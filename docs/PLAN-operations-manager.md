# Plan — «Operations Manager»: todas las apps como gerente, menos Usuarios y RR. HH.

**Estado:** PLAN EN PAPEL. Nada implementado, nada aplicado, ninguna escritura en la base.
**Fecha:** 2026-10-15 · **Pedido por:** el dueño, ese mismo día, literal:
*«quiero vrees un operation manager view que tendra cceso a todas las appas como maanager excepto a
los usuarios y su info y al rrhh app»*.
**Patrón:** `docs/PLAN-A-2a-profiles-rls.md` (inventario → opciones → matriz con ROLLBACK → reversión).

Todas las citas son `archivo:línea` contra `main` en `3e2c69ba` (D-558, migración 175). Las del
SQL son **la última migración que define el objeto**, no la primera.

---

## 0. Lo que hay que saber antes de leer nada más

**«Manager» no es un rol: son cuatro columnas distintas**, una por app, y no se heredan entre sí.

| Columna | Valores | Dónde se fija | Qué decide |
|---|---|---|---|
| `profiles.role` | admin, manager, sales, warehouse, driver, logistics, accounting | **Sin CHECK ni enum en la base** (`supabase/roles.sql:10`, `text not null default 'sales'`). La única lista es la del código: `src/lib/types.ts:2` y `src/app/api/invite/route.ts:7` | Entregas, y lo de rol en Promos, Leads, Encuestas, Directorio, Puntos y las herramientas del hub |
| `erp_role` | staff, manager, admin | `101_erp_role_and_cost.sql:28-30` (`profiles_erp_role_known`, NOT VALID) | ERP (D-181, D-228: ya **no** mira `profiles.role`) |
| `timetracker_role` | admin, manager, employee | `089_store_manager.sql:21-23` | Time Tracker y fichaje (`clockin.auth_is_manager()`, `089:74`) |
| `recruiting_role` | admin, manager, recruiter | `055_recruiting_access.sql:27-28` | RR. HH. (entrar **y** el expediente) |

Y aparte, `module_access text[]` (`profiles_module_access_known`, `162_leads.sql:43-45`: deliveries,
recruiting, timetracker, erp, promos, estimator, surveys, leads) decide **si se entra** a cada app.

En Entregas, `manager` se enseña como **«Office Manager / Gerente de Oficina»**
(`src/lib/constants.ts:213`) — no es el «gerente de tienda» de Time Tracker (D-127), aunque se
llamen igual.

**Consecuencia directa:** «acceso a todas las apps como manager» ya se puede expresar **hoy**,
sin código, poniendo la palabra `manager` en cada una de las columnas — ver opción A.

---

## 1. Qué ve y hace hoy `manager`, app por app

### 1.1 Entradas (quién pasa la puerta)

Nada filtra rutas por rol en el middleware (`src/lib/constants.ts:157`; `src/middleware.ts:21` solo
mira la sesión). Cada app se cierra en su `layout` del servidor y en RLS.

| App | Puerta | ¿Entra el manager por su rol? |
|---|---|---|
| Entregas `(app)` | sin chequeo de módulo en el layout; cada pestaña por rol (`src/components/TabGate.tsx:26`, `canOpenTab` en `constants.ts:163`); los datos por `has_deliveries_access()` (`083:24`) y las APIs por `src/lib/api-auth.ts:69` | Las pestañas, sí; los **datos**, solo con `deliveries` en `module_access` |
| ERP | `src/app/erp/layout.tsx:51` (`admin` o `erp` concedido) | No: módulo. Dentro manda `erp_role` (`src/lib/erp/auth.ts:92-104`) |
| RR. HH. | `src/app/recruiting/(recruiting)/layout.tsx:63` (`recruiting_role` no nulo) | No. **Ni siquiera mira `module_access`**: sin `recruiting_role`, fuera |
| Time Tracker | `src/app/timetracker/(timetracker)/layout.tsx:63` (`timetracker_role` no nulo) | No: lo decide `timetracker_role` |
| Quote Builder | `src/app/estimator/layout.tsx:53` | No: módulo |
| Promos | `src/app/promos/layout.tsx:53` | Entra por módulo; decide por rol (ver abajo) |
| Encuestas | `src/app/surveys/layout.tsx:47` | Entra por módulo |
| Leads | `src/app/leads/layout.tsx:47` | Entra por módulo; alcance por rol + permiso |
| Hub `/home`, Mapa | `canReachHub` (`constants.ts:338-341`; `src/app/home/page.tsx:64`, `src/app/home/mapa/page.tsx:29`) | Sí: todo el que no es chofer (Directorio, Tutoriales y Mi ayuda son `visible: () => true`) |

