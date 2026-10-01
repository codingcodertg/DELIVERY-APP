# Plan 158 · La solicitud de artículo del ERP, columna por columna de la hoja del dueño

Plan en papel exigido por `CLAUDE.md` («Antes de tocar RLS, triggers o permisos en producción»: aquí se **cambia el tipo de una
columna** (`product_requests.type`, de enum a texto), se **añade una columna** (`requester_status`), se **crea una función
`SECURITY DEFINER`** que escribe en `product_requests` y `products` (`set_request_ready`), y se **reemplazan dos funciones**
(`decide_request`, `product_vocabulary`)). Molde: `docs/PLAN-157-partes-de-orden.md` y `docs/PLAN-155-encuestas.md`.

**Estado (2026-09-30):** escrito por un worker en un worktree sin `.env.local`. Producción se **leyó** (`begin read only`) para
medir qué hay (§7), y la migración y la matriz de §6 se **ensayaron contra producción dentro de una transacción con `ROLLBACK`**
(resultado en §6). **Nada aplicado. Pendiente de aprobar.**

**Número:** 158, la siguiente libre (`156` y `157` están escritas y sin aplicar; el registro de producción va por la `155`,
medido en §7).

**Pedido del dueño (2026-09-30, literal, tal como lo pasó el orquestador):**

> *«en el erp en solicitud quiero que me agregues esa columnas si aun no esta como fields par allenar»*

«Esas columnas» son las de su hoja de Excel de solicitudes de artículos (dos capturas del 2026-09-29), en este orden: Date ·
Location · Required by · Executed by · Request Change · Reactivate · Deactivate (if QOH = 0) · Discontinue (same as deactivate
but can still have QOH) · Create New · Create Copy · Copy Source: Store & Item Code · Requester Comments · REQUESTER STATUS ·
EXECUTOR STATUS · Executor Comments · Category · Type · Material · Style · Color · Preferred Vendor · Manufacturer's part number ·
Description on purchase transactions · Cost · Shine · Size · SF/Box · U/M · Item Number (if known) · Description on sales
transactions · Sales price · Fixed Price or Levels. Fila de ejemplo: 3/25/2024 · BRO · Gloria S. · Minerva G. · Request Change = X
· Copy Source «New part Num» · NOT READY · DONE · UNCATEGORIZED · EMSER TILE · 0 · «OPUSCAR PEBBLES MOSAIC LIGHT 12 X 12 1SF» ·
$5.35 · EACH · E-102 · «OPUSCAR PEBBLES MOSAIC LIGHT 12 X 12 1SF» · $14.99.

**La migración está escrita y NO aplicada:** `supabase/migrations/158_erp_solicitud_campos.sql`.

---

## 0 · Resumen

| | Hoy (063/064) | Con la 158 |
|---|---|---|
| Tipos de solicitud | enum `erp.request_type`: new, edit, reactivate, deactivate | `type` **texto** con CHECK: los cuatro + **copy** + **discontinue**; el enum se borra |
| REQUESTER STATUS | no existe | columna `requester_status` (`ready` \| `not_ready`, defecto `ready`); las 332 filas que hay quedan `ready` |
| Marcar lista / no lista | — | `set_request_ready(id, bool)` DEFINER: solo pendientes, del solicitante (o admin/manager); en new/copy mueve la etiqueta `NOT READY` del borrador |
| Aprobar una «no lista» | — | `decide_request` la rechaza (`request % is not ready`); rechazar sí se puede |
| Aprobar un «discontinue» | — | `status = 'discontinued'` (deactivate sigue dando `inactive`) |
| Aprobar una edición | name, price, cost, base_unit, sf_per_box, pieces_per_box, size_in, size_cm, material, finish, mpn | los mismos + **description, price_mode, style, color1** |
| `product_vocabulary()` | base_unit, material, finish | + **style, color** (sugerencias del formulario) |
| Políticas, grants de tabla, datos de `products` | — | **no se tocan** (las 3 políticas de `product_requests` siguen) |

## 1 · El mapa de la hoja, y las decisiones

El mapa completo (32 columnas → campo, dónde se guarda, si existía) vive en `src/lib/erp/solicitud-campos.ts`
(`MAPA_DE_LA_HOJA`) y una prueba lo contrasta con las columnas reales de la 063. Lo que decide esta migración:

