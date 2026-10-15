-- ===========================================================================
-- 176 - Solicitudes de asignacion («Pedir para hoy»): public.assign_requests
-- ===========================================================================
-- Plan en papel: docs/PLAN-176-solicitud-de-asignacion.md. ESCRITA Y NO APLICADA: aplicarla es del
-- orquestador, despues del merge, con respaldo hecho y migrate-status antes y despues.
--
-- El dueno (2026-10-15): «vamos a hacer un assign order request para employees y office que van or
-- ejemplo sale una orden para manna pero el driver tiene spacio hoy ellos pueden pedir que sa orden se
-- asgine para hoy hadciendo un reschedue y un assgin request».
--
-- QUE TRAE:
--   1. La tabla public.assign_requests: una fila por solicitud (orden, fecha pedida, chofer sugerido,
--      nota, estado y decision). Una sola ABIERTA por orden (indice unico parcial).
--   2. assign_requests_guard (BEFORE INSERT OR UPDATE, security invoker): quien pide, que orden, que
--      fecha; y que solo cambie la decision, una vez.
--   3. assign_requests_avisa (AFTER, security definer): los avisos de la campana (public.notifications,
--      la misma tabla de siempre). Nueva -> a logistica y admin. Aprobada/rechazada -> a quien pidio.
--      Definer porque quien pide (ventas) no lee los perfiles de logistica (099).
--   4. RLS: quien pide inserta y ve las suyas (y cancela la suya abierta); logistica y admin ven y
--      deciden todas. Sin DELETE: es historial.
--
-- LO QUE NO TOCA:
--   * public.deliveries ni su guard (173): aprobar NO se hace aqui. La app reprograma con
--     reprogramar_orden (173; la 172 la saca de la ruta vieja) y asigna con el mismo UPDATE de
--     «Asignar a…» del Gestor, cada uno con sus permisos de siempre. Esta tabla solo guarda la peticion
--     y en que quedo.
--   * Las politicas de notifications (001): el aviso lo inserta la funcion definer.
--
-- QUIEN PIDE / QUIEN DECIDE (editables; la app tiene las mismas listas en
-- src/lib/solicitud-de-asignacion.ts y una prueba las compara):
--   pide:   sales (solo su orden: created_by o assigned_sales_rep), accounting, manager. Y admin, que
--           la app no ofrece, para que «ver como» funcione (la base ve al admin de verdad).
--   decide: logistics, admin.
--
-- Sin begin/commit propios, a proposito: quien aplica envuelve el fichero en una transaccion, y un
-- commit de dentro cerraria la de fuera (paso con la 124).
-- ===========================================================================

create table if not exists public.assign_requests (
  id               uuid primary key default gen_random_uuid(),
  delivery_id      uuid not null references public.deliveries (id) on delete cascade,
  requested_by     uuid default auth.uid() references public.profiles (id) on delete set null,
  requested_date   date not null,
  from_date        date,
  suggested_driver text,
  note             text,
  status           text not null default 'open' check (status in ('open', 'approved', 'rejected', 'canceled')),
  decided_by       uuid references public.profiles (id) on delete set null,
  decided_at       timestamptz,
  decision_note    text,
  assigned_driver  text,
  created_at       timestamptz not null default now()
);

create unique index if not exists assign_requests_una_abierta
  on public.assign_requests (delivery_id) where status = 'open';
create index if not exists assign_requests_por_quien
  on public.assign_requests (requested_by, created_at desc);

-- ---------------------------------------------------------------------------
-- El guard
-- ---------------------------------------------------------------------------
create or replace function public.assign_requests_guard()
  returns trigger
  language plpgsql
  security invoker
  set search_path = public
as $function$
declare
  yo  uuid := auth.uid();
  r   text := public.current_user_role();
  hoy date := (now() at time zone 'America/Chicago')::date;
  o   record;