### 1.2 Dentro de cada app

**Entregas** (`profiles.role = 'manager'`):
- Capacidades: `create`, `approve`, `dashboard` (`constants.ts:934`); admin tiene las 8 (`:933`).
- Pestañas: Órdenes, Panel, Cuentas, Ruta de hoy, Auditoría, Recorrido (`constants.ts:98-141`).
  **No**: Mercado, Almacén, Chofer, Inspección, **Gestor de Rutas** (logistics/admin, `:120`),
  Datos, Resumen. Ajustes es solo admin (`src/app/(app)/settings/page.tsx:26`).
- En la base (`guard_delivery_stage`, `173_reprogramar_orden.sql:50`): crea en draft/pending/approved
  (`:128-130`), edita (`:226`), aprueba/rechaza (`:253-258`), cancela con motivo (`:241`), entrega ya
  y deshace un paso (`:264-271`), y **solo él** hace la bodega approved→fulfilling→ready→picked_up
  (`:275-278`, D-397). Reprograma (`reprogramar_orden`, `173:343`), parte/junta cargas
  (`puede_partir_cargas`, `157:286`), borra borradores de su tienda (política «deliveries delete»,
  `131:195`, alterada `142:457`).
- Lee: GPS de la flota (`043:48`/`121:31`), pausas del chofer (`167:76`), ajustes de choferes
  (`128:89`), candados y planes de ruta (`149:76`, `133:265`) — **solo lectura**; escribir rutas es
  de admin/logística.
- **Alcance por tienda:** la lista de Órdenes va cortada a su tienda y su grupo **siempre**
  (`ROLES_LISTA_DE_SU_TIENDA`, `src/lib/ordenes-visibles.ts:242`, D-405), el Panel también
  (`alcanceDelPanel`, `src/lib/panel-por-tienda.ts:42`, D-396), y **sin tienda no ve nada** (D-237).
  En la base, `tiendas_visibles()` (`131:134`) le pone el techo de `visible_stores` si lo tiene.

**ERP** (`erp_role = 'manager'`): ve el costo (`erp.can_see_cost()`, `064:726`), lee la auditoría y
las solicitudes, edita productos y alias (políticas `066:153,167,171,191`, `070:174`), y pasa el
guard `not in ('admin','manager')` de ~54 RPC de la 064 (tres redefinidas en `158:67,111,177`).
Publicar producto es solo admin (`064:1484`).

**Time Tracker** (`timetracker_role = 'manager'`): en la pantalla de Time Tracker **ve la del
empleado** — todas las pantallas de equipo exigen `admin` (`payroll/page.tsx:71`, `live/page.tsx:72`,
`people`, `projects`, `settings`, `team-requests`, `insights`, `assignments`, `audit`). En **fichaje**
sí es gerente: horarios, informes, excepciones, tiempo libre, vehículos, acotado a su tienda +
`extra_store_ids` (`src/lib/clockin/scope.ts:64`, `src/lib/clockin/managerCtx.ts:61-103`; políticas de
`074` re-expresadas en `080:130-219`, todas por `clockin.auth_is_manager()`).
- **Nómina y talones: NO.** `timetracker.pay_rates` y `timetracker.paystubs` son FOR ALL con
  `is_timetracker_admin()` (`170_talones_de_pago.sql:64-73`), que es `timetracker_role = 'admin'` a
  secas (`058:62`). `payrolls`, `sessions`, `requests`, `screenshots`: admin o la propia fila (`060:58-79`).

