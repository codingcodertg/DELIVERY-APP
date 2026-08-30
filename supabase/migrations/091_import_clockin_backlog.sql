-- 091 · Traer de la app de fichaje VIEJA lo que nunca llegó (D-134)
--
-- Origen:  proyecto Supabase `zicjztjdlznqxoddrxtn` ("jose@axen-growth.com's Project"), que es
--          la base original de la app de fichaje, la que se transfirió con la aplicación.
-- Destino: esquema `clockin` de este proyecto.
--
-- ---------------------------------------------------------------------------
-- Qué falta, y por qué importa
-- ---------------------------------------------------------------------------
-- Comparación exacta por identificador, tabla a tabla, no por fechas ni por conteos:
--
--     time_entries      10 filas   ← 85,3 h de trabajo real, del 26 al 29 de agosto
--     scheduled_shifts  45
--     exceptions        10
--     vehicle_trips      2
--     trip_stops         4
--
-- Las horas son de Zulema Resendez (30,2 h), Olga Patricia Hernandez (29,5 h), Alberto Garza
-- (12,0 h), Anthony Hernandez (10,8 h) y Elsa Vasquez (2,8 h). Parte cae DENTRO del periodo de
-- pago en curso, así que sin esto la nómina de este periodo sale corta.
--
-- ---------------------------------------------------------------------------
-- El remapeo de identidades, que es lo delicado
-- ---------------------------------------------------------------------------
-- Las dos bases tienen sistemas de autenticación distintos: **las once personas tienen
-- identificadores diferentes**. Un primer intento sin remapear fue rechazado entero por clave
-- foránea, que es exactamente lo que tenía que pasar.
--
-- Nueve se cruzan por CORREO, sin ambigüedad. Dos no, y se resolvieron por nombre con la
-- confirmación expresa de Andrés — queda escrito porque atribuir horas que se pagan por un
-- cruce de nombres tiene que poder auditarse:
--
--     twagalum@gmail.com          → Alberto Garza      (salesrhc2@rdztilegroup.net)
--     phernandez@rdztilegroup.net → Patricia Hernández (managementrhc@rdztilegroup.net)
--
-- Los sitios de trabajo y el vehículo SÍ comparten identificador entre las dos bases
-- (comprobado uno a uno), así que solo se remapean personas.
--
-- ---------------------------------------------------------------------------
-- Cómo está escrito
-- ---------------------------------------------------------------------------
-- Cada fila va en su propio bloque con su propia captura de errores, y el resultado se anota
-- en una tabla temporal que se consulta al final. Así una fila rechazada —por solapamiento con
-- un fichaje que ya existe, o por una referencia que falta— no se lleva por delante a las otras
-- setenta, y al terminar se sabe exactamente qué entró y qué no en vez de suponerlo.
--
-- `on conflict (id) do nothing` hace que volver a ejecutarlo sea inofensivo.
--
-- ---------------------------------------------------------------------------
-- Lo que esto NO arregla
-- ---------------------------------------------------------------------------
-- La cuadrilla SIGUE fichando en la app vieja: 23 fichajes en los últimos siete días. Esto
-- pone al día hasta el 29 de agosto y mañana volverá a faltar. Es una copia con fecha de
-- caducidad, no una migración, y lo seguirá siendo hasta que se cierre aquella puerta.

