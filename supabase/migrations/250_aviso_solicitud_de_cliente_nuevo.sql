-- 250: el aviso de una solicitud de alta se titula «Solicitud de cliente nuevo» (no ayuda).
--
-- El dueno: las solicitudes de cliente nuevo le llegaban como «Solicitud de ayuda». La causa estaba en la app (el alta
-- tambien mandaba una solicitud de ayuda por /api/help); eso se quita en el codigo. Aqui solo se ajusta el texto en
-- espanol del aviso de la campana que escribe la 243: «Nueva solicitud de cliente» pasa a «Solicitud de cliente nuevo»,
-- igual que el ingles «New customer request». Lo demas de la funcion es identico a la 243.
--
-- Tambien se renombran los avisos ya escritos (solo el texto en espanol de las altas; las ediciones no cambian).
-- Vuelta atras: volver a correr la funcion de la 243.

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
      case when clase = 'edicion' then '📝 Nueva solicitud de edición: ' else '📝 Solicitud de cliente nuevo: ' end || cuenta || tiendas || ' de ' || quien,
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

update public.notifications
   set message_es = replace(message_es, '📝 Nueva solicitud de cliente: ', '📝 Solicitud de cliente nuevo: ')
 where kind = 'cliente_solicitud_nueva' and message_es like '📝 Nueva solicitud de cliente: %';

do $chk$
begin
  if not (select prosecdef from pg_proc where oid = 'erp.avisa_solicitud_de_cliente()'::regprocedure) then raise exception '250: el aviso no es security definer'; end if;
  if position('Solicitud de cliente nuevo' in pg_get_functiondef('erp.avisa_solicitud_de_cliente()'::regprocedure)) = 0 then raise exception '250: el aviso no dice Solicitud de cliente nuevo'; end if;
  if has_function_privilege('anon', 'erp.avisa_solicitud_de_cliente()', 'execute') then raise exception '250: anon ejecuta el aviso'; end if;
end $chk$;
-- @ledger-below
insert into public.schema_migrations (name, checksum) values ('250_aviso_solicitud_de_cliente_nuevo.sql', 'd30d490c54dd7b6275b9d152355c839f7b14c50a34f58faa4202227102f7f5fa') on conflict (name) do nothing;
