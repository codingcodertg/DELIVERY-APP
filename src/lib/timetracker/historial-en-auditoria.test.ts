import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// El historial de solicitudes se movió de Solicitudes (team-requests) a Auditoría (2026-11-24,
// pedido del dueño: las solicitudes de fichaje ya están en Auditoría). Se mira el FUENTE porque
// las pantallas son componentes cliente y no hay forma barata de montarlas aquí.
const leer = (ruta: string) => readFileSync(join(process.cwd(), ruta), "utf8");

const SOLICITUDES = "src/app/timetracker/(timetracker)/team-requests/page.tsx";
const HISTORIAL = "src/components/timetracker/HistorialDeSolicitudes.tsx";
const AUDITORIA = "src/components/timetracker/AuditTabs.tsx";

describe("el historial de solicitudes ya no está en Solicitudes", () => {
  const src = leer(SOLICITUDES);

  it("no tiene la sección de historial ni su tabla", () => {
    expect(src).not.toContain('seccion="historial"');
    expect(src).not.toContain("tt-solicitudes-del-equipo");
    expect(src).not.toContain("TablaEstandar");
  });

  it("sigue con sus secciones de pendientes, ausencias y excepciones", () => {
    expect(src).toContain('seccion="pendientes"');
    expect(src).toContain("<SeccionAusenciasFichaje bandeja={bandeja} />");
    expect(src).toContain("<SeccionExcepcionesFichaje bandeja={bandeja} />");
  });
});

describe("el historial de solicitudes vive en su propio componente", () => {
  const src = leer(HISTORIAL);

  it("tiene la sección plegada con la misma clave y la misma tabla", () => {
    expect(src).toContain('seccion="historial"');
    expect(src).toContain('id="tt-solicitudes-del-equipo"');
    expect(src).toContain('useSeccionAbierta("historial", false,');
  });

  it("usa el título propio de Auditoría", () => {
    expect(src).toContain('t("mgr.req.historyTitle")');
  });
});

describe("Auditoría monta el historial debajo del registro y después de la puerta de admin", () => {
  const src = leer(AUDITORIA);
  const puerta = src.indexOf('if (me.role !== "admin")');
  const registro = src.indexOf('t("mgr.audit.title")');
  const historial = src.indexOf("<HistorialDeSolicitudes");

  it("el componente está importado y montado", () => {
    expect(src).toContain('import { HistorialDeSolicitudes } from "@/components/timetracker/HistorialDeSolicitudes";');
    expect(historial).toBeGreaterThan(-1);
  });

  it("va después de la puerta de admin", () => {
    expect(puerta).toBeGreaterThan(-1);
    expect(historial).toBeGreaterThan(puerta);
  });

  it("va después de la tarjeta del registro de auditoría", () => {
    expect(registro).toBeGreaterThan(-1);
    expect(historial).toBeGreaterThan(registro);
  });
});
