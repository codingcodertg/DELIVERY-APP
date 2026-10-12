-- Matriz por rol de la 165, con ROLLBACK. Se corre con psql desde la RAIZ del worktree:
--   psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -f docs/PLAN-165-matriz-por-rol.sql
-- Sustituir cada <UUID-...> por un perfil REAL de ese rol (con el modulo de Entregas, salvo <UUID-SIN-ENTREGAS>):
-- <UUID-CHOFER-CON-FICHA> tiene fila en clockin.employee_settings (mejor si con vehiculo asignado); <UUID-CHOFER-SIN-FICHA>
-- no la tiene. <UUID-VEHICULO-A> y <UUID-VEHICULO-B>: dos vehiculos ACTIVOS de clockin.vehicles (si solo hay uno, en
-- lugar de <UUID-VEHICULO-B> se escribe NINGUNO y A4 usa un vehiculo escrito a mano). La 165 se crea DENTRO de la
-- transaccion: la tabla empieza vacia, y todo se deshace al final.
\set QUIET on
begin;   -- SIN commit en ningun sitio: termina en rollback
\i supabase/migrations/165_inspeccion_pre_viaje.sql

set local role authenticated;

-- A. CHOFER con ficha
set local request.jwt.claims to '{"sub":"<UUID-CHOFER-CON-FICHA>","role":"authenticated"}';
do $$ declare n int; f public.vehicle_inspections%rowtype; primero record; begin
  select count(*) into n from public.vehiculos_para_inspeccion();
  select * into primero from public.vehiculos_para_inspeccion() limit 1;
  raise notice 'A1  vehiculos (% activos): el asignado, si hay, primero %', n, case when n = 0 or primero.assigned or not exists (select 1 from public.vehiculos_para_inspeccion() v where v.assigned) then 'OK' else 'MAL '||primero.name end;

  insert into public.vehicle_inspections (driver_id, driver_name, inspection_date, vehicle_id, vehicle_label, odometer, answers, safe, certified, checklist_version, repairs)
  values ('<UUID-CHOFER-SIN-FICHA>', 'Otro', '2000-01-01', '<UUID-VEHICULO-A>', 'Camion 3 · TX 4KD-221', 84213,
          '{"inflado":{"estado":"defecto","nota":"baja","fotos":["data:x"]},"bocina":{"estado":"ok"}}', false, true, '2026-10-11', '{"inflado":{"at":"x"}}')
  returning * into f;
  raise notice 'A2  inserta: la base pone quien, nombre, dia, repairs %', case when f.driver_id = '<UUID-CHOFER-CON-FICHA>' and f.driver_name = (select full_name from public.profiles where id = '<UUID-CHOFER-CON-FICHA>')
    and f.inspection_date = (now() at time zone 'America/Chicago')::date and f.repairs = '{}'::jsonb then 'OK' else 'MAL '||row_to_json(f)::text end;

  begin
    insert into public.vehicle_inspections (vehicle_id, vehicle_label, odometer, answers, safe, certified)
    values ('<UUID-VEHICULO-A>', 'Camion 3', 84214, '{}', true, true);
    raise notice 'A3  misma camioneta, mismo dia                        MAL, paso';
  exception when others then raise notice 'A3  misma camioneta, mismo dia -> 23505          %', case when sqlstate = '23505' then 'OK' else 'MAL ('||sqlerrm||')' end; end;

  insert into public.vehicle_inspections (vehicle_id, vehicle_label, odometer, answers, safe, certified)
  values (nullif('<UUID-VEHICULO-B>', 'NINGUNO')::uuid, 'ENSAYO 165 B', 1000, '{}', true, true);
  raise notice 'A4  otro vehiculo el mismo dia                        OK';

  insert into public.vehicle_inspections (vehicle_id, vehicle_label, odometer, answers, safe, certified)
  values (null, '  Pickup   Roja ', null, '{}', true, true);
  begin
    insert into public.vehicle_inspections (vehicle_id, vehicle_label, odometer, answers, safe, certified)
    values (null, 'pickup roja', null, '{}', true, true);
    raise notice 'A5  vehiculo a mano repetido (mayus/espacios)         MAL, paso';
  exception when others then raise notice 'A5  vehiculo a mano repetido -> 23505            %', case when sqlstate = '23505' then 'OK' else 'MAL ('||sqlerrm||')' end; end;

  select count(*) into n from public.vehicle_inspections;
  raise notice 'A6  lee las suyas (3)                                 %', case when n = 3 then 'OK' else 'MAL '||n end;

  begin update public.vehicle_inspections set safe = true;
    raise notice 'A7  UPDATE                                            MAL, paso';
  exception when others then raise notice 'A7  UPDATE -> 42501                              %', case when sqlstate = '42501' then 'OK' else 'MAL ('||sqlerrm||')' end; end;
  begin delete from public.vehicle_inspections;
    raise notice 'A8  DELETE                                            MAL, paso';
  exception when others then raise notice 'A8  DELETE -> 42501                              %', case when sqlstate = '42501' then 'OK' else 'MAL ('||sqlerrm||')' end; end;
  begin perform public.marca_defecto_corregido(f.id, 'inflado', true, 'x');
    raise notice 'A9  chofer marca corregido                            MAL, paso';
  exception when others then raise notice 'A9  chofer marca corregido -> 42501              %', case when sqlstate = '42501' then 'OK' else 'MAL ('||sqlerrm||')' end; end;
  begin insert into public.vehicle_inspections (vehicle_label, answers, safe, certified) values ('X', '{}', true, false);
    raise notice 'A10 sin certificar                                    MAL, paso';
  exception when others then raise notice 'A10 sin certificar -> 23514                      %', case when sqlstate = '23514' then 'OK' else 'MAL ('||sqlerrm||')' end; end;
  begin insert into public.vehicle_inspections (vehicle_label, answers, safe, certified) values ('   ', '{}', true, true);
    raise notice 'A11 vehiculo en blanco                                MAL, paso';
  exception when others then raise notice 'A11 vehiculo en blanco -> 23514                  %', case when sqlstate = '23514' then 'OK' else 'MAL ('||sqlerrm||')' end; end;
