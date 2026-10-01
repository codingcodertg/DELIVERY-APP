# Plan 159 · El expediente, con los campos para llenarlo bien y el motivo de la baja

Plan en papel exigido por `CLAUDE.md` («Antes de tocar RLS, triggers o permisos en producción»). Esta migración **no toca
ninguna política, permiso, trigger ni función**: añade diez columnas nulas y un `check` a `recruiting.employee_files`. El
plan existe igual porque la tabla guarda datos personales y porque de ella lee el directorio de toda la empresa
(`public.phone_book()`); lo que hay que demostrar es que **no se abre nada**. Molde: `docs/PLAN-155-encuestas.md`.

**Estado (2026-10-01):** escrito por un worker en el worktree `feat/expediente-acciones`. Producción se **leyó**
(`begin transaction read only`) y la migración y la matriz de §6 se **ensayaron una vez contra producción dentro de una
transacción con `ROLLBACK`** (resultado en §6; comprobado después que no quedó nada: 18 columnas, ninguna fila en el
registro, ningún expediente de ensayo, el perfil de ensayo sin rol de RR. HH.). **Nada aplicado. Pendiente de aprobar.**

**Pedido del dueño (2026-10-01; citas tal como las pasó el orquestador en el encargo, no extraídas del fichero de sesión):**

> *«ok we need to create an hr expediente crealo con todos los usuarios porque s despidio a uno y quiero poder actualizar eso»*

Se le contestó que el expediente ya existe (D-145, D-251: Recruiting › Employees). Respondió:

> *«ok bien todo, ahora ve y haz los actions bottoms para darle de baja y agregar mas y asi, para llenar bien el sitema, telefono de poficina, telfono eprsonal y eso»*

**La migración está escrita y NO aplicada:** `supabase/migrations/159_expediente_campos.sql`.

---

## 0 · Resumen

| | Hoy (medido 2026-10-01) | Con la 159 |
|---|---|---|
| Columnas de `recruiting.employee_files` | 18 | **28** (+10, todas nulas, sin valor por defecto) |
| Filas | 56 (41 con cuenta, 15 sin cuenta, **0 bajas**) | las mismas 56; ninguna cambia |
| Políticas | 2 (`employee_files_read`, `employee_files_write`: admin y gerente de RR. HH.) | **las mismas 2**, sin tocar |
| Permisos de tabla | `authenticated`, `service_role`, `postgres`; `anon` nada | **los mismos** |
| `public.phone_book()` | diez columnas; lee `phone` y `ringcentral_ext` de quien tiene `date_left is null` | **sin tocar**; no nombra ninguna columna nueva |
| Dónde se guarda el motivo de una baja | en ningún sitio | `left_reason` (lista corta, con `check`), `left_note`, `left_by`, `left_recorded_at` |
| La pantalla antes de aplicar | — | funciona; los campos nuevos salen apagados con «falta la migración 159», y la baja guarda la fecha sin el motivo y lo dice |

## 1 · Decisiones (para validar)

1. **`phone` queda como el teléfono de OFICINA y el nuevo es `personal_phone`.** No al revés. `phone` es la columna que
   `public.phone_book()` enseña a **todo el que tenga sesión** (D-256, D-272); si pasara a ser «el personal», el directorio
   publicaría teléfonos personales. Medido: hay **30** expedientes con `phone`, **29 números distintos**, todos con la forma
   `(956) xxx-xxxx`. **Ojo, y esto lo tiene que mirar el dueño:** 29 números distintos para 30 personas no parece una
   centralita; si esos 30 son en realidad **celulares personales**, hoy ya se están enseñando en el directorio, y lo correcto
   sería moverlos a `personal_phone` (un `update` de datos, con su sí, que NO está en esta migración).
2. **`email` queda como el correo de trabajo** (el del directorio) y el nuevo es `personal_email`.
3. **El puesto es `job_title`, en el expediente, para todos.** No se reutiliza `profiles.title` (D-252): esa es la pastilla
   que el dueño escribe a su gusto, hoy vacía en los 41 perfiles (medido), y no existe para quien no tiene cuenta.
4. **El motivo de la baja es una lista corta con `check`**: `resignation`, `termination`, `abandonment`, `contract_end`,
   `other`. Las claves no se traducen; la etiqueta sí (`MOTIVOS_BAJA`). Una prueba exige que la lista de la pantalla y la del
   `check` sean la misma.
