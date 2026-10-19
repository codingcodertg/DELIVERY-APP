# Plan — traspaso ERP §5: borradores, categorías, proveedores (2026-10-18)

Solo lectura hasta aquí. El dueño aprobó el 2026-10-18 («ok haz todo») la recomendación sobre las cinco
decisiones de `HANDOFF-erp.md` §5. Scripts en `scripts/erp-handoff/`; cada uno es **en seco por defecto**,
`--ensayo` escribe y hace `ROLLBACK`, `--escribe` hace `COMMIT`. Se corren con
`node --env-file=.env.local scripts/erp-handoff/<x>.mjs`.

## 1. Medidas (producción, 2026-10-18, `mide.mjs`, transacción `read only`)

| Qué | Medido |
|---|---|
| `product_requests` | 471 `pending`/`new` (todas `requester_status='ready'`) + 1 `approved`/`edit` |
| Producto de esas 471 | 470 `draft` + **1 ya `published`** (req 297, `ULT158`, publicado el 2026-10-03 sin cerrar su solicitud: el caso «dos acciones separadas» del traspaso) |
| Payload de las 471 | **solo tres claves: `sku`, `name`, `source`** (`excel_round_trip`). Ni categoría ni proveedor ni etiqueta cruda viajan en el payload |
| Categoría y proveedor | viven en la **fila de `erp.products`** del borrador: **198 con las dos** · 184 solo proveedor · **89 sin ninguna** · 0 solo categoría (cuadra con el traspaso: 273 sin categoría, 89 sin proveedor) |
| `raw_category` en los borradores | `null` en los 471 |
| `raw_category` en todo `erp.products` | **18 etiquetas distintas** en 3.076 productos (el traspaso dice 19): TILE 1212 · DECO 706 · ADHESIVES 378 · SHOWER 282 · TRIM 122 · TOOLS 113 · STONE 105 · SPC 36 · DECO/SHOWER 36 · INSTALL MATERIAL 30 · FURNITURE 27 · PANEL 18 · ACCESORIES 3 · FLOOR 2 · WALL 2 · VYNIL 2 · OTHER 1 · TIRA TRIM 1 |
| `raw_category` con `category_id` null | **0** — todo producto que trae etiqueta ya tiene categoría. El mapeo no llena nada hoy; sirve para la hoja (3.310 códigos) |
| Nombres crudos de proveedor | **no están en ningún campo nuestro** (`products` no tiene `vendor_name`; `vendors.aliases` es `null` en las 106 filas). De los 12 del traspaso solo 7 se nombran en el texto: MARSHALLTOWN, FORTAN STONE, ENERGIEKER, TEXRITE/Texrite → **no existen**; DALTILE → `3:DALTILE DISTRIBUTION, INC`; T-2000 → `5:TILES 2000 USA, LLC` |
| «UNIFIED DESC» (renombres) | no vive en ningún campo nuestro: el `name` del borrador es el de la hoja, pero el de los 6.529 publicados es el del ERP. **Hace falta `renames.csv`** |
| `AMC100DUP` | producto 7120 (`draft`, req 13), misma categoría 60 y proveedor 77 que `AMC100` (1722, publicado). **Cumpliría la regla «cat + proveedor» y se publicaría**: el script lo excluye por SKU |
| Admin firmante | `ANDRES UGARTE` = `acf43ad5-a937-419b-980c-ef57d45b67c6` (`erp_role='admin'`). Ojo: hay otro perfil «Andres Ugarte» (`69d1…`) sin `erp_role` |
| Triggers `erp` | 13 (los 12 de la 174 + `customers_touch`); `audit_products` y `audit_product_requests` son `AFTER INSERT OR DELETE OR UPDATE` |

Resultado en seco de `aprueba-borradores.mjs`: **197 elegibles** (198 − AMC100DUP), **273 quedan para revisión**
(184 sin categoría + 89 sin nada; entre ellas la 297/ULT158, que no tiene categoría).

## 2. Mecanismo de aprobación (el de la app, `src/lib/erp/actions.ts`)

- **`erp.decide_request(p_request_id, true, p_note)`** (158, reemplaza la de la 064): bloquea la fila
  (`for update`), exige `status='pending'` y `requester_status<>'not_ready'`; para `type='new'` **no toca el
  producto**; pone `status='approved', decided_by=auth.uid(), decided_at=now(), decision_note`. Revienta si
  otra sesión la decidió entre medias.
- **`erp.publish_product(p_id)`** (064): solo admin; `record_status='published', approved_by=auth.uid(),
  approved_at=now(), updated_at`. **No limpia `needs_review`** (los 470 borradores lo tienen en `true`): se
  deja así a propósito, es lo que haría la app; si el dueño quiere quitarlo, es otra decisión.
- Las dos son `SECURITY DEFINER` y leen `erp.current_app_role()` = `profiles.erp_role where id = auth.uid()`.
  Por Postgres directo `auth.uid()` es `null`; el script firma la transacción con
  `set_config('request.jwt.claims', '{"sub":<id>,"role":"authenticated"}', true)`. **Medido**: tras eso
  `auth.uid()` devuelve el id y `current_app_role()` = `admin`.
