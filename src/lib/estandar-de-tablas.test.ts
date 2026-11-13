import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * EL ESTÁNDAR DE TABLAS (dueño, 12 nov 2026; guía en docs/ESTANDAR-DE-TABLAS.md): toda tabla de datos usa el sistema
 * de columnas de Órdenes. Esta prueba mira cada `.tsx` de `src/` que pinta una tabla y exige que:
 *   · use `TablaEstandar` o `useVistaDeColumnas` (el estándar), o
 *   · esté en PROPIO (ya lo cumple con su propia implementación), o
 *   · esté en EXENTAS (con su porqué), o
 *   · esté en PENDIENTES (deuda conocida: se va vaciando; NO se le agrega nada nuevo).
 * Una tabla NUEVA que no use el estándar hace fallar esta prueba: úsalo, o justifica la exención aquí.
 */
const PROPIO: readonly string[] = [
  "src/components/OrdersTable.tsx", // la tabla de Órdenes: el origen del estándar
  "src/app/(app)/routes/page.tsx", // Gestor de Rutas (D-360/D-379/D-410)
  "src/app/customers/Clientes.tsx", // Clientes: orden en niveles, filtros, ⚙ y anchos propios (D-650)
  "src/app/promos/[id]/TablaDeRonda.tsx", // Promos: ronda con ⚙, mover, anchos por rol (D-385)
  "src/app/operaciones/ListaDeReportes.tsx", // Merma: ▾, ⚙, arrastre (D-1010/D-1016)
];
const EXENTAS: readonly string[] = [
  "src/app/estimator/HojaCliente.tsx", // hoja impresa para el cliente
  "src/app/operaciones/HojaDeGrupo.tsx", // hoja de aprobación (se imprime; trae su ⚙ de hoja)
  "src/app/operaciones/ColumnasDeHoja.tsx", // piezas de la hoja de aprobación
  "src/app/operaciones/reportes/hoja-de-aprobacion/page.tsx", // hoja impresa
  "src/app/operaciones/conteos/hoja/page.tsx", // hoja impresa de conteo
  "src/app/security/PanelDePermisos.tsx", // matriz persona × app (no es una lista de columnas)
  "src/app/security/salud/page.tsx", // monitor de solo lectura: tablas chicas de cifras
  "src/components/ImportOrdersModal.tsx", // vista previa de importación
  "src/components/UsersImportModal.tsx", // vista previa de importación
  "src/components/erp/decisions-upload.tsx", // vista previa de carga
  "src/components/erp/po-upload.tsx", // vista previa de carga
  "src/components/erp/po-ingest.tsx", // vista previa de carga
  "src/components/erp/master-round-trip.tsx", // vista previa de carga
  "src/components/erp/request-review.tsx", // tabla campo / actual / propuesto (3 columnas) dentro de la tarjeta de una solicitud
  "src/components/ComparaConLaHoja.tsx", // comparación lado a lado (2 columnas fijas)
  "src/components/FotoDeLaRuta.tsx", // imagen de la ruta para compartir (se exporta como PNG)
  "src/components/RouteEngineSettings.tsx", // ajustes clave/valor
  "src/components/TracksolidSettings.tsx", // ajustes clave/valor
  "src/components/recruiting/ChecklistDelEmpleado.tsx", // checklist dentro del expediente
  "src/components/recruiting/ModalHost.tsx", // «Comparar candidatos»: matriz atributo × candidato, como ComparaConLaHoja (2 columnas fijas por diseño)
  "src/components/recruiting/QuitFormDelEmpleado.tsx", // formulario de baja (se imprime)
  "src/app/customers/HistorialDelCliente.tsx", // detalle de cambios campo/antes/después dentro de una tarjeta
];
/** Deuda del 12 nov 2026. Solo puede ENCOGER: al convertir una, se quita de aquí. */
const PENDIENTES: readonly string[] = [
  "src/app/(app)/data/page.tsx",
  "src/app/(app)/market/page.tsx",
  "src/app/(app)/settings/page.tsx",
  "src/app/operaciones/KpiDeEntregas.tsx",
  "src/components/PlanContraReal.tsx",
  "src/components/RutaDelPlan.tsx",
  "src/components/erp/review-queue.tsx",
  "src/components/timetracker/AssignmentsPanel.tsx",
  // Tablas sin encabezado por día: igual que MySections.
  "src/components/timetracker/EmployeeWeek.tsx",
  "src/components/timetracker/GeofenceSection.tsx",
  // La tabla de sesiones se edita en su propia fila. El recibo de pago (.rcpt-print) SE IMPRIME: queda sin estándar a propósito.
  "src/components/timetracker/ManagerReports.tsx",
  // Tablas sin encabezado (horario de la semana y notas): hay que decidir cómo se titulan antes de convertirlas.
  "src/components/timetracker/MySections.tsx",
  // Nómina: cada fila se edita y se despliega con la bitácora del turno (fila de ancho completo).
  "src/components/timetracker/PayrollTimesheets.tsx",
  "src/components/timetracker/ScheduleWeek.tsx",
  "src/components/timetracker/TripPanel.tsx",
];

const raiz = process.cwd();
function tsx(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? tsx(p) : /\.tsx$/.test(n) && !/\.test\.tsx$/.test(n) ? [p] : [];
  });
}
const conTabla = tsx(join(raiz, "src"))
  .map((p) => ({ ruta: p.slice(raiz.length + 1).replace(/\\/g, "/"), texto: readFileSync(p, "utf8") }))
  .filter((f) => f.texto.includes("<table"));
const usaElEstandar = (t: string) => t.includes("TablaEstandar") || t.includes("useVistaDeColumnas");

describe("estándar de tablas: toda tabla usa las columnas de Órdenes", () => {
  it("ninguna tabla nueva se sale del estándar", () => {
    const fuera = conTabla
      .filter((f) => !usaElEstandar(f.texto) && !PROPIO.includes(f.ruta) && !EXENTAS.includes(f.ruta) && !PENDIENTES.includes(f.ruta))
      .map((f) => f.ruta);
    expect(fuera, "Usa <TablaEstandar> (docs/ESTANDAR-DE-TABLAS.md) o justifica la exención en esta prueba").toEqual([]);
  });
  it("las listas están al día: lo que ya cumple o ya no existe no se queda apuntado", () => {
    const rutas = new Set(conTabla.map((f) => f.ruta));
    const sobran = [...PROPIO, ...EXENTAS, ...PENDIENTES].filter((r) => !rutas.has(r));
    expect(sobran, "Quita de las listas los archivos que ya no pintan una tabla").toEqual([]);
    const yaCumplen = PENDIENTES.filter((r) => usaElEstandar(conTabla.find((f) => f.ruta === r)?.texto ?? ""));
    expect(yaCumplen, "Ya usan el estándar: quítalos de PENDIENTES").toEqual([]);
  });
  it("la deuda no crece", () => {
    expect(PENDIENTES.length).toBeLessThanOrEqual(23);
  });
});
