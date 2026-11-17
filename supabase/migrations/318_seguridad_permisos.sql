-- ===========================================================================
-- 318 · Seguridad: permisos de datos (auditoría de 2026-11-17, bloque de base de datos)
-- ===========================================================================
-- QUÉ ARREGLA. Ocho huecos, en este orden:
--   1. ERP legible por cualquier cuenta con sesión (clientes, facturas, vendedores, archivos, sugerencias).
--   2. Fichaje: un empleado cambiaba sus propios permisos (activo, tienda, tiendas extra, corredor, puesto).
--   3. Fichaje: un empleado reescribía fichajes ya cerrados e insertaba horas arbitrarias.
--   4. Avisos: cualquier cuenta podía insertar un aviso para cualquier persona.
--   5. Chat: quien recibía un mensaje podía reescribirlo entero, no solo marcarlo como leído.
--   6. CVs: el gerente de tienda leía y tocaba todos los CVs del bucket «resumes».
--   7. Dispositivos: un no-admin podía dejar su dispositivo como «ligado».
--   8. TRUNCATE concedido a anon y authenticated en los esquemas expuestos.
-- Cada bloque dice el hueco, el arreglo y el código de la app que toca. Deshacer al final.
-- ===========================================================================


-- ---------------------------------------------------------------------------
-- 1. ERP: lectura por módulo, no por tener sesión.
-- EL HUECO. Seis políticas de SELECT con `using (true)` para authenticated: erp.customers («customers read»),
--   erp.customer_files («customer files read»), erp.customer_merge_suggestions («customer suggestions read»),
--   erp.sales_invoices y erp.sales_invoice_lines («… select authenticated») y erp.salespeople («salespeople select
--   authenticated»). Las políticas permisivas se suman (O), así que anulaban a las de módulo: un chofer o un
--   almacenista leía todo el ERP.
--   Además, «customers solo los suyos (vendedor)» (ALL) dejaba pasar por la rama de TIENDA a cualquier perfil con
--   tienda (un chofer de la tienda X leía los clientes de X), y su WITH CHECK era `true`: cualquier cuenta podía
--   insertar clientes.
-- EL ARREGLO.
--   · Se quitan las seis lecturas `true`. Las políticas de módulo («customers module gate», «customer files gate»,
--     «customer suggestions module gate», «erp module gate») ya dan lectura a quien tiene el módulo.
--   · Estimador y Leads leen erp.customers con su propia sesión: nueva política de SELECT para quien tiene el módulo
--     «estimator» o «leads», limitada a las filas que la regla de Clientes deja ver (erp.customers_ve_la_fila: su
--     tienda, o las suyas si es vendedor; el admin, todas). Así no ve nada más que antes de la fuga.
--   · «customers solo los suyos (vendedor)» solo vale para admin, gerente o vendedor, y su WITH CHECK es la misma
--     regla (ya no `true`).
-- LA APP (migrada en el mismo cambio, sin cambios de código): Estimador.tsx (lectura de clientes para cotizar) y
--   leads/almacen.ts (cruce de leads con clientes) usan la nueva política. Lo que cambia para el usuario: quien tiene
--   Leads o Estimador sin ser admin ve solo los clientes de su regla de visibilidad; antes veía todos. Clientes
--   (customers/almacen.ts) no cambia: sigue bajo «customers module gate». Las órdenes usan la función
--   cuentas_de_clientes (SECURITY DEFINER, migración 203) y tampoco cambian.
-- ---------------------------------------------------------------------------

drop policy if exists "customers read" on erp.customers;
drop policy if exists "customer files read" on erp.customer_files;
drop policy if exists "customer suggestions read" on erp.customer_merge_suggestions;
drop policy if exists "sales_invoices select authenticated" on erp.sales_invoices;
drop policy if exists "sales_invoice_lines select authenticated" on erp.sales_invoice_lines;
drop policy if exists "salespeople select authenticated" on erp.salespeople;