5. **El estado sigue sin guardarse** (D-251): se deriva de `date_left`. `left_reason` describe una baja, no la crea, y no hay
   `check` que ate una cosa a la otra (un guardado a medias no debe poder dejar la fila inválida).
6. **`left_by` es `on delete set null`**: borrar la cuenta de quien registró la baja no puede borrar ni bloquear nada.
7. **No se reescriben los 30 teléfonos existentes** al formato de la app (`956-xxx-xxxx`, D-432). Cada uno toma la forma
   nueva la primera vez que se guarda su ficha. Mientras tanto el directorio enseña las dos formas mezcladas. Si se prefiere
   de golpe, es un `update` de datos aparte, con su sí.

## 2 · Las columnas

| Columna | Tipo | Qué es | Quién la escribe en la app |
|---|---|---|---|
| `job_title` | text | puesto | ficha («Guardar datos»), «＋ Agregar empleado» |
| `personal_phone` | text | teléfono personal, solo RR. HH. | ficha, agregar |
| `personal_email` | text | correo personal, solo RR. HH. | ficha |
| `emergency_name` / `emergency_relation` / `emergency_phone` | text | contacto de emergencia | ficha |
| `left_reason` | text + `check` | motivo de la baja | **solo** «Dar de baja» / «Reactivar» |
| `left_note` | text | nota de la baja | **solo** «Dar de baja» / «Reactivar» |
| `left_by` | uuid → `profiles`, `on delete set null` | quién la registró | **solo** «Dar de baja» (el `auth.uid()` del servidor) |
| `left_recorded_at` | timestamptz | cuándo se registró (la fecha de salida es `date_left`) | **solo** «Dar de baja» |

## 3 · Inventario de lecturas y escrituras

| Quién | Qué | Por dónde | Cambia con la 159 |
|---|---|---|---|
| `listEmployeeFiles` (admin y gerente de RR. HH.) | `select *` de `employee_files` | PostgREST, con la RLS de la 094 | trae diez columnas más; `tiene159()` las detecta |
| `saveEmployeeFile` (admin y gerente) | `upsert` de la ficha | idem | puede mandar `job_title`, `personal_*`, `emergency_*`; **rechaza** `date_left` y `left_*` |
| `createEmployeeFile` (admin y gerente) — **nueva** | `insert` sin `profile_id` | idem | — |
| `deactivateEmployee` / `reactivateEmployee` (solo admin de RR. HH.) | `update` de `date_left` y `left_*` | idem | escribe `left_*`; sin la 159 reintenta con `date_left` solo |
| `setHubAccess` (solo admin de RR. HH.) — **nueva** | ban / unban en Auth (`service_role`) | `auth.admin.updateUserById` | no toca la tabla |
| `public.phone_book()` (cualquier sesión) | `full_name, department, phone, ringcentral_ext, email, directory_group` + tienda | `security definer` | **nada**: lee columnas con nombre |

## 4 · Qué NO debe romperse

- **Quién lee y quién escribe expedientes** (la 094): admin y gerente de RR. HH. sí; reclutador, cualquier otro y `anon`, no.
- **Quién enlaza una cuenta** (el guard de la 106): solo el admin de RR. HH.
- **El directorio**: las mismas diez columnas, las mismas filas, y ni rastro de teléfono personal, correo personal o contacto
  de emergencia. Una baja deja de salir; reactivada, vuelve.
- **El trigger que crea el expediente con cada cuenta nueva** (106): inserta `id, profile_id, full_name`; las columnas nuevas
  son nulas y sin valor por defecto, así que ese insert no cambia.
- **La pantalla antes de aplicar**: sigue cargando y guardando lo que ya guardaba.

## 5 · El SQL, literal

Ver `supabase/migrations/159_expediente_campos.sql`. Sin `begin`/`commit` propios y sin número de decisión dentro. La
autocomprobación (`do $comprueba$`) exige: las diez columnas, nulas y sin valor por defecto; **una** FK de `left_by` a
`profiles` con `on delete set null`; **2** políticas, las de la 094 (con `current_recruiting_role()`, `admin` y `manager`, y
sin `recruiter`); RLS puesta; `anon` sin `select`; y que `phone_book()` no nombre ninguna columna privada y siga filtrando
por `date_left is null`.

