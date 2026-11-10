import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { AvisoDeFecha } from "@/components/AvisoDeFecha";
import {
  aplicaAvisoMismoDia, AVISO_MISMO_DIA, esParaHoy, fechaPorDefectoManana,
  pideConfirmarMismoDia, PREGUNTA_MISMO_DIA, preguntaMismoDia,
} from "./same-day";

/**
 * "Mismo día" (el dueño, 2026-11-10): toda orden nace para MAÑANA; si la ponen para HOY, se le pregunta a quien no
 * asigna (todos menos logística y admin), con el diálogo de la app. Reemplaza al corte de las 12 de D-845.
 */
const leer = (p: string) => readFileSync(p, "utf8").split("\r\n").join("\n");

// 2026-11-04 (miércoles), ya en CST (UTC−6; el cambio fue el 1-nov). Entonces: 06 vie, 07 sáb, 08 dom, 09 lun.
const CST = (dia: string, hhmm: string) => new Date(`${dia}T${hhmm}:00-06:00`);
const CDT = (dia: string, hhmm: string) => new Date(`${dia}T${hhmm}:00-05:00`);

describe("esParaHoy: la fecha es la de hoy en Texas", () => {
  it("hoy sí, mañana/ayer no, sin fecha nada; a cualquier hora (no mira las 12)", () => {
    const manana = CST("2026-11-04", "09:00");
    expect(esParaHoy("2026-11-04", manana)).toBe(true);
    expect(esParaHoy("2026-11-04T00:00:00", manana)).toBe(true);
    expect(esParaHoy("2026-11-05", manana)).toBe(false);
    expect(esParaHoy("2026-11-03", manana)).toBe(false);
    expect(esParaHoy(null, manana)).toBe(false);
    expect(esParaHoy("", manana)).toBe(false);
    // Por la tarde igual de cierto: la regla no depende de la hora.
    expect(esParaHoy("2026-11-04", CST("2026-11-04", "15:00"))).toBe(true);
  });
  it("mira el día de Texas, no el de UTC: a las 23:30 de Texas en UTC ya es mañana", () => {
    const noche = new Date("2026-11-05T05:30:00Z"); // 23:30 CST del 4-nov
    expect(esParaHoy("2026-11-04", noche)).toBe(true);
    expect(esParaHoy("2026-11-05", noche)).toBe(false);
  });
});

describe("a quién se le pregunta: a todos menos logística y admin", () => {
  it("logística y admin, exentos; los demás (y sin rol), sí", () => {
    expect(aplicaAvisoMismoDia("logistics")).toBe(false);
    expect(aplicaAvisoMismoDia("admin")).toBe(false);
    for (const rol of ["sales", "manager", "warehouse", "accounting", "driver", null, undefined]) {
      expect(aplicaAvisoMismoDia(rol)).toBe(true);
    }
  });
});

describe("pideConfirmarMismoDia: pone hoy, no asigna", () => {
  const ahora = CST("2026-11-04", "09:00");
  it("hoy pide; mañana no; logística/admin nunca", () => {
    expect(pideConfirmarMismoDia("2026-11-04", null, { rol: "sales", ahora })).toBe(true);
    expect(pideConfirmarMismoDia("2026-11-04", "2026-11-06", { rol: "manager", ahora })).toBe(true);
    expect(pideConfirmarMismoDia("2026-11-05", null, { rol: "sales", ahora })).toBe(false);
    expect(pideConfirmarMismoDia("2026-11-04", null, { rol: "logistics", ahora })).toBe(false);
    expect(pideConfirmarMismoDia("2026-11-04", null, { rol: "admin", ahora })).toBe(false);
  });
  it("la misma fecha de siempre no es agendar; con `agenda` sí", () => {
    expect(pideConfirmarMismoDia("2026-11-04", "2026-11-04", { rol: "sales", ahora })).toBe(false);
    expect(pideConfirmarMismoDia("2026-11-04", "2026-11-04", { rol: "sales", ahora, agenda: true })).toBe(true);
    expect(pideConfirmarMismoDia("2026-11-05", "2026-11-05", { rol: "sales", ahora, agenda: true })).toBe(false);
  });
});

