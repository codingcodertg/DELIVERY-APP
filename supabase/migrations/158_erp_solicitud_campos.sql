-- ===========================================================================
-- 158 - Solicitud de articulo del ERP, columna por columna de la hoja del dueno: dos tipos nuevos
--       (copy, discontinue), REQUESTER STATUS (lista / no lista), y los campos nuevos al aprobar
-- ===========================================================================
-- Plan en papel: docs/PLAN-158-erp-solicitud-campos.md. ESCRITA Y NO APLICADA: aplicarla es del
-- orquestador, despues del merge, con respaldo hecho y migrate-status antes y despues.
--
-- El dueno (2026-09-30): "en el erp en solicitud quiero que me agregues esa columnas si aun no esta
-- como fields par allenar". "Esas columnas" son las de su hoja de Excel de solicitudes: Date,
-- Location, Required by, Executed by, Request Change, Reactivate, Deactivate (if QOH = 0),
-- Discontinue (same as deactivate but can still have QOH), Create New, Create Copy, Copy Source:
-- Store & Item Code, Requester Comments, REQUESTER STATUS, EXECUTOR STATUS, Executor Comments,
-- Category, Type, Material, Style, Color, Preferred Vendor, Manufacturer's part number,
-- Description on purchase transactions, Cost, Shine, Size, SF/Box, U/M, Item Number (if known),
-- Description on sales transactions, Sales price, Fixed Price or Levels.
-- El mapa columna -> campo esta en src/lib/erp/solicitud-campos.ts (MAPA_DE_LA_HOJA).
--
-- QUE TRAE (sobre la 063/064, las ultimas que definen estos objetos; medido en produccion el
-- 2026-09-30, solo lectura: decide_request y product_vocabulary son las de la 064 letra por letra,
-- el enum erp.request_type tiene los 4 valores de la 063 y su unico dependiente es la columna):
--   1. product_requests.type pasa de enum a TEXTO con CHECK de seis valores: new, copy, edit,
--      reactivate, deactivate, discontinue. Texto y no "alter type add value" porque un valor nuevo
--      de enum NO se puede usar en la misma transaccion que lo crea (Postgres), y entonces la
--      matriz con ROLLBACK no podria probar los tipos nuevos. El enum se borra: no lo usa nadie mas.
--   2. Columna requester_status ('ready' | 'not_ready', defecto 'ready'): REQUESTER STATUS de la
--      hoja. Columna y no payload para que la cola filtre y decide_request compruebe sin abrir el
--      JSON. Las 332 filas que hay quedan 'ready' (son del round-trip del Excel, ya completas).
--   3. set_request_ready(id, ready): quien pidio (o admin/manager) marca su solicitud PENDIENTE
--      como lista o no lista. En new/copy, el borrador lleva la etiqueta 'NOT READY' mientras no
--      lo este, para que el admin no lo publique a medias desde el Catalogo.
--   4. decide_request: la de la 064 con (a) 'discontinue' -> status 'discontinued' (a diferencia
--      de deactivate -> 'inactive'; puede quedar existencia), (b) aprobar una 'not_ready' se
--      rechaza, (c) una edicion aplica tambien description, style, color1 y price_mode.
--      'copy' no cambia nada al aprobar, como 'new': su borrador se publica desde el Catalogo.
--   5. product_vocabulary: la de la 064 con 'style' y 'color' (color1), para las sugerencias del
--      formulario.
--
-- LO QUE NO TOCA: ninguna politica (las tres de product_requests siguen: gate, insert own, read),
-- ningun grant de tabla, ninguna fila de products. Las filas de product_requests cambian de tipo de
-- columna (enum -> texto) sin cambiar de valor.
--
-- Sin begin/commit propios, a proposito: quien aplica envuelve el fichero en una transaccion, y un
-- commit de dentro cerraria la de fuera (paso con la 124).
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. El tipo de solicitud: de enum a texto con CHECK.
-- ---------------------------------------------------------------------------
alter table erp.product_requests
  alter column type type text using type::text;
alter table erp.product_requests
  add constraint product_requests_type_known
  check (type in ('new','copy','edit','reactivate','deactivate','discontinue'));
drop type erp.request_type;

