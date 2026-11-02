---
name: pendiente-permisos-supabase-db-password
description: Resuelto 2026-10-12 — la contraseña de la base nunca cambió; el fallo del 11-oct fue pasajero. Si pg_dump falla una vez, reintentar antes de pedir permisos o contraseñas.
metadata:
  node_type: memory
  type: project
  originSessionId: 83590ac0-88d3-4d5e-b9d3-888a2b15db49
  modified: 2026-10-12T15:57:44.446Z
---

2026-10-11 17:08 el respaldo nocturno falló con «password authentication failed for user postgres» y creí que alguien había rotado la contraseña. 2026-10-12 el dueño mandó la contraseña y resultó ser LA MISMA que ya estaba en los dos `.env.local` (`D:\CLAUDE\secretos\deliveries-app.env.local` y el del repo, línea `SUPABASE_DB_URL`, Session pooler puerto 5432). Los respaldos de las 08:13 y las 09:54 del 12-oct salieron bien (6 MB) sin cambiar nada. El fallo fue pasajero del lado de Supabase.

**Why:** para no volver a pedir permisos ni contraseñas cuando un `pg_dump` falla una sola vez.

**How to apply:** si vuelve a fallar la autenticación, reintentar primero (y mirar status.supabase.com) antes de asumir rotación. Ver [[confirmar-despliegue-antes-de-decir-listo]].
