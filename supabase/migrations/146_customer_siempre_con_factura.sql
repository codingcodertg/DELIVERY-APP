-- 146 - Una orden cuyo tipo pide factura (Customer) no sale de borrador ni se entrega sin ella
-- ===========================================================================
-- El dueno, literal (2026-09-25): "Invoice pending shouldn't show customers, that shouldn't be possible
-- anyway". Aclarado: "me refiero que el pending invoice no deberia aparecer para customer porque el
-- customer siempre debe llevar invoice, revisa eso".
--
-- Plan en papel: docs/PLAN-146-customer-siempre-con-factura.md. ESCRITA Y NO APLICADA: aplicarla es del
-- orquestador, despues del merge, con respaldo hecho y migrate-status antes y despues.
--
-- Lo que habia: la factura solo se exigia en la PANTALLA, y en un solo sitio (el boton de enviar del
-- modal, D-049). La base no la miraba nunca. Medido en produccion por el orquestador (2026-09-25, solo
-- lectura): 5 Customer entregadas sin factura (#93, #163, #197, #223, #243), creadas y entregadas sin
-- pasar por el envio.
--
-- Que trae, y SOLO esto:
--   Una funcion nueva, public.guard_factura_obligatoria(), y su disparador BEFORE INSERT OR UPDATE en
--   public.deliveries (deliveries_guard_invoice). NO toca guard_delivery_stage (la 145 sigue siendo su
--   ultima definicion), ni politicas, ni columnas, ni datos.
--
-- La regla: se rechaza la escritura si la orden QUEDA fuera de draft/rejected/canceled, con invoice_num
-- vacio, su tipo pide factura, Y la escritura es de las que la dejan asi:
--   - un INSERT (crear ya pendiente, aprobada, la re-entrega, el resto de una carga partida);
--   - un UPDATE que cambia la etapa (enviar, aprobar, entregar ya, deshacer...);
--   - un UPDATE que cambia el tipo (una Intertienda viva que pasa a Customer);
--   - un UPDATE que vacia la factura que tenia.
--
-- Cuatro decisiones, con su motivo:
--   1. LAS 5 VIEJAS NO REVIENTAN. Un UPDATE que no cambia etapa ni tipo, sobre una orden que YA estaba sin
--      factura, pasa: asignarle chofer, cambiarle la fecha, la publicacion de la ruta (135, que escribe
--      chofer/secuencia/carga) o una nota no la dejan peor de lo que estaba. Lo que si se les pide es la
--      factura antes de moverlas de etapa. Ponerla (125, desde la fila) pasa siempre: la deja con factura.
--   2. EL TIPO LO DECIDE LA REGLA, no el nombre: settings.order_type_rules -> <tipo> ->> 'docRef'. Si la
--      regla existe y no dice docRef, cuenta como 'invoice' (igual que la app: `docRef ?? "invoice"`). Si el
--      tipo NO tiene regla explicita, la base no lo exige: la app aplica ahi un respaldo por palabras
--      clave (`fallbackRule`, required.ts) y copiarlo aqui seria una segunda definicion que acabaria
--      discrepando (el mismo motivo que la 125 dio para no leer la regla). La autocomprobacion de abajo
--      EXIGE que hoy Customer tenga regla explicita con docRef 'invoice'; si no, la migracion falla.
--      La regla se lee SOLO cuando la escritura ya iba a violar el resto de condiciones: la inmensa
--      mayoria de escrituras sale antes, sin leer settings (la 131 aviso de leer ese jsonb por fila).
--   3. EL ADMIN TAMBIEN. El dueno dijo "siempre". Es la misma postura de la 122: una invariante de la
--      orden, no un permiso de rol. Esta funcion no tiene salida de admin.
--   4. SIN SESION (auth.uid() null: postgres, una migracion, service-role) PASA, como en el guard desde la
--      019. Nada de la app escribe deliveries con la llave de servicio (medido con grep en src/app/api y
--      src/lib el 2026-09-25); lo que queda sin sesion es el SQL a mano del orquestador, que es por donde
--      se reparan datos.
--
-- Lo que NO cambia:
--   - guard_delivery_stage (145), las politicas de deliveries, deliveries_borradas, order_events.
--   - Ponerle la factura a una orden (125) y agregar material (138).
--   - Borradores, rechazadas y anuladas: se guardan sin factura como hasta ahora (D-049).
--
-- El orden de los disparadores: los BEFORE van por orden alfabetico, asi que deliveries_guard_invoice
-- corre ANTES que deliveries_guard_stage. No importa: esta funcion no modifica NEW, solo rechaza o deja
-- pasar; si las dos rechazarian, el mensaje que llega es el de esta.
--
-- Sin begin/commit propios, a proposito: quien aplica envuelve el fichero en una transaccion, y un commit
-- de dentro cerraria la de fuera (paso con la 124).
-- ===========================================================================

create or replace function public.guard_factura_obligatoria()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  regla jsonb;
  doc   text;
begin
  if auth.uid() is null then return NEW; end if;

  -- Borrador, rechazada y anulada todavia no necesitan la factura, o ya da igual.
  if coalesce(NEW.stage, 'draft') in ('draft','rejected','canceled') then return NEW; end if;

  -- Con factura, nada que mirar.
  if coalesce(btrim(NEW.invoice_num), '') <> '' then return NEW; end if;

  -- Una orden que YA estaba sin factura y a la que esta escritura no le cambia etapa ni tipo: pasa.
  if TG_OP = 'UPDATE'
     and NEW.stage is not distinct from OLD.stage
     and coalesce(btrim(NEW.order_type), '') = coalesce(btrim(OLD.order_type), '')
     and coalesce(btrim(OLD.invoice_num), '') = '' then
    return NEW;
  end if;

  -- Solo aqui se lee la regla del tipo.
  select s.order_type_rules -> btrim(NEW.order_type) into regla from public.settings s where s.id = 1;
  if regla is null or jsonb_typeof(regla) <> 'object' then return NEW; end if;
  doc := coalesce(regla ->> 'docRef', 'invoice');
  if doc = 'invoice' then
    raise exception 'INVOICE_REQUIRED: a % order needs its Invoice # outside draft', btrim(NEW.order_type);
  end if;
  return NEW;
end $function$
;

drop trigger if exists deliveries_guard_invoice on public.deliveries;
create trigger deliveries_guard_invoice before insert or update on public.deliveries
  for each row execute function public.guard_factura_obligatoria();

-- ===========================================================================
-- Se comprueba a si misma
-- ===========================================================================
-- Se mira el CODIGO, sin las lineas de comentario (leccion de la 144): se quitan solo las lineas que
-- EMPIEZAN por `--` (la `n` de las banderas hace que `^` y `$` valgan por linea) y los espacios se colapsan
-- a uno, para no depender de la alineacion.
do $chk$
declare
  def    text := pg_get_functiondef('public.guard_factura_obligatoria()'::regprocedure);
  codigo text := regexp_replace(regexp_replace(def, '^[ \t]*--.*$', '', 'gn'), '\s+', ' ', 'g');
  vivas  int;
  todas  int;
begin
  -- Las cuatro piezas de la regla, en el codigo y no en un comentario.
  if position('if coalesce(NEW.stage, ''draft'') in (''draft'',''rejected'',''canceled'') then return NEW; end if;' in codigo) = 0 then
    raise exception '146: falta la salida de borrador, rechazada y anulada';
  end if;
  if position('if coalesce(btrim(NEW.invoice_num), '''') <> '''' then return NEW; end if;' in codigo) = 0 then
    raise exception '146: falta la salida de la orden con factura';
  end if;
  if position('and NEW.stage is not distinct from OLD.stage and coalesce(btrim(NEW.order_type), '''') = coalesce(btrim(OLD.order_type), '''') and coalesce(btrim(OLD.invoice_num), '''') = '''' then return NEW;' in codigo) = 0 then
    raise exception '146: falta la salida de las viejas sin factura (sin cambio de etapa ni de tipo)';
  end if;
  if position('doc := coalesce(regla ->> ''docRef'', ''invoice'');' in codigo) = 0
     or position('raise exception ''INVOICE_REQUIRED' in codigo) = 0 then
    raise exception '146: falta la lectura de la regla del tipo o el rechazo';
  end if;
  -- El admin no tiene salida: la regla es de la orden, no de un rol.
  if position('admin' in codigo) > 0 or position('current_user_role' in codigo) > 0 then
    raise exception '146: la funcion mira el rol; no deberia';
  end if;
  -- El disparador, puesto y activo, antes de insertar y de actualizar.
  if not exists (select 1 from pg_trigger
                  where tgrelid = 'public.deliveries'::regclass and tgname = 'deliveries_guard_invoice'
                    and not tgisinternal and tgenabled = 'O'
                    and tgfoid = 'public.guard_factura_obligatoria()'::regprocedure) then
    raise exception '146: el disparador deliveries_guard_invoice no esta o no esta activo';
  end if;
  -- La premisa de la decision 2: hoy Customer tiene regla explicita y pide factura. Si no, esta migracion
  -- no haria lo que dice, y es mejor que no se aplique.
  if coalesce((select s.order_type_rules -> 'Customer' ->> 'docRef' from public.settings s where s.id = 1), '(sin regla)') <> 'invoice' then
    raise exception '146: settings.order_type_rules no dice docRef = invoice para Customer; la base no lo exigiria';
  end if;
  -- El guard de etapas sigue siendo el de la 145 (esta migracion no lo toca).
  if position('if r = ''manager'' and ((old_stage = ''approved'' and new_stage = ''fulfilling'')'
              in regexp_replace(regexp_replace(pg_get_functiondef('public.guard_delivery_stage()'::regprocedure),
                                               '^[ \t]*--.*$', '', 'gn'), '\s+', ' ', 'g')) = 0 then
    raise exception '146: guard_delivery_stage no es el de la 145; revisar el orden de migraciones';
  end if;
  -- Para el orquestador: cuantas quedan sin factura (no se tocan, D-NEXT).
  select count(*) filter (where d.stage not in ('delivered')), count(*)
    into vivas, todas
    from public.deliveries d
   where d.order_type = 'Customer'
     and d.stage not in ('draft','rejected','canceled')
     and coalesce(btrim(d.invoice_num), '') = '';
  raise notice '146: Customer fuera de borrador sin factura: % (de ellas, sin entregar: %)', todas, vivas;
end $chk$;

-- ===========================================================================
-- Ensayo por rol, con ROLLBACK
-- ===========================================================================
-- La matriz esta en el plan (docs/PLAN-146-customer-siempre-con-factura.md, seccion 6). Se pega en una
-- transaccion abierta a mano y se cierra con ROLLBACK. Este fichero no la lleva ejecutable a proposito:
-- cualquier sentencia de aqui abajo corre al aplicar la migracion.

-- ===========================================================================
-- Reversion (para pegar A MANO, en una transaccion propia)
-- ===========================================================================
--   drop trigger if exists deliveries_guard_invoice on public.deliveries;
--   drop function if exists public.guard_factura_obligatoria();
--   delete from public.schema_migrations where name = '146_customer_siempre_con_factura.sql';
--   -- Comprobacion: ninguna fila.
--   select tgname from pg_trigger where tgrelid = 'public.deliveries'::regclass and tgname = 'deliveries_guard_invoice';
-- La pantalla sigue exigiendo la factura por su cuenta (factura-obligatoria.ts); revertir la base no la
-- afloja. Para aflojar tambien la pantalla, revertir el commit de D-NEXT.

-- @ledger-below
insert into public.schema_migrations (name, checksum) values ('146_customer_siempre_con_factura.sql', '767b15dee3cb40e9ad3c3ef4961f9f32f85bc002321f1d47829040ac58ec7b63') on conflict (name) do nothing;