end $$;

-- B. CHOFER sin ficha: ve los vehiculos por la compania unica, sin asignado; no ve las de Diego.
set local request.jwt.claims to '{"sub":"<UUID-CHOFER-SIN-FICHA>","role":"authenticated"}';
do $$ declare n int; a int; begin
  select count(*), count(*) filter (where assigned) into n, a from public.vehiculos_para_inspeccion();
  raise notice 'B1  sin ficha: % vehiculos, ninguno asignado         %', n, case when a = 0 then 'OK' else 'MAL '||a end;
  select count(*) into n from public.vehicle_inspections;
  raise notice 'B2  no ve las de otro chofer (0)                      %', case when n = 0 then 'OK' else 'MAL '||n end;
  insert into public.vehicle_inspections (vehicle_id, vehicle_label, odometer, answers, safe, certified)
  values ('<UUID-VEHICULO-A>', 'Camion 3', 5, '{"frenos":{"estado":"defecto","nota":"chillan","fotos":["data:y"]}}', false, true);
  raise notice 'B3  inserta la suya (mismo camion que Diego, otro chofer) OK';
end $$;

-- C. LOGISTICA: lee todas; marca y desmarca; no edita directo.
set local request.jwt.claims to '{"sub":"<UUID-LOGISTICA>","role":"authenticated"}';
do $$ declare n int; id_ uuid; r jsonb; begin
  select count(*) into n from public.vehicle_inspections;
  raise notice 'C1  logistica lee todas (4)                           %', case when n = 4 then 'OK' else 'MAL '||n end;
  select id into id_ from public.vehicle_inspections where answers ? 'inflado';
  r := public.marca_defecto_corregido(id_, 'inflado', true, '  cambiada  ');
  raise notice 'C2  marca corregido: sella quien, nombre, nota        %', case when r -> 'inflado' ->> 'by' = '<UUID-LOGISTICA>'
    and r -> 'inflado' ->> 'by_name' = (select full_name from public.profiles where id = '<UUID-LOGISTICA>') and r -> 'inflado' ->> 'note' = 'cambiada' and r -> 'inflado' ? 'at' then 'OK' else 'MAL '||r::text end;
  begin perform public.marca_defecto_corregido(id_, 'bocina', true, null);
    raise notice 'C3  marcar algo que no es defecto                     MAL, paso';
  exception when others then raise notice 'C3  no es defecto -> 22023                       %', case when sqlstate = '22023' then 'OK' else 'MAL ('||sqlerrm||')' end; end;
  r := public.marca_defecto_corregido(id_, 'inflado', false, null);
  raise notice 'C4  desmarca                                          %', case when r = '{}'::jsonb then 'OK' else 'MAL '||r::text end;
  begin perform public.marca_defecto_corregido(gen_random_uuid(), 'inflado', true, null);
    raise notice 'C5  inspeccion inexistente                            MAL, paso';
  exception when others then raise notice 'C5  inexistente -> P0002                         %', case when sqlstate = 'P0002' then 'OK' else 'MAL ('||sqlerrm||')' end; end;
  begin update public.vehicle_inspections set repairs = '{}';
    raise notice 'C6  UPDATE directo                                    MAL, paso';
  exception when others then raise notice 'C6  UPDATE directo -> 42501                      %', case when sqlstate = '42501' then 'OK' else 'MAL ('||sqlerrm||')' end; end;