1. **`type` texto + CHECK, no `alter type … add value`.** Un valor nuevo de enum no se puede usar en la misma transacción que lo
   añade (Postgres), así que la matriz con `ROLLBACK` no podría insertar un `copy` ni un `discontinue`. Con texto, la matriz
   prueba los seis tipos y la reversión es simétrica. El enum se borra porque su único dependiente era la columna (medido).
2. **`requester_status` columna, no clave del payload.** La cola del ejecutor filtra por ella y `decide_request` la comprueba sin
   abrir el JSON; el payload es «cómo debe quedar el artículo», no el estado del trámite.
3. **La solicitud `new`/`copy` no lleva `product_id`.** Quien pide (staff) no puede leer su propio borrador (política «products
   read»: publicados, o admin/manager) y un `INSERT … RETURNING` se lo rechaza la RLS — **salió en el ensayo** (segunda
   pasada). Por eso `set_request_ready` encuentra el borrador por `payload->>'sku'`, que la app ya guardaba.
4. **Discontinue ≠ deactivate.** Tal como lo escribe el dueño: desactivar exige QOH = 0 (lo comprueba el formulario y lo avisa la
   revisión); descontinuar puede quedar con existencia y pone `discontinued`, que ya era un valor de `commercial_status`.

**Descartado:**
- *Columnas nuevas `purchase_description` / `sales_description` en `products`.* `products.description` existe y está vacía en las
  6.859 filas (medido); «Description on sales transactions» es lo que el ERP llama `name`. Dos columnas más habrían exigido
  recrear la vista `app_products` (101) y tocar el round-trip del Excel maestro.
- *Que `set_request_ready` fuera una política de UPDATE para el solicitante.* Una política no limita columnas: podría tocar
  `status`, `payload` o `decided_by`. La función solo toca `requester_status` (y la etiqueta del borrador).
- *Crear el borrador y la solicitud en una sola función DEFINER.* Habría que mantener dos caminos (con y sin 158); con la forma
  elegida el camino de siempre (new/edit/reactivate/deactivate) sigue entrando sin la 158, y solo copy / discontinue / «no lista»
  contestan «migración pendiente» sin crear nada.

## 2 · Lo que pasa hoy, medido (2026-09-30, solo lectura)

- `erp.request_type` = `{new, edit, reactivate, deactivate}`; único dependiente: `product_requests.type`.
- `product_requests`: **331 `new` pendientes** (todas del round-trip del Excel: payload `sku`, `name`, `source`) y **1 `edit`
  aprobada** (`size_cm`). `requester_store` **nulo en las 332**: el formulario nunca mandaba la tienda.
- `decide_request` y `product_vocabulary` en producción son las de la **064 letra por letra** (comparadas por texto).
- `products`: 6.859 filas; `description` llena en **0**, `style` en 961, `color1` en 1.121, `finish` en 955, `price` en 6.105;
  `price_kind`/`price_mode` nulos en todas. `finish` vale MATTE/POLISHED/GLOSSY…, `base_unit` BOX/BAG/PIECE/EA…
- Perfiles con el ERP: 4, todos `erp_role = admin`. Para la matriz, un perfil de ventas y uno de gerente reciben `staff`/`manager`
  **dentro** de la transacción.
- Políticas de `product_requests`: gate restrictiva (`has_erp_access()`), insert own (`requester = auth.uid()`), read (propias, o
  admin/manager). **No hay UPDATE** para nadie por la API.
- `products`: la columna `cost` está **revocada** desde la 101: un `select *` como `authenticated` falla (salió en el ensayo,
  tercera pasada; la matriz pide columnas).

## 3 · Inventario de lecturas y escrituras

| Quién | Qué | Hoy | Con la 158 |
|---|---|---|---|
| `submitNewItem` (app) | `insert products` (borrador, sin RETURNING) + `insert product_requests` (`new`/`copy`, `requester_status` solo si `not_ready`) | solo `new`, sin tienda | tienda, estado del solicitante, `copy_source` en el payload; antes de crear nada, una lectura de cero filas de `requester_status` dice si la 158 está |
| `submitRequest` (app) | `insert product_requests` (`edit`/`reactivate`/`deactivate`/`discontinue`) | sin `discontinue` | el enum viejo contesta 22P02 → «migración pendiente» |
| `setRequestReady` (app) | `rpc set_request_ready` | — | nueva |
| `/erp/request`, `/erp/requests` (app) | `select *` de `product_requests` | lista de columnas | `*`: la columna nueva solo existe con la 158 |
| `decide_request` | `update products`, `update product_requests` | — | + discontinue, guard not_ready, 4 claves |
| `apply_master_import` (064) | `insert product_requests (type='new', …)` | enum | texto: el literal entra igual |

