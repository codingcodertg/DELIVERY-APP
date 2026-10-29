-- 215: Clientes — el vendedor ve su tienda, abre solo los suyos y busca en toda la empresa (D-740, 2026-10-29).
--
-- El dueño (2026-10-29): «Si ellos buscan algo en el search, pueden buscar cualquier cliente a nivel de toda la
-- database. Ellos solo pueden ver los clientes de su propia tienda y solo pueden abrir los que son sus clientes.»
--
-- Que cambia respecto a la 210 (D-728):
--   1. `erp.customers_ve_la_fila`: el vendedor ve, ademas de los suyos (rep_id = el, o los que creo), las filas de SU
--      tienda (el codigo de la fila frente a la tienda de su perfil, como el gerente). Un vendedor SIN tienda en el
--      perfil sigue viendo solo los suyos. Gerente y admin, como en la 210.
--      Cuales de esos puede ABRIR lo decide la pantalla (solo los suyos); la base le deja LEER la tienda entera, que es
--      lo que hace falta para pintar la lista.
--   2. `erp.busca_clientes_en_toda_la_empresa(p_q)`: la busqueda a nivel de toda la base, con pocas columnas (id,
--      tienda, cuenta, cuenta unificada, estado, vendedor, empresa, archivado) y nada de telefonos, correos ni
--      direcciones: lo que el vendedor puede ver de un cliente que no es suyo. SECURITY DEFINER, para saltar la
--      politica de la fila; exige el modulo (has_customers_access) y al menos dos letras; 100 filas como mucho.
-- Sin begin/commit propios.
-- Para deshacer: volver a crear erp.customers_ve_la_fila como en la 210 y `drop function erp.busca_clientes_en_toda_la_empresa(text)`.

create or replace function erp.customers_ve_la_fila(p_rep uuid, p_creador uuid, p_store text)
  returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((
    select case
      when p.role = 'sales' then (
        p_rep = auth.uid() or p_creador = auth.uid()
        or upper(btrim(coalesce(p_store, ''))) = erp.customers_codigo_de_tienda(p.store)
      )
      when p.role = 'manager' then (
        nullif(btrim(coalesce(p.store, '')), '') is null
        or upper(btrim(coalesce(p_store, ''))) = erp.customers_codigo_de_tienda(p.store)
      )
      else true
    end
    from public.profiles p where p.id = auth.uid()
  ), false);
$$;

create or replace function erp.busca_clientes_en_toda_la_empresa(p_q text)
  returns table (id bigint, store text, account text, unified_account text, status_store text, rep_id uuid, company_id uuid, archived_at timestamptz)
  language sql stable security definer set search_path = public, erp as $$
  select c.id, c.store, c.account, c.unified_account, c.status_store, c.rep_id, c.company_id, c.archived_at
  from erp.customers c
  where public.has_customers_access()
    and length(btrim(coalesce(p_q, ''))) >= 2
    and (
      c.account ilike '%' || btrim(p_q) || '%'
      or coalesce(c.unified_account, '') ilike '%' || btrim(p_q) || '%'
      or coalesce(c.contact_name, '') ilike '%' || btrim(p_q) || '%'
    )
  order by c.account, c.id
  limit 100;
$$;

revoke all on function erp.busca_clientes_en_toda_la_empresa(text) from public, anon;
grant execute on function erp.busca_clientes_en_toda_la_empresa(text) to authenticated;

-- ===========================================================================
-- Autocomprobacion (mira el catalogo)
-- ===========================================================================
do $chk$
declare
  def text;
begin
  def := pg_get_functiondef('erp.customers_ve_la_fila(uuid,uuid,text)'::regprocedure);
  if position('erp.customers_codigo_de_tienda(p.store)' in def) = 0 then
    raise exception '215: customers_ve_la_fila no mira la tienda';
  end if;
  if position('p.role = ''sales''' in def) = 0 or position('p_creador = auth.uid()' in def) = 0 then
    raise exception '215: el vendedor perdio los suyos';
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'erp' and tablename = 'customers' and policyname = 'customers solo los suyos (vendedor)' and permissive = 'RESTRICTIVE') then
    raise exception '215: falta la politica restrictiva de la 210';
  end if;
  if not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'erp' and p.proname = 'busca_clientes_en_toda_la_empresa' and p.prosecdef) then
    raise exception '215: la busqueda no es security definer';
  end if;
  if has_function_privilege('anon', 'erp.busca_clientes_en_toda_la_empresa(text)', 'execute') then
    raise exception '215: anon puede buscar';
  end if;
  if (select count(*) from erp.busca_clientes_en_toda_la_empresa('a')) <> 0 then
    raise exception '215: con una letra no se busca';
  end if;
end $chk$;

-- @ledger-below
insert into public.schema_migrations (name, checksum)
  values ('215_clientes_vendedor_su_tienda_y_busqueda.sql', 'c2a40a8fd1e8799d6eea0c2bea8a679a96f357bbd1ebdb83a3f53ebd87b99573') on conflict (name) do nothing;