-- ---------------------------------------------------------------------------
-- 2. REQUESTER STATUS.
-- ---------------------------------------------------------------------------
alter table erp.product_requests
  add column requester_status text not null default 'ready'
  constraint product_requests_requester_status_known check (requester_status in ('ready','not_ready'));

-- ---------------------------------------------------------------------------
-- 3. Marcar lista / no lista. DEFINER: la tabla no tiene politica de UPDATE para el solicitante, y
--    no hace falta darsela (podria tocar status o payload); esta funcion solo toca requester_status.
-- ---------------------------------------------------------------------------
create or replace function erp.set_request_ready(p_request_id bigint, p_ready boolean)
 returns void
 language plpgsql
 security definer
 set search_path to ''
as $function$
declare r erp.product_requests;
begin
  select * into r from erp.product_requests where id = p_request_id for update;
  if not found then raise exception 'request % not found', p_request_id; end if;
  if r.requester is distinct from auth.uid() and coalesce(erp.current_app_role()::text,'') not in ('admin','manager') then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if r.status <> 'pending' then raise exception 'request already %', r.status; end if;

  update erp.product_requests
    set requester_status = case when p_ready then 'ready' else 'not_ready' end
    where id = p_request_id;

  -- El borrador de una solicitud new/copy: la etiqueta 'NOT READY' va y viene con el estado. Se busca
  -- por el SKU del payload: la solicitud no lleva product_id porque quien pide (staff) no puede leer
  -- su propio borrador (politica "products read": publicados, o admin/manager) y un INSERT ... RETURNING
  -- se lo rechaza la RLS (medido en el ensayo del 2026-09-30).
  if r.type in ('new','copy') and nullif(r.payload->>'sku','') is not null then
    update erp.products set
      review_tags = case
        when p_ready then array_remove(review_tags, 'NOT READY')
        when 'NOT READY' = any(review_tags) then review_tags
        else review_tags || array['NOT READY']
      end,
      updated_at = now()
      where sku = r.payload->>'sku' and record_status = 'draft';
    update erp.products set needs_review = (coalesce(array_length(review_tags, 1), 0) > 0)
      where sku = r.payload->>'sku' and record_status = 'draft';
  end if;
end $function$;

revoke execute on function erp.set_request_ready(bigint, boolean) from public, anon;
grant execute on function erp.set_request_ready(bigint, boolean) to authenticated;