## 4 · Qué NO debe romperse

- Las 331 solicitudes `new` pendientes y la `edit` aprobada: mismo tipo, mismo estado, `requester_status = 'ready'` (E1, E2).
- `apply_master_import` sigue insertando `'new'` (literal sin tipo: vale para texto).
- Las tres políticas de `product_requests` (E5) y los grants de tabla.
- `deactivate` → `inactive` y `reactivate` → `active` como antes (M7, M8). Decidir dos veces sigue fallando (M9).
- El staff sigue sin poder decidir (S9) ni leer solicitudes ajenas (S11); anon sigue sin entrar (A1, A2).

## 5 · El SQL, literal

Ver `158_erp_solicitud_campos.sql`. En resumen:

```sql
alter table erp.product_requests alter column type type text using type::text;
alter table erp.product_requests add constraint product_requests_type_known check (type in ('new','copy','edit','reactivate','deactivate','discontinue'));
drop type erp.request_type;
alter table erp.product_requests add column requester_status text not null default 'ready' constraint product_requests_requester_status_known check (requester_status in ('ready','not_ready'));
create or replace function erp.set_request_ready(p_request_id bigint, p_ready boolean) … security definer   -- solicitante o admin/manager; solo pendientes; etiqueta NOT READY del borrador por payload->>'sku'
revoke execute … from public, anon;  grant execute … to authenticated;
CREATE OR REPLACE FUNCTION erp.decide_request(…)   -- la 064 + guard not_ready + description/price_mode/style/color1 + discontinue
CREATE OR REPLACE FUNCTION erp.product_vocabulary() -- la 064 + style + color
do $chk$ … -- autocomprobación: tipo texto con los seis, enum borrado, columna y CHECK, definer y grants, las ramas nuevas, 3 políticas
```

Sin `begin`/`commit` propios. **Sin el número de la decisión dentro del `.sql`**: numerarla no cambia el checksum.
Checksum del registro: `886b036990dbb9406191fa70c6884a3d9d77d5235f079978cba808e889f49fec`
(`node scripts/db/migrate-status.mjs --sum 158_erp_solicitud_campos.sql`, 2026-09-30; una prueba del repo lo recalcula).

## 6 · Matriz de pruebas por rol, con ROLLBACK (la corre el orquestador)

**33 casos.** Se pega entero en `psql` **desde la raíz del repo** (el `\i` es relativo). **Sin `commit` en ningún sitio.** Crea sus
propios productos (`ZZ158A/B/C` publicados, `ZZ158N`/`ZZ158K` borradores) y sus solicitudes; lo único de producción que toca es
`erp_role`/`module_access` de dos perfiles, **dentro** de la transacción (se deshace).

Sustituir: `<UUID-ADMIN>` (`admin`), `<UUID-VENTAS>` (un perfil de ventas, que recibe `staff` del ERP), `<UUID-GERENTE>` (un
perfil de gerente, que recibe `manager` del ERP).

**Ensayado contra producción el 2026-09-30 con ROLLBACK (por el worker, con los UUID reales: admin `acf43ad5…`, ventas
`4760e4ef…`, gerente `caf1a337…`): 33 de 33 OK.** Cuatro pasadas: la primera cayó en la autocomprobación (`is_nullable` es
`'NO'` en mayúsculas en `information_schema`); la segunda en S1 (`INSERT … RETURNING` del borrador como staff: la RLS de
lectura no le deja ver su propio borrador — se quitó el RETURNING de la app y la función busca por el SKU del payload); la
tercera en M2 (`select *` de `products` como gerente: la columna `cost` está revocada desde la 101 — la matriz pide columnas).
Comprobado después, en solo lectura, que no quedó nada: ni productos `ZZ158`, ni la columna, ni la función, ni la fila del
registro; el enum sigue; `decide_request` y `product_vocabulary` con el mismo md5 que antes; los dos perfiles con su
`erp_role` nulo y su `module_access` de antes; 332 solicitudes.