- Auditoría: `audit_row` (174) escribe en `erp.audit_log(actor=auth.uid(), before, after)` en cada UPDATE
  de `products` y `product_requests`, así que cada aprobación deja **dos filas con el actor** (solicitud y
  producto) — de ahí que no se hagan `UPDATE`s crudos ni se salte la firma.
- Descartado: `UPDATE erp.products set record_status=…` directo (se saltaría `approved_by` y los guards);
  `link_draft_to_product` para AMC100DUP (archiva el borrador y crea un alias `old_sku=mpn` — no es lo que
  es: es un marcador; mejor rechazar la solicitud con nota y archivar a mano cuando el dueño lo confirme).

## 3. Scripts

| Script | Hace | Idempotencia |
|---|---|---|
| `aprueba-borradores.mjs` | por cada `pending/new/ready` con `category_id` y `vendor_id` (menos AMC100DUP): `decide_request(…, true, nota)` y, si sigue `draft`, `publish_product` | solo `pending`; no republica |
| `aplica-mapeo.mjs` | `category_id` según `mapeo-categorias.json` donde falte; fuente `--csv=sku,label` o `raw_category` | `where category_id is null`; «?» se salta |
| `aplica-proveedores.mjs` | crea los `NUEVO`, anota alias en `vendors.aliases`; con `--csv=sku,vendor_name` pone `vendor_id` donde falte | por nombre sin mayúsculas; alias sin repetir; `where vendor_id is null` |
| `mide.mjs` | las medidas de arriba, `begin read only` | — |

`_db.mjs`: conexión `pg` (misma forma que `scripts/db/aplica-migracion.mjs`), `actuaComo`, `adminActor`.

## 4. Matriz de ensayo (con `--ensayo` = ROLLBACK) — **pendiente**: el clasificador de permisos negó
correr los `--ensayo` desde el asistente; los lanza el dueño con `!`.

| # | Script | Comando | Esperado |
|---|---|---|---|
| 1 | aprueba | `--ensayo` | `aprobadas 197 · publicadas 197 · ya publicadas 0`; después `pendientes 274 · borradores 273 · firmados 197 · auditoría ≥ 394`; `ROLLBACK` |
| 2 | aprueba | `--ensayo` otra vez | mismos números (nada quedó escrito) |
| 3 | aprueba | `--ensayo --actor=69d1a91a-93ed-430b-8c02-190405c3edaf` | **falla** «no es admin del ERP», nada escrito |
| 4 | mapeo | `--ensayo` | `porPoner 0`, `actualizados 0` |
| 5 | mapeo | `--ensayo --csv=<prueba de 3 filas con TILE, DECO/SHOWER y una etiqueta inventada>` | 1 por poner (si el SKU no tiene categoría), 1 dudosa, 1 sin mapeo |
| 6 | proveedores | `--ensayo` | `a crear 4 · alias 3`; ids reales en el JSON; `ROLLBACK` |
| 7 | tras 1–6 | `mide.mjs` | 471 pending, 470 drafts, 106 vendors: igual que antes |

Luego `--escribe` de `aprueba-borradores.mjs` **tras un `pg_dump` o respaldo reciente** (regla de CLAUDE.md
para escrituras en producción). Mapeo y proveedores `--escribe` **solo cuando lleguen los CSV** (abajo).

## 5. Reversión

- Aprobaciones: la nota de decisión es fija
  (`Aprobación en lote del traspaso ERP §5.1(b) …`), así que se localizan con
  `select id, product_id from erp.product_requests where decision_note like 'Aprobación en lote del traspaso ERP §5.1(b)%'`;
  deshacer = `update erp.products set record_status='draft', approved_by=null, approved_at=null where id in (…)` y
  `update erp.product_requests set status='pending', decided_by=null, decided_at=null, decision_note=null where id in (…)`.
  El valor anterior exacto está en `erp.audit_log.before` (filas con `actor = acf43ad5…` y `at` de la corrida).
- Mapeo / proveedores: `audit_log.before` de `products` tiene el `category_id`/`vendor_id` previo (null);
  vendors nuevos: `delete from erp.vendors where name in ('MARSHALLTOWN','FORTAN STONE','ENERGIEKER','TEXRITE')`
  si ningún producto los referencia; alias: `aliases = array_remove(aliases, '<crudo>')`.

## 6. Qué falta de BH (sin esto, §5.2, §5.3 y §5.4 no se pueden aplicar)

1. **`sku,label`** de los 3.310 códigos con etiqueta de la hoja (o la hoja LINK), y la 19.ª etiqueta.
2. **`renames.csv`** (451: sku, nombre ERP, UNIFIED DESC) — ningún campo nuestro trae el nombre corto.
3. **Los 12 nombres de proveedor sin cuadrar con sus 94 códigos** (`sku,vendor_name`; `report.json`).
4. **`held-back.csv`** (328) para que el dueño corrija la hoja (§5.5: fuera por ahora).
5. Decisión del dueño sobre los «?» de `mapeo-categorias.json` (`DECO/SHOWER`, `FLOOR`, `WALL`) y sobre
   `AMC100DUP` (propuesta: rechazar la solicitud 13 con nota y archivar el borrador).