-- ---------------------------------------------------------------------------
-- 4. decide_request: la de la 064 letra por letra, mas discontinue, el guard de not_ready y las
--    cuatro claves nuevas de edicion. Una prueba del repo compara las dos (solo lineas anadidas).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION erp.decide_request(p_request_id bigint, p_approve boolean, p_note text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare r erp.product_requests; v_closed int;
begin
  if coalesce(erp.current_app_role()::text,'') not in ('admin','manager') then raise exception 'not authorized' using errcode = '42501'; end if;

  -- ROOT LOCK (COR-08). Was an unlocked `select * into r`.
  select * into r from erp.product_requests where id = p_request_id for update;
  if not found then raise exception 'request % not found', p_request_id; end if;
  if r.status <> 'pending' then raise exception 'request already %', r.status; end if;

  if p_approve then
    -- 158: REQUESTER STATUS. El ejecutor solo atiende las listas; una 'not_ready' se puede rechazar, no aprobar.
    if r.requester_status = 'not_ready' then raise exception 'request % is not ready (requester status)', p_request_id; end if;
    if r.type = 'edit' and r.product_id is not null then
      update erp.products set
        name           = case when r.payload ? 'name'           then nullif(r.payload->>'name','')               else name end,
        description    = case when r.payload ? 'description'    then nullif(r.payload->>'description','')        else description end,
        price          = case when r.payload ? 'price'          then nullif(r.payload->>'price','')::numeric      else price end,
        price_mode     = case when r.payload ? 'price_mode'     then nullif(r.payload->>'price_mode','')         else price_mode end,
        cost           = case when r.payload ? 'cost'           then nullif(r.payload->>'cost','')::numeric       else cost end,
        base_unit      = case when r.payload ? 'base_unit'      then nullif(r.payload->>'base_unit','')           else base_unit end,
        sf_per_box     = case when r.payload ? 'sf_per_box'     then nullif(r.payload->>'sf_per_box','')::numeric else sf_per_box end,
        pieces_per_box = case when r.payload ? 'pieces_per_box' then nullif(r.payload->>'pieces_per_box','')::int else pieces_per_box end,
        size_in        = case when r.payload ? 'size_in'        then nullif(r.payload->>'size_in','')             else size_in end,
        size_cm        = case when r.payload ? 'size_cm'        then nullif(r.payload->>'size_cm','')             else size_cm end,
        material       = case when r.payload ? 'material'       then nullif(r.payload->>'material','')            else material end,
        finish         = case when r.payload ? 'finish'         then nullif(r.payload->>'finish','')             else finish end,
        style          = case when r.payload ? 'style'          then nullif(r.payload->>'style','')              else style end,
        color1         = case when r.payload ? 'color1'         then nullif(r.payload->>'color1','')             else color1 end,
        mpn            = case when r.payload ? 'mpn'            then nullif(r.payload->>'mpn','')                 else mpn end,
        verified_level = greatest(coalesce(verified_level, 0), 1),  -- v4_56: approved edit => human-reviewed
        updated_at = now()
      where id = r.product_id;
    elsif r.type = 'reactivate' and r.product_id is not null then
      update erp.products set status = 'active', updated_at = now() where id = r.product_id;
    elsif r.type = 'deactivate' and r.product_id is not null then
      update erp.products set status = 'inactive', updated_at = now() where id = r.product_id;
    elsif r.type = 'discontinue' and r.product_id is not null then
      -- 158: como desactivar, pero el articulo puede seguir con existencia (QOH).
      update erp.products set status = 'discontinued', updated_at = now() where id = r.product_id;
    end if;
    update erp.product_requests
      set status='approved', decided_by=auth.uid(), decided_at=now(), decision_note=p_note
      where id = p_request_id and status = 'pending';
  else
    update erp.product_requests
      set status='rejected', decided_by=auth.uid(), decided_at=now(), decision_note=p_note
      where id = p_request_id and status = 'pending';
  end if;

  -- BELT AND BRACES: 0 rows means someone else decided it while we held the lock. Raise, so the
  -- product edit above rolls back with it rather than being applied a second time.
  get diagnostics v_closed = row_count;
  if v_closed <> 1 then
    raise exception 'request % was decided by a concurrent call — nothing was applied', p_request_id;
  end if;
end $function$;

-- ---------------------------------------------------------------------------
-- 5. product_vocabulary: la de la 064 con style y color (color1).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION erp.product_vocabulary()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_out jsonb;
begin
  if coalesce(erp.current_app_role()::text, '') not in ('admin','manager','staff') then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  select jsonb_build_object(
    'base_unit', coalesce((select jsonb_agg(distinct base_unit order by base_unit)
                             from erp.products
                            where base_unit is not null and btrim(base_unit) <> ''), '[]'::jsonb),
    'material',  coalesce((select jsonb_agg(distinct material order by material)
                             from erp.products
                            where material is not null and btrim(material) <> ''), '[]'::jsonb),
    'finish',    coalesce((select jsonb_agg(distinct finish order by finish)
                             from erp.products
                            where finish is not null and btrim(finish) <> ''), '[]'::jsonb),
    'style',     coalesce((select jsonb_agg(distinct style order by style)
                             from erp.products
                            where style is not null and btrim(style) <> ''), '[]'::jsonb),
    'color',     coalesce((select jsonb_agg(distinct color1 order by color1)
                             from erp.products
                            where color1 is not null and btrim(color1) <> ''), '[]'::jsonb)
  ) into v_out;
  return v_out;
end $function$;

-- ---------------------------------------------------------------------------
-- 6. Autocomprobacion: si algo de arriba no quedo como se describe, la transaccion revienta aqui.
-- ---------------------------------------------------------------------------
do $chk$
declare v_def text; v_n int; v_t text;
begin
  select data_type into v_t from information_schema.columns where table_schema='erp' and table_name='product_requests' and column_name='type';
  if v_t is distinct from 'text' then raise exception '158: product_requests.type deberia ser text, es %', v_t; end if;
  if not exists (select 1 from pg_constraint where conrelid='erp.product_requests'::regclass and conname='product_requests_type_known'
                   and pg_get_constraintdef(oid) like '%''new''%''copy''%''edit''%''reactivate''%''deactivate''%''discontinue''%') then
    raise exception '158: falta product_requests_type_known con los seis tipos';
  end if;
  if exists (select 1 from pg_type t join pg_namespace n on n.oid=t.typnamespace where n.nspname='erp' and t.typname='request_type') then
    raise exception '158: el enum erp.request_type sigue existiendo';
  end if;
  if not exists (select 1 from information_schema.columns where table_schema='erp' and table_name='product_requests' and column_name='requester_status'
                   and data_type='text' and is_nullable='NO' and column_default like '%ready%') then
    raise exception '158: falta requester_status text not null default ready';
  end if;
  if not exists (select 1 from pg_constraint where conrelid='erp.product_requests'::regclass and conname='product_requests_requester_status_known') then
    raise exception '158: falta product_requests_requester_status_known';
  end if;

  select pg_get_functiondef('erp.set_request_ready(bigint, boolean)'::regprocedure) into v_def;
  if v_def not ilike '%security definer%' or v_def not like '%NOT READY%' or v_def not like '%r.status <> ''pending''%' then
    raise exception '158: set_request_ready no es definer o no lleva la etiqueta / el guard de pendiente';
  end if;
  if has_function_privilege('anon', 'erp.set_request_ready(bigint, boolean)', 'execute') then raise exception '158: anon puede ejecutar set_request_ready'; end if;
  if not has_function_privilege('authenticated', 'erp.set_request_ready(bigint, boolean)', 'execute') then raise exception '158: authenticated no puede ejecutar set_request_ready'; end if;

  select pg_get_functiondef('erp.decide_request(bigint, boolean, text)'::regprocedure) into v_def;
  if v_def not like '%r.type = ''discontinue''%' or v_def not like '%status = ''discontinued''%' then raise exception '158: decide_request no atiende discontinue'; end if;
  if v_def not like '%r.requester_status = ''not_ready''%' then raise exception '158: decide_request no comprueba requester_status'; end if;
  if v_def not like '%price_mode%' or v_def not like '%color1%' or v_def not like '%style%' or v_def not like '%''description''%' then raise exception '158: decide_request no aplica las claves nuevas'; end if;
  if v_def not ilike '%security definer%' then raise exception '158: decide_request dejo de ser definer'; end if;

  select pg_get_functiondef('erp.product_vocabulary()'::regprocedure) into v_def;
  if v_def not like '%''style''%' or v_def not like '%''color''%' then raise exception '158: product_vocabulary no devuelve style y color'; end if;

  select count(*) into v_n from pg_policy where polrelid='erp.product_requests'::regclass;
  if v_n <> 3 then raise exception '158: product_requests deberia seguir con 3 politicas, tiene %', v_n; end if;
end $chk$;

-- ---------------------------------------------------------------------------
-- 7. Reversion a la 064 (para pegar A MANO, en una transaccion propia). Antes hay que decidir que
--    hacer con las filas 'copy' / 'discontinue' que ya existan (el enum viejo no las acepta):
--    update erp.product_requests set type = 'new' where type = 'copy';           -- o borrarlas
--    update erp.product_requests set type = 'deactivate' where type = 'discontinue';
--   1. create type erp.request_type as enum ('new', 'edit', 'reactivate', 'deactivate');
--      alter table erp.product_requests drop constraint product_requests_type_known;
--      alter table erp.product_requests alter column type type erp.request_type using type::erp.request_type;
--   2. alter table erp.product_requests drop column requester_status;
--   3. drop function if exists erp.set_request_ready(bigint, boolean);
--   4. volver a pegar los bloques `CREATE OR REPLACE FUNCTION erp.decide_request(...)` y
--      `erp.product_vocabulary()` de la 064_erp_functions.sql (no el fichero entero).
--   5. delete from public.schema_migrations where name = '158_erp_solicitud_campos.sql';
-- La app sin la 158: new/edit/reactivate/deactivate siguen entrando; copy, discontinue y "No lista"
-- contestan "migracion pendiente" (MIGRATION_158_PENDING) sin crear nada; los selects usan `*`.

-- @ledger-below
insert into public.schema_migrations (name, checksum) values ('158_erp_solicitud_campos.sql', '886b036990dbb9406191fa70c6884a3d9d77d5235f079978cba808e889f49fec') on conflict (name) do nothing;
