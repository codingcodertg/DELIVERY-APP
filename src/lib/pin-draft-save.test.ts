import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fuenteAlAplicar, pinDraftParaGuardar, type PinSource } from "./pin-draft";

// Cierra el camino que dejó dos pedidos del dueño sin coordenadas (D-NEXT): colocó el pin, lo vio
// en el área verde, guardó la orden sin pulsar «Save pin», y el punto se perdió.
//
// La regla se importa de `lib/pin-draft.ts` y se prueba de verdad — no una copia—, porque lo que
// decide son las coordenadas y la procedencia que acaban en la base, no cómo se pintan.

const leer = (r: string) => readFileSync(join(process.cwd(), r), "utf8");

type Fuente = PinSource | null;
type Pedido = { delivery_lat: number | null; delivery_lng: number | null; delivery_pin_source: Fuente };

/**
 * La misma llamada que hace la ficha al guardar. `showPinPicker` y `pinDraft` se combinan aquí en
 * el punto visible **igual que en la pantalla**, que es de donde sale el único dato que el módulo
 * recibe: si se enseña, se guarda.
 */
const pinParaGuardar = (
  showPinPicker: boolean,
  pinDraft: [number, number] | null,
  pinDraftSource: Fuente,
  d: Pedido,
) => pinDraftParaGuardar({ visible: showPinPicker && pinDraft ? pinDraft : null, fuente: pinDraftSource, pedido: d });

const SIN_PIN: Pedido = { delivery_lat: null, delivery_lng: null, delivery_pin_source: null };
const CON_PIN: Pedido = { delivery_lat: 26.2034, delivery_lng: -98.23, delivery_pin_source: "geocoded" };
const NUEVO: [number, number] = [26.405, -97.795];