**Candados:** `alter table … add column` sin valor por defecto es instantáneo pero pide `ACCESS EXCLUSIVE` sobre
`employee_files`, y la FK de `left_by` pide `SHARE ROW EXCLUSIVE` sobre `profiles`. Poner `set lock_timeout = '3s'` antes.

## 6 · Matriz de pruebas por rol, con ROLLBACK (la corre el orquestador)

**29 casos con OK/MAL.** Todo lo que escribe lo escribe dentro de la transacción y se deshace: marcas en un expediente que
hoy sale en el directorio, dos expedientes de ensayo, y `recruiting_role` de **un** perfil de ensayo (hoy no hay ningún
gerente ni reclutador de RR. HH. — medido: 4 `admin`, 37 sin rol — así que esos dos tramos se prueban prestándole el rol a
un perfil).

Sustituir: `<UUID-ADMIN>` (un admin de RR. HH.), `<UUID-VENTAS>` (alguien **sin** rol de RR. HH.), `<UUID-GERENTE>` (otro
perfil sin rol de RR. HH., al que la matriz le presta `manager` y luego `recruiter`).

Se pega entero en `psql` **desde la raíz del repo** (el `\i` es relativo). **Sin `commit` en ningún sitio.**

**Ensayado el 2026-10-01 contra producción, con ROLLBACK** (admin `acf43ad5…`, ventas `4760e4ef…`, gerente `caf1a337…`):
**29 OK, 0 MAL**, a la primera. Lo medido dentro: 56 expedientes antes y después; el directorio le enseña **28** filas a un
vendedor (de los 30 expedientes con extensión y teléfono, 2 van en grupos que un vendedor no ve), **27** con una baja y
**28** al reactivarla.

