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
-- Solo `create or replace` de `public.warehouse_ops_can_see` (misma firma, mismo SECURITY DEFINER y search_path).
-- 237/238/239 en espera, intactas. Para deshacer: volver a aplicar la definición de la 265.

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
end $chk$;

-- @ledger-below
insert into public.schema_migrations (name, checksum) values ('292_almacen_ve_su_tienda.sql', 'e42dc1b24d06db0b024d14eb2ea21a8776f3fba3e7345356f7f95e68eff97796') on conflict (name) do nothing;
