-- 095 · Fichaje deja de ser un módulo, esta vez de verdad (D-157)
--
-- Reemplaza a la 088, que **nunca se aplicó** y no por casualidad: escrita como estaba, no
-- podía aplicarse. Su primer paso era
--
--     update profiles set module_access = array_append(module_access, 'timetracker')
--      where 'clockin' = any(module_access) and not ('timetracker' = any(module_access));
--
-- y eso choca de frente con una restricción que llegó después:
--
--     profiles_timetracker_access_needs_role
--       CHECK (NOT ('timetracker' = ANY(module_access)) OR timetracker_role IS NOT NULL)
--
-- No se puede conceder el módulo a quien no tiene tramo. Y como una migración es una sola
-- transacción, **una fila** que no cumpliera tumbaba las doce. Justo eso pasó:
--
--     ERROR: 23514: new row for relation "profiles" violates check constraint
--            "profiles_timetracker_access_needs_role"
--     DETAIL: Failing row contains (…, Patricia Hernández, …, {clockin}, null)
--
-- ---------------------------------------------------------------------------
-- Lo que se hace aquí, y lo que NO
-- ---------------------------------------------------------------------------
-- De los doce perfiles con la palabra 'clockin', **once ya tienen 'timetracker' y su tramo**.
-- Para ellos esto no cambia ningún permiso: solo borra una palabra que la aplicación dejó de
-- leer en D-111. Eso es lo que hace esta migración.
--
-- El duodécimo —una persona con 'clockin' y NADA más, sin tramo de Time Tracker— **no se
-- toca**. Su caso no es de esquema, es de negocio: hoy ya no puede fichar (desde 087,
-- `has_clockin_access()` mira `timetracker_role`, que tiene nulo), así que la palabra que le
-- queda no le da acceso a nada. Decidir si vuelve a fichar —y con qué tramo— es de quien
-- lleva el personal, no de una migración que se ejecuta sola de madrugada.
--
-- Quitarle la palabra a la brava lo dejaría con `module_access` vacío y aterrizando en
-- /no-access, que es su situación efectiva de hoy pero escrita de una forma que parece una
-- decisión deliberada. Se prefiere dejar el rastro visible.

update public.profiles
   set module_access = array_remove(module_access, 'clockin')
 where 'clockin' = any(coalesce(module_access, '{}'))
   and 'timetracker' = any(coalesce(module_access, '{}'));

-- ---------------------------------------------------------------------------
-- Que no vuelva a entrar
-- ---------------------------------------------------------------------------
-- Sin esto, cualquier pantalla vieja —o una fila restaurada de una copia— podría volver a
-- escribirla, y quedaría un módulo fantasma que la app ya no dibuja pero la base acepta.
-- Se comprueba en la base y no solo en el tipo de TypeScript porque el tipo no viaja: un
-- script, un curl o una sesión de SQL escriben igual.
--
-- `not valid` a propósito, y ahora con un motivo concreto además del general: la fila que
-- esta migración deja intacta **todavía lleva la palabra**. Validar exigiría arreglarla
-- primero, o sea tomar por ella la decisión que se acaba de dejar a una persona.
alter table public.profiles drop constraint if exists profiles_module_access_known;
alter table public.profiles add constraint profiles_module_access_known
  check (module_access is null or module_access <@ array['deliveries','recruiting','timetracker','erp'])
  not valid;