begin
  -- Sin sesion (service role, editor SQL): como los demas guards, no se mira.
  if yo is null then
    return NEW;
  end if;

  if TG_OP = 'INSERT' then
    if not coalesce(r in ('sales', 'accounting', 'manager', 'admin'), false) then
      raise exception 'SOLICITUD_NO_PERMITIDA: % cannot request an assignment', coalesce(r, 'nobody')
        using errcode = '42501';
    end if;
    -- Invoker: la orden se lee con la RLS de quien pide. Si no la ve, no existe.
    select d.id, d.stage, d.delivery_date, d.created_by, d.assigned_sales_rep
      into o
      from public.deliveries d
     where d.id = NEW.delivery_id;
    if not found then
      raise exception 'SOLICITUD_SIN_ORDEN: order not found' using errcode = 'P0002';
    end if;
    if o.stage not in ('draft', 'pending', 'approved', 'fulfilling', 'ready') then
      raise exception 'SOLICITUD_ETAPA: an order in the % stage cannot be requested', o.stage using errcode = '22023';
    end if;
    -- coalesce: con assigned_sales_rep vacio, «= yo» da NULL y un «if not NULL» no lanza (leccion de la 173).
    if r = 'sales' and not coalesce(o.created_by = yo or o.assigned_sales_rep = yo, false) then
      raise exception 'SOLICITUD_NO_ES_SUYA: sales can only request their own orders' using errcode = '42501';
    end if;
    if NEW.requested_date is null or NEW.requested_date < hoy then
      raise exception 'SOLICITUD_FECHA_PASADA: pick today or a later date' using errcode = '22023';
    end if;
    if o.delivery_date is not distinct from NEW.requested_date then
      raise exception 'SOLICITUD_MISMA_FECHA: the order already has that date' using errcode = '22023';
    end if;
    NEW.requested_by     := yo;
    NEW.from_date        := o.delivery_date;
    NEW.status           := 'open';
    NEW.decided_by       := null;
    NEW.decided_at       := null;
    NEW.decision_note    := null;
    NEW.assigned_driver  := null;
    NEW.suggested_driver := nullif(btrim(coalesce(NEW.suggested_driver, '')), '');
    NEW.note             := nullif(btrim(regexp_replace(coalesce(NEW.note, ''), '\s+', ' ', 'g')), '');
    NEW.created_at       := now();
    return NEW;
  end if;

  -- UPDATE: lo pedido no se reescribe; solo la decision, y una sola vez.
  if NEW.id is distinct from OLD.id
     or NEW.delivery_id is distinct from OLD.delivery_id
     or NEW.requested_by is distinct from OLD.requested_by
     or NEW.requested_date is distinct from OLD.requested_date
     or NEW.from_date is distinct from OLD.from_date
     or NEW.suggested_driver is distinct from OLD.suggested_driver
     or NEW.note is distinct from OLD.note
     or NEW.created_at is distinct from OLD.created_at then
    raise exception 'SOLICITUD_INMUTABLE: only the decision of a request can change' using errcode = '42501';
  end if;
  if OLD.status <> 'open' then
    raise exception 'SOLICITUD_CERRADA: this request is already %', OLD.status using errcode = '22023';
  end if;

  if NEW.status = 'canceled' then
    if OLD.requested_by is distinct from yo then
      raise exception 'SOLICITUD_NO_PERMITIDA: only who asked can cancel a request' using errcode = '42501';
    end if;
    NEW.assigned_driver := null;
  elsif NEW.status in ('approved', 'rejected') then
    if not coalesce(r in ('logistics', 'admin'), false) then
      raise exception 'SOLICITUD_NO_PERMITIDA: % cannot decide requests', coalesce(r, 'nobody') using errcode = '42501';
    end if;
    if NEW.status = 'rejected' then
      if char_length(btrim(regexp_replace(coalesce(NEW.decision_note, ''), '\s+', ' ', 'g'))) < 3 then
        raise exception 'SOLICITUD_SIN_MOTIVO: write why it is rejected (3 letters or more)' using errcode = '22023';
      end if;
      NEW.assigned_driver := null;
    end if;
  else
    raise exception 'SOLICITUD_SIN_DECISION: set approved, rejected or canceled' using errcode = '22023';
  end if;
  NEW.decided_by := yo;
  NEW.decided_at := now();
  return NEW;
end $function$;

drop trigger if exists assign_requests_guard on public.assign_requests;
create trigger assign_requests_guard before insert or update on public.assign_requests
  for each row execute function public.assign_requests_guard();

-- ---------------------------------------------------------------------------
-- Los avisos de la campana
-- ---------------------------------------------------------------------------
create or replace function public.assign_requests_avisa()
  returns trigger
  language plpgsql
  security definer
  set search_path = public
as $function$
declare
  o        record;
  etiqueta text;
  quien    text;
begin
  select d.order_no, d.order_code, d.order_suffix, d.invoice_num
    into o
    from public.deliveries d
   where d.id = NEW.delivery_id;
  etiqueta := coalesce(nullif(btrim(o.invoice_num), ''),
                       '#' || coalesce(o.order_code, o.order_no::text, '?') || coalesce(o.order_suffix, ''));

  if TG_OP = 'INSERT' then
    select p.full_name into quien from public.profiles p where p.id = NEW.requested_by;
    insert into public.notifications (user_id, delivery_id, order_no, kind, message)
    select p.id, NEW.delivery_id, o.order_no, 'assign_request',
           'Assign request: ' || etiqueta || ' -> ' || NEW.requested_date::text || ' (' || coalesce(quien, '?') || ')'
           || ' · Solicitud de asignación: ' || etiqueta || ' -> ' || NEW.requested_date::text
      from public.profiles p
     where p.role in ('logistics', 'admin')
       and p.id is distinct from NEW.requested_by;
  elsif NEW.status is distinct from OLD.status
        and NEW.status in ('approved', 'rejected')
        and NEW.requested_by is not null
        and NEW.requested_by is distinct from NEW.decided_by then
    insert into public.notifications (user_id, delivery_id, order_no, kind, message)
    values (NEW.requested_by, NEW.delivery_id, o.order_no,
            case when NEW.status = 'approved' then 'assign_request_approved' else 'assign_request_rejected' end,
            case when NEW.status = 'approved'
                 then 'Request approved: ' || etiqueta || ' -> ' || NEW.requested_date::text
                      || coalesce(' (' || NEW.assigned_driver || ')', '')
                      || ' · Solicitud aprobada: ' || etiqueta || ' -> ' || NEW.requested_date::text
                 else 'Request rejected: ' || etiqueta || ': ' || coalesce(NEW.decision_note, '')
                      || ' · Solicitud rechazada: ' || etiqueta
            end);
  end if;
  return null;
