# Estándar de tablas de RTG Hub

**Regla del dueño (12 nov 2026):** en toda la app —y en cada app nueva— las columnas de una tabla de datos se comportan
como las de la tabla de **Órdenes** de Entregas. No hay «tablas simples» para listas de trabajo.

## Qué trae una tabla estándar

| Función | Cómo se usa | Pieza |
|---|---|---|
| Ordenar y filtrar por valores | ▾ en cada cabecera; barra «Filtrado por… ✕ Limpiar filtros» | `useOrdenYFiltro`, `CabeceraConMenu`, `FiltrosPuestos`, `MenuDeColumnaAbierto` |
| Mostrar / ocultar columnas | ⚙ Columnas | `SelectorDeColumnas` |
| Mover columnas | arrastrar la cabecera; o ↑ ↓ / arrastrar el renglón en ⚙ | `useVistaDeColumnas` |
| Cambiar el ancho | arrastrar el borde; doble clic lo restablece | `useColWidthMap` + `table.tbl-resize` + `.col-resizer` |
| Se recuerda por persona | en su navegador (`rtg:tabla:<id>:vista` y `:anchos`) | `src/lib/tabla-estandar.ts` |
| El mismo aspecto | `table.orders.tbl-resize` dentro de `.tbl-scroll.tbl-fit.tbl-caja` | `globals.css` |

## Cómo se hace una tabla nueva

Usa **`<TablaEstandar>`** (`src/components/TablaEstandar.tsx`): le das columnas y filas, y trae todo lo de arriba.

```tsx
import { TablaEstandar } from "@/components/TablaEstandar";

<TablaEstandar
  id="miapp-pedidos"                      // único en toda la app: con él se guarda la vista de cada persona
  filas={pedidos}
  claveDe={(p) => p.id}
  onFila={(p) => setAbierto(p)}           // abre la ficha EN TARJETA, nunca salta de pantalla
  vacio={t("No orders yet.", "Todavía no hay pedidos.")}
  barra={<BuscadorConBorrar />}           // lo de tu pantalla, a la izquierda del ⚙
  columnas={[
    { key: "folio", en: "Folio", es: "Folio", ancho: 110, fija: true, valor: (p) => p.folio },
    { key: "cliente", en: "Customer", es: "Cliente", ancho: 220, valor: (p) => p.cliente },
    { key: "total", en: "Total", es: "Total", ancho: 110, numerico: true, valor: (p) => p.total, celda: (p) => fmtMoney(p.total) },
    { key: "notas", en: "Notes", es: "Notas", ancho: 260, oculta: true, envuelve: true, valor: (p) => p.notas },
  ]}
  acciones={(p) => <button className="btn btn-sm" onClick={() => imprime(p)}>🖨</button>}
/>
```

- `valor` es lo que ordena y filtra (texto, número o `null`); `celda` es lo que se pinta si no basta el valor.
- `fija`: siempre visible. `oculta`: nace apagada y se prende en ⚙. `numerico`: alinea a la derecha y filtra por número.
- Define `columnas` fuera del componente o con `useMemo` (si cambia en cada pintada, la vista se relee de más).
- Si tu tabla YA tiene su propio marcado con ▾ y anchos, complétala con **`useVistaDeColumnas(id, columnas)`**
  (`src/lib/use-vista-de-columnas.tsx`): te da `visibles`, lo que pide `SelectorDeColumnas` (`selector`) y lo que va en el
  `<th>` para arrastrarlo (`th(key)`). Ejemplos: Empleados y Activos de RR. HH., Central Hub Monitoring.
- En teléfono la tabla se desliza de lado dentro de su caja; si tu pantalla ya tiene una vista de tarjetas para
  teléfono, consérvala.

## Qué NO necesita el estándar

Hojas que se imprimen, matrices (persona × app), vistas previas de importación y tablitas clave/valor de 2–3 columnas.
Cada exención se apunta, con su porqué, en `src/lib/estandar-de-tablas.test.ts`.

## La prueba que lo vigila

