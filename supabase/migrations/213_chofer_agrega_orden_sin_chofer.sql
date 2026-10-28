-- 213: El chofer AGREGA a su ruta una orden que no tiene chofer, sin motivo (D-735, 2026-10-28).
--
-- El dueño: «if any invoice of an order is unassign the driver can look it up and search bar for the driver to look it
-- up and add it to his routes».
--
-- La 188 (D-625) ya deja al chofer buscar una factura ajena y tomarla, pero SIEMPRE como excepcion: motivo obligatorio y
-- nota «⚠️ Excepcion». Tomar una orden que no era de nadie no es una excepcion: es la forma normal de que una orden sin
-- chofer salga. Esta migracion redefine `tomar_orden_para_recoger` (misma firma, mismos permisos, mismo guard de la 188):
--   - el motivo (3 letras o mas) solo se exige si la orden ERA de otro chofer;
--   - sin chofer de antes, la nota es «🚚 X agrego esta orden a su ruta (no tenia chofer)» (y el motivo si lo escribio),
--     y el aviso de la campana (`tomada_por_chofer`, a admins y logistica) va sin «⚠️»;
--   - lo demas igual: etapa aprobada/preparando/lista, no de practica, pasa a su nombre, sin puesto, para HOY, «edited».
-- La busqueda (`buscar_factura_para_recoger`) no cambia.
-- Sin begin/commit propios. Para deshacer: volver a crear la funcion con el texto de la 188 (seccion 4).

create or replace function public.tomar_orden_para_recoger(p_id uuid, p_motivo text, p_lang text default 'es')
  returns void
  language plpgsql
  security definer
  set search_path = public
as $function$
declare
  yo     uuid := auth.uid();
  r      text := public.current_user_role();
  limpio text := btrim(regexp_replace(coalesce(p_motivo, ''), '\s+', ' ', 'g'));
  hoy    date := (now() at time zone 'America/Chicago')::date;
  mio    text;
  o      record;
  filas  integer;
  etiqueta text;
  aviso  text;