**RR. HH.** (`recruiting_role = 'manager'`): ve la pestaña Empleados
(`src/lib/recruiting/constants.ts:55`) y lee/escribe **expedientes y documentos**
(`094_hr_files_manager_only.sql:19-27`; acción de servidor `src/app/recruiting/actions/hr.ts:30`),
ajustes de RR. HH. (`100:47-52`) y el cubo `hr-docs` (`096:41-50`). Enlazar cuenta y preguntas:
solo admin de RR. HH. (`hr.ts:182`, `111:89`).

**Leads:** con el permiso `leads_all_stores` ve los leads de todas las tiendas
(`leads_scope_all()`, `163:53`; cliente `src/lib/leads/alcance.ts:40,49`). Sin él, la suya.
**Quote Builder:** ningún privilegio de gerente (políticas `148:251-293`); «Todas las cotizaciones»
es solo admin (D-476). **Promos:** decide en su grupo (`promo_is_decider()`, `140:97`); costo y
columnas privadas solo admin (`143:21`). **Encuestas:** entra por módulo; además lee
`delivery_surveys` (`151:118`) y ve la tarjeta del Panel (`src/lib/encuesta.ts:45`).
**Puntos:** ve todos y da puntos manuales (`105:86,97,165`). **Directorio:** ve también el grupo
«remote» (`phone_book()`, `117:112,138`).

**Herramientas del hub:**

| Herramienta | ¿Manager? | Puerta |
|---|---|---|
| Usuarios | **No** | `HUB_TOOLS` `constants.ts:599`; `src/app/home/users/layout.tsx:51` |
| Solicitudes de ayuda (todas) | No | `constants.ts:651`; `src/app/home/solicitudes-de-ayuda/layout.tsx:28` |
| Cambiar de usuario / Vista móvil | No | `soloAdminReal`, `constants.ts:665,675` |
| Directorio, Tutoriales, Mi ayuda, Personalizar, Perfil, Mapa | Sí | solo sesión |
| Auditoría de Entregas | Sí | pestaña `audit`, `constants.ts:132` |

---

## 2. Usuarios y su información: dónde viven y si el manager llega

**La pantalla de Usuarios ya es solo del admin, en cuatro capas**, y un manager hoy no la ve:

1. Tarjeta del hub: `constants.ts:599` (`me.role === "admin"`).
2. Layout del servidor: `src/app/home/users/layout.tsx:51` → redirige a cualquier no admin.
   `/recruiting/users` solo redirige ahí (D-207).
3. Rutas API, todas con chequeo admin en el servidor: `api/invite/route.ts:32`,
   `api/delete-user/route.ts:20`, `api/reset-password/route.ts:39`, `api/user-identity/route.ts:34`
   (GET) y `:61` (PATCH), `api/impersonate/route.ts:65-71`; y el reset de clave de fichaje
   `src/app/timetracker/clock-in/actions/team.ts:230`.
4. La base: `profiles update self or admin` (`099:51`) y los guards de columnas privilegiadas
   (`guard_role_change` `roles.sql:21`, `guard_profile_privileged_columns` `131:100`, y los de
   acceso por módulo `055:55`, `058:71`, `062:50`, `087:45`). Ninguno tiene rama de manager.

**Lo que SÍ queda a la vista de cualquier usuario con sesión, manager o no:**
- `public.profiles` se lee entera por la API: `profiles select … using (true)` (`099:39`). Es el
  residuo conocido A-2g (nombre, usuario, rol, tienda, `permissions`, `module_access`). No es de
  gerente: lo tiene **todo el mundo**. Cerrarlo es otro encargo, y el propio A-2a explica por qué no
  se pudo (`docs/PLAN-A-2a-profiles-rls.md` §1).
