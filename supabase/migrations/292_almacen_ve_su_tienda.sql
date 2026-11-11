-- 292: Operaciones de almacén — todos los de la tienda ven los reportes de SU tienda (2026-11-10).
--
-- El dueño (10 nov): «todos pueden ver todos los reportes en su tienda solamente». Hasta hoy el personal con nivel
-- `scrap_only` (solo merma) veía SOLO sus propias mermas, y el nivel `full` sin ser gerente/supervisor, solo lo suyo.
-- Ahora, de los reportes que NO son de RR. HH., cualquiera con nivel en la app ve los de su tienda (`profiles.store` o
-- `visible_stores`); `scrap_only` sigue limitado a los tipos que abre su nivel (merma). Los de RR. HH. (zona,
-- insubordinación, positivo) NO cambian.
--
-- Efecto colateral buscado: los grupos de aprobación (`warehouse_scrap_groups`, su RLS llama a esta función con
-- autor nulo) ya se ven desde el almacén de la tienda, para que el supervisor vea lo que le falta firmar. QUIÉN FIRMA y
-- QUIÉN APRUEBA no cambia: eso es `warehouse_ops_can_manage`, intacta.
--
-- `create or replace` de `public.warehouse_ops_can_see` (misma firma, mismo SECURITY DEFINER y search_path).
--
-- ESCRITURAS (revisión de seguridad): ampliar `can_see` amplía también toda función SECURITY DEFINER que escribe y la
-- usaba como ÚNICA puerta. Se revisaron todas las de `public` que llaman a `warehouse_ops_can_see`:
--   · warehouse_ops_add_photos       escribe; ya exige autor o `warehouse_ops_can_manage`. Sin cambio.
--   · warehouse_ops_set_scrap_stage  escribe; ya exige `warehouse_ops_can_manage`. Sin cambio.
--   · warehouse_ops_sign_scrap       escribe; ya exige `warehouse_ops_can_manage`. Sin cambio.
--   · warehouse_ops_unsign_scrap     escribe; ya exige `warehouse_ops_can_manage`. Sin cambio.
--   · warehouse_ops_sign_scrap_group escribe; ya exige `warehouse_ops_can_manage`. Sin cambio.
--   · warehouse_ops_set_photo_hashes escribe y SOLO miraba `can_see` → aquí gana la misma puerta que add_photos
--     (autor o quien gestiona la tienda). Sin esto, tras la 292 cualquiera del almacén de la tienda podría rellenar las
--     huellas de las fotos de la merma de otro.
-- Ninguna política de escritura (insert/update/delete) usa `can_see`; las de lectura son las que se amplían a propósito.
--
-- 237/238/239 en espera, intactas. Para deshacer: volver a aplicar la definición de la 265 (y la de la 268 para
-- warehouse_ops_set_photo_hashes).

create or replace function public.warehouse_ops_can_see(r_kind text, r_store text, r_author uuid)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $function$
  select coalesce((
    select
      n.nivel = 'admin'
      or (n.nivel = 'store_admin' and t.mia)
      or (
        r_kind in ('zone', 'insubordination', 'positive')
        and (
          p.recruiting_role in ('admin', 'manager')
          or (n.nivel = 'full' and p.role = 'manager' and t.mia)
        )
      )
      or (
        r_kind not in ('zone', 'insubordination', 'positive')
        and (
          (n.nivel = 'scrap_only' and r_author = p.id and r_kind = any(public.warehouse_ops_kinds_of(n.nivel)))
          or (n.nivel = 'full' and (
            r_author = p.id
            or ((p.role = 'manager' or 'warehouse_ops_supervisor' = any(coalesce(p.permissions, '{}'))) and t.mia)
          ))
          or (n.nivel in ('scrap_only', 'full') and t.mia and (n.nivel <> 'scrap_only' or r_kind = any(public.warehouse_ops_kinds_of(n.nivel))))
        )
      )
    from public.profiles p
      cross join lateral (select coalesce(public.warehouse_ops_level_of(p.id), '') as nivel) n
      cross join lateral (select (p.store = r_store or r_store = any(coalesce(p.visible_stores, '{}'))) is true as mia) t
    where p.id = auth.uid()
  ), false);
