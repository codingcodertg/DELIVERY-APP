-- 243: Clientes — avisos en la campana para las solicitudes de cliente (2026-11-04).
--
-- El dueno: «cuando se cree un customer, que le notifique al usuario que lo pidio. Hagamos notificaciones generales para
-- la app (Customers). Y si es rechazado, enviado a revisar o aceptado, que le mande la notificacion a ese usuario».
--
-- Que habia: las solicitudes (216, 221, 242) se deciden con las funciones de la 242 y quien pidio no se enteraba. La
-- campana de Entregas lee public.notifications (001: user_id, kind, message, read; RLS: cada uno lee y marca lo suyo).
--
-- Que hace:
--  1. public.notifications gana dos columnas nulas: `link` (la ruta interna a la que lleva el aviso) y `message_es`
--     (el texto en espanol; `message` sigue siendo el ingles). Los avisos de siempre no cambian.
--  2. Un disparador sobre erp.customer_requests escribe el aviso EN LA MISMA TRANSACCION que la decision, sin tocar las
--     funciones de la 242 (siguen como estan, con su puerta erp.es_admin_de_clientes() y su ('pending', 'review')):
--       - al INSERTAR una solicitud: a los admins de Clientes (admin del hub, o customers_role = 'admin' con la casilla
--         «customers», la misma regla que erp.es_admin_de_clientes()), sin dados de baja, menos quien la pide;
--       - al pasar a 'approved' / 'rejected' / 'review' (o al cambiar la nota de una que ya esta en 'review'): a quien
--         la pidio (requested_by), salvo que la decida el mismo.
--     Los textos y los enlaces son los de src/lib/customers/avisos-de-solicitud.ts (la prueba lo vigila).
--
-- Sin begin/commit propios: el ensayo con ROLLBACK envuelve el fichero.
-- Para deshacer: drop trigger customer_requests_avisa on erp.customer_requests; drop function
-- erp.avisa_solicitud_de_cliente(); alter table public.notifications drop column link, drop column message_es; borrar la
-- fila del registro.

do $pre$
begin
  if not exists (select 1 from information_schema.columns where table_schema = 'erp' and table_name = 'customer_requests' and column_name = 'review_note') then
    raise exception '243: falta erp.customer_requests.review_note; aplica primero la 242';
  end if;
end $pre$;

-- ---------------------------------------------------------------------------
-- 1. Las columnas del aviso
-- ---------------------------------------------------------------------------
alter table public.notifications
  add column if not exists link text,
  add column if not exists message_es text;

-- ---------------------------------------------------------------------------
-- 2. El disparador
-- ---------------------------------------------------------------------------
create or replace function erp.avisa_solicitud_de_cliente()
  returns trigger language plpgsql security definer set search_path = public, erp, pg_temp as $$
declare
  cuenta text;
  tiendas text;
  quien text;
  nota text;
  enlace text;
  ficha bigint;
  clase text := coalesce(NEW.kind, 'alta');
  hoy date := (now() at time zone 'America/Chicago')::date;
