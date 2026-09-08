import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  accionParada, claimDelChofer, escrituraRecogida, extraEntrega, extraRecogida,
  palletsDeRecogida, podSinCumplir, pruebaPendiente,
} from "./one-tap-stop";

// El botón de «Siguiente parada» decía «Recoger»/«Entregar» y solo abría la ficha: dos toques
// para lo que el chofer pedía en uno (D-NEXT). La regla de si se puede cerrar de un toque vive
// en un módulo puro que usan las dos pantallas; esto la prueba en solitario.

const leer = (r: string) => readFileSync(join(process.cwd(), r), "utf8");
const t = (en: string) => en;                       // en las pruebas, el inglés
const SIN_PRUEBA = { pod_signature_enabled: false, require_pod: false };

describe("pruebaPendiente: qué hace falta recoger en la puerta", () => {
  it("firma apagada y sin comprobante exigido → nada pendiente (el segundo toque sería fricción)", () => {
    expect(pruebaPendiente(SIN_PRUEBA, [])).toBe(false);
    expect(pruebaPendiente({}, null)).toBe(false);
  });
  it("firma encendida → siempre pendiente, aunque haya fotos", () => {
    expect(pruebaPendiente({ pod_signature_enabled: true, require_pod: false }, ["a.jpg"])).toBe(true);
  });
  it("comprobante exigido: pendiente sin fotos, cumplido con fotos", () => {
    expect(pruebaPendiente({ require_pod: true }, [])).toBe(true);
    expect(pruebaPendiente({ require_pod: true }, null)).toBe(true);
    expect(pruebaPendiente({ require_pod: true }, ["a.jpg"])).toBe(false);
  });
});

describe("podSinCumplir: la misma regla en el momento de guardar, donde la firma ya cuenta", () => {
  it("con comprobante exigido, lo cumple una foto O una firma", () => {
    expect(podSinCumplir({ require_pod: true }, [], null)).toBe(true);
    expect(podSinCumplir({ require_pod: true }, ["a.jpg"], null)).toBe(false);
    expect(podSinCumplir({ require_pod: true }, [], "data:image/png;base64,x")).toBe(false);
  });
  it("sin comprobante exigido nunca falta nada", () => {
    expect(podSinCumplir(SIN_PRUEBA, [], null)).toBe(false);
  });
  it("y es de donde sale pruebaPendiente al abrir la ficha (aún no hay firma)", () => {
    for (const fotos of [[], ["a.jpg"]]) {
      for (const ajustes of [{ require_pod: true }, { require_pod: false }]) {
        expect(pruebaPendiente(ajustes, fotos)).toBe(podSinCumplir(ajustes, fotos, null));
      }
    }
  });
});

describe("accionParada: la etiqueta y la acción salen de la misma decisión", () => {
  it("ready → recoger", () => {
    expect(accionParada("ready", SIN_PRUEBA, [])).toEqual({ kind: "pickup" });
  });
  it("picked_up sin nada pendiente → entregar de un toque", () => {
    expect(accionParada("picked_up", SIN_PRUEBA, [])).toEqual({ kind: "deliver" });
  });
  it("picked_up con firma encendida o foto pendiente → abre la ficha, y la etiqueta lo dice", () => {
    expect(accionParada("picked_up", { pod_signature_enabled: true }, ["a.jpg"])).toEqual({ kind: "pod" });
    expect(accionParada("picked_up", { require_pod: true }, [])).toEqual({ kind: "pod" });
  });
  it("las otras CUATRO etapas que pueden llegar a `next` no ofrecen acción: solo abrir", () => {
    // Medido: `stops` solo descarta canceled y rejected, y `next` es la primera que no está
    // entregada. Antes el ternario decía «Entregar» para todas ellas.
    for (const etapa of ["draft", "pending", "approved", "fulfilling"]) {
      expect(accionParada(etapa, SIN_PRUEBA, []), etapa).toEqual({ kind: "open" });
    }
    expect(accionParada(null, SIN_PRUEBA, [])).toEqual({ kind: "open" });
    expect(accionParada("delivered", SIN_PRUEBA, [])).toEqual({ kind: "open" });
  });
  it("mutación: si «entregar» no mirara la prueba pendiente, una entrega se saltaría el comprobante", () => {
    const sinMirar = (etapa: string) => (etapa === "picked_up" ? { kind: "deliver" } : { kind: "open" });
    expect(sinMirar("picked_up")).toEqual({ kind: "deliver" });
    expect(accionParada("picked_up", { require_pod: true }, [])).toEqual({ kind: "pod" });
  });
});