end $function$;

drop trigger if exists assign_requests_avisa on public.assign_requests;
create trigger assign_requests_avisa after insert or update of status on public.assign_requests
  for each row execute function public.assign_requests_avisa();

revoke execute on function public.assign_requests_guard() from public, anon, authenticated;
revoke execute on function public.assign_requests_avisa() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Permisos y RLS
-- ---------------------------------------------------------------------------
revoke all on public.assign_requests from public, anon, authenticated;
grant select, insert, update on public.assign_requests to authenticated;

alter table public.assign_requests enable row level security;

drop policy if exists "assign_requests select" on public.assign_requests;
create policy "assign_requests select" on public.assign_requests for select to authenticated
  using (requested_by = (select auth.uid()) or (select public.current_user_role()) in ('logistics', 'admin'));

drop policy if exists "assign_requests insert" on public.assign_requests;
create policy "assign_requests insert" on public.assign_requests for insert to authenticated
  with check (requested_by = (select auth.uid())
              and (select public.current_user_role()) in ('sales', 'accounting', 'manager', 'admin'));

drop policy if exists "assign_requests update" on public.assign_requests;
create policy "assign_requests update" on public.assign_requests for update to authenticated
  using (requested_by = (select auth.uid()) or (select public.current_user_role()) in ('logistics', 'admin'))
  with check (requested_by = (select auth.uid()) or (select public.current_user_role()) in ('logistics', 'admin'));

-- ===========================================================================
-- Autocomprobacion (mira el catalogo: sobrevive a re-aplicar el fichero)
-- ===========================================================================
do $chk$
begin
  if (select count(*) from pg_policies where schemaname = 'public' and tablename = 'assign_requests') <> 3 then
    raise exception '176: assign_requests tiene que tener exactamente 3 politicas (select, insert, update)';
  end if;
  if exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'assign_requests' and cmd in ('DELETE', 'ALL')) then
    raise exception '176: assign_requests no lleva politica de DELETE ni ALL (es historial)';
  end if;
  if not (select c.relrowsecurity from pg_class c where c.oid = 'public.assign_requests'::regclass) then
    raise exception '176: la RLS de assign_requests no esta activa';
  end if;
  if (select count(*) from pg_trigger where tgrelid = 'public.assign_requests'::regclass and not tgisinternal
        and tgname in ('assign_requests_guard', 'assign_requests_avisa')) <> 2 then
    raise exception '176: faltan los disparadores de assign_requests';
  end if;
  if (select p.prosecdef from pg_proc p where p.oid = 'public.assign_requests_guard()'::regprocedure) then
    raise exception '176: el guard NO debe ser security definer (la orden se lee con la RLS de quien pide)';
  end if;
  if not (select p.prosecdef from pg_proc p where p.oid = 'public.assign_requests_avisa()'::regprocedure) then
    raise exception '176: los avisos tienen que ser security definer (ventas no lee los perfiles de logistica)';
  end if;
  if has_table_privilege('anon', 'public.assign_requests', 'select') then
    raise exception '176: anon no debe leer assign_requests';
  end if;
  if has_table_privilege('authenticated', 'public.assign_requests', 'delete') then
    raise exception '176: authenticated no debe poder borrar solicitudes';
  end if;
end $chk$;

-- Reversion (en este orden):
--   drop table if exists public.assign_requests;            -- arrastra indices, politicas y disparadores
--   drop function if exists public.assign_requests_guard();
--   drop function if exists public.assign_requests_avisa();
--   delete from public.schema_migrations where name = '176_solicitudes_de_asignacion.sql';
-- Los avisos ya enviados se quedan en public.notifications (kind assign_request*): son historial.

-- @ledger-below
insert into public.schema_migrations (name, checksum) values ('176_solicitudes_de_asignacion.sql', '86ae9176475e5d64604867a8eec619680f9484d52da1a02fb152a8562313459c') on conflict (name) do nothing;