- El Directorio (teléfono y extensión de las personas activas); el manager ve además el grupo
  «remote» (`117:138`).

**Lo que es «info de empleados» de verdad y su puerta:**
- Expediente y documentos de RR. HH.: `recruiting_role` admin/manager (`094:19-27`, `096:41-50`).
- Nómina y talones: `timetracker_role = 'admin'` (`170:64-73`, `payroll/page.tsx:71`).
- Fichajes, horarios, excepciones de su tienda: `timetracker_role` manager (`089:74`).

---

## 3. Las dos opciones

### Opción A — sin rol nuevo: un perfil configurado

**Qué es.** A la persona se le pone, desde el diálogo de Usuarios (lo hace el admin, sin código):

| Columna | Valor |
|---|---|
| `role` | `manager` |
| `module_access` | deliveries, erp, timetracker, estimator, promos, surveys, leads — **sin `recruiting`** |
| `erp_role` | `manager` |
| `timetracker_role` | `manager` (o `employee`, ver P3) |
| `recruiting_role` | **nulo** → RR. HH. cerrado en la puerta y en la base (`094`) |
| `store` | su tienda (sin tienda no ve nada en Entregas, D-237) |
| `permissions` | `leads_all_stores` si debe ver leads de todas |
| `extra_store_ids` (fichaje) | las tiendas que supervise |

**«Quitar a manager lo de usuarios»: no hay nada que quitar.** Ya no lo tiene (§2). Por lo tanto
**A no toca a ningún otro manager**: no cambia código, ni políticas, ni el rol de nadie más.

**Coste:** 0 líneas de código, 0 migraciones, 0 versiones. 5 minutos en el diálogo.
**Reversión:** desmarcar en el mismo diálogo (queda en `security_events`, D-039).

**Lo que A NO da** — y es lo que hay que preguntarle al dueño:
1. **Una sola tienda (y su grupo).** Órdenes y Panel le cortan a su tienda siempre
   (`ordenes-visibles.ts:242`, `panel-por-tienda.ts:26,42`). Un gerente de *operaciones* suena a
   «todas las tiendas», y eso un `manager` hoy no lo puede tener.
2. **Ni Gestor de Rutas, ni Almacén, ni Ajustes** (`constants.ts:104-121`): son de logística/admin.
   «Como manager» no los incluye; si los quiere, ya no es «como manager».
3. En Time Tracker, como `manager`, ve la pantalla del empleado y el fichaje de gerente, **no** el
   equipo ni la nómina.
4. En Quote Builder ve lo suyo, no «Todas las cotizaciones» (D-476).
5. En la lista de Usuarios saldrá como «Office Manager». No hay un rótulo «Operations Manager»
   (salvo el título libre de T-0044, `profiles.title`, que es solo etiqueta).

### Opción A+ — A, más un permiso suelto «todas las tiendas»

Si la respuesta a la pregunta 1 es «todas las tiendas», el camino barato no es un rol nuevo: es un
permiso por persona en `profiles.permissions`, como ya existe `leads_all_stores`
(`src/lib/leads/alcance.ts:17`). `permissions` ya está protegido por el guard (`131:100`), así que
solo el admin lo concede.

Sitios a tocar (medido):
- `src/lib/panel-por-tienda.ts:42` (`alcanceDelPanel`): con el permiso → `{ tipo: "todas" }`.
- `src/lib/ordenes-visibles.ts:261` (`alcanceDeLaLista`): lo hereda de la anterior.
- `src/lib/constants.ts` (`CAPABILITIES`/diálogo): la casilla.
- Base: **ninguno para leer órdenes** — `tiendas_visibles()` (`131:134`) ya devuelve `null` (todas)
  si `visible_stores` está vacío. Para **borrar borradores** de otras tiendas haría falta tocar
  `orden_de_mis_tiendas` (`142:82`); para **decidir promos** de otros grupos, `promo_is_decider()`
  (`140:97`). Ambos opcionales: pregunta P2.