```sql
begin;

-- 0. Foto de control de lo que hay, ANTES de la migración.
create temp table ctl as
  select (select count(*) from erp.product_requests) as n_req,
         (select count(*) from erp.products) as n_prod,
         (select string_agg(type::text || ':' || status::text || ':' || c, ',' order by type::text, status::text)
            from (select type, status, count(*) c from erp.product_requests group by 1, 2) x) as tipos;

-- 1. La migración, dentro de la misma transacción (se deshace con el resto).
\i supabase/migrations/158_erp_solicitud_campos.sql

do $$ declare v text; n int; begin
  select tipos into v from ctl;
  raise notice 'E1  las filas que había siguen con su tipo y su estado                esperado igual: %',
    case when v = (select string_agg(type || ':' || status::text || ':' || c, ',' order by type, status::text)
                     from (select type, status, count(*) c from erp.product_requests group by 1, 2) x) then 'OK' else 'MAL' end;
  select count(*) into n from erp.product_requests where requester_status <> 'ready';
  raise notice 'E2  todas las filas que había quedan READY                            esperado 0: %', case when n = 0 then 'OK' else 'MAL '||n end;
end $$;

-- 2. Perfiles y productos de ensayo, como postgres. Los perfiles reales reciben el escalafón del ERP
--    SOLO dentro de la transacción. Tres productos publicados ZZ158A/B/C (ninguno existe: se comprueba).
create temp table ids (k text primary key, id bigint);
grant all on table ids to authenticated;
do $$ begin
  if exists (select 1 from erp.products where sku like 'ZZ158%') then raise exception 'ya hay productos ZZ158'; end if;
end $$;
update public.profiles set erp_role = 'staff',   module_access = (select array_agg(distinct m) from unnest(coalesce(module_access, '{}') || '{erp}') m) where id = '<UUID-VENTAS>';
update public.profiles set erp_role = 'manager', module_access = (select array_agg(distinct m) from unnest(coalesce(module_access, '{}') || '{erp}') m) where id = '<UUID-GERENTE>';
insert into erp.products (sku, name, status, record_status, product_type, taxable, created_by)
  values ('ZZ158A', 'Ensayo 158 A', 'active', 'published', 'tile', true, '<UUID-ADMIN>'),
         ('ZZ158B', 'Ensayo 158 B', 'inactive', 'published', 'tile', true, '<UUID-ADMIN>'),
         ('ZZ158C', 'Ensayo 158 C', 'active', 'published', 'tile', true, '<UUID-ADMIN>');
insert into ids select 'A', id from erp.products where sku = 'ZZ158A';
insert into ids select 'B', id from erp.products where sku = 'ZZ158B';
insert into ids select 'C', id from erp.products where sku = 'ZZ158C';

set local role authenticated;

-- S. El solicitante (staff del ERP). Como hace la app: inserta el borrador SIN returning (la RLS de
--    lectura no le deja ver su propio borrador) y la solicitud sin product_id, con el SKU en el payload.
set local request.jwt.claims to '{"sub":"<UUID-VENTAS>","role":"authenticated"}';
do $$ declare rid bigint; r erp.product_requests; begin
  -- S1 new: borrador con los campos nuevos de la hoja (sin costo: staff no lo ve).
  insert into erp.products (sku, name, description, status, record_status, product_type, style, color1, price, price_mode, needs_review, review_tags, taxable, created_by)
    values ('ZZ158N', 'OPUSCAR PEBBLES MOSAIC LIGHT 12 X 12 1SF', 'OPUSCAR PEBBLES MOSAIC LIGHT 12 X 12 1SF', 'active', 'draft', 'tile', 'STONE', 'WHITE', 14.99, 'fixed', false, '{}', true, '<UUID-VENTAS>');
  insert into erp.product_requests (type, requester, requester_store, reason, payload)
    values ('new', '<UUID-VENTAS>', 'BRO', 'ensayo S1', '{"sku":"ZZ158N","name":"OPUSCAR PEBBLES MOSAIC LIGHT 12 X 12 1SF"}') returning id into rid;
  insert into ids values ('S1', rid);
  select * into r from erp.product_requests where id = rid;
  raise notice 'S1  new: entra con tienda BRO y requester_status READY por defecto     esperado OK: %', case when r.requester_store = 'BRO' and r.requester_status = 'ready' then 'OK' else 'MAL' end;
  -- S2 copy, NO LISTA, con el origen en el payload; el borrador nace con la etiqueta NOT READY.
  insert into erp.products (sku, name, status, record_status, product_type, needs_review, review_tags, taxable, created_by)
    values ('ZZ158K', 'Copia de ZZ158A', 'active', 'draft', 'tile', true, '{NOT READY}', true, '<UUID-VENTAS>');
  insert into erp.product_requests (type, requester, reason, payload, requester_status)
    values ('copy', '<UUID-VENTAS>', 'ensayo S2', jsonb_build_object('sku', 'ZZ158K', 'copy_source', jsonb_build_object('store','BRO','item_code','ZZ158A','product_id',(select id from ids where k='A'))), 'not_ready')
    returning id into rid;
  insert into ids values ('S2', rid);
  select * into r from erp.product_requests where id = rid;
  raise notice 'S2  copy NO LISTA con copy_source en el payload                         esperado OK: %', case when r.type = 'copy' and r.requester_status = 'not_ready' and r.payload->'copy_source'->>'store' = 'BRO' then 'OK' else 'MAL' end;
  -- S3 discontinue de A, pendiente y READY.
  insert into erp.product_requests (type, product_id, requester, reason) values ('discontinue', (select id from ids where k='A'), '<UUID-VENTAS>', 'ensayo S3') returning id into rid;
  insert into ids values ('S3', rid);
  raise notice 'S3  discontinue entra                                                   esperado OK: %', case when rid is not null then 'OK' else 'MAL' end;
  -- S4/S5 valores fuera del CHECK.
  begin
    insert into erp.product_requests (type, product_id, requester) values ('bogus', (select id from ids where k='A'), '<UUID-VENTAS>');
    raise notice 'S4  un tipo que no es de los seis                                       esperado error: MAL (pasó)';
  exception when check_violation then raise notice 'S4  un tipo que no es de los seis                                       esperado error: OK (%)', left(sqlerrm, 50); end;
  begin
    insert into erp.product_requests (type, product_id, requester, requester_status) values ('edit', (select id from ids where k='A'), '<UUID-VENTAS>', 'maybe');
    raise notice 'S5  un requester_status que no es ready/not_ready                       esperado error: MAL (pasó)';
  exception when check_violation then raise notice 'S5  un requester_status que no es ready/not_ready                       esperado error: OK (%)', left(sqlerrm, 50); end;
  -- S6 el solicitante marca la copia como LISTA.
  perform erp.set_request_ready((select id from ids where k='S2'), true);
  select * into r from erp.product_requests where id = (select id from ids where k='S2');
  raise notice 'S6  marcar lista: requester_status ready                                esperado OK: %', case when r.requester_status = 'ready' then 'OK' else 'MAL '||r.requester_status end;
end $$;
-- S6b la etiqueta NOT READY se fue del borrador (se mira como postgres: el staff no lee borradores).
reset role;
do $$ declare p erp.products; begin
  select * into p from erp.products where sku = 'ZZ158K';
  raise notice 'S6b ...y el borrador queda sin NOT READY ni needs_review                esperado OK: %', case when not ('NOT READY' = any(p.review_tags)) and p.needs_review = false then 'OK' else 'MAL '||p.review_tags::text end;
end $$;
set local role authenticated;
set local request.jwt.claims to '{"sub":"<UUID-VENTAS>","role":"authenticated"}';
do $$ declare r erp.product_requests; begin
  -- S7 y la vuelve a NO LISTA.
  perform erp.set_request_ready((select id from ids where k='S2'), false);
  select * into r from erp.product_requests where id = (select id from ids where k='S2');
  raise notice 'S7  marcar no lista: requester_status not_ready                         esperado OK: %', case when r.requester_status = 'not_ready' then 'OK' else 'MAL' end;
  -- S8 marca S3 como NO LISTA (para M1).
  perform erp.set_request_ready((select id from ids where k='S3'), false);
  select * into r from erp.product_requests where id = (select id from ids where k='S3');
  raise notice 'S8  el discontinue queda NO LISTA                                       esperado OK: %', case when r.requester_status = 'not_ready' then 'OK' else 'MAL' end;
  -- S9 no puede decidir.
  begin
    perform erp.decide_request((select id from ids where k='S3'), true, null);
    raise notice 'S9  staff no decide                                                     esperado 42501: MAL (pasó)';
  exception when insufficient_privilege then raise notice 'S9  staff no decide                                                     esperado 42501: OK'; end;
  -- S10 el vocabulario trae style y color.
  raise notice 'S10 product_vocabulary trae style y color                               esperado OK: %', case when (erp.product_vocabulary() ? 'style') and (erp.product_vocabulary() ? 'color') and jsonb_typeof(erp.product_vocabulary()->'style') = 'array' then 'OK' else 'MAL' end;
end $$;
reset role;
do $$ declare p erp.products; begin
  select * into p from erp.products where sku = 'ZZ158K';
  raise notice 'S7b ...y el borrador vuelve a llevar NOT READY y needs_review           esperado OK: %', case when 'NOT READY' = any(p.review_tags) and p.needs_review then 'OK' else 'MAL '||p.review_tags::text end;
end $$;
set local role authenticated;
set local request.jwt.claims to '{"sub":"<UUID-VENTAS>","role":"authenticated"}';
-- S11 el solicitante lee solo las suyas (las 3 del ensayo).
do $$ declare n int; begin
  select count(*) into n from erp.product_requests;
  raise notice 'S11 el solicitante lee solo sus solicitudes                             esperado 3: %', case when n = 3 then 'OK' else 'MAL '||n end;
end $$;

-- O. Otro usuario sin escalafón del ERP (un sub sin perfil): no marca una solicitud ajena.
set local request.jwt.claims to '{"sub":"00000000-0000-0000-0000-000000000158","role":"authenticated"}';
do $$ begin
  begin
    perform erp.set_request_ready((select id from ids where k='S1'), false);
    raise notice 'O1  otro usuario no marca una solicitud ajena                            esperado 42501: MAL (pasó)';
  exception when insufficient_privilege then raise notice 'O1  otro usuario no marca una solicitud ajena                            esperado 42501: OK'; end;
end $$;

-- M. El ejecutor (gerente del ERP).
set local request.jwt.claims to '{"sub":"<UUID-GERENTE>","role":"authenticated"}';
-- (el gerente no puede `select *` de erp.products: la columna cost está revocada desde la 101; se piden columnas)
do $$ declare r erp.product_requests; p record; rid bigint; n int; begin
  select count(*) into n from erp.product_requests where status = 'pending';
  raise notice 'M0  el gerente ve todas las pendientes                                  esperado >= 3: %', case when n >= 3 then 'OK ('||n||')' else 'MAL '||n end;
  -- M1 aprobar una NO LISTA se rechaza.
  begin
    perform erp.decide_request((select id from ids where k='S3'), true, 'ensayo M1');
    raise notice 'M1  aprobar un discontinue NO LISTA                                     esperado error: MAL (pasó)';
  exception when others then raise notice 'M1  aprobar un discontinue NO LISTA                                     esperado error: OK (%)', left(sqlerrm, 45); end;
  select status, name, description, style, color1, price_mode, price, verified_level, record_status into p from erp.products where id = (select id from ids where k='A');
  raise notice 'M2  ...y el producto no cambió                                          esperado active: %', case when p.status = 'active' then 'OK' else 'MAL '||p.status end;
  -- M3 el gerente la marca lista y la aprueba: discontinued, con existencia o sin ella.
  perform erp.set_request_ready((select id from ids where k='S3'), true);
  perform erp.decide_request((select id from ids where k='S3'), true, 'ensayo M3');
  select * into r from erp.product_requests where id = (select id from ids where k='S3');
  select status, name, description, style, color1, price_mode, price, verified_level, record_status into p from erp.products where id = (select id from ids where k='A');
  raise notice 'M3  aprobar discontinue: producto discontinued, solicitud approved        esperado OK: %', case when p.status = 'discontinued' and r.status = 'approved' and r.decided_by = '<UUID-GERENTE>' and r.decision_note = 'ensayo M3' then 'OK' else 'MAL' end;
  -- M4 edición con las claves nuevas.
  insert into erp.product_requests (type, product_id, requester, reason, payload)
    values ('edit', (select id from ids where k='C'), '<UUID-GERENTE>', 'ensayo M4',
            '{"name":"Ensayo 158 C (ventas)","description":"Ensayo 158 C (compras)","style":"MARBLE","color1":"GRAY","price_mode":"leveled","price":"14.99"}')
    returning id into rid;
  perform erp.decide_request(rid, true, null);
  select status, name, description, style, color1, price_mode, price, verified_level, record_status into p from erp.products where id = (select id from ids where k='C');
  raise notice 'M4  aprobar edit aplica description, style, color1, price_mode, price    esperado OK: %', case when p.name = 'Ensayo 158 C (ventas)' and p.description = 'Ensayo 158 C (compras)' and p.style = 'MARBLE' and p.color1 = 'GRAY' and p.price_mode = 'leveled' and p.price = 14.99 and p.verified_level >= 1 then 'OK' else 'MAL' end;
  -- M5 price_mode fuera de fixed|leveled: la restricción de products lo para.
  insert into erp.product_requests (type, product_id, requester, reason, payload)
    values ('edit', (select id from ids where k='C'), '<UUID-GERENTE>', 'ensayo M5', '{"price_mode":"bad"}') returning id into rid;
  begin
    perform erp.decide_request(rid, true, null);
    raise notice 'M5  aprobar edit con price_mode inválido                                 esperado error: MAL (pasó)';
  exception when check_violation then raise notice 'M5  aprobar edit con price_mode inválido                                 esperado error: OK (%)', left(sqlerrm, 45); end;
  -- M6 rechazar una NO LISTA sí se puede.
  perform erp.decide_request((select id from ids where k='S2'), false, 'ensayo M6');
  select * into r from erp.product_requests where id = (select id from ids where k='S2');
  raise notice 'M6  rechazar una copy NO LISTA                                          esperado rejected: %', case when r.status = 'rejected' and r.decision_note = 'ensayo M6' then 'OK' else 'MAL' end;
  -- M7 deactivate y M8 reactivate siguen como antes.
  insert into erp.product_requests (type, product_id, requester, reason) values ('deactivate', (select id from ids where k='C'), '<UUID-GERENTE>', 'ensayo M7') returning id into rid;
  perform erp.decide_request(rid, true, null);
  select status, name, description, style, color1, price_mode, price, verified_level, record_status into p from erp.products where id = (select id from ids where k='C');
  raise notice 'M7  aprobar deactivate: inactive                                         esperado OK: %', case when p.status = 'inactive' then 'OK' else 'MAL '||p.status end;
  insert into erp.product_requests (type, product_id, requester, reason) values ('reactivate', (select id from ids where k='B'), '<UUID-GERENTE>', 'ensayo M8') returning id into rid;
  perform erp.decide_request(rid, true, null);
  select status, name, description, style, color1, price_mode, price, verified_level, record_status into p from erp.products where id = (select id from ids where k='B');
  raise notice 'M8  aprobar reactivate: active                                           esperado OK: %', case when p.status = 'active' then 'OK' else 'MAL '||p.status end;
  -- M9 decidir dos veces.
  begin
    perform erp.decide_request((select id from ids where k='S3'), true, null);
    raise notice 'M9  decidir una ya aprobada                                             esperado error: MAL (pasó)';
  exception when others then raise notice 'M9  decidir una ya aprobada                                             esperado error: OK (%)', left(sqlerrm, 40); end;
  -- M10 marcar una ya decidida.
  begin
    perform erp.set_request_ready((select id from ids where k='S3'), false);
    raise notice 'M10 marcar lista/no lista una ya decidida                               esperado error: MAL (pasó)';
  exception when others then raise notice 'M10 marcar lista/no lista una ya decidida                               esperado error: OK (%)', left(sqlerrm, 40); end;
  -- M11 aprobar un new READY no publica el borrador (se publica desde el Catálogo).
  perform erp.decide_request((select id from ids where k='S1'), true, 'ensayo M11');
  select status, name, description, style, color1, price_mode, price, verified_level, record_status into p from erp.products where sku = 'ZZ158N';
  raise notice 'M11 aprobar un new no publica el borrador                                esperado draft: %', case when p.record_status = 'draft' then 'OK' else 'MAL '||p.record_status end;
end $$;

-- A. Anónimo.
reset request.jwt.claims;
set local role anon;
do $$ declare n int; begin
  begin
    perform erp.set_request_ready((select id from ids where k='S1'), true);
    raise notice 'A1  anon no ejecuta set_request_ready                                   esperado error: MAL (pasó)';
  exception when others then raise notice 'A1  anon no ejecuta set_request_ready                                   esperado error: OK (%)', left(sqlerrm, 40); end;
  begin
    select count(*) into n from erp.product_requests;
    raise notice 'A2  anon no lee solicitudes                                             esperado 0 o error: %', case when n = 0 then 'OK' else 'MAL '||n end;
  exception when others then raise notice 'A2  anon no lee solicitudes                                             esperado 0 o error: OK (%)', left(sqlerrm, 40); end;
end $$;

-- E. Lo que había, intacto (como postgres).
reset role;
do $$ declare c ctl%rowtype; n int; begin
  select * into c from ctl;
  select count(*) into n from erp.product_requests where coalesce(reason, '') not like 'ensayo %';
  raise notice 'E3  las solicitudes de antes siguen (sin contar las del ensayo)          esperado %: %', c.n_req, case when n = c.n_req then 'OK' else 'MAL '||n end;
  select count(*) into n from erp.products where sku not like 'ZZ158%';
  raise notice 'E4  los productos de antes siguen                                       esperado %: %', c.n_prod, case when n = c.n_prod then 'OK' else 'MAL '||n end;
  select count(*) into n from pg_policy where polrelid = 'erp.product_requests'::regclass;
  raise notice 'E5  product_requests sigue con 3 políticas                              esperado 3: %', case when n = 3 then 'OK' else 'MAL '||n end;
end $$;

ROLLBACK;
```