```sql
begin;

-- 0. Antes de la migración: cuántos expedientes hay y cuántas filas enseña el directorio a un vendedor.
select set_config('ensayo.total', (select count(*) from recruiting.employee_files)::text, true);

-- 1. La migración, dentro de la misma transacción (se deshace con el resto).
\i supabase/migrations/159_expediente_campos.sql

-- 2. Preparación, como postgres (todo se deshace con el ROLLBACK):
--    * X = un expediente que HOY sale en el directorio para cualquiera (activo, con extensión, con teléfono,
--      con tienda y sin grupo especial). Se le ponen marcas reconocibles en los cuatro teléfonos.
--    * <UUID-GERENTE> pasa a ser GERENTE de RR. HH. (hoy no hay ninguno: medido, 4 admin y 0 gerente).
select set_config('request.jwt.claims', '', true);
select set_config('ensayo.x', (
  select f.id::text
    from recruiting.employee_files f
    left join public.profiles p on p.id = f.profile_id
   where f.date_left is null
     and nullif(btrim(coalesce(f.ringcentral_ext, '')), '') is not null
     and nullif(btrim(coalesce(f.phone, '')), '') is not null
     and f.directory_group is null
     and coalesce(nullif(btrim(coalesce(p.store, '')), ''), nullif(btrim(coalesce(f.store, '')), '')) is not null
     and f.profile_id is distinct from '<UUID-ADMIN>'::uuid
   order by f.id limit 1), true);
update public.profiles set recruiting_role = 'manager' where id = '<UUID-GERENTE>';

do $$
declare n int; total int := current_setting('ensayo.total')::int;
begin
  select count(*) into n from recruiting.employee_files;
  raise notice 'P1  la migración no crea ni borra filas (% = %): %', n, total, case when n = total then 'OK' else 'MAL' end;
  select count(*) into n from recruiting.employee_files
   where job_title is not null or personal_phone is not null or personal_email is not null or emergency_name is not null
      or emergency_relation is not null or emergency_phone is not null or left_reason is not null or left_note is not null
      or left_by is not null or left_recorded_at is not null;
  raise notice 'P2  las columnas nuevas nacen vacías en todas las filas: %', case when n = 0 then 'OK' else 'MAL (' || n || ')' end;
  raise notice 'P3  hay un expediente X que sale en el directorio: %', case when current_setting('ensayo.x') <> '' then 'OK' else 'MAL' end;
  begin
    update recruiting.employee_files set left_reason = 'fired' where id = current_setting('ensayo.x')::uuid;
    raise notice 'P4  motivo fuera de la lista                 esperado 23514: MAL, pasó';
  exception when others then
    raise notice 'P4  motivo fuera de la lista                 esperado 23514: %', case when sqlstate = '23514' then 'OK' else 'MAL (' || sqlerrm || ')' end;
  end;
  select count(*) into n from pg_proc p where p.oid = 'public.phone_book()'::regprocedure
     and pg_get_function_result(p.oid) = 'TABLE(full_name text, title text, store text, store_rank integer, department text, phone text, ringcentral_ext text, email text, directory_group text, store_ext text)';
  raise notice 'P5  phone_book() devuelve las mismas diez columnas que antes: %', case when n = 1 then 'OK' else 'MAL' end;
end $$;

-- ===========================================================================================
-- D. El directorio (T-0054), visto por un vendedor SIN rol de RR. HH.
-- ===========================================================================================
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', '<UUID-VENTAS>', 'role', 'authenticated')::text, true);
select set_config('ensayo.dir0', (select count(*) from public.phone_book())::text, true);
reset role;
select set_config('request.jwt.claims', '', true);
update recruiting.employee_files
   set phone = '956-000-0159', ringcentral_ext = '15959',
       personal_phone = '956-111-0159', emergency_phone = '956-222-0159', emergency_name = 'Ensayo 159',
       personal_email = 'ensayo159@example.invalid'
 where id = current_setting('ensayo.x')::uuid;

set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', '<UUID-VENTAS>', 'role', 'authenticated')::text, true);
do $$
declare n int; d0 int := current_setting('ensayo.dir0')::int;
begin
  select count(*) into n from public.phone_book() where phone = '956-000-0159' and ringcentral_ext = '15959';
  raise notice 'D1  el directorio enseña el teléfono de OFICINA (phone) y la extensión (ringcentral_ext): %', case when n = 1 then 'OK' else 'MAL (' || n || ')' end;
  select count(*) into n from public.phone_book() b
   where b::text like '%956-111-0159%' or b::text like '%956-222-0159%' or b::text like '%Ensayo 159%' or b::text like '%ensayo159@%';
  raise notice 'D2  el directorio NO enseña teléfono personal, correo personal ni contacto de emergencia: %', case when n = 0 then 'OK' else 'MAL (' || n || ')' end;
  select count(*) into n from public.phone_book();
  raise notice 'D3  el directorio tiene las mismas filas que antes de la migración (% = %): %', n, d0, case when n = d0 then 'OK' else 'MAL' end;
end $$;
reset role;
select set_config('request.jwt.claims', '', true);

-- La baja, tal como la escribe «Dar de baja» (parcheBajaCompleto).
update recruiting.employee_files
   set date_left = current_date, left_reason = 'termination', left_note = 'ensayo', left_by = '<UUID-ADMIN>', left_recorded_at = now()
 where id = current_setting('ensayo.x')::uuid;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', '<UUID-VENTAS>', 'role', 'authenticated')::text, true);
do $$
declare n int; m int; d0 int := current_setting('ensayo.dir0')::int;
begin
  select count(*), count(*) filter (where phone = '956-000-0159') into n, m from public.phone_book();
  raise notice 'D4  una BAJA deja de salir en el directorio (% = % - 1, y su fila no está): %', n, d0, case when n = d0 - 1 and m = 0 then 'OK' else 'MAL' end;
end $$;
reset role;
select set_config('request.jwt.claims', '', true);

-- La reactivación, tal como la escribe «Reactivar» (parcheAltaCompleto).
update recruiting.employee_files
   set date_left = null, left_reason = null, left_note = null, left_by = null, left_recorded_at = null
 where id = current_setting('ensayo.x')::uuid;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', '<UUID-VENTAS>', 'role', 'authenticated')::text, true);
do $$
declare n int; d0 int := current_setting('ensayo.dir0')::int;
begin
  select count(*) into n from public.phone_book();
  raise notice 'D5  reactivada, vuelve a salir (% = %): %', n, d0, case when n = d0 then 'OK' else 'MAL' end;
end $$;

-- ===========================================================================================
-- S. Un vendedor SIN rol de RR. HH.: no lee ni escribe expedientes (ni las columnas nuevas).
-- ===========================================================================================
do $$
declare n int;
begin
  select count(*) into n from recruiting.employee_files;
  raise notice 'S1  sin rol de RR. HH.: lee 0 expedientes: %', case when n = 0 then 'OK' else 'MAL (' || n || ')' end;
  update recruiting.employee_files set personal_phone = '956-333-0159' where id = current_setting('ensayo.x')::uuid;
  get diagnostics n = row_count;
  raise notice 'S2  sin rol de RR. HH.: su update no toca ninguna fila: %', case when n = 0 then 'OK' else 'MAL (' || n || ')' end;
  begin
    insert into recruiting.employee_files (full_name, job_title) values ('Ensayo 159 S', 'x');
    raise notice 'S3  sin rol de RR. HH.: insert                esperado 42501: MAL, pasó';
  exception when others then
    raise notice 'S3  sin rol de RR. HH.: insert                esperado 42501: %', case when sqlstate = '42501' then 'OK' else 'MAL (' || sqlstate || ' ' || sqlerrm || ')' end;
  end;
end $$;

-- ===========================================================================================
-- A. Admin de RR. HH.: lee todo, llena los campos nuevos, da de baja con motivo, reactiva, agrega.
-- ===========================================================================================
select set_config('request.jwt.claims', json_build_object('sub', '<UUID-ADMIN>', 'role', 'authenticated')::text, true);
do $$
declare n int; total int := current_setting('ensayo.total')::int; v text; nuevo uuid;
begin
  select count(*) into n from recruiting.employee_files;
  raise notice 'A1  admin de RR. HH.: lee todos los expedientes (% = %): %', n, total, case when n = total then 'OK' else 'MAL' end;
  select personal_phone into v from recruiting.employee_files where id = current_setting('ensayo.x')::uuid;
  raise notice 'A2  admin: lee el teléfono personal: %', case when v = '956-111-0159' then 'OK' else 'MAL (' || coalesce(v, 'null') || ')' end;
  update recruiting.employee_files
     set job_title = 'Ensayo', personal_phone = '956-444-0159', personal_email = 'a@example.invalid',
         emergency_name = 'N', emergency_relation = 'R', emergency_phone = '956-555-0159'
   where id = current_setting('ensayo.x')::uuid;
  get diagnostics n = row_count;
  raise notice 'A3  admin: llena los seis campos nuevos de la ficha: %', case when n = 1 then 'OK' else 'MAL (' || n || ')' end;
  update recruiting.employee_files
     set date_left = current_date, left_reason = 'resignation', left_note = 'ensayo', left_by = auth.uid(), left_recorded_at = now()
   where id = current_setting('ensayo.x')::uuid;
  get diagnostics n = row_count;
  raise notice 'A4  admin: da de baja con fecha, motivo, nota y quién: %', case when n = 1 then 'OK' else 'MAL (' || n || ')' end;
  begin
    update recruiting.employee_files set left_reason = 'porque sí' where id = current_setting('ensayo.x')::uuid;
    raise notice 'A5  admin: motivo fuera de la lista           esperado 23514: MAL, pasó';
  exception when others then
    raise notice 'A5  admin: motivo fuera de la lista           esperado 23514: %', case when sqlstate = '23514' then 'OK' else 'MAL (' || sqlerrm || ')' end;
  end;
  update recruiting.employee_files
     set date_left = null, left_reason = null, left_note = null, left_by = null, left_recorded_at = null
   where id = current_setting('ensayo.x')::uuid;
  get diagnostics n = row_count;
  raise notice 'A6  admin: reactiva (borra fecha y datos de la baja): %', case when n = 1 then 'OK' else 'MAL (' || n || ')' end;
  insert into recruiting.employee_files (full_name, profile_id, job_title, personal_phone)
    values ('Ensayo 159 A', null, 'Ensayo', '956-666-0159') returning id into nuevo;
  raise notice 'A7  admin: agrega un empleado SIN cuenta, con puesto y teléfono personal: %', case when nuevo is not null then 'OK' else 'MAL' end;
end $$;

-- ===========================================================================================
-- G. Gerente de RR. HH. (rol puesto en el paso 2): lee y edita igual; NO enlaza cuentas.
-- ===========================================================================================
select set_config('request.jwt.claims', json_build_object('sub', '<UUID-GERENTE>', 'role', 'authenticated')::text, true);
do $$
declare n int; total int := current_setting('ensayo.total')::int; nuevo uuid;
begin
  select count(*) into n from recruiting.employee_files;
  raise notice 'G1  gerente de RR. HH.: lee todos (% = % + 1 del admin): %', n, total, case when n = total + 1 then 'OK' else 'MAL' end;
  update recruiting.employee_files set personal_phone = '956-777-0159', emergency_name = 'G' where id = current_setting('ensayo.x')::uuid;
  get diagnostics n = row_count;
  raise notice 'G2  gerente: edita teléfono personal y contacto de emergencia: %', case when n = 1 then 'OK' else 'MAL (' || n || ')' end;
  insert into recruiting.employee_files (full_name, profile_id, job_title) values ('Ensayo 159 G', null, 'Ensayo') returning id into nuevo;
  raise notice 'G3  gerente: agrega un empleado SIN cuenta: %', case when nuevo is not null then 'OK' else 'MAL' end;
  begin
    update recruiting.employee_files set profile_id = '<UUID-VENTAS>' where id = nuevo;
    raise notice 'G4  gerente: enlazar una cuenta               esperado rechazo del guard: MAL, pasó';
  exception when others then
    raise notice 'G4  gerente: enlazar una cuenta               esperado rechazo del guard: %', case when sqlerrm like '%Only an HR admin can link%' then 'OK' else 'MAL (' || sqlstate || ' ' || sqlerrm || ')' end;
  end;
end $$;

-- ===========================================================================================
-- R. Reclutador: el mismo perfil, ahora con el tramo que la 094 deja FUERA del expediente.
-- ===========================================================================================
reset role;
select set_config('request.jwt.claims', '', true);
update public.profiles set recruiting_role = 'recruiter' where id = '<UUID-GERENTE>';
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', '<UUID-GERENTE>', 'role', 'authenticated')::text, true);
do $$
declare n int;
begin
  select count(*) into n from recruiting.employee_files;
  raise notice 'R1  reclutador: lee 0 expedientes: %', case when n = 0 then 'OK' else 'MAL (' || n || ')' end;
  update recruiting.employee_files set emergency_phone = '956-888-0159' where id = current_setting('ensayo.x')::uuid;
  get diagnostics n = row_count;
  raise notice 'R2  reclutador: su update no toca ninguna fila: %', case when n = 0 then 'OK' else 'MAL (' || n || ')' end;
  begin
    insert into recruiting.employee_files (full_name) values ('Ensayo 159 R');
    raise notice 'R3  reclutador: insert                        esperado 42501: MAL, pasó';
  exception when others then
    raise notice 'R3  reclutador: insert                        esperado 42501: %', case when sqlstate = '42501' then 'OK' else 'MAL (' || sqlstate || ' ' || sqlerrm || ')' end;
  end;
end $$;

-- ===========================================================================================
-- N. Sin sesión (anon): ni la tabla ni el directorio.
-- ===========================================================================================
reset role;
select set_config('request.jwt.claims', '', true);
set local role anon;
do $$
declare n int;
begin
  begin
    select count(*) into n from recruiting.employee_files;
    raise notice 'N1  anon: leer expedientes                    esperado 42501: MAL, leyó %', n;
  exception when others then
    raise notice 'N1  anon: leer expedientes                    esperado 42501: %', case when sqlstate = '42501' then 'OK' else 'MAL (' || sqlstate || ' ' || sqlerrm || ')' end;
  end;
  begin
    select count(*) into n from public.phone_book();
    raise notice 'N2  anon: el directorio                       esperado 42501: MAL, leyó %', n;
  exception when others then
    raise notice 'N2  anon: el directorio                       esperado 42501: %', case when sqlstate = '42501' then 'OK' else 'MAL (' || sqlstate || ' ' || sqlerrm || ')' end;
  end;
end $$;
reset role;

ROLLBACK;
```