describe("fechaPorDefectoManana: mañana en Texas, saltando el domingo", () => {
  it("viernes → sábado (mañana)", () => {
    expect(fechaPorDefectoManana(CST("2026-11-06", "12:00"))).toBe("2026-11-07");
  });
  it("sábado → lunes (salta el domingo)", () => {
    expect(fechaPorDefectoManana(CST("2026-11-07", "12:00"))).toBe("2026-11-09");
  });
  it("en CDT también suma un solo día", () => {
    expect(fechaPorDefectoManana(CDT("2026-10-29", "12:00"))).toBe("2026-10-30");
  });
});

describe("la pregunta y el aviso, en los dos idiomas", () => {
  it("la pregunta lleva el texto del dueño y sus dos botones", () => {
    expect(PREGUNTA_MISMO_DIA.en).toBe("Are you sure? Contact the logistics manager to assign it. Note: for the short notice this might get rescheduled for tomorrow.");
    expect(PREGUNTA_MISMO_DIA.es).toBe("¿Seguro? Contacta al gerente de logística para asignarla. Nota: por ser a última hora, puede reprogramarse para mañana.");
    expect(PREGUNTA_MISMO_DIA.si).toEqual({ en: "Yes, for today", es: "Sí, para hoy" });
    expect(PREGUNTA_MISMO_DIA.cambiar).toEqual({ en: "Change date", es: "Cambiar fecha" });
  });
  it("el aviso es un consejo (menciona a logística), no un «no se puede»", () => {
    expect(AVISO_MISMO_DIA.en).toMatch(/logistics manager/);
    expect(AVISO_MISMO_DIA.es).toMatch(/logística/);
  });
  it("preguntaMismoDia usa el diálogo que le pasan y devuelve su respuesta", async () => {
    const llamadas: Array<[string, { confirmLabel: string; cancelLabel: string }]> = [];
    const es = (_en: string, s: string) => s;
    const si = await preguntaMismoDia(async (m, o) => { llamadas.push([m, o]); return true; }, es);
    const no = await preguntaMismoDia(async () => false, es);
    expect([si, no]).toEqual([true, false]);
    expect(llamadas).toEqual([[PREGUNTA_MISMO_DIA.es, { confirmLabel: "Sí, para hoy", cancelLabel: "Cambiar fecha" }]]);
  });
});

describe("el aviso debajo del selector (AvisoDeFecha)", () => {
  const pinta = (rol: string, fecha: string, ahora: Date) =>
    renderToStaticMarkup(createElement(AvisoDeFecha, {
      fecha, actual: null, rol, caso: { marcado: false, motivo: "" }, onCaso: () => {}, t: (_en: string, es: string) => es, hoy: "2026-11-06", ahora,
    }));
  it("a quien no asigna, hoy sale como consejo (ámbar); mañana, o a logística/admin, nada", () => {
    const html = pinta("sales", "2026-11-06", CST("2026-11-06", "09:00"));
    expect(html).toContain('data-aviso-fecha="mismo-dia"');
    expect(html).toContain(AVISO_MISMO_DIA.es);
    expect(html).toContain("var(--amber-soft)");
    expect(html).not.toContain("var(--red");
    expect(pinta("sales", "2026-11-07", CST("2026-11-06", "09:00"))).toBe("");
    expect(pinta("logistics", "2026-11-06", CST("2026-11-06", "09:00"))).toBe("");
    expect(pinta("admin", "2026-11-06", CST("2026-11-06", "09:00"))).toBe("");
  });
  it("el domingo conserva su propio aviso", () => {
    expect(pinta("sales", "2026-11-08", CST("2026-11-06", "09:00"))).toContain('data-aviso-fecha="domingo"');
  });
});