describe("el pin en borrador se guarda con el pedido", () => {
  it("EL CASO DEL DUEÑO: pedido sin pin, suelta el pin y guarda la orden → el punto se guarda", () => {
    expect(pinParaGuardar(true, NUEVO, "manual", SIN_PIN)).toEqual({
      delivery_lat: 26.405, delivery_lng: -97.795, delivery_pin_source: "manual",
    });
  });
  it("mutación: la regla vieja —guardar solo lo que ya está en el pedido— dejaba el pedido sin punto", () => {
    // Lo que hacía main: el payload salía de `d` y el borrador no entraba. Con el pedido sin pin,
    // eso es exactamente perder el punto, que es lo que le pasó al dueño dos veces.
    const comoAntes = (d: Pedido) =>
      d.delivery_lat != null && d.delivery_lng != null
        ? { delivery_lat: d.delivery_lat, delivery_lng: d.delivery_lng, delivery_pin_source: d.delivery_pin_source }
        : null;
    expect(comoAntes(SIN_PIN)).toBeNull();
    expect(pinParaGuardar(true, NUEVO, "manual", SIN_PIN)).toMatchObject({ delivery_lat: 26.405 });
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
  it("BUSCAR DIRECCIÓN con pin ya guardado: SÍ se guarda el nuevo — se guarda lo que se ve", () => {
    // Se probó la regla contraria (no pisar un pin previo) y era peor: el usuario veía un punto y
    // se guardaba otro. Quien solo quería comprobar una dirección, cancela (D-220).
    const conPinManual: Pedido = { delivery_lat: 26.1, delivery_lng: -97.5, delivery_pin_source: "manual" };
    expect(pinParaGuardar(true, NUEVO, "geocoded", conPinManual)).toMatchObject({ delivery_lat: 26.405, delivery_pin_source: "geocoded" });
    expect(pinParaGuardar(true, NUEVO, "geocoded", CON_PIN)).toMatchObject({ delivery_pin_source: "geocoded" });
  });
  it("y el clic derecho también pisa lo que hubiera", () => {
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

describe("las transiciones entre puertas: manda el ÚLTIMO gesto", () => {
  // Lo que se olvida al mirar cada puerta por separado. La procedencia la pone la vía que tocó el
  // borrador la última vez, así que basta con seguir esa secuencia.
  it("buscar dirección y luego mover el pin a mano → «manual»: el usuario corrigió la propuesta", () => {
    let fuente: Fuente = null;
    fuente = "geocoded";                                   // lookupAddress
    fuente = "manual";                                     // dropPin encima
    expect(pinParaGuardar(true, NUEVO, fuente, SIN_PIN)).toMatchObject({ delivery_pin_source: "manual" });
  });
  it("poner el pin a mano y luego buscar la dirección → «geocoded», y se guarda ESE punto", () => {
    // El que peor sienta de los tres, y por eso está escrito: el punto que el usuario había puesto
    // a mano se sustituye por el del buscador. Es coherente con «se guarda lo que se ve», y quien
    // no quiera la propuesta la cancela.
    let fuente: Fuente = null;
    fuente = "manual";                                     // dropPin
    fuente = "geocoded";                                   // lookupAddress encima
    const conPinManual: Pedido = { delivery_lat: 26.1, delivery_lng: -97.5, delivery_pin_source: "manual" };
    expect(pinParaGuardar(true, NUEVO, fuente, conPinManual)).toMatchObject({ delivery_lat: 26.405, delivery_pin_source: "geocoded" });
  });
  it("la procedencia vive en UN estado compartido por las dos vías de mapa, no uno por bloque", () => {
    const src = leer("src/components/OrderModal.tsx");
    expect((src.match(/const \[pinDraftSource, setPinDraftSource\] = useState/g) ?? [])).toHaveLength(1);
    expect((src.match(/const \[pinDraft, setPinDraft\] = useState/g) ?? [])).toHaveLength(1);
  });
  it("y el tipo impide inventarse un valor: el estado es una unión cerrada, no `string`", () => {
    const src = leer("src/components/OrderModal.tsx");
    expect(src).toMatch(/useState<PinSource \| null>\(null\)/);
    expect(leer("src/lib/pin-draft.ts")).toMatch(/export type PinSource = "manual" \| "geocoded";/);
    expect(leer("src/lib/pin-draft.ts")).toMatch(/export type PinParaGuardar = Pick<Delivery, "delivery_lat" \| "delivery_lng" \| "delivery_pin_source">;/);
  });
});

describe("la ficha usa esa regla, y las dos vías de mapa la comparten", () => {
  const src = leer("src/components/OrderModal.tsx");

  it("lo que se enseña y lo que se guarda salen del MISMO dato, no de dos expresiones que coinciden", () => {
    // `pinVisible` decide la zona (:291) y es lo que se le pasa al módulo. Mientras sea el mismo
    // valor, no puede haber un aviso que diga una cosa y un guardado que haga otra.
    expect(src).toMatch(/const pinVisible = showPinPicker && pinDraft \? pinDraft : null;/);
    expect(src).toMatch(/pinDraftParaGuardar\(\{ visible: pinVisible, fuente: pinDraftSource, pedido: d \}\)/);
    expect(src).toMatch(/\.\.\.withDurations\(d\),/);
    // Y el módulo no puede reconstruir «visible» por su cuenta: no recibe las piezas.
    expect(leer("src/lib/pin-draft.ts")).not.toContain("selectorAbierto");
  });
  it("y «Save pin» usa la misma fuente, no «manual» a secas", () => {
    expect(fuenteAlAplicar("geocoded")).toBe("geocoded");
    expect(fuenteAlAplicar("manual")).toBe("manual");
    expect(fuenteAlAplicar(null)).toBe("manual");
    expect(src).toMatch(/set\("delivery_pin_source", fuenteAlAplicar\(pinDraftSource\)\)/);
  });
  it("la ficha NO tiene su propia copia de la regla: la importa", () => {
    // Lo que hace que esta prueba valga: se prueba la función que corre de verdad, no una copia.
    expect(src).toMatch(/import \{ fuenteAlAplicar, pinDraftParaGuardar, type PinSource \} from "@\/lib\/pin-draft";/);
    expect(src).not.toContain("const pinDraftParaGuardar = (");
  });
  it("cada vía declara su procedencia", () => {
    expect(src).toMatch(/setPinDraftSource\("manual"\);\s+\/\/ clic derecho/);          // dropPin
    expect(src).toMatch(/setPinDraftSource\("geocoded"\); setShowPinPicker\(true\);/);  // lookupAddress
    // Abrir el selector hereda la del pedido, en los DOS mapas.
    // Sin `as`: `Delivery.delivery_pin_source` ya es esa unión, y un cast de más ocultaría mañana
    // un cambio de tipo.
    expect(src.match(/setPinDraftSource\(d\.delivery_pin_source \?\? null\);/g) ?? []).toHaveLength(2);
    expect(src).not.toContain("as PinSource | null");
  });
  it("y limpiar el borrador limpia también su procedencia, en los dos mapas", () => {
    expect(src.match(/setPinDraft\(null\); setPinDraftSource\(null\); setShowPinPicker\(false\);/g) ?? []).toHaveLength(4);
  });
  it("el aviso del chofer sigue dependiendo de «manual» — es la razón de todo esto", () => {
    expect(src).toMatch(/order\.delivery_pin_source === "manual" && \(/);
    expect(src).toContain("Navigate uses the pin");
  });
});