| Bloque | Casos | Qué demuestra |
|---|---|---|
| P1–P5 | postgres | no se crean ni borran filas; las columnas nacen vacías; el `check` rechaza un motivo de fuera; `phone_book()` devuelve las mismas diez columnas |
| D1–D5 | vendedor sin rol de RR. HH. | el directorio enseña `phone` y `ringcentral_ext`; **no** enseña nada de lo nuevo; mismas filas que antes; una baja sale del directorio y vuelve al reactivarla |
| S1–S3 | vendedor sin rol de RR. HH. | no lee, no actualiza, no inserta |
| A1–A7 | admin de RR. HH. | lee todo, llena los campos nuevos, da de baja con motivo, reactiva, agrega sin cuenta; motivo de fuera, rechazado |
| G1–G4 | gerente de RR. HH. | lee y edita igual, agrega sin cuenta; **no** enlaza una cuenta (guard de la 106) |
| R1–R3 | reclutador | no lee, no actualiza, no inserta |
| N1–N2 | `anon` | ni la tabla ni el directorio |

## 7 · Mediciones de solo lectura (hechas el 2026-10-01; repetirlas antes de aplicar)

- `recruiting.employee_files`: **18 columnas**, **56 filas**: 41 con cuenta, 15 sin cuenta, **0 bajas**.
- Rellenos: `phone` 30, `ringcentral_ext` 45, `email` 34, `department` 39; **0** en `date_hired`, `birthday`, `address` y
  `employee_code`. O sea que hoy **los 56 expedientes están incompletos** (a todos les falta la fecha de ingreso).