## 7 · Mediciones de solo lectura (hechas el 2026-09-30; repetirlas antes de aplicar)

```sql
begin read only;
select enumlabel from pg_enum where enumtypid = 'erp.request_type'::regtype order by enumsortorder;          -- new, edit, reactivate, deactivate
select type::text, status::text, count(*) from erp.product_requests group by 1,2;                            -- edit/approved 1, new/pending 331
select count(*) filter (where requester_store is not null) from erp.product_requests;                      -- 0
select md5(pg_get_functiondef('erp.decide_request'::regproc)), md5(pg_get_functiondef('erp.product_vocabulary'::regproc));
                                                                                                             -- 2f0d7da16c9a190634fec8a735492f1c, 3b74d2cbff5d25bc5121611fe90745c0 (= 064)
select n.nspname, c.relname from pg_depend d join pg_class c on c.oid=d.objid join pg_namespace n on n.oid=c.relnamespace
 where d.refobjid='erp.request_type'::regtype and d.deptype='n';                                             -- solo erp.product_requests
select count(*) filter (where description is not null), count(*) filter (where style is not null), count(*) from erp.products;  -- 0, 961, 6859
select count(*), max(name) from public.schema_migrations;                                                    -- 154, 155_encuestas.sql
rollback;
```

## 8 · Reversión