end $$;

-- D. ADMIN (sin 'deliveries' en module_access, pero admin): lee todas y marca.
set local request.jwt.claims to '{"sub":"<UUID-ADMIN>","role":"authenticated"}';
do $$ declare n int; id_ uuid; r jsonb; begin
  select count(*) into n from public.vehicle_inspections;
  select id into id_ from public.vehicle_inspections where answers ? 'frenos';
  r := public.marca_defecto_corregido(id_, 'frenos', true, null);
  raise notice 'D1  admin lee todas (4) y marca                       %', case when n = 4 and r -> 'frenos' ->> 'by_name' = (select full_name from public.profiles where id = '<UUID-ADMIN>') and r -> 'frenos' -> 'note' = 'null'::jsonb then 'OK' else 'MAL '||n||' '||r::text end;
end $$;

-- E. VENTAS (con modulo) y F. GERENTE: no ven las de nadie; marcar -> 42501.
set local request.jwt.claims to '{"sub":"<UUID-VENTAS>","role":"authenticated"}';
do $$ declare n int; begin
  select count(*) into n from public.vehicle_inspections;
  raise notice 'E1  ventas no ve ninguna (0)                          %', case when n = 0 then 'OK' else 'MAL '||n end;
  begin perform public.marca_defecto_corregido(gen_random_uuid(), 'x', true, null);
    raise notice 'E2  ventas marca                                      MAL, paso';
  exception when others then raise notice 'E2  ventas marca -> 42501                        %', case when sqlstate = '42501' then 'OK' else 'MAL ('||sqlerrm||')' end; end;
end $$;
set local request.jwt.claims to '{"sub":"<UUID-GERENTE>","role":"authenticated"}';
do $$ declare n int; begin
  select count(*) into n from public.vehicle_inspections;
  raise notice 'F1  gerente no ve ninguna (0)                         %', case when n = 0 then 'OK' else 'MAL '||n end;
end $$;

-- G. SIN EL MODULO: nada.
set local request.jwt.claims to '{"sub":"<UUID-SIN-ENTREGAS>","role":"authenticated"}';
do $$ declare n int; begin
  select count(*) into n from public.vehicle_inspections;
  raise notice 'G1  sin modulo no ve (0)                              %', case when n = 0 then 'OK' else 'MAL '||n end;
  begin insert into public.vehicle_inspections (vehicle_label, answers, safe, certified) values ('X', '{}', true, true);
    raise notice 'G2  sin modulo inserta                                MAL, paso';
  exception when others then raise notice 'G2  sin modulo inserta -> 42501                  %', case when sqlstate = '42501' then 'OK' else 'MAL ('||sqlerrm||')' end; end;
  begin perform * from public.vehiculos_para_inspeccion();
    raise notice 'G3  sin modulo lee vehiculos                          MAL, paso';
  exception when others then raise notice 'G3  sin modulo vehiculos -> 42501                %', case when sqlstate = '42501' then 'OK' else 'MAL ('||sqlerrm||')' end; end;
end $$;

-- H. ANON: nada.
reset role;
set local role anon;
do $$ begin
  begin perform 1 from public.vehicle_inspections;
    raise notice 'H1  anon lee                                          MAL, paso';
  exception when others then raise notice 'H1  anon lee -> 42501                            %', case when sqlstate = '42501' then 'OK' else 'MAL ('||sqlerrm||')' end; end;
  begin perform * from public.vehiculos_para_inspeccion();
    raise notice 'H2  anon vehiculos                                    MAL, paso';
  exception when others then raise notice 'H2  anon vehiculos -> 42501                      %', case when sqlstate = '42501' then 'OK' else 'MAL ('||sqlerrm||')' end; end;
end $$;

reset role;
select name, checksum from public.schema_migrations where name = '165_inspeccion_pre_viaje.sql';
rollback;
select count(*) as filas_tras_rollback from pg_tables where tablename = 'vehicle_inspections';
