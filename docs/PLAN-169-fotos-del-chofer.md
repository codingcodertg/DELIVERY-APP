# Plan 169 · El chofer guarda las fotos del material y sus marcas de salida / llegada en SU orden

Plan en papel exigido por `CLAUDE.md` («Antes de tocar RLS, triggers o permisos en producción» — aquí es **un bloque más
en `guard_delivery_stage`**, nada de políticas ni de esquema). Molde: la 168 (`docs` no tuvo plan aparte; el fichero
.sql lleva el hueco, el qué, el ensayo por rol y la reversión).

**Pedido del dueño (2026-10-12), literal:** *«haz el 5, 6 y 7»* sobre la lista de pendientes, donde el 5 era: *«Fotos del
material desde el chofer: en la ficha de orden el botón «📷 Fotos del material» usa una actualización que el guardia de la
base rechaza al chofer. Es una migración chica (…) Lo mismo para `arrived_at` / `departed_at` del chofer.»*

## 1 · Lecturas y escrituras (inventario)

| Quién | Qué escribe hoy | Qué contesta la base (168) |
|---|---|---|
| Chofer, «📷 Fotos del material» (`OrderModal.tsx`, `PhotoUpload`) | `update deliveries set photos = …` | «You cannot edit an order in the % stage» en toda etapa |
| Chofer, «En camino a recoger» (`depart`) | `set departed_at = now()` | lo mismo |
| Chofer, «Llegó a la parada» (`arrive`) | `set arrived_at = now()` | lo mismo (por eso D-520 marcó «Llegué» con EVENTOS) |
| Chofer, coordenadas al cerrar parada (142/145) | `pickup_lat/lng/gps_at`, `pod_lat/lng/accuracy` | pasa, en picked_up / delivered |
| Almacén, fotos | `photos` | pasa (su rama: approved…delivered) |

## 2 · Lo que cambia (literal)

Un bloque en el tramo «misma etapa», justo después del bloque del chofer de la 142/145:

```
if r = 'driver' and old_stage in ('approved','fulfilling','ready','picked_up','delivered')
   and OLD.assigned_driver = (select p.full_name from public.profiles p where p.id = auth.uid()) then
  probe := NEW;
  probe.photos      := OLD.photos;
  probe.photo_meta  := OLD.photo_meta;
  probe.departed_at := OLD.departed_at;
  probe.arrived_at  := OLD.arrived_at;
  probe.updated_at  := OLD.updated_at;
  if probe is not distinct from OLD then return NEW; end if;
end if;
```

Todo lo demás, letra por letra la 168 (lo compara `src/lib/fotos-del-chofer.test.ts`).

## 3 · Qué no debe romperse

- Ningún cambio de etapa (el bloque está en el tramo de misma etapa y solo devuelve `NEW` si el probe iguala a OLD).
- INSERT y lectura (RLS) intactos.
- Almacén, ventas, office, logística: sus ramas no se tocan.
- El chofer sigue sin poder tocar otra columna: una escritura con `photos` + `delivery_notes` no iguala a OLD y cae al
  resto del guard, que contesta como hoy.
- Orden de otro chofer o sin chofer: no entra (compara con `OLD.assigned_driver`).

## 4 · Matriz de pruebas por rol (con ROLLBACK)

Está al pie de `supabase/migrations/169_fotos_del_chofer.sql` (E1–E8). Ensayada con `aplica-migracion.mjs` (sin
`--escribe`) el 2026-10-12: corrió entera con su autocomprobación y se deshizo.

## 5 · Reversión

Volver a aplicar SOLO el bloque `create or replace function public.guard_delivery_stage() … end $function$;` de la
`168_chofer_recoge_sin_listo.sql` y `delete from public.schema_migrations where name = '169_fotos_del_chofer.sql';`.

## 6 · Respaldo

`D:\CLAUDE\respaldos-db\rtg-prod-20261012-095300.dump` (6 MB), del mismo día, antes de aplicar.
