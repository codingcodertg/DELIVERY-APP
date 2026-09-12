-- 107_session_gate.sql — lo que el middleware necesita para el cierre de las 18:30
--
-- La decisión que la acompaña es la de la rama `cierre-sesion-1830`, en DECISIONS.md.
--
-- SIN EL MARCADOR DE DECISIÓN SIN NUMERAR, Y NO ES UN OLVIDO. Una migración se ejecuta a mano y su fila en
-- `schema_migrations` guarda el checksum del cuerpo; numerar la decisión después cambiaría ese
-- cuerpo y `migrate-status` diría «cambiada» para siempre. Y dejarlo sin numerar dejaría un
-- comentario apuntando a nada en el único fichero que ya no se puede tocar. Así que aquí se
-- cita la rama, que no cambia, y el número vive en la entrada.
--
-- El dueño pidió que a las 6:30 PM salga todo el mundo menos él y los administradores. Para
-- decidirlo, el middleware necesita tres datos de quien llega:
--
--   · CUÁNDO puso la contraseña — no cuándo se emitió este token. `iat` se renueva en cada
--     refresco (cada hora), así que no sirve de ancla; la hora real de la contraseña vive en
--     `auth.sessions.created_at`, que no se mueve con los refrescos (medido en producción:
--     una sesión del 09-09 con refrescos hasta el 09-12 conserva su `created_at`).
--   · Su rol de Entregas y su rol de fichaje, para saber si está exento.
--
-- POR QUÉ UNA FUNCIÓN Y NO TRES CONSULTAS
--
-- `auth.sessions` no está expuesta por PostgREST, y exponer el esquema `auth` entero para leer
-- una columna abriría de paso la tabla de usuarios y la de identidades. Esto expone **un dato**.
--
-- POR QUÉ NO RECIBE ARGUMENTOS, QUE ES LO QUE LA HACE SEGURA
--
-- Un `session_gate(uuid)` dejaría preguntar por la sesión de cualquiera. Aquí el id sale del
-- JWT de quien llama y el usuario de `auth.uid()`, así que **solo se puede leer la propia
-- sesión**, que es exactamente lo que la regla necesita: se evalúa para la sesión que llega.
-- La doble condición (`id` del JWT **y** `user_id = auth.uid()`) es a propósito: sin la
-- segunda, un `session_id` de otro que se colara en un token forjado devolvería su hora.
--
-- Y devuelve las tres cosas en UNA fila porque el middleware corre en cada navegación y ya
-- hace una llamada de red por su cuenta (`getUser()`); tres viajes donde cabe uno se notaría.

create or replace function public.session_gate()
returns table (
  session_created_at timestamptz,
  deliveries_role    text,
  clockin_role       text
)
language sql
stable
security definer
-- `set search_path` explícito: sin él, una función `security definer` es la puerta clásica para
-- que alguien plante un `profiles` suyo en un esquema por delante y se lo lea con permisos de
-- dueño. `pg_temp` va al final, nunca al principio, por lo mismo.
set search_path = public, auth, clockin, pg_temp
as $$
  select
    (select s.created_at
       from auth.sessions s
      where s.id = nullif(auth.jwt() ->> 'session_id', '')::uuid
        and s.user_id = auth.uid()),
    (select p.role::text from public.profiles  p where p.id = auth.uid()),
    (select c.role::text from clockin.profiles c where c.id = auth.uid());
$$;

comment on function public.session_gate() is
  'La hora en que se autenticó ESTA sesión y los dos roles de quien la trae, para el cierre '
  'diario de las 18:30. Solo la propia sesión: el id sale del JWT, no de un argumento.';

-- Nadie sin sesión tiene nada que preguntar aquí, y `public` incluye a `anon`.
revoke execute on function public.session_gate() from public, anon;
grant  execute on function public.session_gate() to authenticated;

-- @ledger-below
insert into public.schema_migrations (name, checksum)
  values ('107_session_gate.sql', 'e672ab2c35119cfa3bdd795ae00c06433aea0bc9bd21fa0ca8a971761276392c') on conflict (name) do nothing;
