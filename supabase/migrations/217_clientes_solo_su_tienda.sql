-- 217: Clientes — todos salvo el admin ven SOLO su tienda (D-748, 2026-10-29).
--
-- El dueño (2026-10-29): «todos, excepto admins, […] solo pueden ver la tienda que estan asignados. Porque ahorita Carlos
-- Fuentes puede ver todas las tiendas, al menos en la parte de customers, y no es asi».
--
-- Que cambia respecto a la 215: `erp.customers_ve_la_fila` deja de tener un «else true». Medido en produccion el
-- 2026-10-29: Carlos Fuentes es `accounting` (oficina) con tienda RDZ Pharr y el modulo de Clientes, y la 210/215 solo
-- acotaban a `sales` y `manager`; cualquier otro rol con el modulo veia todo.
--   - admin: todo.
--   - cualquier otro rol: las filas de SU tienda (codigo de la fila frente a la tienda del perfil). Sin tienda en el
--     perfil, NADA (antes el gerente sin tienda veia todo): se dice, no se adivina. El vendedor ademas sigue viendo las
--     suyas (asignado o creado por el), esten en la tienda que esten.
-- `erp.busca_clientes_en_toda_la_empresa` (215) no cambia: la busqueda a nivel de empresa, con pocas columnas, sigue
-- abierta a quien tiene el modulo. Sin begin/commit propios.
-- Para deshacer: volver a crear erp.customers_ve_la_fila como en la 215.

create or replace function erp.customers_ve_la_fila(p_rep uuid, p_creador uuid, p_store text)
  returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((
    select case
      when p.role = 'admin' then true
      else (
        upper(btrim(coalesce(p_store, ''))) = erp.customers_codigo_de_tienda(p.store)
        or (p.role = 'sales' and (p_rep = auth.uid() or p_creador = auth.uid()))
      )
    end
    from public.profiles p where p.id = auth.uid()
  ), false);
$$;

-- ===========================================================================
-- Autocomprobacion (mira el catalogo)
-- ===========================================================================
do $chk$
declare def text;
begin
  def := pg_get_functiondef('erp.customers_ve_la_fila(uuid,uuid,text)'::regprocedure);
  if position('else true' in def) > 0 then raise exception '217: sigue el «else true»'; end if;
  if position('when p.role = ''admin'' then true' in def) = 0 then raise exception '217: el admin perdio todo'; end if;
  if position('erp.customers_codigo_de_tienda(p.store)' in def) = 0 then raise exception '217: no mira la tienda'; end if;
  if position('p.role = ''sales'' and (p_rep = auth.uid() or p_creador = auth.uid())' in def) = 0 then raise exception '217: el vendedor perdio los suyos'; end if;
  if not exists (select 1 from pg_policies where schemaname = 'erp' and tablename = 'customers' and policyname = 'customers solo los suyos (vendedor)' and permissive = 'RESTRICTIVE') then
    raise exception '217: falta la politica restrictiva de la 210';
  end if;
end $chk$;

-- @ledger-below
insert into public.schema_migrations (name, checksum)
  values ('217_clientes_solo_su_tienda.sql', '12a2451c0e006f82e974b8de7233ac3b133997d598601465c5b2f1c8095b4210') on conflict (name) do nothing;