-- Estimador y Leads: leer clientes con su sesión, solo lo que la regla de Clientes les deja ver.
create policy "customers read (estimador y leads)" on erp.customers
  for select to authenticated
  using (
    (public.has_estimator_access() or public.has_leads_access())
    and erp.customers_ve_la_fila(rep_id, created_by, store)
  );

-- El vendedor: solo admin, gerente o vendedor, y solo sus filas (o las de su tienda según la regla de Clientes).
drop policy if exists "customers solo los suyos (vendedor)" on erp.customers;
create policy "customers solo los suyos (vendedor)" on erp.customers
  for all to authenticated
  using (
    erp.customers_ve_la_fila(rep_id, created_by, store)
    and exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.role in ('admin', 'manager', 'sales'))
  )
  with check (
    erp.customers_ve_la_fila(rep_id, created_by, store)
    and exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.role in ('admin', 'manager', 'sales'))
  );


-- ---------------------------------------------------------------------------
-- 2. clockin.employee_settings: el empleado no cambia sus propios permisos.
-- EL HUECO. «employee_settings self update» (id = auth.uid()) deja a cada empleado escribir su fila: active,
--   company_id, store_id, extra_store_ids, is_runner y position. Con eso se daba de alta en otra tienda o se
--   marcaba como corredor.
-- EL ARREGLO. Disparador BEFORE INSERT OR UPDATE con la misma forma que
--   timetracker.guard_employee_settings_privilege_columns: sin JWT (consola, migraciones) o con la llave de
--   servicio pasa; si no, solo un gerente o admin de fichaje (clockin.auth_is_manager()) puede cambiar esas seis
--   columnas. El resto de la fila (idioma, teléfono, horario) sigue siendo del empleado.
-- LA APP. Ningún cliente escribe esas columnas como empleado: las escribe team.ts con sesión de gerente. Sin cambios.
-- ---------------------------------------------------------------------------

create or replace function clockin.guard_employee_settings_privilege_columns()
  returns trigger language plpgsql security definer set search_path = clockin, public as $$
begin
  -- Sin JWT (consola, migraciones) o con la llave de servicio también vale: no son un empleado.
  if coalesce(auth.role(), '') in ('', 'service_role') or clockin.auth_is_manager() then
    return new;
  end if;
  if tg_op = 'INSERT' then
    -- Una ficha nueva sin gerente no puede nacer con tienda, tiendas extra, corredor ni puesto, ni desactivada.
    if new.store_id is not null or new.extra_store_ids is not null or new.is_runner or new.position is not null
       or new.active is false then
      raise exception 'Only a clock-in manager can set the store, runner, position or active status';
    end if;
  else
    if new.active is distinct from old.active then
      raise exception 'Only a clock-in manager can change active status';
    end if;
    if new.company_id is distinct from old.company_id then
      raise exception 'Only a clock-in manager can change the company';
    end if;
    if new.store_id is distinct from old.store_id then
      raise exception 'Only a clock-in manager can change the store';
    end if;
    if new.extra_store_ids is distinct from old.extra_store_ids then
      raise exception 'Only a clock-in manager can change the extra stores';
    end if;
    if new.is_runner is distinct from old.is_runner then
      raise exception 'Only a clock-in manager can change the runner flag';
    end if;
    if new.position is distinct from old.position then
      raise exception 'Only a clock-in manager can change the position';
    end if;
  end if;
  return new;
end $$;

drop trigger if exists employee_settings_guard_privilege_columns on clockin.employee_settings;
create trigger employee_settings_guard_privilege_columns
  before insert or update on clockin.employee_settings
  for each row execute function clockin.guard_employee_settings_privilege_columns();


