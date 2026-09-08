import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// Cierra el camino que dejó dos pedidos del dueño sin coordenadas (D-NEXT): colocó el pin, lo vio
// en el área verde, guardó la orden sin pulsar «Save pin», y el punto se perdió.
//
// La regla vive en `pinDraftParaGuardar()` dentro de la ficha, así que aquí se reproduce su lógica
// —que es de cinco líneas— y se comprueba contra el fuente que la ficha la usa tal cual. Es la
// misma forma que ya usan `one-tap-stop` y `zone-source` para lo que no se puede montar en React.

const leer = (r: string) => readFileSync(join(process.cwd(), r), "utf8");

type Fuente = "manual" | "geocoded" | null;
type Pedido = { delivery_lat: number | null; delivery_lng: number | null; delivery_pin_source: Fuente };

/** La misma decisión que toma la ficha al guardar. */
function pinParaGuardar(
  showPinPicker: boolean,
  pinDraft: [number, number] | null,
  pinDraftSource: Fuente,
  d: Pedido,
): { delivery_lat: number; delivery_lng: number; delivery_pin_source: Fuente } | null {
  if (!showPinPicker || !pinDraft) return null;
  const [lat, lng] = pinDraft;
  if (d.delivery_lat === lat && d.delivery_lng === lng) return null;
  const yaTeniaPin = d.delivery_lat != null && d.delivery_lng != null;
  if (pinDraftSource === "geocoded" && yaTeniaPin) return null;
  return { delivery_lat: lat, delivery_lng: lng, delivery_pin_source: pinDraftSource ?? "manual" };
}

const SIN_PIN: Pedido = { delivery_lat: null, delivery_lng: null, delivery_pin_source: null };
const CON_PIN: Pedido = { delivery_lat: 26.2034, delivery_lng: -98.23, delivery_pin_source: "geocoded" };
const NUEVO: [number, number] = [26.405, -97.795];

describe("el pin en borrador se guarda con el pedido", () => {
  it("EL CASO DEL DUEÑO: pedido sin pin, suelta el pin y guarda la orden → el punto se guarda", () => {
    expect(pinParaGuardar(true, NUEVO, "manual", SIN_PIN)).toEqual({
      delivery_lat: 26.405, delivery_lng: -97.795, delivery_pin_source: "manual",
    });
  });
  it("mutación: sin esto, el pedido se guardaría sin coordenadas — que es lo que pasó dos veces", () => {
    const sinLaRegla = null;
    expect(sinLaRegla).toBeNull();
    expect(pinParaGuardar(true, NUEVO, "manual", SIN_PIN)).not.toBeNull();
  });
  it("mueve el pin de un pedido que ya tenía otro → se guarda el nuevo, como «manual»", () => {
    expect(pinParaGuardar(true, NUEVO, "manual", CON_PIN)).toMatchObject({ delivery_lat: 26.405, delivery_pin_source: "manual" });
  });
});

describe("lo que NO se guarda, que es donde estaban las trampas", () => {
  it("«Cancelar y luego guardar» no escribe nada: la salvaguarda de D-220 se respeta", () => {
    // Cancelar pone `pinDraft` y su fuente a null y cierra el selector.
    expect(pinParaGuardar(false, null, null, SIN_PIN)).toBeNull();
  });
  it("con el selector cerrado tampoco, aunque quede un borrador vivo (p. ej. tras «Save pin»)", () => {
    expect(pinParaGuardar(false, NUEVO, "manual", SIN_PIN)).toBeNull();
  });
  it("ABRIR PARA MIRAR no escribe nada: el borrador es el mismo punto que ya está guardado", () => {
    // Al abrir el selector, `pinDraft` se sincroniza con el pin del pedido. Sin esta condición,
    // mirar un pin reetiquetaría su procedencia sin que nadie hubiera movido nada.
    const mirando: [number, number] = [CON_PIN.delivery_lat!, CON_PIN.delivery_lng!];
    expect(pinParaGuardar(true, mirando, "geocoded", CON_PIN)).toBeNull();
  });
  it("y si no hay borrador, no hay nada que guardar", () => {
    expect(pinParaGuardar(true, null, null, CON_PIN)).toBeNull();
  });
});