Está al final del `.sql`, para pegar a mano en una transacción propia: (0) decidir qué hacer con las filas `copy`/`discontinue`
que ya existan (el enum viejo no las acepta: pasarlas a `new`/`deactivate` o borrarlas); (1) recrear el enum, quitar el CHECK y
volver la columna a `erp.request_type`; (2) `drop column requester_status`; (3) `drop function set_request_ready`; (4) volver a
pegar los bloques de `decide_request` y `product_vocabulary` de la 064; (5) borrar la fila del registro. La app sin la 158 sigue
funcionando: new/edit/reactivate/deactivate entran; copy, discontinue y «no lista» contestan «migración pendiente».

## 9 · Lo que le toca al orquestador (en este orden)

1. Leer §1 y la entrada `D-453` de `DECISIONS.md` (el mapa columna → campo y lo descartado). Si algo no cuadra, parar aquí.
2. Respaldo (`pg_dump` reciente o respaldo activo). `node scripts/db/migrate-status.mjs` (saldrán la 156, la 157 y la 158
   pendientes).
3. Repetir §7 (solo lectura) y la matriz de §6 con ROLLBACK, con los UUID reales. Esperado: 33 OK.
4. Aplicar `158_erp_solicitud_campos.sql` en una transacción. `migrate-status` después.
5. Numerar la decisión (`D-453` → `D-0XX`), sin tocar el `.sql` (no lleva el número).
6. Probar en vivo con un perfil de staff del ERP (hoy no hay ninguno: los 4 con módulo son admin): una solicitud «no lista»,
   marcarla lista desde «Tus solicitudes recientes», y verla en Aprobaciones con «Aprobar» apagado hasta entonces.

## 10 · Lo que NO se ha medido

- La app contra la 158 **aplicada** (el formulario mandando `copy`/`discontinue`/`not_ready` de verdad): la app se midió con
  pruebas de fuente y la base con la matriz; no las dos juntas.
- El formulario en el navegador (el demo del ERP no existe como el de Entregas: `/erp/request` exige sesión y lee la base).
- La caché de esquema de PostgREST tras aplicar: si `requester_status` tarda en aparecer, el `select *` no la trae y el
  formulario sigue en «migración pendiente» hasta que se recargue (`notify pgrst, 'reload schema'`).