create temp table migra_log(tabla text, estado text, motivo text) on commit drop;
do $mig$
begin
  begin
    insert into clockin.scheduled_shifts (id, company_id, employee_id, site_id, shift_date, start_time, end_time, lunch_minutes, created_by, created_at, lunch_start_time) values ('42c2c6b2-2468-4ce8-b4a5-d32bd1c4977b', '8ac7eb71-5e7e-46df-96f3-9ad3b2d2da40', '273f67fa-b9d2-40d7-a489-0f7d5050d4a7', null, '2026-09-04', '08:00:00', '18:00:00', 60, null, '2026-08-28 09:00:22.035182+00', null) on conflict (id) do nothing;
    insert into migra_log values ('scheduled_shifts', 'ok', null);
  exception when others then
    insert into migra_log values ('scheduled_shifts', 'rechazada', sqlerrm);
  end;
  begin
    insert into clockin.scheduled_shifts (id, company_id, employee_id, site_id, shift_date, start_time, end_time, lunch_minutes, created_by, created_at, lunch_start_time) values ('cc54443b-9e44-4f1c-bcd1-ff84e2085a17', '8ac7eb71-5e7e-46df-96f3-9ad3b2d2da40', '273f67fa-b9d2-40d7-a489-0f7d5050d4a7', null, '2026-09-05', '08:00:00', '16:00:00', 60, null, '2026-08-28 09:00:22.035182+00', null) on conflict (id) do nothing;
    insert into migra_log values ('scheduled_shifts', 'ok', null);
  exception when others then
    insert into migra_log values ('scheduled_shifts', 'rechazada', sqlerrm);
  end;
  begin
    insert into clockin.scheduled_shifts (id, company_id, employee_id, site_id, shift_date, start_time, end_time, lunch_minutes, created_by, created_at, lunch_start_time) values ('ece2bb40-37d0-473b-9321-a03c438d1c13', '8ac7eb71-5e7e-46df-96f3-9ad3b2d2da40', '273f67fa-b9d2-40d7-a489-0f7d5050d4a7', null, '2026-09-07', '08:00:00', '18:00:00', 60, null, '2026-08-28 09:00:22.035182+00', null) on conflict (id) do nothing;
    insert into migra_log values ('scheduled_shifts', 'ok', null);
  exception when others then
    insert into migra_log values ('scheduled_shifts', 'rechazada', sqlerrm);
  end;
  begin
    insert into clockin.scheduled_shifts (id, company_id, employee_id, site_id, shift_date, start_time, end_time, lunch_minutes, created_by, created_at, lunch_start_time) values ('7fba3212-9706-4661-92c0-b219caf7d558', '8ac7eb71-5e7e-46df-96f3-9ad3b2d2da40', '273f67fa-b9d2-40d7-a489-0f7d5050d4a7', null, '2026-09-08', '08:00:00', '18:00:00', 60, null, '2026-08-28 09:00:22.035182+00', null) on conflict (id) do nothing;
    insert into migra_log values ('scheduled_shifts', 'ok', null);
  exception when others then
    insert into migra_log values ('scheduled_shifts', 'rechazada', sqlerrm);
  end;
  begin
    insert into clockin.scheduled_shifts (id, company_id, employee_id, site_id, shift_date, start_time, end_time, lunch_minutes, created_by, created_at, lunch_start_time) values ('c01289aa-f4de-4aa9-80ec-f47b394d3292', '8ac7eb71-5e7e-46df-96f3-9ad3b2d2da40', '273f67fa-b9d2-40d7-a489-0f7d5050d4a7', null, '2026-09-09', '08:00:00', '18:00:00', 60, null, '2026-08-28 09:00:22.035182+00', null) on conflict (id) do nothing;
    insert into migra_log values ('scheduled_shifts', 'ok', null);
  exception when others then
    insert into migra_log values ('scheduled_shifts', 'rechazada', sqlerrm);
  end;
  begin
    insert into clockin.scheduled_shifts (id, company_id, employee_id, site_id, shift_date, start_time, end_time, lunch_minutes, created_by, created_at, lunch_start_time) values ('272398e8-c158-45d5-8882-9aadad03f9a1', '8ac7eb71-5e7e-46df-96f3-9ad3b2d2da40', '273f67fa-b9d2-40d7-a489-0f7d5050d4a7', null, '2026-09-10', '08:00:00', '18:00:00', 60, null, '2026-08-28 09:00:22.035182+00', null) on conflict (id) do nothing;
    insert into migra_log values ('scheduled_shifts', 'ok', null);
  exception when others then
    insert into migra_log values ('scheduled_shifts', 'rechazada', sqlerrm);
  end;
  begin
    insert into clockin.scheduled_shifts (id, company_id, employee_id, site_id, shift_date, start_time, end_time, lunch_minutes, created_by, created_at, lunch_start_time) values ('b6e98795-3d9e-49f3-a288-698a3a16617d', '8ac7eb71-5e7e-46df-96f3-9ad3b2d2da40', '388aa1e4-516b-4647-b2af-8edfe992da03', '517a6d1d-e9f0-4c1c-a21a-6e2c54b38899', '2026-09-04', '08:00:00', '18:00:00', 60, null, '2026-08-28 09:00:22.157758+00', null) on conflict (id) do nothing;
    insert into migra_log values ('scheduled_shifts', 'ok', null);
  exception when others then
    insert into migra_log values ('scheduled_shifts', 'rechazada', sqlerrm);
  end;
  begin
    insert into clockin.scheduled_shifts (id, company_id, employee_id, site_id, shift_date, start_time, end_time, lunch_minutes, created_by, created_at, lunch_start_time) values ('d95e7b57-7afa-4325-85fa-c9183125fc84', '8ac7eb71-5e7e-46df-96f3-9ad3b2d2da40', '388aa1e4-516b-4647-b2af-8edfe992da03', '517a6d1d-e9f0-4c1c-a21a-6e2c54b38899', '2026-09-05', '08:00:00', '16:00:00', 60, null, '2026-08-28 09:00:22.157758+00', null) on conflict (id) do nothing;
    insert into migra_log values ('scheduled_shifts', 'ok', null);
  exception when others then
    insert into migra_log values ('scheduled_shifts', 'rechazada', sqlerrm);
  end;
  begin
    insert into clockin.scheduled_shifts (id, company_id, employee_id, site_id, shift_date, start_time, end_time, lunch_minutes, created_by, created_at, lunch_start_time) values ('cb7d75a1-b458-411f-bee2-5797e4d1e5e6', '8ac7eb71-5e7e-46df-96f3-9ad3b2d2da40', '388aa1e4-516b-4647-b2af-8edfe992da03', '517a6d1d-e9f0-4c1c-a21a-6e2c54b38899', '2026-09-07', '08:00:00', '18:00:00', 60, null, '2026-08-28 09:00:22.157758+00', null) on conflict (id) do nothing;
    insert into migra_log values ('scheduled_shifts', 'ok', null);
  exception when others then
    insert into migra_log values ('scheduled_shifts', 'rechazada', sqlerrm);
  end;
  begin
    insert into clockin.scheduled_shifts (id, company_id, employee_id, site_id, shift_date, start_time, end_time, lunch_minutes, created_by, created_at, lunch_start_time) values ('b209457a-5e62-4ca1-82ec-f5e6cb29ee5b', '8ac7eb71-5e7e-46df-96f3-9ad3b2d2da40', '388aa1e4-516b-4647-b2af-8edfe992da03', '517a6d1d-e9f0-4c1c-a21a-6e2c54b38899', '2026-09-08', '08:00:00', '18:00:00', 60, null, '2026-08-28 09:00:22.157758+00', null) on conflict (id) do nothing;
    insert into migra_log values ('scheduled_shifts', 'ok', null);
  exception when others then
    insert into migra_log values ('scheduled_shifts', 'rechazada', sqlerrm);
  end;
  begin
    insert into clockin.scheduled_shifts (id, company_id, employee_id, site_id, shift_date, start_time, end_time, lunch_minutes, created_by, created_at, lunch_start_time) values ('f8cc9b1f-842b-494e-9f79-b4fddc8c0d39', '8ac7eb71-5e7e-46df-96f3-9ad3b2d2da40', '388aa1e4-516b-4647-b2af-8edfe992da03', '517a6d1d-e9f0-4c1c-a21a-6e2c54b38899', '2026-09-09', '08:00:00', '18:00:00', 60, null, '2026-08-28 09:00:22.157758+00', null) on conflict (id) do nothing;
    insert into migra_log values ('scheduled_shifts', 'ok', null);
  exception when others then
    insert into migra_log values ('scheduled_shifts', 'rechazada', sqlerrm);
  end;
  begin
    insert into clockin.scheduled_shifts (id, company_id, employee_id, site_id, shift_date, start_time, end_time, lunch_minutes, created_by, created_at, lunch_start_time) values ('60e7698d-fa84-48bf-8d6f-5ac0ff2cd95d', '8ac7eb71-5e7e-46df-96f3-9ad3b2d2da40', '388aa1e4-516b-4647-b2af-8edfe992da03', '517a6d1d-e9f0-4c1c-a21a-6e2c54b38899', '2026-09-10', '08:00:00', '18:00:00', 60, null, '2026-08-28 09:00:22.157758+00', null) on conflict (id) do nothing;
    insert into migra_log values ('scheduled_shifts', 'ok', null);
  exception when others then
    insert into migra_log values ('scheduled_shifts', 'rechazada', sqlerrm);
  end;
  begin
    insert into clockin.scheduled_shifts (id, company_id, employee_id, site_id, shift_date, start_time, end_time, lunch_minutes, created_by, created_at, lunch_start_time) values ('84acec9f-d506-4abb-bae5-b5b43770874a', '8ac7eb71-5e7e-46df-96f3-9ad3b2d2da40', '20848eee-06eb-4b52-a58a-63d0d42494cf', '517a6d1d-e9f0-4c1c-a21a-6e2c54b38899', '2026-09-04', '08:00:00', '18:00:00', 60, null, '2026-08-28 09:00:22.246966+00', null) on conflict (id) do nothing;
    insert into migra_log values ('scheduled_shifts', 'ok', null);
  exception when others then
    insert into migra_log values ('scheduled_shifts', 'rechazada', sqlerrm);
  end;
  begin
    insert into clockin.scheduled_shifts (id, company_id, employee_id, site_id, shift_date, start_time, end_time, lunch_minutes, created_by, created_at, lunch_start_time) values ('57f08d2c-a0f1-447d-bbcc-3d7c4824f189', '8ac7eb71-5e7e-46df-96f3-9ad3b2d2da40', '20848eee-06eb-4b52-a58a-63d0d42494cf', '517a6d1d-e9f0-4c1c-a21a-6e2c54b38899', '2026-09-05', '08:00:00', '16:00:00', 60, null, '2026-08-28 09:00:22.246966+00', null) on conflict (id) do nothing;
    insert into migra_log values ('scheduled_shifts', 'ok', null);
  exception when others then
    insert into migra_log values ('scheduled_shifts', 'rechazada', sqlerrm);
  end;
  begin
    insert into clockin.scheduled_shifts (id, company_id, employee_id, site_id, shift_date, start_time, end_time, lunch_minutes, created_by, created_at, lunch_start_time) values ('c82c80ce-0fc3-40e8-a1c0-cd09d6f5bf22', '8ac7eb71-5e7e-46df-96f3-9ad3b2d2da40', '20848eee-06eb-4b52-a58a-63d0d42494cf', '517a6d1d-e9f0-4c1c-a21a-6e2c54b38899', '2026-09-07', '08:00:00', '18:00:00', 60, null, '2026-08-28 09:00:22.246966+00', null) on conflict (id) do nothing;
    insert into migra_log values ('scheduled_shifts', 'ok', null);
  exception when others then
    insert into migra_log values ('scheduled_shifts', 'rechazada', sqlerrm);
  end;
  begin
    insert into clockin.scheduled_shifts (id, company_id, employee_id, site_id, shift_date, start_time, end_time, lunch_minutes, created_by, created_at, lunch_start_time) values ('c05fa529-ff85-451c-9553-7027b6c87e31', '8ac7eb71-5e7e-46df-96f3-9ad3b2d2da40', '20848eee-06eb-4b52-a58a-63d0d42494cf', '517a6d1d-e9f0-4c1c-a21a-6e2c54b38899', '2026-09-08', '08:00:00', '18:00:00', 60, null, '2026-08-28 09:00:22.246966+00', null) on conflict (id) do nothing;
    insert into migra_log values ('scheduled_shifts', 'ok', null);
  exception when others then
    insert into migra_log values ('scheduled_shifts', 'rechazada', sqlerrm);
  end;
  begin
    insert into clockin.scheduled_shifts (id, company_id, employee_id, site_id, shift_date, start_time, end_time, lunch_minutes, created_by, created_at, lunch_start_time) values ('64c35399-5c25-470f-b076-636a7d5dc27c', '8ac7eb71-5e7e-46df-96f3-9ad3b2d2da40', '20848eee-06eb-4b52-a58a-63d0d42494cf', '517a6d1d-e9f0-4c1c-a21a-6e2c54b38899', '2026-09-09', '08:00:00', '18:00:00', 60, null, '2026-08-28 09:00:22.246966+00', null) on conflict (id) do nothing;
    insert into migra_log values ('scheduled_shifts', 'ok', null);
  exception when others then
    insert into migra_log values ('scheduled_shifts', 'rechazada', sqlerrm);
  end;
  begin
    insert into clockin.scheduled_shifts (id, company_id, employee_id, site_id, shift_date, start_time, end_time, lunch_minutes, created_by, created_at, lunch_start_time) values ('b3b294f0-e0d3-44c9-b07a-b4d1b88908d6', '8ac7eb71-5e7e-46df-96f3-9ad3b2d2da40', '20848eee-06eb-4b52-a58a-63d0d42494cf', '517a6d1d-e9f0-4c1c-a21a-6e2c54b38899', '2026-09-10', '08:00:00', '18:00:00', 60, null, '2026-08-28 09:00:22.246966+00', null) on conflict (id) do nothing;
    insert into migra_log values ('scheduled_shifts', 'ok', null);
  exception when others then
    insert into migra_log values ('scheduled_shifts', 'rechazada', sqlerrm);
  end;
  begin
    insert into clockin.scheduled_shifts (id, company_id, employee_id, site_id, shift_date, start_time, end_time, lunch_minutes, created_by, created_at, lunch_start_time) values ('3ee48397-f6bc-4e50-bea7-a08a260a264b', '8ac7eb71-5e7e-46df-96f3-9ad3b2d2da40', '4760e4ef-acd2-4b13-82c6-a6fdb789886c', '517a6d1d-e9f0-4c1c-a21a-6e2c54b38899', '2026-09-04', '08:00:00', '18:00:00', 60, null, '2026-08-28 09:00:22.324648+00', null) on conflict (id) do nothing;
    insert into migra_log values ('scheduled_shifts', 'ok', null);
  exception when others then
    insert into migra_log values ('scheduled_shifts', 'rechazada', sqlerrm);
  end;
  begin
    insert into clockin.scheduled_shifts (id, company_id, employee_id, site_id, shift_date, start_time, end_time, lunch_minutes, created_by, created_at, lunch_start_time) values ('bb97511a-5023-4c39-a259-f3e48c759618', '8ac7eb71-5e7e-46df-96f3-9ad3b2d2da40', '4760e4ef-acd2-4b13-82c6-a6fdb789886c', '517a6d1d-e9f0-4c1c-a21a-6e2c54b38899', '2026-09-05', '08:00:00', '16:00:00', 60, null, '2026-08-28 09:00:22.324648+00', null) on conflict (id) do nothing;
    insert into migra_log values ('scheduled_shifts', 'ok', null);
  exception when others then
    insert into migra_log values ('scheduled_shifts', 'rechazada', sqlerrm);
  end;
  begin
    insert into clockin.scheduled_shifts (id, company_id, employee_id, site_id, shift_date, start_time, end_time, lunch_minutes, created_by, created_at, lunch_start_time) values ('57a764eb-187b-43a9-8b86-f1a36f296c10', '8ac7eb71-5e7e-46df-96f3-9ad3b2d2da40', '4760e4ef-acd2-4b13-82c6-a6fdb789886c', '517a6d1d-e9f0-4c1c-a21a-6e2c54b38899', '2026-09-07', '08:00:00', '18:00:00', 60, null, '2026-08-28 09:00:22.324648+00', null) on conflict (id) do nothing;
    insert into migra_log values ('scheduled_shifts', 'ok', null);
  exception when others then
    insert into migra_log values ('scheduled_shifts', 'rechazada', sqlerrm);
  end;
  begin
    insert into clockin.scheduled_shifts (id, company_id, employee_id, site_id, shift_date, start_time, end_time, lunch_minutes, created_by, created_at, lunch_start_time) values ('a9975bdc-22fb-4a7f-9b03-d2a625bfa103', '8ac7eb71-5e7e-46df-96f3-9ad3b2d2da40', '4760e4ef-acd2-4b13-82c6-a6fdb789886c', '517a6d1d-e9f0-4c1c-a21a-6e2c54b38899', '2026-09-08', '08:00:00', '18:00:00', 60, null, '2026-08-28 09:00:22.324648+00', null) on conflict (id) do nothing;
    insert into migra_log values ('scheduled_shifts', 'ok', null);
  exception when others then
    insert into migra_log values ('scheduled_shifts', 'rechazada', sqlerrm);
  end;
  begin
    insert into clockin.scheduled_shifts (id, company_id, employee_id, site_id, shift_date, start_time, end_time, lunch_minutes, created_by, created_at, lunch_start_time) values ('13a5b7bb-2b1f-4215-8e63-7cf06d30d10f', '8ac7eb71-5e7e-46df-96f3-9ad3b2d2da40', '4760e4ef-acd2-4b13-82c6-a6fdb789886c', '517a6d1d-e9f0-4c1c-a21a-6e2c54b38899', '2026-09-09', '08:00:00', '18:00:00', 60, null, '2026-08-28 09:00:22.324648+00', null) on conflict (id) do nothing;
    insert into migra_log values ('scheduled_shifts', 'ok', null);
  exception when others then
    insert into migra_log values ('scheduled_shifts', 'rechazada', sqlerrm);
  end;
  begin
    insert into clockin.scheduled_shifts (id, company_id, employee_id, site_id, shift_date, start_time, end_time, lunch_minutes, created_by, created_at, lunch_start_time) values ('dc92f0e6-def9-452d-8a6f-020009d2d890', '8ac7eb71-5e7e-46df-96f3-9ad3b2d2da40', '4760e4ef-acd2-4b13-82c6-a6fdb789886c', '517a6d1d-e9f0-4c1c-a21a-6e2c54b38899', '2026-09-10', '08:00:00', '18:00:00', 60, null, '2026-08-28 09:00:22.324648+00', null) on conflict (id) do nothing;
    insert into migra_log values ('scheduled_shifts', 'ok', null);
  exception when others then
    insert into migra_log values ('scheduled_shifts', 'rechazada', sqlerrm);
  end;
  begin
    insert into clockin.scheduled_shifts (id, company_id, employee_id, site_id, shift_date, start_time, end_time, lunch_minutes, created_by, created_at, lunch_start_time) values ('e1f049ab-2107-4c12-ac1a-8b1bc8a5437f', '8ac7eb71-5e7e-46df-96f3-9ad3b2d2da40', 'caf1a337-16fe-4736-9f56-012a07fd4164', '517a6d1d-e9f0-4c1c-a21a-6e2c54b38899', '2026-09-04', '09:00:00', '18:00:00', 60, null, '2026-08-28 09:00:22.389547+00', null) on conflict (id) do nothing;
    insert into migra_log values ('scheduled_shifts', 'ok', null);
  exception when others then
    insert into migra_log values ('scheduled_shifts', 'rechazada', sqlerrm);
  end;
  begin
    insert into clockin.scheduled_shifts (id, company_id, employee_id, site_id, shift_date, start_time, end_time, lunch_minutes, created_by, created_at, lunch_start_time) values ('24b5fec4-ebb4-45f2-85b5-a101b5993bd0', '8ac7eb71-5e7e-46df-96f3-9ad3b2d2da40', 'caf1a337-16fe-4736-9f56-012a07fd4164', '517a6d1d-e9f0-4c1c-a21a-6e2c54b38899', '2026-09-07', '09:00:00', '18:00:00', 60, null, '2026-08-28 09:00:22.389547+00', null) on conflict (id) do nothing;
    insert into migra_log values ('scheduled_shifts', 'ok', null);
  exception when others then
    insert into migra_log values ('scheduled_shifts', 'rechazada', sqlerrm);
  end;
  begin
    insert into clockin.scheduled_shifts (id, company_id, employee_id, site_id, shift_date, start_time, end_time, lunch_minutes, created_by, created_at, lunch_start_time) values ('b35cfd50-d28d-474d-9ed9-c1cf43e45e63', '8ac7eb71-5e7e-46df-96f3-9ad3b2d2da40', 'caf1a337-16fe-4736-9f56-012a07fd4164', '517a6d1d-e9f0-4c1c-a21a-6e2c54b38899', '2026-09-08', '09:00:00', '18:00:00', 60, null, '2026-08-28 09:00:22.389547+00', null) on conflict (id) do nothing;
    insert into migra_log values ('scheduled_shifts', 'ok', null);
  exception when others then
    insert into migra_log values ('scheduled_shifts', 'rechazada', sqlerrm);
  end;
  begin
    insert into clockin.scheduled_shifts (id, company_id, employee_id, site_id, shift_date, start_time, end_time, lunch_minutes, created_by, created_at, lunch_start_time) values ('5e99a635-0662-4a9a-9ad1-6d10ef68c3f8', '8ac7eb71-5e7e-46df-96f3-9ad3b2d2da40', 'caf1a337-16fe-4736-9f56-012a07fd4164', '517a6d1d-e9f0-4c1c-a21a-6e2c54b38899', '2026-09-09', '09:00:00', '18:00:00', 60, null, '2026-08-28 09:00:22.389547+00', null) on conflict (id) do nothing;
    insert into migra_log values ('scheduled_shifts', 'ok', null);
  exception when others then
    insert into migra_log values ('scheduled_shifts', 'rechazada', sqlerrm);
  end;
  begin
    insert into clockin.scheduled_shifts (id, company_id, employee_id, site_id, shift_date, start_time, end_time, lunch_minutes, created_by, created_at, lunch_start_time) values ('574f859e-2a3b-4512-84a9-1fc9f70b3838', '8ac7eb71-5e7e-46df-96f3-9ad3b2d2da40', 'caf1a337-16fe-4736-9f56-012a07fd4164', '517a6d1d-e9f0-4c1c-a21a-6e2c54b38899', '2026-09-10', '09:00:00', '18:00:00', 60, null, '2026-08-28 09:00:22.389547+00', null) on conflict (id) do nothing;
    insert into migra_log values ('scheduled_shifts', 'ok', null);
  exception when others then
    insert into migra_log values ('scheduled_shifts', 'rechazada', sqlerrm);
  end;
  begin
    insert into clockin.scheduled_shifts (id, company_id, employee_id, site_id, shift_date, start_time, end_time, lunch_minutes, created_by, created_at, lunch_start_time) values ('c0c2b049-55f1-4720-b130-23063e47f8d5', '8ac7eb71-5e7e-46df-96f3-9ad3b2d2da40', '5443362c-1a6c-4f34-b55e-271b76e9fddd', '517a6d1d-e9f0-4c1c-a21a-6e2c54b38899', '2026-09-04', '08:00:00', '18:00:00', 60, null, '2026-08-28 09:00:22.463219+00', null) on conflict (id) do nothing;
    insert into migra_log values ('scheduled_shifts', 'ok', null);
  exception when others then
    insert into migra_log values ('scheduled_shifts', 'rechazada', sqlerrm);
  end;
  begin
    insert into clockin.scheduled_shifts (id, company_id, employee_id, site_id, shift_date, start_time, end_time, lunch_minutes, created_by, created_at, lunch_start_time) values ('e735f564-a84c-41a1-9d53-25f38c1ea13c', '8ac7eb71-5e7e-46df-96f3-9ad3b2d2da40', '5443362c-1a6c-4f34-b55e-271b76e9fddd', '517a6d1d-e9f0-4c1c-a21a-6e2c54b38899', '2026-09-07', '08:00:00', '18:00:00', 60, null, '2026-08-28 09:00:22.463219+00', null) on conflict (id) do nothing;
    insert into migra_log values ('scheduled_shifts', 'ok', null);
  exception when others then
    insert into migra_log values ('scheduled_shifts', 'rechazada', sqlerrm);
  end;
  begin
    insert into clockin.scheduled_shifts (id, company_id, employee_id, site_id, shift_date, start_time, end_time, lunch_minutes, created_by, created_at, lunch_start_time) values ('bf43c2cb-e0a6-4c6f-b01c-cd5385ccedb6', '8ac7eb71-5e7e-46df-96f3-9ad3b2d2da40', '5443362c-1a6c-4f34-b55e-271b76e9fddd', '517a6d1d-e9f0-4c1c-a21a-6e2c54b38899', '2026-09-08', '08:00:00', '18:00:00', 60, null, '2026-08-28 09:00:22.463219+00', null) on conflict (id) do nothing;
    insert into migra_log values ('scheduled_shifts', 'ok', null);
  exception when others then
    insert into migra_log values ('scheduled_shifts', 'rechazada', sqlerrm);
  end;
  begin
    insert into clockin.scheduled_shifts (id, company_id, employee_id, site_id, shift_date, start_time, end_time, lunch_minutes, created_by, created_at, lunch_start_time) values ('66902ae8-13e8-4475-bc61-2bdefb110ba2', '8ac7eb71-5e7e-46df-96f3-9ad3b2d2da40', '5443362c-1a6c-4f34-b55e-271b76e9fddd', '517a6d1d-e9f0-4c1c-a21a-6e2c54b38899', '2026-09-09', '08:00:00', '18:00:00', 60, null, '2026-08-28 09:00:22.463219+00', null) on conflict (id) do nothing;
    insert into migra_log values ('scheduled_shifts', 'ok', null);
  exception when others then
    insert into migra_log values ('scheduled_shifts', 'rechazada', sqlerrm);
  end;
  begin
    insert into clockin.scheduled_shifts (id, company_id, employee_id, site_id, shift_date, start_time, end_time, lunch_minutes, created_by, created_at, lunch_start_time) values ('8b435b74-c687-4c51-91fb-3feb212e24b7', '8ac7eb71-5e7e-46df-96f3-9ad3b2d2da40', '5443362c-1a6c-4f34-b55e-271b76e9fddd', '517a6d1d-e9f0-4c1c-a21a-6e2c54b38899', '2026-09-10', '08:00:00', '18:00:00', 60, null, '2026-08-28 09:00:22.463219+00', null) on conflict (id) do nothing;
    insert into migra_log values ('scheduled_shifts', 'ok', null);
  exception when others then
    insert into migra_log values ('scheduled_shifts', 'rechazada', sqlerrm);
  end;
  begin
    insert into clockin.scheduled_shifts (id, company_id, employee_id, site_id, shift_date, start_time, end_time, lunch_minutes, created_by, created_at, lunch_start_time) values ('8b49c8ef-fc9e-415e-9e94-19b754a1c556', '8ac7eb71-5e7e-46df-96f3-9ad3b2d2da40', 'd4fcdfcf-204e-4ab6-920b-332fadce533f', '517a6d1d-e9f0-4c1c-a21a-6e2c54b38899', '2026-09-04', '09:00:00', '18:00:00', 60, null, '2026-08-28 09:00:22.535521+00', null) on conflict (id) do nothing;
    insert into migra_log values ('scheduled_shifts', 'ok', null);
  exception when others then
    insert into migra_log values ('scheduled_shifts', 'rechazada', sqlerrm);
  end;
  begin
    insert into clockin.scheduled_shifts (id, company_id, employee_id, site_id, shift_date, start_time, end_time, lunch_minutes, created_by, created_at, lunch_start_time) values ('17c7c768-93c8-48a4-a03e-48945ea31063', '8ac7eb71-5e7e-46df-96f3-9ad3b2d2da40', 'd4fcdfcf-204e-4ab6-920b-332fadce533f', '517a6d1d-e9f0-4c1c-a21a-6e2c54b38899', '2026-09-07', '09:00:00', '18:00:00', 60, null, '2026-08-28 09:00:22.535521+00', null) on conflict (id) do nothing;
    insert into migra_log values ('scheduled_shifts', 'ok', null);
  exception when others then
    insert into migra_log values ('scheduled_shifts', 'rechazada', sqlerrm);
  end;
  begin
    insert into clockin.scheduled_shifts (id, company_id, employee_id, site_id, shift_date, start_time, end_time, lunch_minutes, created_by, created_at, lunch_start_time) values ('4eebe838-3b8b-4f0a-8666-0860626a56c2', '8ac7eb71-5e7e-46df-96f3-9ad3b2d2da40', 'd4fcdfcf-204e-4ab6-920b-332fadce533f', '517a6d1d-e9f0-4c1c-a21a-6e2c54b38899', '2026-09-08', '09:00:00', '18:00:00', 60, null, '2026-08-28 09:00:22.535521+00', null) on conflict (id) do nothing;
    insert into migra_log values ('scheduled_shifts', 'ok', null);
  exception when others then
    insert into migra_log values ('scheduled_shifts', 'rechazada', sqlerrm);
  end;
  begin
    insert into clockin.scheduled_shifts (id, company_id, employee_id, site_id, shift_date, start_time, end_time, lunch_minutes, created_by, created_at, lunch_start_time) values ('b3d4b79c-6333-4139-b457-b50cab2a6a29', '8ac7eb71-5e7e-46df-96f3-9ad3b2d2da40', 'd4fcdfcf-204e-4ab6-920b-332fadce533f', '517a6d1d-e9f0-4c1c-a21a-6e2c54b38899', '2026-09-09', '09:00:00', '18:00:00', 60, null, '2026-08-28 09:00:22.535521+00', null) on conflict (id) do nothing;
    insert into migra_log values ('scheduled_shifts', 'ok', null);
  exception when others then
    insert into migra_log values ('scheduled_shifts', 'rechazada', sqlerrm);
  end;
  begin
    insert into clockin.scheduled_shifts (id, company_id, employee_id, site_id, shift_date, start_time, end_time, lunch_minutes, created_by, created_at, lunch_start_time) values ('898cd027-4e6c-4dd0-901d-9d02162f093a', '8ac7eb71-5e7e-46df-96f3-9ad3b2d2da40', 'd4fcdfcf-204e-4ab6-920b-332fadce533f', '517a6d1d-e9f0-4c1c-a21a-6e2c54b38899', '2026-09-10', '09:00:00', '18:00:00', 60, null, '2026-08-28 09:00:22.535521+00', null) on conflict (id) do nothing;
    insert into migra_log values ('scheduled_shifts', 'ok', null);
  exception when others then
    insert into migra_log values ('scheduled_shifts', 'rechazada', sqlerrm);
  end;
  begin
    insert into clockin.scheduled_shifts (id, company_id, employee_id, site_id, shift_date, start_time, end_time, lunch_minutes, created_by, created_at, lunch_start_time) values ('1f01d070-babb-4a08-a7d5-de67d68dba50', '8ac7eb71-5e7e-46df-96f3-9ad3b2d2da40', '8986d602-03ba-4fde-a169-a5cae02071bb', 'b67c6e3a-a355-4665-a2c6-be523fc5cd30', '2026-09-04', '09:00:00', '18:00:00', 60, null, '2026-08-28 09:00:22.612984+00', null) on conflict (id) do nothing;
    insert into migra_log values ('scheduled_shifts', 'ok', null);
  exception when others then
    insert into migra_log values ('scheduled_shifts', 'rechazada', sqlerrm);
  end;
  begin
    insert into clockin.scheduled_shifts (id, company_id, employee_id, site_id, shift_date, start_time, end_time, lunch_minutes, created_by, created_at, lunch_start_time) values ('261d2c2f-2539-4895-afdd-f1e737cfc639', '8ac7eb71-5e7e-46df-96f3-9ad3b2d2da40', '8986d602-03ba-4fde-a169-a5cae02071bb', 'b67c6e3a-a355-4665-a2c6-be523fc5cd30', '2026-09-05', '09:00:00', '16:00:00', 60, null, '2026-08-28 09:00:22.612984+00', null) on conflict (id) do nothing;
    insert into migra_log values ('scheduled_shifts', 'ok', null);
  exception when others then
    insert into migra_log values ('scheduled_shifts', 'rechazada', sqlerrm);
  end;
  begin
    insert into clockin.scheduled_shifts (id, company_id, employee_id, site_id, shift_date, start_time, end_time, lunch_minutes, created_by, created_at, lunch_start_time) values ('b28d7478-d423-4cd6-94ce-fe9776f963d6', '8ac7eb71-5e7e-46df-96f3-9ad3b2d2da40', '8986d602-03ba-4fde-a169-a5cae02071bb', 'b67c6e3a-a355-4665-a2c6-be523fc5cd30', '2026-09-07', '09:00:00', '18:00:00', 60, null, '2026-08-28 09:00:22.612984+00', null) on conflict (id) do nothing;
    insert into migra_log values ('scheduled_shifts', 'ok', null);
  exception when others then
    insert into migra_log values ('scheduled_shifts', 'rechazada', sqlerrm);
  end;
  begin
    insert into clockin.scheduled_shifts (id, company_id, employee_id, site_id, shift_date, start_time, end_time, lunch_minutes, created_by, created_at, lunch_start_time) values ('5d142e9b-6d31-4b4b-8087-a9129bea2a13', '8ac7eb71-5e7e-46df-96f3-9ad3b2d2da40', '8986d602-03ba-4fde-a169-a5cae02071bb', 'b67c6e3a-a355-4665-a2c6-be523fc5cd30', '2026-09-08', '09:00:00', '18:00:00', 60, null, '2026-08-28 09:00:22.612984+00', null) on conflict (id) do nothing;
    insert into migra_log values ('scheduled_shifts', 'ok', null);
  exception when others then
    insert into migra_log values ('scheduled_shifts', 'rechazada', sqlerrm);
  end;
  begin
    insert into clockin.scheduled_shifts (id, company_id, employee_id, site_id, shift_date, start_time, end_time, lunch_minutes, created_by, created_at, lunch_start_time) values ('b556f3ce-44a1-411a-8d4c-2fd618bdd775', '8ac7eb71-5e7e-46df-96f3-9ad3b2d2da40', '8986d602-03ba-4fde-a169-a5cae02071bb', 'b67c6e3a-a355-4665-a2c6-be523fc5cd30', '2026-09-09', '09:00:00', '18:00:00', 60, null, '2026-08-28 09:00:22.612984+00', null) on conflict (id) do nothing;
    insert into migra_log values ('scheduled_shifts', 'ok', null);
  exception when others then
    insert into migra_log values ('scheduled_shifts', 'rechazada', sqlerrm);
  end;
  begin
    insert into clockin.scheduled_shifts (id, company_id, employee_id, site_id, shift_date, start_time, end_time, lunch_minutes, created_by, created_at, lunch_start_time) values ('9f86b115-b1b5-44ee-b218-1b93e6a01437', '8ac7eb71-5e7e-46df-96f3-9ad3b2d2da40', '8986d602-03ba-4fde-a169-a5cae02071bb', 'b67c6e3a-a355-4665-a2c6-be523fc5cd30', '2026-09-10', '09:00:00', '18:00:00', 60, null, '2026-08-28 09:00:22.612984+00', null) on conflict (id) do nothing;
    insert into migra_log values ('scheduled_shifts', 'ok', null);
  exception when others then
    insert into migra_log values ('scheduled_shifts', 'rechazada', sqlerrm);
  end;
  begin
    insert into clockin.time_entries (id, company_id, employee_id, scheduled_shift_id, clock_in_at, clock_in_lat, clock_in_lng, clock_in_site_id, clock_in_in_radius, clock_out_at, clock_out_lat, clock_out_lng, lunch_minutes, device_id, ip_address, status, created_at, clock_in_photo_path, edited_at, edited_by, edit_note, manual, clock_out_photo_path, clock_out_in_radius, clock_out_site_id, still_working_at, auto_closed) values ('59ac3a20-2e64-47ee-8566-9add3e3f0ba5', '8ac7eb71-5e7e-46df-96f3-9ad3b2d2da40', 'caf1a337-16fe-4736-9f56-012a07fd4164', null, '2026-07-31 21:00:00+00', null, null, null, null, '2026-07-31 21:19:00+00', null, null, 15, null, null, 'edited', '2026-08-01 00:45:46.782861+00', null, '2026-08-06 12:20:12.511+00', 'caf1a337-16fe-4736-9f56-012a07fd4164', null, true, null, null, null, null, false) on conflict (id) do nothing;
    insert into migra_log values ('time_entries', 'ok', null);
  exception when others then
    insert into migra_log values ('time_entries', 'rechazada', sqlerrm);
  end;
  begin
    insert into clockin.time_entries (id, company_id, employee_id, scheduled_shift_id, clock_in_at, clock_in_lat, clock_in_lng, clock_in_site_id, clock_in_in_radius, clock_out_at, clock_out_lat, clock_out_lng, lunch_minutes, device_id, ip_address, status, created_at, clock_in_photo_path, edited_at, edited_by, edit_note, manual, clock_out_photo_path, clock_out_in_radius, clock_out_site_id, still_working_at, auto_closed) values ('2f7db5e1-b77b-49f1-bf6e-5c0553cebd23', '8ac7eb71-5e7e-46df-96f3-9ad3b2d2da40', '273f67fa-b9d2-40d7-a489-0f7d5050d4a7', '317833a7-4412-4ccc-a70a-1f1408e00afa', '2026-08-26 17:30:54.392866+00', 25.9593373686976, -97.5091435937075, '517a6d1d-e9f0-4c1c-a21a-6e2c54b38899', true, '2026-08-26 20:21:07.161+00', 25.959324112523, -97.509017260757, 0, null, null, 'closed', '2026-08-26 17:30:54.392866+00', '8ac7eb71-5e7e-46df-96f3-9ad3b2d2da40/45e70806-2fb3-490d-9cf4-74dc2791fb20/1787765450658.jpg', null, null, null, false, '8ac7eb71-5e7e-46df-96f3-9ad3b2d2da40/45e70806-2fb3-490d-9cf4-74dc2791fb20/1787775657130.jpg', true, '517a6d1d-e9f0-4c1c-a21a-6e2c54b38899', null, false) on conflict (id) do nothing;
    insert into migra_log values ('time_entries', 'ok', null);
  exception when others then
    insert into migra_log values ('time_entries', 'rechazada', sqlerrm);
  end;
  begin
    insert into clockin.time_entries (id, company_id, employee_id, scheduled_shift_id, clock_in_at, clock_in_lat, clock_in_lng, clock_in_site_id, clock_in_in_radius, clock_out_at, clock_out_lat, clock_out_lng, lunch_minutes, device_id, ip_address, status, created_at, clock_in_photo_path, edited_at, edited_by, edit_note, manual, clock_out_photo_path, clock_out_in_radius, clock_out_site_id, still_working_at, auto_closed) values ('f733bce5-369d-4deb-9aa0-34b2ffcc2b35', '8ac7eb71-5e7e-46df-96f3-9ad3b2d2da40', 'caf1a337-16fe-4736-9f56-012a07fd4164', '52b85461-c14e-467c-840a-9e489531beda', '2026-08-27 14:19:46.894178+00', 25.9596751470155, -97.5090561367247, '517a6d1d-e9f0-4c1c-a21a-6e2c54b38899', true, '2026-08-28 00:49:40.083+00', 25.9593291506202, -97.5090405285559, 0, null, null, 'closed', '2026-08-27 14:19:46.894178+00', '8ac7eb71-5e7e-46df-96f3-9ad3b2d2da40/2cc11692-ef53-4086-9333-e1595df4ae0c/1787840385213.jpg', null, null, null, false, '8ac7eb71-5e7e-46df-96f3-9ad3b2d2da40/2cc11692-ef53-4086-9333-e1595df4ae0c/1787878172336.jpg', true, '517a6d1d-e9f0-4c1c-a21a-6e2c54b38899', null, false) on conflict (id) do nothing;
    insert into migra_log values ('time_entries', 'ok', null);
  exception when others then
    insert into migra_log values ('time_entries', 'rechazada', sqlerrm);
  end;
  begin
    insert into clockin.time_entries (id, company_id, employee_id, scheduled_shift_id, clock_in_at, clock_in_lat, clock_in_lng, clock_in_site_id, clock_in_in_radius, clock_out_at, clock_out_lat, clock_out_lng, lunch_minutes, device_id, ip_address, status, created_at, clock_in_photo_path, edited_at, edited_by, edit_note, manual, clock_out_photo_path, clock_out_in_radius, clock_out_site_id, still_working_at, auto_closed) values ('529de9ad-1655-481c-aa31-43cbd3edbdf8', '8ac7eb71-5e7e-46df-96f3-9ad3b2d2da40', '388aa1e4-516b-4647-b2af-8edfe992da03', '40d7be9e-4a1f-4ceb-85ec-c5a9e3c3a242', '2026-08-27 13:01:27.54398+00', 25.9593926836692, -97.5091350831933, '517a6d1d-e9f0-4c1c-a21a-6e2c54b38899', true, '2026-08-28 00:55:45.96+00', 25.9883161320284, -97.4786644133195, 0, null, null, 'closed', '2026-08-27 13:01:27.54398+00', '8ac7eb71-5e7e-46df-96f3-9ad3b2d2da40/a18ee187-6a5e-415f-a7a9-b47c5f88200e/1787835685558.jpg', null, null, null, false, '8ac7eb71-5e7e-46df-96f3-9ad3b2d2da40/a18ee187-6a5e-415f-a7a9-b47c5f88200e/1787878541486.jpg', false, null, null, false) on conflict (id) do nothing;
    insert into migra_log values ('time_entries', 'ok', null);
  exception when others then
    insert into migra_log values ('time_entries', 'rechazada', sqlerrm);
  end;
  begin
    insert into clockin.time_entries (id, company_id, employee_id, scheduled_shift_id, clock_in_at, clock_in_lat, clock_in_lng, clock_in_site_id, clock_in_in_radius, clock_out_at, clock_out_lat, clock_out_lng, lunch_minutes, device_id, ip_address, status, created_at, clock_in_photo_path, edited_at, edited_by, edit_note, manual, clock_out_photo_path, clock_out_in_radius, clock_out_site_id, still_working_at, auto_closed) values ('e12907a0-dd02-48aa-9cbd-15f285515d45', '8ac7eb71-5e7e-46df-96f3-9ad3b2d2da40', 'faf218e9-a1d7-48f5-b8ac-59446223d3e5', null, '2026-08-27 14:13:29.275942+00', 26.2044949101024, -98.167277026606, null, false, '2026-08-28 01:00:00+00', null, null, 0, null, null, 'closed', '2026-08-27 14:13:29.275942+00', '8ac7eb71-5e7e-46df-96f3-9ad3b2d2da40/76bf0f40-9216-454e-a3b7-0dea1d09f5fd/1787840002087.jpg', null, null, 'Automatically clocked out at 8:00 PM (no response to the still-working prompt)', false, null, null, null, null, true) on conflict (id) do nothing;
    insert into migra_log values ('time_entries', 'ok', null);
  exception when others then
    insert into migra_log values ('time_entries', 'rechazada', sqlerrm);
  end;
  begin
    insert into clockin.time_entries (id, company_id, employee_id, scheduled_shift_id, clock_in_at, clock_in_lat, clock_in_lng, clock_in_site_id, clock_in_in_radius, clock_out_at, clock_out_lat, clock_out_lng, lunch_minutes, device_id, ip_address, status, created_at, clock_in_photo_path, edited_at, edited_by, edit_note, manual, clock_out_photo_path, clock_out_in_radius, clock_out_site_id, still_working_at, auto_closed) values ('d1f5568f-e9fb-4aa3-b410-7616e84e8338', '8ac7eb71-5e7e-46df-96f3-9ad3b2d2da40', '4760e4ef-acd2-4b13-82c6-a6fdb789886c', '15c1f93f-354e-46a7-b411-6d16daf1b4d1', '2026-08-27 13:00:52.77316+00', 25.9713530208538, -97.4859693419612, null, false, '2026-08-28 01:00:00+00', null, null, 0, null, null, 'closed', '2026-08-27 13:00:52.77316+00', '8ac7eb71-5e7e-46df-96f3-9ad3b2d2da40/e655bf88-a457-468b-b871-86931215ed75/1787835643641.jpg', null, null, 'Automatically clocked out at 8:00 PM (no response to the still-working prompt)', false, null, null, null, null, true) on conflict (id) do nothing;
    insert into migra_log values ('time_entries', 'ok', null);
  exception when others then
    insert into migra_log values ('time_entries', 'rechazada', sqlerrm);
  end;
  begin
    insert into clockin.time_entries (id, company_id, employee_id, scheduled_shift_id, clock_in_at, clock_in_lat, clock_in_lng, clock_in_site_id, clock_in_in_radius, clock_out_at, clock_out_lat, clock_out_lng, lunch_minutes, device_id, ip_address, status, created_at, clock_in_photo_path, edited_at, edited_by, edit_note, manual, clock_out_photo_path, clock_out_in_radius, clock_out_site_id, still_working_at, auto_closed) values ('b4b1573d-2bcf-4785-ace1-5feba90e5e47', '8ac7eb71-5e7e-46df-96f3-9ad3b2d2da40', '388aa1e4-516b-4647-b2af-8edfe992da03', '3a9a40cd-7f0f-4da4-8ed5-fd51bbaea250', '2026-08-28 13:02:26.164356+00', 25.9592990220217, -97.5091710376155, '517a6d1d-e9f0-4c1c-a21a-6e2c54b38899', true, '2026-08-28 23:11:09.217+00', 25.9593082040657, -97.5089255621636, 0, null, null, 'closed', '2026-08-28 13:02:26.164356+00', '8ac7eb71-5e7e-46df-96f3-9ad3b2d2da40/a18ee187-6a5e-415f-a7a9-b47c5f88200e/1787922139764.jpg', null, null, null, false, '8ac7eb71-5e7e-46df-96f3-9ad3b2d2da40/a18ee187-6a5e-415f-a7a9-b47c5f88200e/1787958666988.jpg', true, '517a6d1d-e9f0-4c1c-a21a-6e2c54b38899', null, false) on conflict (id) do nothing;
    insert into migra_log values ('time_entries', 'ok', null);
  exception when others then
    insert into migra_log values ('time_entries', 'rechazada', sqlerrm);
  end;
  begin
    insert into clockin.time_entries (id, company_id, employee_id, scheduled_shift_id, clock_in_at, clock_in_lat, clock_in_lng, clock_in_site_id, clock_in_in_radius, clock_out_at, clock_out_lat, clock_out_lng, lunch_minutes, device_id, ip_address, status, created_at, clock_in_photo_path, edited_at, edited_by, edit_note, manual, clock_out_photo_path, clock_out_in_radius, clock_out_site_id, still_working_at, auto_closed) values ('3dba806d-3825-427d-94be-44caecfc6d9d', '8ac7eb71-5e7e-46df-96f3-9ad3b2d2da40', 'caf1a337-16fe-4736-9f56-012a07fd4164', '0e64a5c9-b7eb-4a55-8dca-35a60342f350', '2026-08-28 14:42:15.75751+00', 25.9593291506202, -97.5090405285559, '517a6d1d-e9f0-4c1c-a21a-6e2c54b38899', true, '2026-08-29 00:36:33.206+00', 25.9593291506202, -97.5090405285559, 0, null, null, 'closed', '2026-08-28 14:42:15.75751+00', '8ac7eb71-5e7e-46df-96f3-9ad3b2d2da40/2cc11692-ef53-4086-9333-e1595df4ae0c/1787928128977.jpg', null, null, null, false, '8ac7eb71-5e7e-46df-96f3-9ad3b2d2da40/2cc11692-ef53-4086-9333-e1595df4ae0c/1787963774219.jpg', true, '517a6d1d-e9f0-4c1c-a21a-6e2c54b38899', null, false) on conflict (id) do nothing;
    insert into migra_log values ('time_entries', 'ok', null);
  exception when others then
    insert into migra_log values ('time_entries', 'rechazada', sqlerrm);
  end;
  begin
    insert into clockin.time_entries (id, company_id, employee_id, scheduled_shift_id, clock_in_at, clock_in_lat, clock_in_lng, clock_in_site_id, clock_in_in_radius, clock_out_at, clock_out_lat, clock_out_lng, lunch_minutes, device_id, ip_address, status, created_at, clock_in_photo_path, edited_at, edited_by, edit_note, manual, clock_out_photo_path, clock_out_in_radius, clock_out_site_id, still_working_at, auto_closed) values ('c62cada5-25a8-4222-8677-b032d575b055', '8ac7eb71-5e7e-46df-96f3-9ad3b2d2da40', '388aa1e4-516b-4647-b2af-8edfe992da03', '5492a06b-76fc-460c-8d15-f115a6f5cbc2', '2026-08-29 12:50:36.182693+00', 25.9593093210388, -97.5089222584035, '517a6d1d-e9f0-4c1c-a21a-6e2c54b38899', true, '2026-08-29 21:02:07.969+00', 25.9593074305038, -97.5089220065117, 0, null, null, 'closed', '2026-08-29 12:50:36.182693+00', '8ac7eb71-5e7e-46df-96f3-9ad3b2d2da40/a18ee187-6a5e-415f-a7a9-b47c5f88200e/1788007834636.jpg', null, null, null, false, '8ac7eb71-5e7e-46df-96f3-9ad3b2d2da40/a18ee187-6a5e-415f-a7a9-b47c5f88200e/1788037314418.jpg', true, '517a6d1d-e9f0-4c1c-a21a-6e2c54b38899', null, false) on conflict (id) do nothing;
    insert into migra_log values ('time_entries', 'ok', null);
  exception when others then
    insert into migra_log values ('time_entries', 'rechazada', sqlerrm);
  end;
  begin
    insert into clockin.time_entries (id, company_id, employee_id, scheduled_shift_id, clock_in_at, clock_in_lat, clock_in_lng, clock_in_site_id, clock_in_in_radius, clock_out_at, clock_out_lat, clock_out_lng, lunch_minutes, device_id, ip_address, status, created_at, clock_in_photo_path, edited_at, edited_by, edit_note, manual, clock_out_photo_path, clock_out_in_radius, clock_out_site_id, still_working_at, auto_closed) values ('f7f1f797-4c33-4e9b-abaa-f3f2d05aee47', '8ac7eb71-5e7e-46df-96f3-9ad3b2d2da40', 'caf1a337-16fe-4736-9f56-012a07fd4164', '75c66ec6-630c-4169-8541-1c8fa71fe4fb', '2026-08-29 13:16:18.669796+00', 25.9593291506202, -97.5090405285559, '517a6d1d-e9f0-4c1c-a21a-6e2c54b38899', true, '2026-08-29 22:02:23.275+00', 25.9593291506202, -97.5090405285559, 0, null, null, 'closed', '2026-08-29 13:16:18.669796+00', '8ac7eb71-5e7e-46df-96f3-9ad3b2d2da40/2cc11692-ef53-4086-9333-e1595df4ae0c/1788009376938.jpg', null, null, null, false, '8ac7eb71-5e7e-46df-96f3-9ad3b2d2da40/2cc11692-ef53-4086-9333-e1595df4ae0c/1788040936836.jpg', true, '517a6d1d-e9f0-4c1c-a21a-6e2c54b38899', null, false) on conflict (id) do nothing;
    insert into migra_log values ('time_entries', 'ok', null);
  exception when others then
    insert into migra_log values ('time_entries', 'rechazada', sqlerrm);
  end;
  begin
    insert into clockin.exceptions (id, company_id, employee_id, time_entry_id, type, reason, note, photo_path, latitude, longitude, left_at, expected_return_at, returned_at, resolved, created_at, returned_lat, returned_lng, returned_photo_path) values ('92bfb1d8-990c-4e0c-91c9-929c0c755806', '8ac7eb71-5e7e-46df-96f3-9ad3b2d2da40', '4760e4ef-acd2-4b13-82c6-a6fdb789886c', 'd1f5568f-e9fb-4aa3-b410-7616e84e8338', 'out_of_radius', 'moving_between_stores', null, '8ac7eb71-5e7e-46df-96f3-9ad3b2d2da40/e655bf88-a457-468b-b871-86931215ed75/1787835643641.jpg', 25.9713530208538, -97.4859693419612, null, null, null, false, '2026-08-27 13:00:52.818387+00', null, null, null) on conflict (id) do nothing;
    insert into migra_log values ('exceptions', 'ok', null);
  exception when others then
    insert into migra_log values ('exceptions', 'rechazada', sqlerrm);
  end;
  begin
    insert into clockin.exceptions (id, company_id, employee_id, time_entry_id, type, reason, note, photo_path, latitude, longitude, left_at, expected_return_at, returned_at, resolved, created_at, returned_lat, returned_lng, returned_photo_path) values ('c8188693-d6e4-4597-ac34-c5021f792ad5', '8ac7eb71-5e7e-46df-96f3-9ad3b2d2da40', '388aa1e4-516b-4647-b2af-8edfe992da03', 'c62cada5-25a8-4222-8677-b032d575b055', 'leaving_while_clocked_in', 'lunch', null, '8ac7eb71-5e7e-46df-96f3-9ad3b2d2da40/a18ee187-6a5e-415f-a7a9-b47c5f88200e/1788023392602.jpg', 25.9593077479594, -97.5089222882022, '2026-08-29 17:09:59.066+00', null, '2026-08-29 17:34:00.539+00', false, '2026-08-29 17:09:59.102035+00', 25.9593077543254, -97.5089221976059, '8ac7eb71-5e7e-46df-96f3-9ad3b2d2da40/a18ee187-6a5e-415f-a7a9-b47c5f88200e/1788024837784.jpg') on conflict (id) do nothing;
    insert into migra_log values ('exceptions', 'ok', null);
  exception when others then
    insert into migra_log values ('exceptions', 'rechazada', sqlerrm);
  end;
  begin
    insert into clockin.exceptions (id, company_id, employee_id, time_entry_id, type, reason, note, photo_path, latitude, longitude, left_at, expected_return_at, returned_at, resolved, created_at, returned_lat, returned_lng, returned_photo_path) values ('c2ce1cb3-e399-4b9c-96f9-0f82b522706b', '8ac7eb71-5e7e-46df-96f3-9ad3b2d2da40', 'faf218e9-a1d7-48f5-b8ac-59446223d3e5', 'e12907a0-dd02-48aa-9cbd-15f285515d45', 'out_of_radius', 'customer_visit', null, '8ac7eb71-5e7e-46df-96f3-9ad3b2d2da40/76bf0f40-9216-454e-a3b7-0dea1d09f5fd/1787840002087.jpg', 26.2044949101024, -98.167277026606, null, null, null, false, '2026-08-27 14:13:29.336923+00', null, null, null) on conflict (id) do nothing;
    insert into migra_log values ('exceptions', 'ok', null);
  exception when others then
    insert into migra_log values ('exceptions', 'rechazada', sqlerrm);
  end;
  begin
    insert into clockin.exceptions (id, company_id, employee_id, time_entry_id, type, reason, note, photo_path, latitude, longitude, left_at, expected_return_at, returned_at, resolved, created_at, returned_lat, returned_lng, returned_photo_path) values ('f4e6df05-31b3-4e0c-ae03-53568ab44eb8', '8ac7eb71-5e7e-46df-96f3-9ad3b2d2da40', '388aa1e4-516b-4647-b2af-8edfe992da03', '529de9ad-1655-481c-aa31-43cbd3edbdf8', 'leaving_while_clocked_in', 'lunch', null, '8ac7eb71-5e7e-46df-96f3-9ad3b2d2da40/a18ee187-6a5e-415f-a7a9-b47c5f88200e/1787848354508.jpg', 25.9594334842535, -97.508865615288, '2026-08-27 16:32:40.195+00', null, '2026-08-27 19:22:37.325+00', false, '2026-08-27 16:32:41.00069+00', 25.9592983472075, -97.5091736630079, '8ac7eb71-5e7e-46df-96f3-9ad3b2d2da40/a18ee187-6a5e-415f-a7a9-b47c5f88200e/1787858552149.jpg') on conflict (id) do nothing;
    insert into migra_log values ('exceptions', 'ok', null);
  exception when others then
    insert into migra_log values ('exceptions', 'rechazada', sqlerrm);
  end;
  begin
    insert into clockin.exceptions (id, company_id, employee_id, time_entry_id, type, reason, note, photo_path, latitude, longitude, left_at, expected_return_at, returned_at, resolved, created_at, returned_lat, returned_lng, returned_photo_path) values ('046ca0c9-e8be-46aa-ae5b-aaf2bfc8152a', '8ac7eb71-5e7e-46df-96f3-9ad3b2d2da40', '20848eee-06eb-4b52-a58a-63d0d42494cf', '844abda6-e653-49eb-8dc7-b7ec2392f793', 'leaving_while_clocked_in', 'lunch', null, '8ac7eb71-5e7e-46df-96f3-9ad3b2d2da40/f6b2cc2e-0d58-4058-bbc4-a26e52675d49/1787764256615.jpg', 25.959303513228, -97.5091488544629, '2026-08-26 17:10:58.369+00', null, '2026-08-26 18:01:07.276+00', false, '2026-08-26 17:10:58.443409+00', 25.959303513228, -97.5091488544629, '8ac7eb71-5e7e-46df-96f3-9ad3b2d2da40/f6b2cc2e-0d58-4058-bbc4-a26e52675d49/1787767265360.jpg') on conflict (id) do nothing;
    insert into migra_log values ('exceptions', 'ok', null);
  exception when others then
    insert into migra_log values ('exceptions', 'rechazada', sqlerrm);
  end;
  begin
    insert into clockin.exceptions (id, company_id, employee_id, time_entry_id, type, reason, note, photo_path, latitude, longitude, left_at, expected_return_at, returned_at, resolved, created_at, returned_lat, returned_lng, returned_photo_path) values ('d43303f5-e0be-47ed-82cb-8bef0cbf0088', '8ac7eb71-5e7e-46df-96f3-9ad3b2d2da40', '388aa1e4-516b-4647-b2af-8edfe992da03', '529de9ad-1655-481c-aa31-43cbd3edbdf8', 'out_of_radius', 'other', 'Clocked out away from a job site', '8ac7eb71-5e7e-46df-96f3-9ad3b2d2da40/a18ee187-6a5e-415f-a7a9-b47c5f88200e/1787878541486.jpg', 25.9883161320284, -97.4786644133195, null, null, null, true, '2026-08-28 00:55:46.03625+00', null, null, null) on conflict (id) do nothing;
    insert into migra_log values ('exceptions', 'ok', null);
  exception when others then
    insert into migra_log values ('exceptions', 'rechazada', sqlerrm);
  end;
  begin
    insert into clockin.exceptions (id, company_id, employee_id, time_entry_id, type, reason, note, photo_path, latitude, longitude, left_at, expected_return_at, returned_at, resolved, created_at, returned_lat, returned_lng, returned_photo_path) values ('e04c40d2-89e2-47c4-a8b2-73a913c60601', '8ac7eb71-5e7e-46df-96f3-9ad3b2d2da40', '388aa1e4-516b-4647-b2af-8edfe992da03', '6913064d-5c06-456d-adf1-45e4562c4af7', 'leaving_while_clocked_in', 'lunch', null, '8ac7eb71-5e7e-46df-96f3-9ad3b2d2da40/a18ee187-6a5e-415f-a7a9-b47c5f88200e/1787769399096.jpg', 25.9592970215592, -97.5091745675214, '2026-08-26 18:36:42.552+00', null, '2026-08-26 19:15:48.251+00', false, '2026-08-26 18:36:42.609254+00', 25.9592970215592, -97.5091745675214, '8ac7eb71-5e7e-46df-96f3-9ad3b2d2da40/a18ee187-6a5e-415f-a7a9-b47c5f88200e/1787771745065.jpg') on conflict (id) do nothing;
    insert into migra_log values ('exceptions', 'ok', null);
  exception when others then
    insert into migra_log values ('exceptions', 'rechazada', sqlerrm);
  end;
  begin
    insert into clockin.exceptions (id, company_id, employee_id, time_entry_id, type, reason, note, photo_path, latitude, longitude, left_at, expected_return_at, returned_at, resolved, created_at, returned_lat, returned_lng, returned_photo_path) values ('620e4adf-fc73-4503-9d0d-16e80584bfa2', '8ac7eb71-5e7e-46df-96f3-9ad3b2d2da40', '388aa1e4-516b-4647-b2af-8edfe992da03', 'b4b1573d-2bcf-4785-ace1-5feba90e5e47', 'leaving_while_clocked_in', 'lunch', null, '8ac7eb71-5e7e-46df-96f3-9ad3b2d2da40/a18ee187-6a5e-415f-a7a9-b47c5f88200e/1787936899141.jpg', 25.9594989511318, -97.5089774983895, '2026-08-28 17:09:36.139+00', null, '2026-08-28 18:15:09.789+00', false, '2026-08-28 17:09:36.205197+00', 25.9593295857736, -97.5089568316248, '8ac7eb71-5e7e-46df-96f3-9ad3b2d2da40/a18ee187-6a5e-415f-a7a9-b47c5f88200e/1787940896407.jpg') on conflict (id) do nothing;
    insert into migra_log values ('exceptions', 'ok', null);
  exception when others then
    insert into migra_log values ('exceptions', 'rechazada', sqlerrm);
  end;
  begin
    insert into clockin.exceptions (id, company_id, employee_id, time_entry_id, type, reason, note, photo_path, latitude, longitude, left_at, expected_return_at, returned_at, resolved, created_at, returned_lat, returned_lng, returned_photo_path) values ('aeee126f-34b6-49ae-9906-abc305d81912', '8ac7eb71-5e7e-46df-96f3-9ad3b2d2da40', 'caf1a337-16fe-4736-9f56-012a07fd4164', '00c2bac4-5147-494d-ab77-fccb3859b9fb', 'leaving_while_clocked_in', 'lunch', null, '8ac7eb71-5e7e-46df-96f3-9ad3b2d2da40/2cc11692-ef53-4086-9333-e1595df4ae0c/1787778690849.jpg', 25.9595664923683, -97.5091936779189, '2026-08-26 21:11:38.317+00', null, '2026-08-26 21:27:12.386+00', false, '2026-08-26 21:11:38.378075+00', 25.9593291506202, -97.5090405285559, '8ac7eb71-5e7e-46df-96f3-9ad3b2d2da40/2cc11692-ef53-4086-9333-e1595df4ae0c/1787779630031.jpg') on conflict (id) do nothing;
    insert into migra_log values ('exceptions', 'ok', null);
  exception when others then
    insert into migra_log values ('exceptions', 'rechazada', sqlerrm);
  end;
  begin
    insert into clockin.exceptions (id, company_id, employee_id, time_entry_id, type, reason, note, photo_path, latitude, longitude, left_at, expected_return_at, returned_at, resolved, created_at, returned_lat, returned_lng, returned_photo_path) values ('129a91d9-6e6b-40b6-8a19-e8aabf4640cb', '8ac7eb71-5e7e-46df-96f3-9ad3b2d2da40', 'caf1a337-16fe-4736-9f56-012a07fd4164', 'f7f1f797-4c33-4e9b-abaa-f3f2d05aee47', 'leaving_while_clocked_in', 'lunch', null, '8ac7eb71-5e7e-46df-96f3-9ad3b2d2da40/2cc11692-ef53-4086-9333-e1595df4ae0c/1788016578332.jpg', 25.9593291506202, -97.5090405285559, '2026-08-29 15:16:20.574+00', null, '2026-08-29 15:33:19.771+00', false, '2026-08-29 15:16:20.610803+00', 25.9593291506202, -97.5090405285559, '8ac7eb71-5e7e-46df-96f3-9ad3b2d2da40/2cc11692-ef53-4086-9333-e1595df4ae0c/1788017597905.jpg') on conflict (id) do nothing;
    insert into migra_log values ('exceptions', 'ok', null);
  exception when others then
    insert into migra_log values ('exceptions', 'rechazada', sqlerrm);
  end;
  begin
    insert into clockin.vehicle_trips (id, company_id, employee_id, time_entry_id, vehicle_id, kind, started_at, start_odometer, start_fuel, start_photo_path, start_lat, start_lng, ended_at, end_odometer, end_fuel, end_photo_path, end_lat, end_lng, created_at, start_address, end_address, reason, note, paused_at, paused_minutes) values ('a5ee5da0-e29f-4887-a37e-789eb2b6f91c', '8ac7eb71-5e7e-46df-96f3-9ad3b2d2da40', '20848eee-06eb-4b52-a58a-63d0d42494cf', '844abda6-e653-49eb-8dc7-b7ec2392f793', null, 'sales', '2026-08-26 19:07:29.658054+00', null, null, '8ac7eb71-5e7e-46df-96f3-9ad3b2d2da40/f6b2cc2e-0d58-4058-bbc4-a26e52675d49/1787771247565.jpg', 25.9597142041182, -97.5092581272806, '2026-08-26 20:02:45.305+00', null, null, null, 25.959303513228, -97.5091488544629, '2026-08-26 19:07:29.658054+00', '3955 North Expressway, Brownsville', '3891 South Frontage Road, Brownsville', 'other', 'Cliente', null, 0) on conflict (id) do nothing;
    insert into migra_log values ('vehicle_trips', 'ok', null);
  exception when others then
    insert into migra_log values ('vehicle_trips', 'rechazada', sqlerrm);
  end;
  begin
    insert into clockin.vehicle_trips (id, company_id, employee_id, time_entry_id, vehicle_id, kind, started_at, start_odometer, start_fuel, start_photo_path, start_lat, start_lng, ended_at, end_odometer, end_fuel, end_photo_path, end_lat, end_lng, created_at, start_address, end_address, reason, note, paused_at, paused_minutes) values ('3fba850b-5a8a-4cd4-84ee-9a68340992c4', '8ac7eb71-5e7e-46df-96f3-9ad3b2d2da40', 'faf218e9-a1d7-48f5-b8ac-59446223d3e5', 'e12907a0-dd02-48aa-9cbd-15f285515d45', null, 'sales', '2026-08-27 14:14:10.358109+00', null, null, '8ac7eb71-5e7e-46df-96f3-9ad3b2d2da40/76bf0f40-9216-454e-a3b7-0dea1d09f5fd/1787840049083.jpg', 26.2044949101024, -98.167277026606, '2026-08-27 14:57:40.877+00', null, null, null, 26.2045103040296, -98.1676200420133, '2026-08-27 14:14:10.358109+00', '1265 East Expressway 83, Pharr', '1231 East Expressway 83, Pharr', 'customer_visit', null, null, 0) on conflict (id) do nothing;
    insert into migra_log values ('vehicle_trips', 'ok', null);
  exception when others then
    insert into migra_log values ('vehicle_trips', 'rechazada', sqlerrm);
  end;
  begin
    insert into clockin.trip_stops (id, company_id, employee_id, trip_id, time_entry_id, label, note, arrived_at, latitude, longitude, photo_path, miles_from_prev, created_at, address, departed_at, depart_lat, depart_lng) values ('7fe052b7-361b-4feb-b3c3-d92b01db9c6e', '8ac7eb71-5e7e-46df-96f3-9ad3b2d2da40', '20848eee-06eb-4b52-a58a-63d0d42494cf', 'a5ee5da0-e29f-4887-a37e-789eb2b6f91c', '844abda6-e653-49eb-8dc7-b7ec2392f793', 'Olmito', null, '2026-08-26 19:50:25.444063+00', 26.0167832866977, -97.5314045834221, '8ac7eb71-5e7e-46df-96f3-9ad3b2d2da40/f6b2cc2e-0d58-4058-bbc4-a26e52675d49/1787773818822.jpg', '0', '2026-08-26 19:50:25.444063+00', '9605 Anacua Street, Brownsville', '2026-08-26 19:55:07.821+00', 26.017158594938, -97.5313009322598) on conflict (id) do nothing;
    insert into migra_log values ('trip_stops', 'ok', null);
  exception when others then
    insert into migra_log values ('trip_stops', 'rechazada', sqlerrm);
  end;
  begin
    insert into clockin.trip_stops (id, company_id, employee_id, trip_id, time_entry_id, label, note, arrived_at, latitude, longitude, photo_path, miles_from_prev, created_at, address, departed_at, depart_lat, depart_lng) values ('ec83db55-3c2a-4d93-a5dd-bc97d63115f5', '8ac7eb71-5e7e-46df-96f3-9ad3b2d2da40', '20848eee-06eb-4b52-a58a-63d0d42494cf', 'a5ee5da0-e29f-4887-a37e-789eb2b6f91c', '844abda6-e653-49eb-8dc7-b7ec2392f793', 'Paredes y Alton gloor', null, '2026-08-26 19:27:58.687239+00', 25.9869041003457, -97.4798462378844, '8ac7eb71-5e7e-46df-96f3-9ad3b2d2da40/f6b2cc2e-0d58-4058-bbc4-a26e52675d49/1787772462876.jpg', '2.6', '2026-08-26 19:27:58.687239+00', '865 Tonys Road, Brownsville', '2026-08-26 19:36:02.191+00', 25.9866167600552, -97.4781950855211) on conflict (id) do nothing;
    insert into migra_log values ('trip_stops', 'ok', null);
  exception when others then
    insert into migra_log values ('trip_stops', 'rechazada', sqlerrm);
  end;
  begin
    insert into clockin.trip_stops (id, company_id, employee_id, trip_id, time_entry_id, label, note, arrived_at, latitude, longitude, photo_path, miles_from_prev, created_at, address, departed_at, depart_lat, depart_lng) values ('bcab1cf6-fe50-43d4-9d57-5a2c9713a95f', '8ac7eb71-5e7e-46df-96f3-9ad3b2d2da40', 'faf218e9-a1d7-48f5-b8ac-59446223d3e5', '3fba850b-5a8a-4cd4-84ee-9a68340992c4', 'e12907a0-dd02-48aa-9cbd-15f285515d45', 'Pharr', null, '2026-08-27 14:47:27.796345+00', 26.2294396912676, -98.1930302864899, '8ac7eb71-5e7e-46df-96f3-9ad3b2d2da40/76bf0f40-9216-454e-a3b7-0dea1d09f5fd/1787842023471.jpg', '2.3', '2026-08-27 14:47:27.796345+00', 'Pharr', '2026-08-27 14:47:39.97+00', 26.2294396912676, -98.1930302864899) on conflict (id) do nothing;
    insert into migra_log values ('trip_stops', 'ok', null);
  exception when others then
    insert into migra_log values ('trip_stops', 'rechazada', sqlerrm);
  end;
  begin
    insert into clockin.trip_stops (id, company_id, employee_id, trip_id, time_entry_id, label, note, arrived_at, latitude, longitude, photo_path, miles_from_prev, created_at, address, departed_at, depart_lat, depart_lng) values ('43b63a47-0da4-4b33-bf15-deacf57171c0', '8ac7eb71-5e7e-46df-96f3-9ad3b2d2da40', '20848eee-06eb-4b52-a58a-63d0d42494cf', 'a5ee5da0-e29f-4887-a37e-789eb2b6f91c', '844abda6-e653-49eb-8dc7-b7ec2392f793', 'Olmito', null, '2026-08-26 19:50:09.564548+00', 26.0167832866977, -97.5314045834221, '8ac7eb71-5e7e-46df-96f3-9ad3b2d2da40/f6b2cc2e-0d58-4058-bbc4-a26e52675d49/1787773801040.jpg', '3.8', '2026-08-26 19:50:09.564548+00', '9605 Anacua Street, Brownsville', '2026-08-26 19:55:13.639+00', 26.017158594938, -97.5313009322598) on conflict (id) do nothing;
    insert into migra_log values ('trip_stops', 'ok', null);
  exception when others then
    insert into migra_log values ('trip_stops', 'rechazada', sqlerrm);
  end;
end $mig$;
select tabla, estado, count(*) n, min(motivo) ejemplo from migra_log group by 1,2 order by 1,2;