$function$;

-- Escritura: las huellas de las fotos solo las pone el autor o quien gestiona la tienda (igual que add_photos, 268).
create or replace function public.warehouse_ops_set_photo_hashes(p_report uuid, p_hashes text[])
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  yo uuid := auth.uid();
  r record;
  n int;
  nuevas text[];
begin
  select * into r from public.warehouse_reports where id = p_report;
  if r.id is null then raise exception 'warehouse_ops: reporte desconocido'; end if;
  if yo is null or not public.warehouse_ops_can_see(r.kind, r.store, r.author_id) then
    raise exception 'warehouse_ops: sin acceso' using errcode = '42501';
  end if;
  if not (r.author_id = yo or public.warehouse_ops_can_manage(r.store)) then
    raise exception 'warehouse_ops: solo quien lo lleno o el gerente de la tienda pone las huellas' using errcode = '42501';
  end if;
  n := cardinality(coalesce(r.photos, '{}'));
  if n = 0 then return; end if;
  -- Las huellas vienen alineadas con las fotos: ni mas ni menos.
  if cardinality(coalesce(p_hashes, '{}')) <> n then
    raise exception 'warehouse_ops: las huellas no cuadran con las fotos (% fotos)', n using errcode = '22023';
  end if;
  -- Solo rellena huecos: una huella guardada no se cambia.
  nuevas := (select coalesce(array_agg(case
                when (coalesce(r.photo_hashes, '{}'))[i] ~ '^[0-9a-f]{64}$' then (coalesce(r.photo_hashes, '{}'))[i]
                when (coalesce(p_hashes, '{}'))[i] ~ '^[0-9a-f]{64}$' then (coalesce(p_hashes, '{}'))[i]
              end), '{}') from generate_series(1, n) i);
  if nuevas is distinct from r.photo_hashes then
    update public.warehouse_reports set photo_hashes = nuevas where id = p_report;
  end if;
end $function$;

-- ===========================================================================
-- Autocomprobacion
-- ===========================================================================
do $chk$
declare d text;
begin
  select pg_get_functiondef('public.warehouse_ops_can_see(text,text,uuid)'::regprocedure) into d;
  if position('n.nivel in (''scrap_only'', ''full'') and t.mia' in d) = 0 then
    raise exception '292: la regla de la tienda no quedo en warehouse_ops_can_see';
  end if;
  if position('SECURITY DEFINER' in upper(d)) = 0 then
    raise exception '292: warehouse_ops_can_see dejo de ser security definer';
  end if;
  if position('''zone'', ''insubordination'', ''positive''' in d) = 0 then
    raise exception '292: se perdio la regla de RR. HH.';
  end if;
  -- Ninguna funcion que ESCRIBE puede quedarse con can_see como unica puerta.
  select pg_get_functiondef('public.warehouse_ops_set_photo_hashes(uuid,text[])'::regprocedure) into d;
  if position('r.author_id = yo or public.warehouse_ops_can_manage(r.store)' in d) = 0 then
    raise exception '292: warehouse_ops_set_photo_hashes sigue sin la puerta de autor o gerente';
  end if;
  if exists (
    select 1 from pg_proc p join pg_namespace s on s.oid = p.pronamespace
     where s.nspname = 'public' and p.prosecdef
       and p.prosrc ilike '%warehouse_ops_can_see%'
       and p.prosrc ~* '\m(insert|update|delete)\M'
       and p.prosrc not ilike '%warehouse_ops_can_manage%'
  ) then
    raise exception '292: hay una funcion que escribe con warehouse_ops_can_see como unica puerta';
  end if;
end $chk$;

-- @ledger-below
insert into public.schema_migrations (name, checksum) values ('292_almacen_ve_su_tienda.sql', '5ff07bfe013055cd44dc473b646831f77dc8a007c97a52afc3f037742d56228b') on conflict (name) do nothing;