-- ---------------------------------------------------------------------------
-- 3. clockin.time_entries: el empleado solo cierra su fichaje abierto.
-- EL HUECO. «entries_update_self_open» solo miraba company_id y employee_id, no el estado: un empleado podía
--   reescribir un fichaje cerrado (horas, fechas, notas de edición). «entries_insert_self» dejaba insertar un
--   fichaje con cualquier clock_in_at, cerrado y sin tope de fecha.
-- EL ARREGLO.
--   · UPDATE: la política solo deja tocar el fichaje ABIERTO propio (status = 'open'). Un disparador
--     (clockin.guard_time_entries_employee_update) deja cambiar solo lo que la app pone al fichar y al cerrar:
--     status (open → closed), clock_out_* (solo si aún no había salida), still_working_at. Lo demás (entrada, tienda,
--     foto de entrada, manual, edición, lunch_minutes, dispositivo, ip) se queda como está para el empleado.
--   · INSERT: solo un fichaje abierto, sin salida, no manual y sin marca de edición, con clock_in_at a no más de 10
--     minutos atrás ni más de 1 minuto adelante (la hora la pone now() por defecto).
--   · Gerentes: no cambian (entries_manage sigue; el disparador los deja pasar con clockin.auth_is_manager()).
-- LA APP. clock.ts (fichar, cerrar, «seguir trabajando»), photos/leave/runner no tocan columnas fuera de esa lista
--   y solo tocan su fichaje abierto. Las ediciones de gerente (reports.ts, adminClock) usan mgrCtx/clockinManagerCtx y
--   pasan por entries_manage. Sin cambios de código.
-- ---------------------------------------------------------------------------

create or replace function clockin.guard_time_entries_employee_update()
  returns trigger language plpgsql security definer set search_path = clockin, public as $$
begin
  -- Sin JWT, con la llave de servicio (cron) o gerente: no es un empleado escribiendo su fichaje.
  if coalesce(auth.role(), '') in ('', 'service_role') or clockin.auth_is_manager() then
    return new;
  end if;
  if old.status <> 'open' then
    raise exception 'Only the open time entry can be changed by the employee';
  end if;
  if new.status not in ('open', 'closed') then
    raise exception 'Invalid status for an employee';
  end if;
  if new.clock_out_at is not null and new.status <> 'closed' then
    raise exception 'A clock-out must close the entry';
  end if;
  if old.clock_out_at is not null and new.clock_out_at is distinct from old.clock_out_at then
    raise exception 'The clock-out time is already set';
  end if;
  if new.company_id is distinct from old.company_id
     or new.employee_id is distinct from old.employee_id
     or new.clock_in_at is distinct from old.clock_in_at
     or new.clock_in_lat is distinct from old.clock_in_lat
     or new.clock_in_lng is distinct from old.clock_in_lng
     or new.clock_in_site_id is distinct from old.clock_in_site_id
     or new.clock_in_in_radius is distinct from old.clock_in_in_radius
     or new.clock_in_photo_path is distinct from old.clock_in_photo_path
     or new.scheduled_shift_id is distinct from old.scheduled_shift_id
     or new.manual is distinct from old.manual
     or new.lunch_minutes is distinct from old.lunch_minutes
     or new.device_id is distinct from old.device_id
     or new.ip_address is distinct from old.ip_address
     or new.edited_by is distinct from old.edited_by
     or new.edited_at is distinct from old.edited_at
     or new.edit_note is distinct from old.edit_note
     or new.auto_closed is distinct from old.auto_closed then
    raise exception 'The employee can only change the clock-out fields of an open entry';
  end if;
  return new;
end $$;

drop trigger if exists time_entries_guard_employee_update on clockin.time_entries;
create trigger time_entries_guard_employee_update
  before update on clockin.time_entries
  for each row execute function clockin.guard_time_entries_employee_update();

drop policy if exists "entries_insert_self" on clockin.time_entries;
create policy "entries_insert_self" on clockin.time_entries
  for insert to authenticated
  with check (
    company_id = (select clockin.auth_company_id())
    and employee_id = (select auth.uid())
    and status = 'open'
    and clock_out_at is null
    and coalesce(manual, false) = false
    and edited_by is null
    and edited_at is null
    and clock_in_at between now() - interval '10 minutes' and now() + interval '1 minute'
  );

drop policy if exists "entries_update_self_open" on clockin.time_entries;
create policy "entries_update_self_open" on clockin.time_entries
  for update to authenticated
  using (
    company_id = (select clockin.auth_company_id())
    and employee_id = (select auth.uid())
    and status = 'open'
  )
  with check (
    company_id = (select clockin.auth_company_id())
    and employee_id = (select auth.uid())
  );


