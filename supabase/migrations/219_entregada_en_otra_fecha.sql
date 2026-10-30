-- 219: Entregas — una orden entregada en OTRO dia se queda con la fecha real de entrega (D-761, 2026-10-30).
--
-- Roberto Rodriguez Jr (admin), con una orden Intertienda programada para manana y ya entregada hoy: «If driver delivers
-- something at a different date then update delivery date to be true».
--
-- Que hace: un disparador BEFORE UPDATE en public.deliveries. Cuando la orden PASA a 'delivered' (antes no lo estaba) y
-- su `delivery_date` no es el dia de la entrega, la fecha se cambia a ese dia y queda una nota en el historial
-- («Entregada el 2026-10-30; estaba programada para 2026-10-31»). El dia de la entrega es el de `pod_delivered_at` si la
-- app lo mando (la hora de la prueba de entrega) y, si no, el de ahora; en el dia de Texas (America/Chicago), no en UTC.
--
-- Por que en la base y no en la pantalla: todos los caminos que marcan entregada (el boton del chofer, «Marcar entregada
-- ya», los botones en bloque, el «Forzar estado» del admin, la cola sin cobertura que reenvia) pasan por el mismo UPDATE,
-- y el chofer no tiene permiso para tocar `delivery_date` por su cuenta (guard de la 168): aqui lo pone el servidor.
-- Se llama `zz_` para correr DESPUES del guard (los disparadores van por nombre), que ya vio la escritura tal cual la
-- mando la app. El disparador de reprogramar (`deliveries_zz_reprogramar_saca_de_la_ruta`) solo actua en etapas abiertas,
-- asi que no saca a nadie de la ruta por esto. Sin begin/commit propios.
-- Para deshacer: drop trigger deliveries_zz_entregada_fija_fecha on public.deliveries; drop function
-- public.entregada_fija_fecha(); borrar la fila del registro.

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
  end if;
  return NEW;
end $$;

drop trigger if exists deliveries_zz_entregada_fija_fecha on public.deliveries;
create trigger deliveries_zz_entregada_fija_fecha before update on public.deliveries
  for each row execute function public.entregada_fija_fecha();

-- ===========================================================================
-- Autocomprobacion (mira el catalogo)
-- ===========================================================================
do $chk$
begin
  if not exists (select 1 from pg_trigger where tgrelid = 'public.deliveries'::regclass and tgname = 'deliveries_zz_entregada_fija_fecha') then
    raise exception '219: falta el disparador';
  end if;
  -- Corre despues del guard: por nombre, 'deliveries_guard_stage' < 'deliveries_zz_entregada_fija_fecha'.
  if 'deliveries_guard_stage' >= 'deliveries_zz_entregada_fija_fecha' then raise exception '219: el nombre no lo pone despues del guard'; end if;
  if position('America/Chicago' in pg_get_functiondef('public.entregada_fija_fecha()'::regprocedure)) = 0 then
    raise exception '219: el dia no es el de Texas';
  end if;
end $chk$;

-- @ledger-below
insert into public.schema_migrations (name, checksum)
  values ('219_entregada_en_otra_fecha.sql', '4faefb2bcff99ccddacd49a47c50900a6c1e11744927ff9bc129fc8fab25601b') on conflict (name) do nothing;