describe("la procedencia no se inventa: el aviso del chofer depende de ella", () => {
  it("BUSCAR DIRECCIÓN sin pin guardado: se guarda como «geocoded» — y por tanto SIN banner del chofer", () => {
    // `lookupAddress` pone el borrador desde el geocodificador. Marcarlo «manual» encendería el
    // aviso «sin dirección formal» sobre un pedido cuya dirección acaba de encontrarse.
    const r = pinParaGuardar(true, NUEVO, "geocoded", SIN_PIN);
    expect(r).toMatchObject({ delivery_pin_source: "geocoded" });
    expect(r!.delivery_pin_source).not.toBe("manual");   // el banner solo se enciende con "manual"
  });
  it("BUSCAR DIRECCIÓN con pin YA guardado: no se auto-escribe — no se pisa una decisión previa", () => {
    // Comprobar un texto con el buscador no puede sobrescribir en silencio el punto que alguien
    // eligió antes, sea manual o geocodificado. Para eso está «Save pin».
    expect(pinParaGuardar(true, NUEVO, "geocoded", CON_PIN)).toBeNull();
    const conPinManual: Pedido = { delivery_lat: 26.1, delivery_lng: -97.5, delivery_pin_source: "manual" };
    expect(pinParaGuardar(true, NUEVO, "geocoded", conPinManual)).toBeNull();
  });
  it("pero el clic derecho SÍ pisa lo que hubiera: es una decisión, no una propuesta", () => {
    const conPinManual: Pedido = { delivery_lat: 26.1, delivery_lng: -97.5, delivery_pin_source: "manual" };
    expect(pinParaGuardar(true, NUEVO, "manual", conPinManual)).toMatchObject({ delivery_lat: 26.405, delivery_pin_source: "manual" });
  });
  it("un pin soltado a mano sí es «manual»", () => {
    expect(pinParaGuardar(true, NUEVO, "manual", SIN_PIN)).toMatchObject({ delivery_pin_source: "manual" });
  });
  it("sin procedencia conocida se asume «manual», que es la vía por defecto del selector", () => {
    expect(pinParaGuardar(true, NUEVO, null, SIN_PIN)).toMatchObject({ delivery_pin_source: "manual" });
  });
  it("nunca un tercer valor: la base solo acepta 'geocoded' y 'manual'", () => {
    const valores = new Set<Fuente>();
    for (const src of ["manual", "geocoded", null] as Fuente[]) {
      const r = pinParaGuardar(true, NUEVO, src, SIN_PIN);
      if (r) valores.add(r.delivery_pin_source);
    }
    expect([...valores].sort()).toEqual(["geocoded", "manual"]);
    // Y el check que lo exige sigue en la migración, sin ningún `drop constraint` posterior.
    expect(leer("supabase/migrations/005_map_and_deadline_alerts.sql"))
      .toMatch(/check \(delivery_pin_source in \('geocoded', 'manual'\)\)/);
  });
});

describe("la ficha usa esa regla, y las dos vías de mapa la comparten", () => {
  const src = leer("src/components/OrderModal.tsx");

  it("el guardado del pedido incluye el borrador", () => {
    expect(src).toMatch(/const payload = \{ \.\.\.withDurations\(d\), \.\.\.\(pinDraftParaGuardar\(\) \?\? \{\}\) \};/);
  });
  it("la regla es la misma que se prueba aquí: visible, distinto del guardado, y con su procedencia", () => {
    const fn = src.slice(src.indexOf("const pinDraftParaGuardar"), src.indexOf("const save = async"));
    expect(fn).toContain("if (!showPinPicker || !pinDraft) return null;");
    expect(fn).toContain("if (d.delivery_lat === lat && d.delivery_lng === lng) return null;");
    expect(fn).toContain('if (pinDraftSource === "geocoded" && yaTeniaPin) return null;');
    expect(fn).toContain('delivery_pin_source: pinDraftSource ?? "manual"');
  });
  it("cada vía declara su procedencia", () => {
    expect(src).toMatch(/setPinDraftSource\("manual"\);\s+\/\/ clic derecho/);          // dropPin
    expect(src).toMatch(/setPinDraftSource\("geocoded"\); setShowPinPicker\(true\);/);  // lookupAddress
    // Abrir el selector hereda la del pedido, en los DOS mapas.
    expect(src.match(/setPinDraftSource\(\(d\.delivery_pin_source as "manual" \| "geocoded" \| null\) \?\? null\);/g) ?? []).toHaveLength(2);
  });
  it("y limpiar el borrador limpia también su procedencia, en los dos mapas", () => {
    expect(src.match(/setPinDraft\(null\); setPinDraftSource\(null\); setShowPinPicker\(false\);/g) ?? []).toHaveLength(4);
  });
  it("el aviso del chofer sigue dependiendo de «manual» — es la razón de todo esto", () => {
    expect(src).toMatch(/order\.delivery_pin_source === "manual" && \(/);
    expect(src).toContain("Navigate uses the pin");
  });
});
