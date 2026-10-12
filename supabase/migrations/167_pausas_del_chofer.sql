-- 167_pausas_del_chofer.sql — «⏸ Registrar parada»: el chofer anota que se detiene por algo que no es una orden
--
-- (Su decisión es la de la rama feat/mi-ruta-botones-y-secciones, 2026-10-11. El número no se escribe aquí a propósito:
-- numerarla después cambiaría el cuerpo y con él el checksum de la línea de registro, D-512.)
--
-- El dueño, 2026-10-11: «AGREGA A BUTTOM TO LOG A STOP PUEDE SER RESTROOM, STOP FOR GAS Y ASI» y «AND WHEN STOPPED FOR
-- GAS ASK TO UPLOAD DE GAS RECEIPT».
--
-- Una fila por parada: quién, por qué (baño, gasolina, comida, tráfico u otro), cuándo empezó y cuándo siguió, dónde (si el
-- teléfono dio la ubicación) y, en la de gasolina, el recibo. Se llama «pausa» para no confundirla con las paradas de la
-- ruta, que son de órdenes.
--
-- Por qué una tabla nueva y no algo de lo que ya hay (se miró antes):
--   · order_events      — es de UNA orden; una parada para cargar gasolina no es de ninguna.
--   · driver_shifts     — es el turno entero (entrada/salida) y la base solo deja uno abierto por chofer.
--   · driver_incidents  — lo escribe logística, y es de costos que causó el chofer.
--   · driver_locations  — un punto GPS, sin motivo ni fin.
--   · clockin.trip_stops («Voy a salir», D-455) — es del Time Tracker, de otra empresa lógica (`company_id`), y pide un
--     viaje y un fichaje abiertos.
--
-- El recibo va como las fotos de una entrega (`deliveries.photos`): la imagen JPEG comprimida en el teléfono (~1280 px), en
-- texto `data:image/...`. Así no hace falta un cubo nuevo de Storage con sus políticas, y el demo (sin base) lo enseña
-- igual. El tope de 2 000 000 caracteres deja ~1,5 MB de imagen: una foto comprimida ocupa unos 150-400 KB.
--
-- RLS: el chofer crea y lee las suyas, y solo puede tocar la que tiene ABIERTA (cerrarla, o ponerle la ubicación que llegó
-- tarde): una cerrada ya no se reescribe. Admin, logística y gerentes leen todas, como las posiciones (`driver_locations`,
-- 043): las ven en el Recorrido del chofer, que es su pantalla. Nadie borra: el historial no se borra.
--
-- Reversa (si hiciera falta, ANTES de que haya filas que importen):
--   drop table if exists public.pausas_del_chofer;
--   delete from public.schema_migrations where name = '167_pausas_del_chofer.sql';
--
-- NO lleva `begin`/`commit` a propósito: una migración con su propia transacción cierra la de fuera y se aplica sola en un
-- ensayo con ROLLBACK (pasó con la 124).

create table if not exists public.pausas_del_chofer (
  id             uuid primary key default gen_random_uuid(),
  driver_id      uuid not null default auth.uid() references public.profiles(id) on delete cascade,
  motivo         text not null,
  nota           text,
  empezo_at      timestamptz not null default now(),
  termino_at     timestamptz,
  lat            double precision,
  lng            double precision,
  precision_m    real,
  recibo_foto    text,
  recibo_monto   numeric(10,2),
  recibo_galones numeric(10,3),
  sin_recibo     boolean not null default false,
  created_at     timestamptz not null default now(),
  constraint pausas_motivo check (motivo in ('restroom', 'gas', 'food', 'traffic', 'other')),
  constraint pausas_nota check (nota is null or length(nota) <= 500),
  -- «Otro» obliga a decir qué (la pantalla pide 3 letras: lo mismo aquí).
  constraint pausas_otro_con_texto check (motivo <> 'other' or length(btrim(coalesce(nota, ''))) >= 3),
  constraint pausas_termina_despues check (termino_at is null or termino_at >= empezo_at),
  constraint pausas_recibo_foto check (recibo_foto is null or (recibo_foto like 'data:image/%' and length(recibo_foto) <= 2000000)),
  constraint pausas_recibo_monto check (recibo_monto is null or recibo_monto >= 0),
  constraint pausas_recibo_galones check (recibo_galones is null or recibo_galones >= 0),
  -- La de gasolina no se cierra sin recibo, salvo con «No tengo recibo» dicho a propósito, que queda anotado.
  constraint pausas_gasolina_con_recibo check (motivo <> 'gas' or termino_at is null or recibo_foto is not null or sin_recibo),
  -- Recibo, monto y galones son de la gasolina.
  constraint pausas_recibo_solo_gasolina check (motivo = 'gas' or (recibo_foto is null and recibo_monto is null and recibo_galones is null and not sin_recibo))
);

-- Lo que se lee: las de un chofer en un día (Mi ruta, el Recorrido).
create index if not exists pausas_del_chofer_dia_idx on public.pausas_del_chofer (driver_id, empezo_at desc);
-- Una abierta a la vez por chofer: no se puede estar parado por dos cosas.
create unique index if not exists pausas_del_chofer_una_abierta on public.pausas_del_chofer (driver_id) where termino_at is null;

revoke all on public.pausas_del_chofer from public, anon, authenticated;
grant select, insert, update on public.pausas_del_chofer to authenticated;

alter table public.pausas_del_chofer enable row level security;

drop policy if exists "pausas select" on public.pausas_del_chofer;
create policy "pausas select" on public.pausas_del_chofer for select to authenticated
  using (driver_id = (select auth.uid())
         or coalesce((select public.current_user_role()), '') in ('admin', 'logistics', 'manager'));

drop policy if exists "pausas insert" on public.pausas_del_chofer;
create policy "pausas insert" on public.pausas_del_chofer for insert to authenticated
  with check (driver_id = (select auth.uid()));

drop policy if exists "pausas update" on public.pausas_del_chofer;
create policy "pausas update" on public.pausas_del_chofer for update to authenticated
  using (driver_id = (select auth.uid()) and termino_at is null)
  with check (driver_id = (select auth.uid()));

notify pgrst, 'reload schema';

-- Comprobación: la tabla, la RLS encendida y las tres políticas. Si algo de esto no cuadra, revienta aquí.
do $$
declare
  faltan text;
begin
  select string_agg(q, '; ') into faltan from (
    select 'sin RLS' as q from pg_class where oid = 'public.pausas_del_chofer'::regclass and not relrowsecurity
    union all
    select 'politicas: ' || count(*)::text from pg_policies
     where schemaname = 'public' and tablename = 'pausas_del_chofer' having count(*) <> 3
    union all
    select 'anon puede leer' where has_table_privilege('anon', 'public.pausas_del_chofer', 'select')
    union all
    select 'authenticated puede borrar' where has_table_privilege('authenticated', 'public.pausas_del_chofer', 'delete')
  ) t;
  if faltan is not null then
    raise exception '167 no quedo bien: %', faltan;
  end if;
end $$;

-- @ledger-below
insert into public.schema_migrations (name, checksum) values ('167_pausas_del_chofer.sql', '12535df8ac4a426a42876f579d0bcf3916fd785fabd405c62f033b8e8b24426c') on conflict (name) do nothing;
