---
name: migracion-sin-transaccion-propia
description: Una migración con begin/commit propios se aplica sola dentro de un ensayo con ROLLBACK.
metadata: 
  node_type: memory
  type: feedback
  originSessionId: 9d5602ef-8669-4169-abbc-3d0b12686868
  modified: 2026-09-18T03:43:17.240Z
---

Un fichero de `supabase/migrations/` **nunca** lleva `begin;`/`commit;` propios. La atomicidad la pone
quien aplica, envolviendo el fichero entero. En Postgres un `begin` anidado es solo un *WARNING*, pero
el `commit` de dentro **cierra la transacción de fuera**: a partir de ahí, un ensayo con `ROLLBACK`
deja de deshacer nada.

**Why:** el 2026-09-17 puse un `begin`/`commit` alrededor de un `drop policy` + `create policy` «para
que no hubiera un instante sin política de escritura». La 124 **se aplicó sola a producción** durante
el ensayo: columna, guardia, políticas y fila del registro, todo confirmado, sin que nadie hubiera
aprobado el cambio de comportamiento que traía. Ninguna de las 123 migraciones anteriores lo llevaba:
la convención existía y no la comprobé.

**How to apply:** antes de escribir algo estructural en un `.sql`, `grep` de ese patrón en las
migraciones que ya hay — si ninguna lo hace, hay una razón. Y si el cambio necesita atomicidad, ya la
tiene por el envoltorio de quien aplica. Consecuencia que hay que resolver a mano si pasa: la fila de
`schema_migrations` queda con el checksum viejo, así que o se borra (si se revierte) o se actualiza (si
se queda), o `migrate-status` la marca como *cambiada* para siempre. Ver [[politica-que-no-decide]].