`src/lib/estandar-de-tablas.test.ts` revisa cada `.tsx` con una tabla. Una tabla nueva que no use el estándar hace
fallar la prueba (y el CI). La lista de PENDIENTES es deuda conocida: solo puede encoger.

## Inventario (12 nov 2026)

67 archivos del código pintan una tabla con `<table`: **12 cumplen el estándar** (5 con implementación propia y 7 con las piezas comunes), **22 exentas** y **33 pendientes**. Además, **16 tablas usan `<TablaEstandar>` sin `<table` escrito** (las 12 del ERP de PR #857 y 4 de la tanda del 12 nov 2026: Métricas, tiempo del expediente, historial de RR. HH. y Encuestas), que por eso no cuentan arriba.

Convertidas el 12 nov 2026 con `<TablaEstandar>`: Solicitudes de cliente e Historial de tratos (Clientes), «Por
vendedor» y «Por GOV Pool» (Leads), la Bitácora de seguridad del hub (`src/components/SecurityLog.tsx`), el historial de
RR. HH., las tablas de tiempo del expediente, las tres de Métricas de RR. HH. y la de Encuestas (ambas). Completadas
con `useVistaDeColumnas` (ya tenían ▾ y anchos; ganaron ⚙ y mover): Empleados y Activos (RR. HH.), las listas de
Central Hub Monitoring y la lista de cotizaciones del Quote Builder. Productos de la competencia (Quote Builder) tiene ⚙,
mover y anchos, pero no ▾, porque es una tabla de edición. Pendiente por app: Time Tracker 18, Entregas 13, ERP 1
(`review-queue`), Operaciones 1 — se convierten por tandas, empezando por las listas de uso diario.

| App | Archivo | Estado | Nota |
|---|---|---|---|
| Entregas / compartido | `src/components/OrdersTable.tsx` | ✅ estándar (propio) | la tabla de Órdenes: el origen del estándar |
| Entregas | `src/app/(app)/routes/page.tsx` | ✅ estándar (propio) | Gestor de Rutas (D-360/D-379/D-410) |
| Clientes | `src/app/customers/Clientes.tsx` | ✅ estándar (propio) | Clientes: orden en niveles, filtros, ⚙ y anchos propios (D-650) |
| Promos | `src/app/promos/[id]/TablaDeRonda.tsx` | ✅ estándar (propio) | Promos: ronda con ⚙, mover, anchos por rol (D-385) |
| Operaciones | `src/app/operaciones/ListaDeReportes.tsx` | ✅ estándar (propio) | Merma: ▾, ⚙, arrastre (D-1010/D-1016) |
| Clientes | `src/app/customers/SolicitudesDeCliente.tsx` | ✅ estándar |  |
| RR. HH. | `src/app/recruiting/(recruiting)/assets/page.tsx` | ✅ estándar |  |
| RR. HH. | `src/app/recruiting/(recruiting)/employees/page.tsx` | ✅ estándar |  |
| Central Hub Monitoring | `src/app/security/PanelDeSeguridad.tsx` | ✅ estándar |  |
| Entregas / compartido | `src/components/TablaEstandar.tsx` | ✅ estándar |  |
| Quote Builder | `src/app/estimator/HojaCliente.tsx` | ➖ exenta | hoja impresa para el cliente |
| Operaciones | `src/app/operaciones/HojaDeGrupo.tsx` | ➖ exenta | hoja de aprobación (se imprime; trae su ⚙ de hoja) |
| Operaciones | `src/app/operaciones/ColumnasDeHoja.tsx` | ➖ exenta | piezas de la hoja de aprobación |
| Operaciones | `src/app/operaciones/reportes/hoja-de-aprobacion/page.tsx` | ➖ exenta | hoja impresa |
| Operaciones | `src/app/operaciones/conteos/hoja/page.tsx` | ➖ exenta | hoja impresa de conteo |
| Central Hub Monitoring | `src/app/security/PanelDePermisos.tsx` | ➖ exenta | matriz persona × app (no es una lista de columnas) |
| Central Hub Monitoring | `src/app/security/salud/page.tsx` | ➖ exenta | monitor de solo lectura: tablas chicas de cifras |
| Entregas / compartido | `src/components/ImportOrdersModal.tsx` | ➖ exenta | vista previa de importación |
| Entregas / compartido | `src/components/UsersImportModal.tsx` | ➖ exenta | vista previa de importación |
| ERP | `src/components/erp/decisions-upload.tsx` | ➖ exenta | vista previa de carga |
| ERP | `src/components/erp/po-upload.tsx` | ➖ exenta | vista previa de carga |
| ERP | `src/components/erp/po-ingest.tsx` | ➖ exenta | vista previa de carga |
| ERP | `src/components/erp/master-round-trip.tsx` | ➖ exenta | vista previa de carga |
| Entregas / compartido | `src/components/ComparaConLaHoja.tsx` | ➖ exenta | comparación lado a lado (2 columnas fijas) |
| Entregas / compartido | `src/components/FotoDeLaRuta.tsx` | ➖ exenta | imagen de la ruta para compartir (se exporta como PNG) |
| Entregas / compartido | `src/components/RouteEngineSettings.tsx` | ➖ exenta | ajustes clave/valor |
| Entregas / compartido | `src/components/TracksolidSettings.tsx` | ➖ exenta | ajustes clave/valor |
| RR. HH. | `src/components/recruiting/ChecklistDelEmpleado.tsx` | ➖ exenta | checklist dentro del expediente |
| RR. HH. | `src/components/recruiting/QuitFormDelEmpleado.tsx` | ➖ exenta | formulario de baja (se imprime) |
| Clientes | `src/app/customers/HistorialDelCliente.tsx` | ➖ exenta | detalle de cambios campo/antes/después dentro de una tarjeta |
| Entregas | `src/app/(app)/accounts/page.tsx` | ⏳ pendiente |  |
| Entregas | `src/app/(app)/audit/page.tsx` | ⏳ pendiente |  |
| Entregas | `src/app/(app)/dashboard/page.tsx` | ⏳ pendiente |  |
| Entregas | `src/app/(app)/data/page.tsx` | ⏳ pendiente |  |
| Entregas | `src/app/(app)/market/page.tsx` | ⏳ pendiente |  |
| Entregas | `src/app/(app)/settings/page.tsx` | ⏳ pendiente |  |
| Entregas | `src/app/(app)/track/page.tsx` | ⏳ pendiente |  |
| Entregas | `src/app/(app)/warehouse/page.tsx` | ⏳ pendiente |  |
| ERP | `src/app/erp/analytics/categories/page.tsx` | ✅ estándar | PR #857 |
| ERP | `src/app/erp/analytics/vendors/page.tsx` | ✅ estándar | PR #857 |
| ERP | `src/app/erp/purchasing/orders/page.tsx` | ✅ estándar | PR #857 |
| ERP | `src/app/erp/review/daltile/page.tsx` | ✅ estándar | PR #857 |
| Quote Builder | `src/app/estimator/ProductosCompetencia.tsx` | ✅ estándar (sin ▾) | tabla de edición: ⚙, cabeceras que se mueven y anchos; sin ▾ porque cada celda es un campo y la comparación va bajo su fila |
| Quote Builder | `src/app/estimator/TodasLasCotizaciones.tsx` | ✅ estándar | ya tenía ▾ y ganó ⚙, mover cabeceras y anchos (`useVistaDeColumnas`) |
| Operaciones | `src/app/operaciones/KpiDeEntregas.tsx` | ⏳ pendiente |  |
| RR. HH. | `src/app/recruiting/(recruiting)/employees/time-tracker.tsx` | ✅ estándar | semanas y pagos del expediente; los totales van en una línea debajo |
| RR. HH. | `src/app/recruiting/(recruiting)/metrics/page.tsx` | ✅ estándar | tres tablas (fuentes, puestos, proceso); la del proceso ya no pinta el punto de color de cada etapa |
| Encuestas | `src/app/surveys/Encuestas.tsx` | ✅ estándar | dos tablas; en el teléfono siguen siendo tarjetas (`.enc-tabla`) |
| Time Tracker | `src/app/timetracker/(timetracker)/insights/page.tsx` | ⏳ pendiente |  |
| Time Tracker | `src/app/timetracker/(timetracker)/people/page.tsx` | ⏳ pendiente |  |
| Time Tracker | `src/app/timetracker/(timetracker)/requests/page.tsx` | ⏳ pendiente |  |
| Time Tracker | `src/app/timetracker/(timetracker)/team-requests/page.tsx` | ⏳ pendiente |  |
| Time Tracker | `src/app/timetracker/(timetracker)/week/page.tsx` | ⏳ pendiente |  |
| Entregas / compartido | `src/components/PausasDelDia.tsx` | ⏳ pendiente |  |
| Entregas / compartido | `src/components/PlanContraReal.tsx` | ⏳ pendiente |  |
| Entregas / compartido | `src/components/PuntualidadPorChofer.tsx` | ⏳ pendiente |  |
| Entregas / compartido | `src/components/ReportesDeChoferes.tsx` | ⏳ pendiente |  |
| Entregas / compartido | `src/components/RutaDelPlan.tsx` | ⏳ pendiente |  |
| ERP | `src/components/erp/inventory-console.tsx` | ✅ estándar | PR #857 |
| ERP | `src/components/erp/item/qoh-panel.tsx` | ✅ estándar | PR #857 |
| ERP | `src/components/erp/po-reconcile.tsx` | ✅ estándar | PR #857 |
| ERP | `src/components/erp/product-detail.tsx` | ✅ estándar | PR #857 |
| ERP | `src/components/erp/purchasing-groups.tsx` | ✅ estándar | PR #857 |
| ERP | `src/components/erp/receiving.tsx` | ✅ estándar | PR #857 |
| ERP | `src/components/erp/reorder-panel.tsx` | ✅ estándar | PR #857 |
| ERP | `src/components/erp/request-review.tsx` | ➖ exenta | campo / actual / propuesto: tres columnas dentro de una tarjeta |
| ERP | `src/components/erp/review-queue.tsx` | ⏳ pendiente |  |
| ERP | `src/components/erp/uom-assistant.tsx` | ✅ estándar | PR #857 |
| RR. HH. | `src/components/recruiting/HistorialDeRrhh.tsx` | ✅ estándar | historial de RR. HH.; cada variante (todo, empleado, activo) tiene su vista guardada |
| RR. HH. | `src/components/recruiting/ModalHost.tsx` | ➖ exenta | «Comparar candidatos»: matriz atributo × candidato (como la comparación de Entregas) |
| Time Tracker | `src/components/timetracker/AssignmentsPanel.tsx` | ⏳ pendiente |  |
| Time Tracker | `src/components/timetracker/AuditTabs.tsx` | ⏳ pendiente |  |
| Time Tracker | `src/components/timetracker/ClockinApprovals.tsx` | ⏳ pendiente |  |
| Time Tracker | `src/components/timetracker/EmployeeWeek.tsx` | ⏳ pendiente |  |
| Time Tracker | `src/components/timetracker/FichajesDeHoy.tsx` | ⏳ pendiente |  |
| Time Tracker | `src/components/timetracker/GeofenceSection.tsx` | ⏳ pendiente |  |
| Time Tracker | `src/components/timetracker/ManagerReports.tsx` | ⏳ pendiente |  |
| Time Tracker | `src/components/timetracker/MySections.tsx` | ⏳ pendiente |  |
| Time Tracker | `src/components/timetracker/PayrollTimesheets.tsx` | ⏳ pendiente |  |
| Time Tracker | `src/components/timetracker/ScheduleWeek.tsx` | ⏳ pendiente |  |
| Time Tracker | `src/components/timetracker/TimeOffRequests.tsx` | ⏳ pendiente |  |
| Time Tracker | `src/components/timetracker/TripPanel.tsx` | ⏳ pendiente |  |
| Time Tracker | `src/components/timetracker/VehiclesSection.tsx` | ⏳ pendiente |  |
