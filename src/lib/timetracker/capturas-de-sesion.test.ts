import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// 2026-11-24: las capturas de escritorio salen de Nómina como sección plegada. Ahora se abren con un 🖥
// desde cada día de «Remoto» y desde cada sesión, en una ventana (`CapturasDeSesion`). Se mira el FUENTE,
// igual que el resto de pruebas de pantalla de este módulo.
const leer = (ruta: string) => readFileSync(join(process.cwd(), ruta), "utf8");

describe("Nómina ya no monta las capturas, ni las fotos ni las excepciones", () => {
  const nomina = leer("src/components/timetracker/PayrollTabs.tsx");

  it("PayrollTabs no monta DayPhotos, ExceptionHistory ni TeamDiary", () => {
    for (const nombre of ["DayPhotos", "ExceptionHistory", "TeamDiary"]) {
      expect(nomina, nombre).not.toContain(`<${nombre} />`);
    }
  });
});

describe("Remoto: un día por fila, y el 🖥 por día y por sesión", () => {
  const remoto = leer("src/components/timetracker/ManagerReports.tsx");

  it("agrupa las sesiones con sesionesPorDia", () => {
    expect(remoto).toContain("sesionesPorDia(sess)");
  });

  it("pinta el 🖥 de cada día y el de cada sesión", () => {
    expect(remoto).toContain("data-capturas-del-dia={d.dia}");
    expect(remoto).toContain("data-capturas-de-sesion={s.id}");
  });

  it("el chip de varias sesiones lleva su número", () => {
    expect(remoto).toContain("data-sesiones-del-dia={d.sesiones.length}");
  });

  it("abre la ventana de capturas y la recarga de sesiones al borrar", () => {
    expect(remoto).toContain("<CapturasDeSesion");
    expect(remoto).toContain("onCambio={recargarSesiones}");
  });
});

describe("la ventana de capturas", () => {
  const ventana = leer("src/components/timetracker/CapturasDeSesion.tsx");

  it("carga las capturas de sus sesiones por session_id", () => {
    expect(ventana).toContain('.in("session_id", ids)');
    expect(ventana).toContain('.order("taken_at", { ascending: true })');
  });

  it("el borrado de una captura conserva su confirmación y su clave", () => {
    expect(ventana).toContain('t("mgr.shots.delConfirm"');
  });

  it("la purga de más de 14 días sigue en el pie, con su clave", () => {
    expect(ventana).toContain('t("mgr.shots.purgeBtn")');
    expect(ventana).toContain('t("mgr.shots.purgeConfirm")');
  });

  it("el guard de admin y el cierre (Modal) siguen", () => {
    expect(ventana).toContain('me.role !== "admin"');
    expect(ventana).toContain("<Modal");
  });
});

describe("los enlaces viejos caen en Nómina sin ?vista=", () => {
  const cfg = leer("next.config.mjs");
  const destinoDe = (origen: string) => {
    const linea = cfg.split(/\r?\n/).find((l) => l.includes(`source: "${origen}",`));
    expect(linea, origen).toBeDefined();
    return /destination: "([^"]+)"/.exec(linea!)?.[1];
  };

  it("las tres reglas llevan a /timetracker/payroll", () => {
    expect(destinoDe("/clock-in/photos")).toBe("/timetracker/payroll");
    expect(destinoDe("/timetracker/clock-in/photos")).toBe("/timetracker/payroll");
    expect(destinoDe("/timetracker/team-diary")).toBe("/timetracker/payroll");
  });
});