describe("lo que se escribe al recoger: una sola construcción para las dos vías", () => {
  const gps = { lat: 26.1, lng: -98.2, at: "2026-09-08T15:00:00.000Z" };
  const chofer = { role: "driver", full_name: "Ana" };

  it("pallets: las confirmadas, si no las estimadas, si no ninguna", () => {
    expect(palletsDeRecogida({ actual_pallets: 3, est_pallets: 9 })).toBe(3);
    expect(palletsDeRecogida({ est_pallets: 9 })).toBe(9);
    expect(palletsDeRecogida({})).toBe(0);
  });
  it("con recuento: nota con el número y `actual_pallets` en el extra", () => {
    const e = escrituraRecogida({ pedido: { est_pallets: 4, assigned_driver: "Ana" }, me: chofer, gps, t });
    expect(e.pallets).toBe(4);
    expect(e.note).toBe("Loaded: 4 pallets");
    expect(e.extra).toMatchObject({ actual_pallets: 4, pickup_lat: 26.1, pickup_lng: -98.2, pickup_gps_at: gps.at });
  });
  it("sin recuento: NO se escribe un 0 encima de un blanco", () => {
    const e = escrituraRecogida({ pedido: { assigned_driver: "Ana" }, me: chofer, gps, t });
    expect(e.note).toBe("Loaded");
    expect(e.extra).not.toHaveProperty("actual_pallets");
  });
  it("sin GPS: se guarda igual, solo con la hora (nunca bloquea)", () => {
    const e = escrituraRecogida({ pedido: { est_pallets: 1, assigned_driver: "Ana" }, me: chofer, gps: null, t });
    expect(e.extra).not.toHaveProperty("pickup_lat");
    expect(typeof e.extra.pickup_gps_at).toBe("string");
  });
  it("el chofer se queda el pedido de nadie; si ya tiene dueño, no se toca", () => {
    expect(claimDelChofer(chofer, null)).toEqual({ assigned_driver: "Ana" });
    expect(claimDelChofer(chofer, "Beto")).toEqual({});
    expect(claimDelChofer({ role: "logistics", full_name: "Sara" }, null)).toEqual({});
    expect(claimDelChofer(null, null)).toEqual({});
  });
  it("extraRecogida y extraEntrega escriben las columnas de su etapa, y ninguna de la otra", () => {
    expect(Object.keys(extraRecogida(gps)).sort()).toEqual(["pickup_gps_at", "pickup_lat", "pickup_lng"]);
    const ent = extraEntrega({ lat: 1, lng: 2, accuracy: 5 });
    expect(ent).toMatchObject({ pod_lat: 1, pod_lng: 2, pod_accuracy: 5, pod_received_by: null, pod_signature: null });
    expect(typeof ent.pod_delivered_at).toBe("string");
    expect(Object.keys(ent)).not.toContain("pickup_lat");
  });
  it("entregar sin GPS deja las coordenadas nulas, no inventadas", () => {
    expect(extraEntrega(null)).toMatchObject({ pod_lat: null, pod_lng: null, pod_accuracy: null });
  });
});

describe("las dos pantallas usan el módulo, y el botón no dispara dos veces", () => {
  const ruta = leer("src/app/(app)/my-route/page.tsx");
  const modal = leer("src/components/OrderModal.tsx");

  it("Mi ruta: el botón ejecuta la acción, ya no abre la ficha sin más", () => {
    expect(ruta).toMatch(/onClick=\{\(\) => void cerrarParada\(next\)\}/);
    expect(ruta).not.toMatch(/next\.stage === "ready" \? `🚚/);
  });
  it("la etiqueta sale de la misma decisión que la acción", () => {
    expect(ruta).toMatch(/const accionSiguiente = accionParada\(next\?\.stage, settings, next\?\.photos\)/);
    expect(ruta).toMatch(/accionSiguiente\.kind === "pickup"/);
    expect(ruta).toMatch(/accionSiguiente\.kind === "deliver"/);
    expect(ruta).toMatch(/accionSiguiente\.kind === "pod"/);
  });
  it("un toque, no dos: se deshabilita mientras guarda y la función se cierra a sí misma", () => {
    expect(ruta).toMatch(/disabled=\{guardando === next\.id\}/);
    expect(ruta).toMatch(/if \(guardando\) return;/);
    expect(ruta).toMatch(/setGuardando\(d\.id\);/);
    expect(ruta).toMatch(/setGuardando\(null\);/);
  });
  it("el GPS no bloquea: se espera el inmediato y el tardío se adjunta en silencio", () => {
    expect(ruta).toMatch(/const \{ immediate, eventual \} = captureLocationSplit\(\);/);
    expect(ruta).toMatch(/void adjuntarTardio\(d\.id, eventual, "pickup"\)/);
    expect(ruta).toMatch(/void adjuntarTardio\(d\.id, eventual, "pod"\)/);
    expect(ruta).toMatch(/\{ quiet: true \}/);
  });
  it("la ficha usa el mismo módulo: la escritura de la recogida y las DOS guardas del comprobante", () => {
    expect(modal).toMatch(/escrituraRecogida\(\{ pedido:/);
    expect(modal).toMatch(/const podFormNeeded = pruebaPendiente\(settings, existing\?\.photos\)/);
    expect(modal).toMatch(/if \(podSinCumplir\(settings, existing\.photos, podSig\)\)/);
    // Y ya no quedan las dos reglas escritas a mano.
    expect(modal).not.toMatch(/const podOwed = /);
    expect(modal).not.toMatch(/settings\.require_pod && !podSig && !\(existing\.photos\?\.length\)/);
  });
});