- Fichaje: `extra_store_ids` ya existe (D-127). Leads: `leads_all_stores` ya existe.

Coste: ~3 ficheros de cliente + pruebas; migración solo si P2 dice que sí. Sube `deliveries`.

### Opción B — rol nuevo `operations` en `profiles.role`

**Qué es.** Un octavo valor de `profiles.role` que vale como `manager` en todos los checks de
Entregas/hub, más lo que se decida (todas las tiendas, Gestor de Rutas…), y que **no** abre
Usuarios ni RR. HH. — aunque eso ya lo garantizan las columnas de §2 sin hacer nada.

Nota: B **solo** cambia `profiles.role`. ERP, Time Tracker y RR. HH. tienen su propia columna;
para ellos B no aporta nada que A no dé.

#### B.1 Inventario — cliente y API (`src/`, sin pruebas)

Comparaciones directas con `"manager"` sobre `profiles.role`: **~45 sitios lógicos** (52 con tipo,
demo y rótulos). Cada uno exige decidir «¿operations hereda?».

- **Obligatorios por `tsc`** (`Record<UserRole, …>` completo): `ROLE_INFO` `constants.ts:211`,
  `DEFAULT_PERMISSIONS` `:819`, `ROLE_CAPS` `:932`, `ROLE_INFO` de recruiting
  `src/lib/recruiting/constants.ts:81`; el tipo `src/lib/types.ts:2`; `ROLE_ORDER` `constants.ts:362`;
  la lista de alta `src/app/api/invite/route.ts:7`; el mapeo CSV `src/components/UsersImportModal.tsx:22`.
- **Pestañas** (`constants.ts:98,99,100,108,132,141`) y filtros (`:53`).
- **Reglas de órdenes:** `gerenteHaceBodega` `constants.ts:1336`, `ordersLikeOfficeManager` `:1353`
  (y sus usos en `:1255,1282,1313,1379`, `src/components/OrderModal.tsx:353,1488,2757,2810,2840,2846`,
  `src/lib/acciones-de-la-ficha.ts:170`, `src/lib/deshacer-y-borrar.ts:81`, `src/lib/sales-reps.ts:95`),
  `src/lib/enviar-borrador.ts:44`, `src/lib/juntar-intertienda.ts:90`, `src/lib/reprogramar-orden.ts:27`,
  `src/lib/order-sites.ts:126`, `src/lib/sales-reps.ts:50`.
- **Pantalla de Órdenes** `src/app/(app)/page.tsx:70,160,522,812,844,851,907`;
  `src/components/OrderModal.tsx:1872`; `src/components/TopBar.tsx:78`;
  `src/components/PendingDeadlineWatcher.tsx:54`; `src/lib/notifications.ts:55`.
- **Alcance:** `src/lib/ordenes-visibles.ts:242`, `src/lib/panel-por-tienda.ts:26`,
  `src/lib/gestor/choferes-por-tienda.ts:39`.
- **Otras apps por rol:** `src/lib/promos/tabla.ts:480`, `src/lib/leads/alcance.ts:40`
  (y `constants.ts:1170`), `src/lib/encuesta.ts:45`, `src/lib/points.ts:88`,
  `src/lib/user-prefs.ts:39,74`.
- **Servidor:** `src/app/api/puntualidad/route.ts:27,42` (la única puerta de servidor que concede a
  manager).
- Más los usos indirectos por `hasCap`/`ROLE_CAPS` (p. ej. `canApprove`,
  `OrderModal.tsx:2702`, `acciones-de-la-ficha.ts:217,225`), que heredan solos si `ROLE_CAPS` se
  copia.

#### B.2 Inventario — SQL vigente con `profiles.role = 'manager'` (16 objetos)