begin
  -- El nombre del cliente: el pedido, o el de la fila en una edicion que no lo cambia.
  cuenta := nullif(btrim(coalesce(NEW.payload ->> 'account', '')), '');
  if cuenta is null and NEW.customer_id is not null then
    select nullif(btrim(c.account), '') into cuenta from erp.customers c where c.id = NEW.customer_id;
  end if;
  cuenta := coalesce(cuenta, '?');

  if TG_OP = 'INSERT' then
    tiendas := array_to_string(NEW.stores, ', ');
    if clase = 'edicion' and NEW.customer_id is not null then
      select c.store into tiendas from erp.customers c where c.id = NEW.customer_id;
    end if;
    tiendas := case when coalesce(btrim(tiendas), '') = '' then '' else ' (' || btrim(tiendas) || ')' end;
    select coalesce(nullif(btrim(p.full_name), ''), '?') into quien from public.profiles p where p.id = NEW.requested_by;
    quien := coalesce(quien, '?');
    insert into public.notifications (user_id, kind, message, message_es, link)
    select p.id, 'cliente_solicitud_nueva',
      case when clase = 'edicion' then '📝 New edit request: ' else '📝 New customer request: ' end || cuenta || tiendas || ' from ' || quien,
      case when clase = 'edicion' then '📝 Nueva solicitud de edición: ' else '📝 Nueva solicitud de cliente: ' end || cuenta || tiendas || ' de ' || quien,
      '/customers?solicitud=' || NEW.id
      from public.profiles p
     where (p.role = 'admin' or (p.customers_role = 'admin' and 'customers' = any(coalesce(p.module_access, '{}'))))
       and p.id is distinct from NEW.requested_by
       and (p.left_at is null or p.left_at > hoy);
    return NEW;
  end if;

  -- UPDATE: solo cuando cambia el estado, o la nota de una que sigue en «Revisar».
  if NEW.status is not distinct from OLD.status
     and not (NEW.status = 'review' and NEW.review_note is distinct from OLD.review_note) then
    return NEW;
  end if;
  -- Quien decide su propia solicitud no se avisa a si mismo.
  if NEW.requested_by is null or NEW.requested_by = auth.uid() then return NEW; end if;

  enlace := '/customers?solicitud=' || NEW.id;
  if NEW.status = 'approved' then
    ficha := coalesce(NEW.created_ids[1], NEW.customer_id);
    if ficha is not null then enlace := '/customers/' || ficha; end if;
    insert into public.notifications (user_id, kind, message, message_es, link)
    values (NEW.requested_by, 'cliente_solicitud_aprobada',
      case when clase = 'edicion' then '✅ Edit to ' || cuenta || ' approved' else '✅ Customer ' || cuenta || ' approved' end,
      case when clase = 'edicion' then '✅ Edición de ' || cuenta || ' aprobada' else '✅ Cliente ' || cuenta || ' aprobado' end,
      enlace);
  elsif NEW.status = 'rejected' then
    nota := nullif(btrim(coalesce(NEW.decision_note, '')), '');
    insert into public.notifications (user_id, kind, message, message_es, link)
    values (NEW.requested_by, 'cliente_solicitud_rechazada',
      '❌ Request for ' || cuenta || ' rejected' || coalesce(': ' || nota, ''),
      '❌ Solicitud de ' || cuenta || ' rechazada' || coalesce(': ' || nota, ''),
      enlace);
  elsif NEW.status = 'review' then
    nota := nullif(btrim(coalesce(NEW.review_note, '')), '');
    insert into public.notifications (user_id, kind, message, message_es, link)
    values (NEW.requested_by, 'cliente_solicitud_revisar',
      '⚠️ Request for ' || cuenta || ' needs a check' || coalesce(': ' || nota, ''),
      '⚠️ Solicitud de ' || cuenta || ' por revisar' || coalesce(': ' || nota, ''),
      enlace);
  end if;
  return NEW;
end $$;

revoke all on function erp.avisa_solicitud_de_cliente() from public, anon, authenticated;

drop trigger if exists customer_requests_avisa on erp.customer_requests;
create trigger customer_requests_avisa
  after insert or update of status, review_note on erp.customer_requests
  for each row execute function erp.avisa_solicitud_de_cliente();

-- ===========================================================================
-- Autocomprobacion (mira el catalogo)
-- ===========================================================================
do $chk$
begin
  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'notifications' and column_name = 'link') then raise exception '243: falta notifications.link'; end if;
  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'notifications' and column_name = 'message_es') then raise exception '243: falta notifications.message_es'; end if;
  if not exists (select 1 from pg_trigger where tgname = 'customer_requests_avisa' and tgrelid = 'erp.customer_requests'::regclass and not tgisinternal) then
    raise exception '243: falta el disparador customer_requests_avisa';
  end if;
  if not (select prosecdef from pg_proc where oid = 'erp.avisa_solicitud_de_cliente()'::regprocedure) then raise exception '243: el aviso no es security definer'; end if;
  if has_function_privilege('anon', 'erp.avisa_solicitud_de_cliente()', 'execute') then raise exception '243: anon ejecuta el aviso'; end if;
end $chk$;
-- @ledger-below
insert into public.schema_migrations (name, checksum) values ('243_avisos_de_solicitudes_de_cliente.sql', '4b5d11146e94423ddc4e6f94bc79a96b5ae3612b27fedee74aab89a914233822') on conflict (name) do nothing;
