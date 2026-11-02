-- 226: Clientes — la oficina (accounting) tambien pide ALTAS, como ventas; editar no (D-NEXT, 2026-11-02).
--
-- El dueño: «dale la opción de request new client así como sales a los de office, así como Carlos Fuentes»; y luego:
-- «Carlos Fuentes déjalo como estaba, solo dale la opción de add new customer».
--
-- Que habia: la politica de insertar una solicitud (216, «customer requests insert own (writers)») pasa por
-- erp.customers_can_write() (198: admin, y gerente o vendedor con el modulo), asi que la oficina no podia ni pedir un alta.
--
-- Que hace: erp.customers_can_request(): customers_can_write() o oficina (accounting) con el modulo. La politica de
-- insertar solicitudes pasa a mirarla. customers_can_write() NO cambia: la oficina sigue sin editar ni pedir ediciones.
--
-- Sin begin/commit propios. Para deshacer: volver a crear la politica como en la 216 (con customers_can_write);
-- drop function erp.customers_can_request(); borrar la fila del registro.
create or replace function erp.customers_can_request()
  returns boolean language sql stable security definer set search_path = public as $$
  select erp.customers_can_write() or coalesce((
    select (role = 'accounting' and 'customers' = any(coalesce(module_access, '{}')))
    from public.profiles where id = auth.uid()
  ), false);
$$;
revoke execute on function erp.customers_can_request() from public, anon;
grant  execute on function erp.customers_can_request() to authenticated;

drop policy if exists "customer requests insert own (writers)" on erp.customer_requests;
create policy "customer requests insert own (writers)" on erp.customer_requests as permissive for insert to authenticated
  with check (requested_by = (select auth.uid()) and status = 'pending' and (select erp.customers_can_request()));

-- ===========================================================================
-- Autocomprobacion (mira el catalogo)
-- ===========================================================================
do $chk$
begin
  if position('''accounting''' in pg_get_functiondef('erp.customers_can_request()'::regprocedure)) = 0 then
    raise exception '226: customers_can_request no mira accounting';
  end if;
  if position('''accounting''' in pg_get_functiondef('erp.customers_can_write()'::regprocedure)) > 0 then
    raise exception '226: customers_can_write no debe dar accounting (la oficina no edita)';
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'erp' and tablename = 'customer_requests'
                   and policyname = 'customer requests insert own (writers)' and with_check ~ 'customers_can_request') then
    raise exception '226: la politica de insertar solicitudes no pasa por customers_can_request';
  end if;
end $chk$;

-- @ledger-below
insert into public.schema_migrations (name, checksum)
  values ('226_clientes_oficina_solicita.sql', '69e0976741f68e1014bfc0632da2ad8a05fc24df02106b67235b1ba3a0962fd7') on conflict (name) do nothing;
