-- 294: merma — el reporte acepta a los empleados de almacén SIN cuenta del Hub (expedientes) (2026-11-11).
--
-- Bug en producción (Roberto, 11 nov, Pharr): un reporte de merma con «¿Quién lo rompió?» = Juan Carlos Castanon no se
-- pudo enviar: «warehouse_ops: empleado desconocido». La 284 añadió los expedientes sin usuario al selector
-- (`warehouse_ops_people()`), pero `warehouse_ops_file_report` seguía validando los ids SOLO contra `public.profiles`,
-- así que rechazaba justo a esa gente.
--
-- Arreglo: las dos validaciones de empleados de `warehouse_ops_file_report` (sujetos y «lo rompió») aceptan un id si es
-- un profile O un expediente que `warehouse_ops_people()` le ofrece a quien llama (sin usuario, sin baja, de almacén y
-- de SU tienda — la misma regla del selector). Nada más del cuerpo cambia: se reescribe la función a partir de su
-- definición actual, sustituyendo solo esas dos condiciones, y se comprueba que la sustitución ocurrió dos veces.
--
-- Additive. 237/238/239 intactas.

do $m$
declare
  f text;
  viejo constant text := 'where not exists (select 1 from public.profiles pr where pr.id = u)) then';
  nuevo constant text := 'where not exists (select 1 from public.profiles pr where pr.id = u) and not exists (select 1 from public.warehouse_ops_people() w where w.id = u)) then';
  antes int;
begin
  f := pg_get_functiondef('public.warehouse_ops_file_report(text,text,uuid[],jsonb,text[],jsonb)'::regprocedure);
  antes := (length(f) - length(replace(f, viejo, ''))) / length(viejo);
  if antes <> 2 then
    raise exception '294: esperaba 2 validaciones de empleado en warehouse_ops_file_report, encontre %', antes;
  end if;
  execute replace(f, viejo, nuevo);
end $m$;

-- ===========================================================================
-- Autocomprobacion
-- ===========================================================================
do $chk$
declare f text; n int;
begin
  f := pg_get_functiondef('public.warehouse_ops_file_report(text,text,uuid[],jsonb,text[],jsonb)'::regprocedure);
  n := (length(f) - length(replace(f, 'public.warehouse_ops_people() w where w.id = u', ''))) / length('public.warehouse_ops_people() w where w.id = u');
  if n <> 2 then
    raise exception '294: las dos validaciones deben aceptar expedientes (encontre %)', n;
  end if;
  if position('security definer' in lower(f)) = 0 then
    raise exception '294: warehouse_ops_file_report debe seguir siendo security definer';
  end if;
end $chk$;

-- @ledger-below
insert into public.schema_migrations (name, checksum) values ('294_merma_acepta_expedientes.sql', '716626341a22d6a464d06f1e28e85bbd7ed471f01e90dd791a37df206b9219a8') on conflict (name) do nothing;