- `phone`: los 30 con forma `(956) xxx-xxxx`, 29 números distintos.
- Políticas: `employee_files_read` (SELECT) y `employee_files_write` (ALL), las dos con
  `current_recruiting_role() = any (array['admin','manager'])`.
- Permisos de tabla: `authenticated`, `postgres`, `service_role`. `anon`: ninguno.
- Trigger propio: `employee_files_guard_link`. Restricciones: `directory_group_check`, `pkey`, `profile_id_fkey`
  (`on delete set null`), `updated_by_fkey`.
- `profiles.recruiting_role`: 4 `admin`, 37 `null`. `profiles.title`: 0 de 41.
- Expedientes que cumplen el `where` del directorio (activo, con extensión y con teléfono): **30**.
- Registro de migraciones: la última aplicada es `155_encuestas.sql`; **156, 157 y 158 están en el repo sin aplicar**. La 159
  no depende de ninguna de las tres.

## 8 · Reversión

Comentada al final del `.sql`: `drop constraint` y `drop column` de las diez, quitar el comentario de `phone` y borrar la
fila del registro. **Borra lo que se haya escrito en esas columnas**: antes, `pg_dump` o una copia de esas columnas. La app
no se rompe al revertir: vuelve a decir «falta la migración 159».

## 9 · Lo que le toca al orquestador (en este orden)

