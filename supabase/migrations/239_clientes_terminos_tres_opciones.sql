-- 239: los términos de pago de un cliente (`erp.customers.terms`), a las tres opciones de la ficha, y la base que solo
-- acepta esas (o lo que la fila ya tenía).
--
-- El dueño (2026-11-04): «terms in customer can a dropdown that says due on receipt / 15 days / 30 days». Desde ese cambio
-- la ficha ofrece un desplegable (`src/lib/customers/terminos.ts`) que guarda «Due on receipt», «Net 15» o «Net 30» —las
-- tres formas que ya eran las más comunes— y enseña «Due on receipt / 15 days / 30 days» (o «Al recibir / 15 días /
-- 30 días»). **La pantalla NO necesita esta migración**: lee «NET 30», «Net30» o «COD» como su opción, y lo que no es
-- ninguna («25 Days») lo enseña tal cual y lo conserva al guardar.
--
-- Esta migración hace dos cosas:
--
--   1. Deja lo guardado igual que lo que se ve: reescribe en su forma estable lo que dice una de las tres opciones escrita
--      de otra manera. La regla es la de `terminoCanonico` escrita en SQL (`pg_temp.termino`). Lo que no es ninguna de las
--      tres NO se toca: nunca se pierde un término.
--      Medido en producción el 2026-11-04 (solo lectura, solo conteos; 1.353 filas, 797 con términos), filas que cambia:
--        «NET 30»          → «Net 30»           77  (70 vivas, 7 archivadas)
--        «DUE ON RECEIPT»  → «Due on receipt»   49  (46 vivas, 3 archivadas)
--        «NET 15»          → «Net 15»           14  (13 vivas, 1 archivada)
--        «15 Days»         → «Net 15»            1
--      Total 141. Ya estaban en su forma: «Due on receipt» 392, «Net 30» 165, «Net 15» 31.
--      Se quedan como están (68): «25 Days» 48, «NET 6» 6, «net 7» 6, «CASH» 3, «CREDIT» 2, «45 days.» 1, «Net 60» 1,
--      «NET 60 DAYS» 1. La ficha los enseña como cuarta opción apagada «25 Days (old value)».
--      Efectos del UPDATE: `customers_touch` mueve `updated_at` de esas filas (sin sesión, `updated_by` no cambia), y
--      `customers_zz_historial` deja una línea «edit» por fila con la nota de abajo, sin autor.
--
--   2. La validación en el servidor. Clientes no tiene acción de servidor: la ficha escribe en `erp.customers` por
--      PostgREST (RLS de la 221: edita solo el admin) y las solicitudes del vendedor y del gerente entran por
--      `aprueba_solicitud_de_cliente` (216) y `aprueba_edicion_de_cliente` (221), que escriben la fila. Un disparador en la
--      fila cubre los tres caminos. Acepta:
--        - vacío (se guarda null) o una de las tres;
--        - el valor que la fila ya tenía, sin cambiar (guardar otra cosa de una ficha con «25 Days» no falla);
--        - un valor que ya tiene OTRA fila: `junta_clientes` (189) rellena el término vacío de la superviviente con el de la
--          duplicada, y copiar los datos a otra tienda lleva el de la empresa. Es «lo que ya había», no texto nuevo;
--        - una sesión sin usuario (`auth.uid()` null: los guiones con la conexión directa, como `importa-clientes.mjs`,
--          que normaliza los sinónimos y guarda lo demás tal cual del Excel, y esta misma migración).
--      Lo demás se rechaza con `check_violation` y la ficha dice «No se guardó: …».
--
-- Sin begin/commit: quien aplica envuelve el fichero (el `set_config(..., true)` dura lo que la transacción). **Sin
-- aplicar** cuando se escribió: la aplica el orquestador tras fusionar, con `migrate-status` antes y después.
--
-- Reversión:
--   drop trigger if exists customers_terminos on erp.customers;
--   drop function if exists erp.customers_terminos_validos();
--   (El paso 1 no se deshace: «NET 30» y «Net 30» dicen lo mismo, y el historial guarda el valor de antes de cada fila.)

-- ---------------------------------------------------------------------------
-- 1. Lo guardado, en su forma estable
-- ---------------------------------------------------------------------------
create or replace function pg_temp.termino(t text) returns text language sql immutable as $$
  select case
    when x.c in ('dueonreceipt', 'dueuponreceipt', 'duereceipt', 'uponreceipt', 'onreceipt', 'payableonreceipt', 'dueatreceipt',
                 'cod', 'cashondelivery', 'alrecibir', 'contraentrega') then 'Due on receipt'
    when x.c ~ '^(net|n)?15(days?|dias?|d)?$' then 'Net 15'
    when x.c ~ '^(net|n)?30(days?|dias?|d)?$' then 'Net 30'
    else null
  end
  from (select regexp_replace(translate(lower(coalesce(t, '')), 'áéíóúü', 'aeiouu'), '[^a-z0-9]', '', 'g') as c) x
$$;

select set_config('rtg.nota', 'Migración 239: términos en su forma estable (misma opción escrita de otra manera)', true);

update erp.customers
   set terms = pg_temp.termino(terms)
 where pg_temp.termino(terms) is not null
   and terms is distinct from pg_temp.termino(terms);

select set_config('rtg.nota', '', true);

-- ---------------------------------------------------------------------------
-- 2. La base acepta solo las tres, el vacío, o lo que ya había
-- ---------------------------------------------------------------------------
create or replace function erp.customers_terminos_validos()
  returns trigger language plpgsql set search_path = public, erp, pg_temp as $$
begin
  if NEW.terms is not null and btrim(NEW.terms) = '' then NEW.terms := null; end if;
  if NEW.terms is null or NEW.terms in ('Due on receipt', 'Net 15', 'Net 30') then return NEW; end if;
  if tg_op = 'UPDATE' and NEW.terms is not distinct from OLD.terms then return NEW; end if;
  if auth.uid() is null then return NEW; end if;
  if exists (select 1 from erp.customers x where x.terms = NEW.terms and x.id is distinct from NEW.id) then return NEW; end if;
  raise exception using
    errcode = 'check_violation',
    message = format('Terms «%s» is not one of: Due on receipt, Net 15, Net 30', NEW.terms);
end $$;

drop trigger if exists customers_terminos on erp.customers;
create trigger customers_terminos before insert or update of terms on erp.customers
  for each row execute function erp.customers_terminos_validos();

-- Comprobación: no queda ningún término que la regla del paso 1 cambiaría.
do $chk$
declare n int;
begin
  select count(*) into n from erp.customers
   where pg_temp.termino(terms) is not null and terms is distinct from pg_temp.termino(terms);
  if n > 0 then
    raise exception '239: quedan % filas con un término escrito de otra forma', n;
  end if;
end $chk$;

-- @ledger-below
insert into public.schema_migrations (name, checksum)
  values ('239_clientes_terminos_tres_opciones.sql', '487b6b84b88f9a8fbc640b3b1290b1e9b90bd81753c107a9a7e0ef556313b138') on conflict (name) do nothing;