-- ---------------------------------------------------------------------------
-- 4. public.notifications: avisos solo propios o de quien avisa por trabajo.
-- EL HUECO. «notif insert any» (WITH CHECK true): cualquier cuenta insertaba un aviso para cualquiera.
-- EL ARREGLO. Se permite insertar si el aviso es para una misma (user_id = auth.uid()) o si quien inserta es admin,
--   gerente, chofer o tiene el módulo de Entregas (public.notif_puede_avisar_a_otros()). Almacén, contabilidad y
--   recruiting sin Entregas ya no avisan a otros.
-- LA APP. Los avisos entre personas salen con sesión de quien hace el paso: data-provider.tsx (emitStageNotifs,
--   pushNotifs, ~1120-1392) y solicitudes-de-ayuda/page.tsx:122 (admin). El chat (api/chat/send) y el push (api/push)
--   usan llave de servicio: no cambian. Si un rol sin Entregas avisa a otros, el aviso dejará de salir; sin
--   error visible (el cliente registra console.error). Pendiente, fuera de esta migración: pasar esos avisos al
--   servidor con llave de servicio.
-- ---------------------------------------------------------------------------

create or replace function public.notif_puede_avisar_a_otros()
  returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((
    select p.role in ('admin', 'manager', 'driver') or 'deliveries' = any(coalesce(p.module_access, '{}'))
    from public.profiles p where p.id = auth.uid()
  ), false);
$$;

drop policy if exists "notif insert any" on public.notifications;
create policy "notif insert (propia o de quien avisa)" on public.notifications
  for insert to authenticated
  with check (user_id = (select auth.uid()) or (select public.notif_puede_avisar_a_otros()));


-- ---------------------------------------------------------------------------
-- 5. public.chat_messages: el destinatario solo marca como leído.
-- EL HUECO. «chat mark read» (UPDATE de la fila entera para to_user) dejaba reescribir body, from_user, etc.
-- EL ARREGLO. Se quita el UPDATE de tabla y se concede solo la columna read_at. La política se mantiene.
-- LA APP. ChatFlotante.tsx:98 solo hace update({ read_at }). Sin cambios.
-- ---------------------------------------------------------------------------

revoke update on public.chat_messages from anon, authenticated;
grant update (read_at) on public.chat_messages to authenticated;


-- ---------------------------------------------------------------------------
-- 6. Bucket «resumes»: el gerente de tienda solo lee los CVs de candidatos que ve.
-- EL HUECO. «resumes read/update/delete» daban a todo el equipo de RR. HH. (has_recruiting_access) cualquier CV del
--   bucket, incluido el del gerente de tienda, que solo debe ver sus candidatos.
-- EL ARREGLO. Lectura, cambio y borrado: si quien mira no es gerente de tienda, igual que antes; si lo es, solo si el
--   objeto es el resume_path de un candidato o un adjunto de un candidato que ve. Las subconsultas pasan por la RLS
--   de recruiting.candidates y recruiting.attachments (misma regla que la tabla de candidatos). La subida nueva
--   («resumes insert») no cambia: un archivo nuevo aún no tiene candidato.
-- LA APP. recruiting-data-provider.tsx sube, cambia y borra CVs y adjuntos con sesión del usuario: un gerente sube
--   el CV de un candidato que ya ve (su fila de candidato pasa la regla). Sin cambios.
-- ---------------------------------------------------------------------------

drop policy if exists "resumes read" on storage.objects;
drop policy if exists "resumes update" on storage.objects;
drop policy if exists "resumes delete" on storage.objects;

create policy "resumes read" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'resumes'
    and public.has_recruiting_access()
    and (
      not public.is_recruiting_store_manager()
      or exists (select 1 from recruiting.candidates c where c.resume_path = storage.objects.name)
      or exists (select 1 from recruiting.attachments a where a.path = storage.objects.name)
    )
  );

