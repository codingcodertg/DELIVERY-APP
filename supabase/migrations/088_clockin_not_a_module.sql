-- ===========================================================================
-- NUNCA SE APLICO. REEMPLAZADA POR LA 095 (D-157).
-- ===========================================================================
-- No se borra -el historial no se borra- pero que quede dicho arriba del todo, porque
-- leerla entera sin saberlo lleva a creer que la base esta en un estado en el que no esta.
--
-- No se aplico porque NO PODIA aplicarse: su primer UPDATE concede el modulo 'timetracker'
-- a quien tenia 'clockin', y una restriccion posterior
--
--     profiles_timetracker_access_needs_role
--       CHECK (NOT ('timetracker' = ANY(module_access)) OR timetracker_role IS NOT NULL)
--
-- prohibe tener el modulo sin tramo. Una sola fila que no cumpliera tumbaba la transaccion
-- entera, y habia una. El error exacto y que se hizo en su lugar, en la 095.
-- ===========================================================================

-- 088 · Fichaje deja de ser un módulo (D-111)
--
-- Tuvo tarjeta propia en el hub y casilla propia en Usuarios mientras fue una app aparte.
-- Desde la fusión es la otra mitad de Time Tracker, y mantener las dos cosas hacía elegir
-- entre dos puertas de la misma casa. Peor: se podía conceder MEDIA app — alguien con
-- 'clockin' y sin 'timetracker' tenía las pantallas de fichaje y no la puerta por la que
-- ahora se entra a ellas.
--
-- La palabra ya no decide nada. Desde 087, quien puede fichar lo dice `timetracker_role`:
--
--     has_clockin_access() -> timetracker_role is not null or role = 'admin'
--
-- y la restricción que ataba 'clockin' en module_access a un rol se soltó en esa misma
-- migración. Así que esto no quita permisos a nadie; quita una palabra que ya no se lee.

-- ---------------------------------------------------------------------------
-- Primero la puerta, después el nombre viejo
-- ---------------------------------------------------------------------------
-- 084 y 087 ya hicieron este relleno. Se repite porque el ORDEN es lo que importa: si
-- alguien se dio de alta entre una migración y otra con 'clockin' y sin 'timetracker',
-- borrar la palabra antes de concederle el módulo madre lo dejaría sin ninguno — y con
-- module_access vacío, landingRoute manda a /no-access.
update public.profiles
   set module_access = array_append(module_access, 'timetracker')
 where 'clockin' = any(coalesce(module_access, '{}'))
   and not ('timetracker' = any(coalesce(module_access, '{}')));

-- Y ahora sí, fuera la palabra.
update public.profiles
   set module_access = array_remove(module_access, 'clockin')
 where 'clockin' = any(coalesce(module_access, '{}'));

-- ---------------------------------------------------------------------------
-- Que no vuelva a entrar
-- ---------------------------------------------------------------------------
-- Sin esto, cualquier pantalla vieja —o una fila restaurada de una copia— podría volver a
-- escribirla, y quedaría un módulo fantasma que la app ya no dibuja pero la base acepta.
-- Se comprueba en la base y no solo en el tipo de TypeScript porque el tipo no viaja: un
-- script, un curl o una sesión de SQL escriben igual.
alter table public.profiles drop constraint if exists profiles_module_access_known;
alter table public.profiles add constraint profiles_module_access_known
  check (module_access is null or module_access <@ array['deliveries','recruiting','timetracker','erp'])
  not valid;

-- `not valid` a propósito: valida lo que se escriba de ahora en adelante sin exigir que
-- todo lo ya escrito pase primero. Si quedara una fila rara de antes, esta migración
-- fallaría entera y con ella el despliegue, por un dato que no hace daño a nadie.