1. **Respaldo** (`pg_dump` o el respaldo activo) y `node scripts/db/migrate-status.mjs` (deben salir pendientes la 156, 157,
   158 y 159; si otra rama cogió el 159, renumerar esta **y** recalcular su checksum con `--sum`).
2. **§6 entera con ROLLBACK**: 29 OK. Si algo sale MAL, parar.
3. `set lock_timeout = '3s';` y **aplicar** `supabase/migrations/159_expediente_campos.sql` en una transacción;
   `migrate-status` después.
4. **Recargar el esquema de PostgREST** si la pantalla siguiera diciendo «falta la migración 159» tras aplicar
   (`notify pgrst, 'reload schema';`): PostgREST cachea las columnas, y `select *` no las trae hasta que recarga.
5. Abrir Recruiting › Employees como admin de RR. HH.: el aviso ámbar desaparece y los campos nuevos se encienden.
6. **Decidir con el dueño el punto 1 de §1** (si los 30 teléfonos son de oficina o personales) **antes** de animar a nadie a
   llenar el campo «Teléfono personal».

## 10 · Lo que NO se ha medido

- **La pantalla contra la base real, ni en el navegador.** El módulo de RR. HH. no carga en el demo (su `layout` pide sesión
  en el servidor y no tiene rama de demo), así que no hay capturas. Lo que hay son pruebas de función y de fuente, `tsc` y
  `next build`.
- **El error exacto que da PostgREST** al escribir una columna que no existe. El código reconoce `PGRST204`, `42703` y los
  dos mensajes, pero no se provocó de verdad (habría sido una escritura contra producción).
- **Que el ban de Auth corte una sesión ya abierta.** Un ban impide iniciar sesión y refrescar el token; un token vigente
  dura hasta que caduca. No se midió cuánto.
- **La matriz con un gerente y un reclutador reales**: no existen; se prestó el rol dentro de la transacción.
