import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { agendaEnDiaPasado, AVISO_FECHA_PASADA, fechaDeEntregaPasada, minFechaDeEntrega } from "./fecha-de-entrega";

// D-532 · «que no se pueda agendar orden a dias pasados» (el dueño, 2026-10-12).

const HOY = "2026-10-12";
const leer = (p: string) => readFileSync(p, "utf8").split("\r\n").join("\n");

describe("fechaDeEntregaPasada: antes de hoy", () => {
  it("ayer sí; hoy y mañana no; sin fecha no", () => {
    expect(fechaDeEntregaPasada("2026-10-11", HOY)).toBe(true);
    expect(fechaDeEntregaPasada("2026-10-12", HOY)).toBe(false);
    expect(fechaDeEntregaPasada("2026-10-13", HOY)).toBe(false);
    expect(fechaDeEntregaPasada(null, HOY)).toBe(false);
    expect(fechaDeEntregaPasada("", HOY)).toBe(false);
  });
  it("una fecha con hora se mira por su día", () => {
    expect(fechaDeEntregaPasada("2026-10-11T23:00:00", HOY)).toBe(true);
  });
});

describe("agendaEnDiaPasado: solo cuando la fecha es nueva o cambia", () => {
  it("una orden nueva con fecha de ayer: no", () => {
    expect(agendaEnDiaPasado("2026-10-11", null, HOY)).toBe(true);
    expect(agendaEnDiaPasado("2026-10-11", undefined, HOY)).toBe(true);
  });
  it("cambiar una orden a un día pasado: no", () => {
    expect(agendaEnDiaPasado("2026-10-10", "2026-10-13", HOY)).toBe(true);
  });
  it("una atrasada que se edita SIN tocarle la fecha: sí (no es agendar)", () => {
    expect(agendaEnDiaPasado("2026-10-10", "2026-10-10", HOY)).toBe(false);
    expect(agendaEnDiaPasado("2026-10-10T00:00:00", "2026-10-10", HOY)).toBe(false);
  });
  it("hoy o adelante: siempre sí", () => {
    expect(agendaEnDiaPasado("2026-10-12", "2026-10-01", HOY)).toBe(false);
    expect(agendaEnDiaPasado("2026-10-20", null, HOY)).toBe(false);
  });
  it("el selector empieza en hoy", () => {
    expect(minFechaDeEntrega(HOY)).toBe(HOY);
  });
});

describe("todos los sitios que escriben delivery_date usan la regla", () => {
  const modal = leer("src/components/OrderModal.tsx");
  const gestor = leer("src/app/(app)/routes/page.tsx");
  const ordenes = leer("src/app/(app)/page.tsx");
  it("la ficha: al enviar / editar (passesChecks, antes de cualquier «¿continuar?») y en «solo la fecha» de ventas", () => {
    const i = modal.indexOf("const passesChecks = async (draft: Draft): Promise<boolean> => {");
    const cabeza = modal.slice(i, modal.indexOf("const miss = computeMissing(draft);", i));
    expect(cabeza).toContain("if (agendaEnDiaPasado(draft.delivery_date, existing?.delivery_date)) { notify(t(AVISO_FECHA_PASADA.en, AVISO_FECHA_PASADA.es)); return false; }");
    expect(modal).toContain("if (agendaEnDiaPasado(d.delivery_date, existing!.delivery_date)) { notify(t(AVISO_FECHA_PASADA.en, AVISO_FECHA_PASADA.es)); return; }");
    // Los dos botones (borrador→enviar y crear) pasan por passesChecks.
    expect(modal.split("await passesChecks(payload)").length - 1).toBe(2);
  });
  it("la ficha: los dos selectores de fecha empiezan en hoy, y Txt pasa `min` al input", () => {
    expect(modal.split("min={minFechaDeEntrega()}").length - 1).toBe(2);
    expect(modal).toMatch(/function Txt\(\{ label, val, on, type = "text", disabled, placeholder, invalid, min \}/);
    expect(modal).toContain("placeholder={placeholder} min={min}");
  });
  it("el Gestor de rutas: la celda de fecha tiene tope y `reschedule` lo comprueba contra la fecha actual de la orden", () => {
    expect(gestor).toContain("const actual = deliveries.find((d) => d.id === id)?.delivery_date;");
    expect(gestor).toContain("if (agendaEnDiaPasado(delivery_date, actual)) { notify(t(AVISO_FECHA_PASADA.en, AVISO_FECHA_PASADA.es)); return; }");
    expect(gestor).toContain("min={minFechaDeEntrega()}\n        onChange={(e) => e.target.value && onChange(d.id, e.target.value)}");
  });
  it("Órdenes: la fecha en bloque tiene tope y `bulkSetDate` no aplica un día pasado", () => {
    expect(ordenes).toContain("if (fechaDeEntregaPasada(date)) { notify(t(AVISO_FECHA_PASADA.en, AVISO_FECHA_PASADA.es)); return; }");
    expect(ordenes).toContain('<input type="date" value={fechaEnBloque} min={minFechaDeEntrega()}');
  });
  it("«Reprogramar» ya lo tenía (D-500) y sigue", () => {
    expect(leer("src/lib/reprogramar-orden.ts")).toContain("if (nueva < hoy) return false;");
    expect(leer("src/components/ReprogramarOrden.tsx")).toContain("min={hoy}");
  });
  it("el aviso dice qué elegir", () => {
    expect(AVISO_FECHA_PASADA.es).toBe("La fecha de entrega no puede ser un día pasado. Elige hoy o un día posterior.");
    expect(AVISO_FECHA_PASADA.en).toBe("The delivery date can't be a past day. Pick today or a later day.");
  });
});