| # | Objeto | Definición vigente | Qué le da al manager |
|---|---|---|---|
| 1 | `guard_delivery_stage()` (trigger `deliveries_guard_stage`) | `173_reprogramar_orden.sql:50` (11 menciones) | crear, editar, aprobar, cancelar, entregar ya, deshacer, bodega |
| 2 | `reprogramar_orden()` | `173:312` (`:343`) | reprogramar |
| 3 | `puede_partir_cargas()` | `157:286` | partir/repartir/juntar cargas |
| 4 | política «deliveries delete» | `131:195`, alterada `142:457` | borrar borradores de su tienda |
| 5 | política «read fleet locations» (`driver_locations`) | `043:48`, alterada `121:31` | GPS |
| 6 | política «pausas select» | `167:76` | pausas del chofer |
| 7 | política «driver_settings select» | `128:89` | leer |
| 8 | política «route_locks select» | `149:76` | leer |
| 9 | política «route_plans select» | `133:265` (stops por el plan, `:287`) | leer |
| 10 | política «delivery_surveys select» | `151:118` | leer encuestas de entrega |
| 11 | política «point_events select» | `105:86` | ver todos los puntos |
| 12 | política «point_events insert manual» | `105:97` | dar puntos |
| 13 | `point_balance(target)` | `105:165` | saldo de cualquiera |
| 14 | `leads_scope_all()` | `163:53` (+ el UPDATE único `163:181`) | leads de todas con permiso |
| 15 | `promo_is_decider()` | `140:97` | decidir promos de su grupo |
| 16 | `phone_book()` | `117:30` (`:112,138`) | grupo «remote» del Directorio |

Y uno que no nombra a manager pero decide su alcance: `tiendas_visibles()` (`131:134`) — si
`operations` debe ver todas las tiendas, va en la rama `null`.

Implícitos que **no** hay que tocar: «auth read deliveries» (`131:207`, rama `else true`) y
«driver_day_bases select» (`166:90`, todo no chofer).

#### B.3 La migración (esbozo, NO escrita como `.sql`)

```sql
-- NNN_rol_operations.sql — esbozo
-- 1. Un helper, para no volver a escribir la lista de gerentes 16 veces:
create or replace function public.es_gerente(r text)
  returns boolean language sql immutable as $$ select r in ('manager','operations') $$;

-- 2. Redefinir los 16 objetos de B.2 copiando SU ÚLTIMA definición (no la primera) y
--    sustituyendo cada  r = 'manager' / r in (...'manager'...)  por  public.es_gerente(r) / la lista
--    con 'operations'. guard_delivery_stage se copia ENTERO desde 173:50.
-- 3. tiendas_visibles(): añadir 'operations' a la rama null SOLO si P1 = todas las tiendas.
-- 4. (Opcional) poner por fin un CHECK en profiles.role, NOT VALID primero:
--    alter table public.profiles add constraint profiles_role_known check (role in
--    ('admin','manager','sales','warehouse','driver','logistics','accounting','operations')) not valid;
-- @ledger-below
```

**Riesgos de B:**
- `guard_delivery_stage` lleva ~19 redefiniciones; copiarla entera es donde se cuela un error. Los
  bloques de autocomprobación de `125, 143, 145-147, 157, 168, 169` buscan el texto literal
  `'manager'` en su cuerpo: no se re-ejecutan (ya están aplicadas), pero **las próximas** migraciones
  que copien el guard deben saber que ahora hay dos nombres.
- ~45 decisiones de cliente, una por sitio. Un olvido no rompe nada visible: el operations
  simplemente «no puede» en esa pantalla, que es el fallo que parece un bug (D-127).
- `profiles.role` sin CHECK: un valor mal escrito en el alta entra sin error. B es la ocasión de
  poner el CHECK, pero el CHECK es en sí un cambio de esquema con su propio riesgo.
- «Ver como» del admin (`viewAs`, `src/lib/data-provider.tsx:305-321`): `me.role` pasa a ser el rol
  que el admin mira, así que cada check de cliente también salta para un admin que mira «como
  manager»; `operations` tiene que entrar en ese selector o el admin no podrá probarlo.

