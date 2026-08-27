-- 081: anon deja de tener permisos de tabla en public, recruiting y timetracker.
--
-- Encontrado auditando: anon —el rol del visitante sin sesión, el que respalda la
-- clave pública que va en el navegador— tenía SELECT, INSERT, UPDATE, DELETE y
-- TRUNCATE sobre 31 tablas. clockin y erp no: sus migraciones (075 y equivalente)
-- concedieron solo a authenticated y service_role. Las otras tres heredaron el
-- reparto por defecto de Supabase y nadie lo recortó.
--
-- No es una fuga abierta, y conviene decirlo con precisión: RLS filtra fila por
-- fila, anon no tiene auth.uid(), así que has_recruiting_access() y compañía
-- devuelven false y un SELECT anónimo trae cero filas. Se comprobó además que
-- ninguna pantalla funciona sin sesión — todas redirigen a /login — así que no hay
-- nada legítimo apoyado en estos permisos.
--
-- Lo que sí importa: **TRUNCATE no pasa por RLS**. Una política no lo filtra
-- porque no mira filas, vacía la tabla entera. Hoy no hay camino para invocarlo
-- (PostgREST no expone TRUNCATE), pero es un permiso a una función RPC de
-- distancia de ser alcanzable, y no hay ninguna razón para que exista.
--
-- USAGE sobre el schema public se deja: es el reparto estándar de Supabase y el
-- cliente del navegador lo usa para hablar con GoTrue. Sin permisos de tabla no
-- lleva a ninguna parte. En recruiting y timetracker se retira, para que queden
-- como clockin y erp.

revoke all on all tables    in schema public, recruiting, timetracker from anon;
revoke all on all sequences in schema public, recruiting, timetracker from anon;
revoke all on all functions in schema recruiting, timetracker from anon;
revoke usage on schema recruiting, timetracker from anon;

-- Y que una tabla nueva no vuelva a nacer con ellos.
alter default privileges in schema public, recruiting, timetracker
  revoke all on tables from anon;
alter default privileges in schema public, recruiting, timetracker
  revoke all on sequences from anon;