describe("el cableado: por defecto mañana y una sola pregunta al poner hoy", () => {
  const modal = leer("src/components/OrderModal.tsx");

  it("la ficha importa de same-day y arma la pregunta con el diálogo de la app (useConfirm), nunca window.confirm", () => {
    expect(modal).toContain('import { pideConfirmarMismoDia, preguntaMismoDia, fechaPorDefectoManana } from "@/lib/same-day";');
    expect(modal).toContain("!pideConfirmarMismoDia(nueva, existing?.delivery_date, { rol: me.role, agenda }) || preguntaMismoDia(confirmAction, t);");
    expect(modal).not.toContain("window.confirm(");
    expect(modal).not.toContain("pideConfirmarMediodia");
    expect(modal).not.toContain("siguePorMediodia");
  });
  it("una orden nueva nace para mañana, y duplicar también, sin pisar una fecha que ya traiga", () => {
    expect(modal).toContain("return b.delivery_date ? b : { ...b, delivery_date: fechaPorDefectoManana() };");
    expect(modal).toContain("const payload: Draft = borradorDuplicado(existing, fechaPorDefectoManana());");
  });
  it("los selectores siguen pudiendo elegir hoy (min = hoy), para que el aviso tenga sentido", () => {
    expect(modal.split("min={minFechaDeEntrega()} max={maxFechaDeEntrega()} />").length - 1).toBe(2);
    expect(modal).not.toContain("minFechaParaRol");
  });
  it("crear/enviar, borrador, «solo la fecha» y enviar/reenviar preguntan una vez por guardado", () => {
    expect(modal).toContain("if (!(await sigueParaHoy(draft.delivery_date))) return false;");
    expect(modal).toContain("if (!(await sigueParaHoy(d.delivery_date))) return;");
    expect(modal).toContain('if ((payload.stage ?? "draft") === "draft" && !(await sigueParaHoy(payload.delivery_date))) return;');
    expect(modal).toContain("if (esEnvioDeBorrador(existing.stage, to) && !(await sigueParaHoy(existing.delivery_date, { agenda: true }))) return;");
    expect(modal.split("await sigueParaHoy(").length - 1).toBe(4);
  });
  it("«Reprogramar», la celda del Gestor y la fecha en bloque preguntan por `same-day`, no bloquean", () => {
    const rep = leer("src/components/ReprogramarOrden.tsx");
    expect(rep).toContain('import { pideConfirmarMismoDia, preguntaMismoDia } from "@/lib/same-day";');
    expect(rep).toContain("if (pideConfirmarMismoDia(fecha, pedido.delivery_date, { rol }) && !(await preguntaMismoDia(confirmAction, t))) return;");
    expect(leer("src/app/(app)/routes/page.tsx")).toContain("if (pideConfirmarMismoDia(delivery_date, actual, { rol: me?.role }) && !(await preguntaMismoDia(confirmAction, t))) return;");
    expect(leer("src/app/(app)/page.tsx")).toContain("if (pideConfirmarMismoDia(date, null, { rol: me?.role }) && !(await preguntaMismoDia(confirmAction, t))) return;");
  });
  it("el aviso debajo del selector lo monta AvisoDeFecha con same-day", () => {
    const aviso = leer("src/components/AvisoDeFecha.tsx");
    expect(aviso).toContain('import { AVISO_MISMO_DIA, pideConfirmarMismoDia } from "@/lib/same-day";');
    expect(aviso).toContain("if (!imposible && !esDomingo(fecha) && pideConfirmarMismoDia(fecha, actual, { rol, ahora })) {");
    expect(aviso).toContain("t(AVISO_MISMO_DIA.en, AVISO_MISMO_DIA.es)");
  });
  it("los proveedores de datos no vuelven a importar la regla", () => {
    for (const p of ["src/lib/data-provider.tsx", "src/lib/local-data-provider.tsx"]) {
      expect(leer(p)).not.toContain('from "@/lib/same-day"');
      expect(leer(p)).not.toContain('from "@/lib/corte-de-ventas"');
    }
  });
});
