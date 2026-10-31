-- 222: Entregas — una orden ya entregada se queda en el dia real de la entrega aunque alguien le cambie la fecha
-- despues (D-781, 2026-10-31). Amplia la 219 (D-761).
--
-- El dueño, con la orden 1268 (FV532): entregada el 2026-10-28 por el chofer; al dia siguiente un vendedor le cambio la
-- fecha de entrega al 2026-10-31 (queria programar la reposicion del material) y la orden aparecio, ya entregada, en la
-- ruta del 31, sin poder quitarla. «Si esa orden ya se entrego, que se pase a la ruta de ese dia y que no me aparezca
-- en la del 31».
--
-- Que hace: la misma funcion de la 219, con un segundo caso. Si la orden YA esta entregada y el UPDATE trae otra
-- `delivery_date`, la fecha vuelve al dia real (el de `pod_delivered_at`, en hora de Texas; si no lo hay, no se sabe
-- el dia y se deja pasar) y queda una nota en el historial. Asi la reposicion se programa como orden nueva, y la
-- entregada no se mueve de su ruta. Pasar a entregada sigue como en la 219. Sin begin/commit propios.
-- Para deshacer: volver a crear la funcion con el cuerpo de la 219 y borrar la fila del registro.
create or replace function public.entregada_fija_fecha()
  returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_dia date;
begin
  if NEW.stage = 'delivered' and OLD.stage is distinct from 'delivered' then
    v_dia := (coalesce(NEW.pod_delivered_at, now()) at time zone 'America/Chicago')::date;
    if NEW.delivery_date is distinct from v_dia then
      insert into public.order_events (delivery_id, kind, note, created_by)
        values (NEW.id, 'edited',
                'Delivered on ' || v_dia::text || '; was scheduled for ' || coalesce(NEW.delivery_date::text, '—')
                  || ' / Entregada el ' || v_dia::text || '; estaba programada para ' || coalesce(NEW.delivery_date::text, '—'),
                auth.uid());
      NEW.delivery_date := v_dia;
    end if;
  elsif NEW.stage = 'delivered' and OLD.stage = 'delivered' and NEW.pod_delivered_at is not null
        and NEW.delivery_date is distinct from OLD.delivery_date then
    -- 222: ya entregada; la fecha no se mueve del dia real de la entrega.
    v_dia := (NEW.pod_delivered_at at time zone 'America/Chicago')::date;
    if NEW.delivery_date is distinct from v_dia then
      insert into public.order_events (delivery_id, kind, note, created_by)
        values (NEW.id, 'edited',
                'Delivery date kept on ' || v_dia::text || ' (already delivered); ' || coalesce(NEW.delivery_date::text, '—') || ' was not applied'
                  || ' / La fecha se queda en ' || v_dia::text || ' (ya entregada); no se aplico ' || coalesce(NEW.delivery_date::text, '—'),
                auth.uid());
      NEW.delivery_date := v_dia;
    end if;
  end if;
  return NEW;
end $$;

-- ===========================================================================
-- Autocomprobacion (mira el catalogo)
-- ===========================================================================
do $chk$
begin
  if not exists (select 1 from pg_trigger where tgrelid = 'public.deliveries'::regclass and tgname = 'deliveries_zz_entregada_fija_fecha') then
    raise exception '222: falta el disparador de la 219';
  end if;
  if position('already delivered' in pg_get_functiondef('public.entregada_fija_fecha()'::regprocedure)) = 0 then
    raise exception '222: la funcion no lleva el caso de ya entregada';
  end if;
end $chk$;

-- @ledger-below
insert into public.schema_migrations (name, checksum)
  values ('222_entregada_se_queda_en_su_dia.sql', '498048524dd5f9555ac013310511e9c029d4af92b94a362191e321ca9571f585') on conflict (name) do nothing;