**Coste estimado:** 1 migración (16 objetos + helper), ~45 sitios de cliente, las pruebas que fijan
listas de roles (89 ficheros `*.test.ts` citan `"manager"`; no todos fijan listas) (p. ej. `src/lib/juntar-y-reprogramar.test.ts:152`,
`src/lib/barra-de-entregas.test.ts:21`, `src/lib/history-window.test.ts:54`), DECISIONS + Notion.
Sube `deliveries` (y `package.json`).

#### B.4 Matriz de pruebas por rol — con `ROLLBACK`, antes de aplicar

Contra producción, en una transacción que termina en `rollback`, haciéndose pasar por cada rol
(`set local role authenticated; set local request.jwt.claims = '{"sub":"<uuid>","role":"authenticated"}'`).
Para `operations`, dentro de la misma transacción: `update public.profiles set role='operations'
where id='<uuid-de-prueba>'` (lo deshace el `rollback`). **Ninguna prueba toca SMS, llamadas ni
correos** (regla permanente): solo SQL. Se corre dos veces: con el esquema de hoy (operations debe
salir ⛔ en todo, porque ningún objeto lo nombra) y con la migración dentro de la transacción.

Leyenda: ✅ permitido esperado · ⛔ bloqueado esperado.

| Acción \ Rol | sales | manager | **operations** | admin |
|---|---|---|---|---|
| Crear orden en `approved` | ⛔ | ✅ | ✅ | ✅ |
| Aprobar pending→approved | ⛔ | ✅ | ✅ | ✅ |
| Bodega approved→fulfilling | ⛔ | ✅ | ✅ | ✅ |
| `reprogramar_orden` sobre una `ready` | ⛔ | ✅ | ✅ | ✅ |
| `puede_partir_cargas()` | ⛔ | ✅ | ✅ | ✅ |
| DELETE de un borrador de su tienda | ⛔* | ✅ | ✅ | ✅ |
| DELETE de un borrador de OTRA tienda | ⛔ | ⛔ | según P2 | ✅ |
| SELECT `driver_locations` (todas) | ⛔ | ✅ | ✅ | ✅ |
| SELECT `route_plans` | ⛔ | ✅ | ✅ | ✅ |
| INSERT/UPDATE `route_plans` | ⛔ | ⛔ | según P4 | ✅ |
| SELECT `delivery_surveys` | ⛔ | ✅ | ✅ | ✅ |
| INSERT `point_events` manual a otro | ⛔ | ✅ | ✅ | ✅ |
| `promo_is_decider()` en su grupo | ⛔ | ✅ | ✅ | ✅ |
| `phone_book()` incluye «remote» | ⛔ | ✅ | ✅ | ✅ |
| `tiendas_visibles()` | — | techo | `null` si P1 | `null` |
| **UPDATE `role`/`module_access` de otro perfil** | ⛔ | ⛔ | **⛔** | ✅ |
| **UPDATE `recruiting_role` propio** | ⛔ | ⛔ | **⛔** | ✅ |
| **SELECT `recruiting.employee_files`** (sin `recruiting_role`) | ⛔ | ⛔ | **⛔** | ✅** |
| **SELECT `timetracker.paystubs`** | ⛔ | ⛔ | **⛔** | según `timetracker_role` |

\* sales borra sus propios borradores por otra rama de la política; la fila de prueba debe ser de
otro vendedor. \*\* el admin de Entregas lee el expediente solo si además es admin/manager de RR. HH.

Las cuatro filas en negrita son las que el dueño pidió que NO tenga: tienen que salir ⛔ **antes y
después**, y no dependen de B (las cierran `099:51`, los guards de §2, `094` y `170`).

#### B.5 Reversión

Prerrequisito: `pg_dump` de `public.profiles` y captura de `pg_get_functiondef` / `pg_policies` de
los 16 objetos justo antes de aplicar, en `D:\CLAUDE` (memoria «Todo se guarda en D:»).

