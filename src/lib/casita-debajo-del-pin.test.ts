import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { TIENDA_CLASICA, Z_CASITA_DESPACHO, estiloTienda } from "./store-pins";

/**
 * La casita de los mapas de despacho va DEBAJO del pin de la orden (D-NEXT). Lo que decide esto es un número, y el número
 * solo significa algo comparado con los de las otras capas — que viven dentro de cada motor. Así que la prueba los LEE de
 * los dos motores en vez de repetirlos: si alguien sube el pin o baja la casita, el orden se rompe aquí.
 */

const leer = (rel: string) => readFileSync(join(process.cwd(), rel), "utf8").replace(/\r\n/g, "\n");
const leaflet = leer("src/components/LeafletMap.tsx");
const google = leer("src/components/GoogleMapView.tsx");

/** El z que cada motor le da al pin de una orden, encendido y apagado, sacado de su propia línea. */
function zDelPin(motor: string, cual: "encendido" | "apagado"): number {
  const m = /zIndex(?:Offset)?: p\.dimmed \? (\d+) : (\d+)/.exec(motor);
  if (!m) throw new Error("no encuentro el z del pin de orden en ese motor");
  return Number(cual === "apagado" ? m[1] : m[2]);
}

describe("el z de la casita, comparado con el de las capas que la rodean", () => {
  for (const [nombre, motor] of [["Leaflet", leaflet], ["Google", google]] as const) {
    it(`${nombre}: apagado < casita < pin encendido`, () => {
      const encendido = zDelPin(motor, "encendido"), apagado = zDelPin(motor, "apagado");
      expect(apagado).toBeLessThan(Z_CASITA_DESPACHO);
      expect(Z_CASITA_DESPACHO).toBeLessThan(encendido);
    });
    it(`${nombre}: la capa de tiendas usa la constante, no un número suyo`, () => {
      const capa = motor.slice(motor.indexOf("s.papel ? estiloTienda(s.papel)"), motor.indexOf("Live drivers"));
      expect(capa).toContain("estilo ? estilo.zIndex : Z_CASITA_DESPACHO");
      expect(capa).not.toMatch(/estilo\.zIndex : \d+/);
    });
  }
  it("el camión en vivo sigue por encima de todo, y la casita del selector de pin no se toca", () => {
    for (const motor of [leaflet, google]) {
      const z = [...motor.matchAll(/zIndex(?:Offset)?: (\d+)/g)].map((m) => Number(m[1]));
      expect(Math.max(...z)).toBe(1500);                                  // el camión
    }
    // El selector de la ficha (D-222) pinta las tiendas «con papel» y manda su propio z: ni lo mira esta decisión.
    expect(estiloTienda("origen").zIndex).toBe(900);
    expect(estiloTienda("otra").zIndex).toBe(800);
    expect(Z_CASITA_DESPACHO).toBeLessThan(estiloTienda("otra").zIndex);
  });
  it("el dibujo y el tamaño de la casita NO cambian: esto es solo el orden de las capas", () => {
    expect(TIENDA_CLASICA).toEqual({ fill: "#0b3d91", diametro: 26, borde: "#fff", grosor: 2 });
    // Y sigue respondiendo al ratón donde no hay pin encima: su nombre se ve al pasar por ella.
    expect(leaflet).toContain("interactive: true }");
    expect(leaflet).toContain('marker.bindTooltip(`🏬 ${s.name}`');
    expect(google).toContain("title: `🏬 ${s.name}`,");
  });
});