begin
  if yo is null then
    raise exception 'TOMAR_SIN_SESION: sign in first' using errcode = '42501';
  end if;
  if not coalesce(r in ('driver','admin') and public.has_deliveries_access(), false) then
    raise exception 'TOMAR_NO_PERMITIDO: only drivers take an order to pick up' using errcode = '42501';
  end if;
  select p.full_name into mio from public.profiles p where p.id = yo;
  if coalesce(btrim(mio), '') = '' then
    raise exception 'TOMAR_SIN_NOMBRE: your profile has no name' using errcode = '22023';
  end if;

  select d.id, d.order_no, d.order_suffix, d.stage, d.assigned_driver, d.delivery_date, d.invoice_num, d.is_training
    into o
    from public.deliveries d
   where d.id = p_id
   for update;
  if not found then
    raise exception 'TOMAR_NO_EXISTE: order not found' using errcode = 'P0002';
  end if;
  if coalesce(o.is_training, false) or o.stage not in ('approved','fulfilling','ready') then
    raise exception 'TOMAR_ETAPA: only an approved, preparing or ready order can be taken (this one is %)', o.stage
      using errcode = '42501';
  end if;
  if o.assigned_driver is not distinct from mio then
    raise exception 'TOMAR_YA_ES_TUYA: the order is already yours' using errcode = '22023';
  end if;
  -- 213: el motivo solo cuando se le quita a OTRO chofer. Sin chofer no es una excepcion: es agregarla a su ruta.
  if o.assigned_driver is not null and char_length(limpio) < 3 then
    raise exception 'TOMAR_SIN_MOTIVO: write why you are taking it (3 letters or more)' using errcode = '22023';
  end if;

  perform set_config('rtg.tomar_orden', p_id::text, true);
  update public.deliveries
     set assigned_driver = mio, route_seq = null, pickup_seq = null, load_no = null, delivery_date = hoy
   where id = p_id;
  get diagnostics filas = row_count;
  perform set_config('rtg.tomar_orden', '', true);
  if filas <> 1 then
    raise exception 'TOMAR_NO_GUARDADA: the order was not updated' using errcode = 'P0002';
  end if;

  insert into public.order_events (delivery_id, kind, note, created_by)
    values (p_id, 'edited',
            'Changed: Driver: ' || coalesce(o.assigned_driver, '—') || ' → ' || mio
            || case when o.delivery_date is distinct from hoy
                    then ', Delivery Date: ' || coalesce(o.delivery_date::text, '—') || ' → ' || hoy::text else '' end,
            yo);
  insert into public.order_events (delivery_id, kind, note, created_by)
    values (p_id, 'note',
            case when o.assigned_driver is null then
              -- 213: no tenia chofer, se la agrego a su ruta (el motivo, si lo escribio)
              case when p_lang = 'en'
                   then '🚚 ' || mio || ' added this order to their route (it had no driver)'
                   else '🚚 ' || mio || ' agregó esta orden a su ruta (no tenía chofer)' end
              || case when limpio <> '' then ': ' || limpio else '' end
            when p_lang = 'en'
                 then '⚠️ Exception: ' || mio || ' took this order to pick it up'
                      || ' (it was ' || o.assigned_driver || '''s)'
                      || ': ' || limpio
                 else '⚠️ Excepción: ' || mio || ' tomó esta orden para recogerla'
                      || ' (era de ' || o.assigned_driver || ')'
                      || ': ' || limpio end,
            yo);

  etiqueta := '#' || o.order_no::text || coalesce(o.order_suffix, '')
              || case when coalesce(btrim(o.invoice_num), '') <> '' then ' (INV ' || btrim(o.invoice_num) || ')' else '' end;
  aviso := case when o.assigned_driver is null
                then '🚚 ' || mio || ' agregó ' || etiqueta || ' a su ruta (no tenía chofer)'
                     || case when limpio <> '' then ': ' || limpio else '' end
                else '⚠️ ' || mio || ' tomó ' || etiqueta || ' para recogerla (era de ' || o.assigned_driver || '): ' || limpio end;
  insert into public.notifications (user_id, delivery_id, order_no, kind, message)
    select p.id, p_id, o.order_no, 'tomada_por_chofer', aviso
      from public.profiles p
     where p.id <> yo
       and (p.role in ('admin','logistics')
            or (o.assigned_driver is not null and p.full_name = o.assigned_driver));
end $function$;

revoke execute on function public.tomar_orden_para_recoger(uuid, text, text) from public, anon;
grant execute on function public.tomar_orden_para_recoger(uuid, text, text) to authenticated;

-- ===========================================================================
-- Autocomprobacion (mira el catalogo)
-- ===========================================================================
do $chk$
declare
  def text := pg_get_functiondef('public.tomar_orden_para_recoger(uuid, text, text)'::regprocedure);
begin
  if position('o.assigned_driver is not null and char_length(limpio) < 3' in def) = 0 then
    raise exception '213: la funcion sigue exigiendo motivo sin chofer de antes';
  end if;
  if position('agregó esta orden a su ruta (no tenía chofer)' in def) = 0
     or position('added this order to their route (it had no driver)' in def) = 0 then
    raise exception '213: la funcion no lleva la nota de «agregada a su ruta»';
  end if;
  if position('rtg.tomar_orden' in def) = 0 or position('TOMAR_YA_ES_TUYA' in def) = 0 then
    raise exception '213: la funcion perdio el guard de la 188 o la comprobacion de «ya es tuya»';
  end if;
  if position('current_setting(''rtg.tomar_orden'', true) = OLD.id::text' in pg_get_functiondef('public.guard_delivery_stage()'::regprocedure)) = 0 then
    raise exception '213: el guard no lleva el bloque de tomar la orden (188)';
  end if;
end $chk$;

-- @ledger-below
insert into public.schema_migrations (name, checksum)
  values ('213_chofer_agrega_orden_sin_chofer.sql', '7e6620d419f1849e5936d0747bc0c13dd614c3410fd193bb629a964661269808') on conflict (name) do nothing;