```sql
begin;
-- 1. Nadie se queda con un rol que la base ya no entiende:
update public.profiles set role = 'manager' where role = 'operations';
-- 2. Quitar el CHECK si se puso:
alter table public.profiles drop constraint if exists profiles_role_known;
-- 3. Volver a ejecutar, tal cual, las definiciones capturadas en el prerrequisito (las vigentes hoy:
--    173:50, 173:312, 157:286, 131:195+142:457, 043:48+121:31, 167:76, 128:89, 149:76, 133:265,
--    151:118, 105:86, 105:97, 105:165, 163:53, 140:97, 117:30, 131:134).
-- 4. drop function if exists public.es_gerente(text);
commit;
```

Y el código: revertir el commit (los perfiles ya volvieron a `manager` en el paso 1).

---

## 4. Recomendación

**Opción A hoy, y A+ si el dueño contesta «todas las tiendas».** B solo si pide cosas que un
`manager` no tiene y que no son de tienda (Gestor de Rutas, Ajustes, Almacén…).

Razones, medidas:
- Lo que pide excluir **ya está excluido** para cualquier manager: Usuarios es admin en cuatro capas
  (§2) y RR. HH. se cierra con `recruiting_role` nulo, en la puerta (`layout.tsx:63`) y en la base
  (`094`). No hay nada que quitar, así que A no afecta a ningún otro manager.
- «Todas las apps como manager» es poner `manager` en las cuatro columnas de §0. Eso no necesita
  código.
- B cuesta 16 objetos SQL (uno de ellos el guard más delicado del repo) y ~45 decisiones de cliente
  para dar, en Entregas, lo mismo que ya da `manager` — salvo el alcance por tienda, que A+ resuelve
  con 3 ficheros y sin migración.

## 5. Preguntas que solo el dueño puede contestar

- **P0. ¿A quién se le asigna?** Nombre de la persona (o personas). Si es una sola, A es claramente
  suficiente; si va a ser un puesto con varios, se puede valorar B por el rótulo propio.
- **P1. ¿Ve todas las tiendas o una tienda y su grupo?** Es la diferencia entre A y A+.
- **P2.** Si todas: ¿también **borra borradores** y **decide promos** de cualquier tienda/grupo, o
  solo lo ve?
- **P3. Time Tracker:** ¿`manager` (horarios, informes, excepciones, tiempo libre y vehículos del
  fichaje de sus tiendas) o `employee` (solo lo suyo)? ¿Debe ver **nómina y talones**? Hoy eso es
  solo `timetracker_role = 'admin'`, que además le daría todo el equipo; si dice que sí a nómina
  pero no a lo demás, eso sí es un cambio de código.
- **P4.** «Como manager» en Entregas, ¿incluye el **Gestor de Rutas**, Almacén o Ajustes? Hoy no son
  de manager. Si los quiere → B (o darle `logistics`, que es otro rol con otro alcance).
- **P5. «Su info» de los usuarios:** ¿le basta con que no entre a Usuarios ni a RR. HH.? Hoy
  cualquier usuario con sesión lee nombre, rol y tienda de todos por la API (`099:39`) y ve el
  Directorio; cerrar eso es para todos, no solo para él.
- **P6. ERP:** ¿`manager` (ve costos) o `staff`? Ver el costo es la frontera de D-181.
- **P7. Rótulo:** ¿le importa que salga «Office Manager» en la lista, o quiere ver «Operations
  Manager»? (Con A se puede poner como título libre, `profiles.title`.)

## 6. No medido

- Nada contra la base: ni un `select` de cuántos `manager` hay hoy, ni la matriz de B.4 (este
  encargo prohíbe escribir en la base, y un worktree no lleva `.env.local`).
- Nada en navegador: cómo se ve un manager con todos los módulos marcados.
- El inventario SQL sale de leer las migraciones, no de `pg_get_functiondef` en producción. Si algo
  se aplicó a mano fuera de una migración, aquí no está; `migrate-status` antes de B lo diría.
