-- 210: Clientes — quien ve que cliente, por rol (D-728, 2026-10-28).
--
-- El dueño: «Salesperson: can only view and open the customers assigned to them. They cannot see other customers.
-- Manager: can view all customers of their store, and can assign customers to salespeople. Admin: can view everything
-- across all stores, and can also assign customers to salespeople.»
--
-- Que cambia respecto a la 198 (D-683):
--   - El vendedor ya NO ve los clientes libres (sin vendedor): solo los suyos (rep_id = el) y los que creo el mismo.
--   - El gerente ve SOLO los de su tienda: el codigo de la fila (BRO, EDG, MCA, PHR, WES) frente a la tienda de su
--     perfil («RDZ Brownsville», ...). Un gerente SIN tienda en el perfil ve todas (como el admin). Un gerente con una
--     tienda que no tiene codigo (p. ej. «Bodega Azul») no ve ninguna: se dice, no se adivina.
--   - El admin, y cualquier otro rol con el modulo (contabilidad...), ven todo, como antes.
--   - Asignar vendedores: lo hacen admin y gerente. La politica de escritura (customers_can_write, 198) ya deja al
--     gerente actualizar; la restrictiva de aqui le deja ver solo su tienda, asi que asigna solo dentro de ella.
-- La funcion pasa a tres argumentos (rep, creador, tienda); la politica se vuelve a crear con ellos; la de dos
-- argumentos se borra. Sin begin/commit propios.
-- Para deshacer: volver a crear erp.customers_ve_la_fila(uuid, uuid) y la politica como en la 198, y borrar la de tres.

create or replace function erp.customers_codigo_de_tienda(p_nombre text)
  returns text language sql immutable as $$
  select case lower(btrim(coalesce(p_nombre, '')))
    when 'rdz brownsville' then 'BRO'
    when 'rdz edinburg'    then 'EDG'
    when 'rdz mcallen'     then 'MCA'
    when 'rdz pharr'       then 'PHR'
    when 'rdz weslaco'     then 'WES'
    when 'rdz mission'     then 'MIS'
    else null end;
$$;

create or replace function erp.customers_ve_la_fila(p_rep uuid, p_creador uuid, p_store text)
  returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((
    select case
      when p.role = 'sales' then (p_rep = auth.uid() or p_creador = auth.uid())
      when p.role = 'manager' then (
        nullif(btrim(coalesce(p.store, '')), '') is null
        or upper(btrim(coalesce(p_store, ''))) = erp.customers_codigo_de_tienda(p.store)
      )
      else true
    end
    from public.profiles p where p.id = auth.uid()
  ), false);
$$;

drop policy if exists "customers solo los suyos (vendedor)" on erp.customers;
create policy "customers solo los suyos (vendedor)" on erp.customers as restrictive for all to authenticated
  using ((select erp.customers_ve_la_fila(rep_id, created_by, store))) with check (true);

drop function if exists erp.customers_ve_la_fila(uuid, uuid);

-- ===========================================================================
-- Autocomprobacion (mira el catalogo)
-- ===========================================================================
do $chk$
begin
  if not exists (select 1 from pg_policies where schemaname = 'erp' and tablename = 'customers' and policyname = 'customers solo los suyos (vendedor)' and permissive = 'RESTRICTIVE') then
    raise exception '210: falta la politica restrictiva';
  end if;
  if position('p_store' in pg_get_functiondef('erp.customers_ve_la_fila(uuid,uuid,text)'::regprocedure)) = 0 then
    raise exception '210: customers_ve_la_fila no mira la tienda';
  end if;
  if exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'erp' and p.proname = 'customers_ve_la_fila' and p.pronargs = 2) then
    raise exception '210: sigue la funcion de dos argumentos';
  end if;
  if erp.customers_codigo_de_tienda('RDZ McAllen') <> 'MCA' or erp.customers_codigo_de_tienda('Bodega Azul') is not null then
    raise exception '210: el codigo de tienda no cuadra';
  end if;
end $chk$;

-- @ledger-below
insert into public.schema_migrations (name, checksum)
  values ('210_clientes_por_rol.sql', 'c7eda631a2394d2768d6e9dae11576bf2b719dcb77bbb4717fcfddddb23be2a1') on conflict (name) do nothing;