create policy "resumes update" on storage.objects
  for update to authenticated
  using (
    bucket_id = 'resumes'
    and public.has_recruiting_access()
    and (
      not public.is_recruiting_store_manager()
      or exists (select 1 from recruiting.candidates c where c.resume_path = storage.objects.name)
      or exists (select 1 from recruiting.attachments a where a.path = storage.objects.name)
    )
  )
  with check (
    bucket_id = 'resumes'
    and public.has_recruiting_access()
  );

create policy "resumes delete" on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'resumes'
    and public.has_recruiting_access()
    and (
      not public.is_recruiting_store_manager()
      or exists (select 1 from recruiting.candidates c where c.resume_path = storage.objects.name)
      or exists (select 1 from recruiting.attachments a where a.path = storage.objects.name)
    )
  );


-- ---------------------------------------------------------------------------
-- 7. public.security_touch_device: solo el admin liga un dispositivo.
-- EL HUECO. La función escribía bound = true con el p_bound que manda el cliente (la cabecera de la app de
--   escritorio): cualquiera podía declarar su dispositivo como ligado.
-- EL ARREGLO. p_bound se ignora salvo que la sesión sea admin (public.profiles.role = 'admin'). El resto de la
--   función (último uso, IP, lugar, ruta, app) no cambia.
-- LA APP. /api/security/seen/route.ts:42 sigue mandando p_bound; el servidor lo ignora para no-admin. Sin cambios.
-- ---------------------------------------------------------------------------

create or replace function public.security_touch_device(
  p_device text, p_user_agent text, p_kind text, p_bound boolean default false,
  p_ip text default null, p_place text default null, p_route text default null, p_app text default null)
  returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_kind  text := case when p_kind in ('desktop', 'phone', 'browser') then p_kind else 'browser' end;
  v_ua    text := left(coalesce(p_user_agent, ''), 400);
  v_ip    text := nullif(left(coalesce(p_ip, ''), 64), '');
  v_place text := nullif(left(coalesce(p_place, ''), 120), '');
  v_route text := nullif(left(coalesce(p_route, ''), 200), '');
  v_app   text := case when p_app in ('deliveries','estimator','leads','customers','promos','warehouse_ops','recruiting','timetracker','surveys','erp') then p_app end;
  v_admin boolean := false;
  v_bound boolean := false;
begin
  if auth.uid() is null then return; end if;
  if p_device is null or length(p_device) < 8 or length(p_device) > 64 then return; end if;
  -- Solo el admin puede ligar un dispositivo; para el resto, p_bound no cuenta.
  select exists (select 1 from public.profiles where id = auth.uid() and role = 'admin') into v_admin;
  v_bound := v_admin and coalesce(p_bound, false);
  insert into public.security_devices (id, kind, user_agent, first_user_id, last_user_id, bound, last_ip, last_place)
    values (p_device, v_kind, v_ua, auth.uid(), auth.uid(), v_bound, v_ip, v_place)
  on conflict (id) do update
    set last_seen_at = now(), last_user_id = auth.uid(), user_agent = coalesce(nullif(v_ua, ''), public.security_devices.user_agent),
        bound = public.security_devices.bound or v_bound,
        last_ip = coalesce(v_ip, public.security_devices.last_ip), last_place = coalesce(v_place, public.security_devices.last_place);
  insert into public.security_device_users (device_id, user_id, last_ip, last_place, last_route)
    values (p_device, auth.uid(), v_ip, v_place, v_route)
  on conflict (device_id, user_id) do update
    set last_seen_at = now(), seen_count = public.security_device_users.seen_count + 1,
        last_ip = coalesce(v_ip, public.security_device_users.last_ip),
        last_place = coalesce(v_place, public.security_device_users.last_place),
        last_route = coalesce(v_route, public.security_device_users.last_route);
  -- 289: el último uso de la app donde está (si el server mandó un módulo real).
  if v_app is not null then
    insert into public.app_last_seen (user_id, app, last_seen_at) values (auth.uid(), v_app, now())
    on conflict (user_id, app) do update set last_seen_at = now();
  end if;
end $$;


-- ---------------------------------------------------------------------------
-- 8. TRUNCATE fuera de anon y authenticated, en todos los esquemas expuestos (y por defecto).
-- EL HUECO. TRUNCATE no pasa por RLS: cualquier cuenta autenticada vaciaba una tabla entera. Está concedido en
--   todas las tablas (ver pg_default_acl).
-- EL ARREGLO. Revocar en las tablas existentes y en los privilegios por defecto del rol postgres (el que crea las
--   tablas en las migraciones). El rol supabase_admin tiene sus propios privilegios por defecto en public: se
--   intenta también en un bloque protegido, por si la migración no tiene permiso para cambiarlos.
-- LA APP. Nada del código usa TRUNCATE (grep en src/). Sin cambios.
-- ---------------------------------------------------------------------------

revoke truncate on all tables in schema public from anon, authenticated;
revoke truncate on all tables in schema recruiting from anon, authenticated;
revoke truncate on all tables in schema clockin from anon, authenticated;
revoke truncate on all tables in schema timetracker from anon, authenticated;
revoke truncate on all tables in schema erp from anon, authenticated;

alter default privileges for role postgres in schema public, recruiting, clockin, timetracker, erp
  revoke truncate on tables from anon, authenticated;

do $$
begin
  execute 'alter default privileges for role supabase_admin in schema public revoke truncate on tables from anon, authenticated';
exception when others then
  raise notice 'No se pudo cambiar los privilegios por defecto de supabase_admin: %', sqlerrm;
end $$;


-- ===========================================================================
-- DESHACER. Volver a los privilegios y políticas de antes (en orden inverso; los nombres son los de arriba):
--   -- 8: grant truncate on all tables in schema public, recruiting, clockin, timetracker, erp to anon, authenticated;
--   --    alter default privileges for role postgres in schema public, recruiting, clockin, timetracker, erp
--   --      grant truncate on tables to anon, authenticated;   (y lo mismo para supabase_admin en public, si se cambió)
--   -- 7: volver a crear public.security_touch_device con el cuerpo de la migración 229 (bound = coalesce(p_bound,false)).
--   -- 6: drop policy "resumes read|update|delete" on storage.objects, y recrearlas con
--   --    using ((bucket_id = 'resumes'::text) AND has_recruiting_access()) (y sin with check en update).
--   -- 5: grant update on public.chat_messages to authenticated;  revoke update (read_at) on public.chat_messages from authenticated;
--   -- 4: drop policy "notif insert (propia o de quien avisa)" on public.notifications;
--   --    create policy "notif insert any" on public.notifications for insert to authenticated with check (true);
--   --    drop function public.notif_puede_avisar_a_otros();
--   -- 3: drop trigger time_entries_guard_employee_update on clockin.time_entries; drop function clockin.guard_time_entries_employee_update();
--   --    drop policy "entries_insert_self" / "entries_update_self_open" y recrearlas como en las migraciones 074 y 080
--   --    (entries_insert_self: with check (company_id = clockin.auth_company_id() and employee_id = auth.uid());
--   --     entries_update_self_open: using (company_id = clockin.auth_company_id() and employee_id = auth.uid())).
--   -- 2: drop trigger employee_settings_guard_privilege_columns on clockin.employee_settings;
--   --    drop function clockin.guard_employee_settings_privilege_columns();
--   -- 1: create policy "customers read" on erp.customers for select to authenticated using (true);
--   --    (y lo mismo para «customer files read», «customer suggestions read», «sales_invoices select authenticated»,
--   --     «sales_invoice_lines select authenticated» y «salespeople select authenticated», todas con using (true));
--   --    drop policy "customers read (estimador y leads)" on erp.customers;
--   --    «customers solo los suyos (vendedor)»: recrear con using/with check (true) para la rama de vendedor.
-- ===========================================================================
-- @ledger-below
insert into public.schema_migrations (name, checksum) values ('318_seguridad_permisos.sql', '004638b7a2160f7db56196a7fc92bcb25a9f46e93d8bc520f55ca11be0553dca') on conflict (name) do nothing;
