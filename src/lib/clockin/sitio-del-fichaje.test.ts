import { describe, expect, it } from "vitest";
import { COLUMNAS_DE_GEOCERCA, sitioDelFichaje, type ClienteDeSitios } from "./sitio-del-fichaje";

/**
 * Tres estados, no dos (hallazgo C-3 de la auditoría del 2026-10-09).
 *
 * Lo que se mide aquí es la frontera entre «está fuera» y «no se pudo preguntar», porque lo que
 * salía antes de esa confusión era una fila de `exceptions` tipo `out_of_radius` contra una
 * persona, idéntica a la de un fraude. Las pruebas de abajo con la base ROTA son el motivo de que
 * el fichero exista; las de la geocerca en sí ya las cubre `geofence.ts`.
 */

const EMPRESA = "99999999-9999-9999-9999-999999999999";
const SITIO = "11111111-1111-1111-1111-111111111111";

/** Un sitio circular de 50 m. Las coordenadas son de la zona, no de nadie. */
const CIRCULO = { id: SITIO, latitude: 25.9593, longitude: -97.5091, radius_meters: 50, boundary: null, padding_meters: null };
/** Dentro: el centro mismo. Lejos: ~30 km al norte, fuera de cualquier radio y de su holgura. */
const DENTRO = { lat: 25.9593, lng: -97.5091 };
const LEJOS = { lat: 26.2045, lng: -98.1673 };

type Respuesta = { data: unknown[] | null; error: { message?: string | null } | null };
type Llamada = { tabla: string; columnas: string; filtros: [string, unknown][] };

/** Una base falsa que contesta lo que se le diga y apunta qué se le preguntó. */
function base(respuesta: Respuesta) {
  const llamadas: Llamada[] = [];
  const cliente = {
    from(tabla: string) {
      const l: Llamada = { tabla, columnas: "", filtros: [] };
      llamadas.push(l);
      const eslabon = {
        select(columnas: string) { l.columnas = columnas; return eslabon; },
        eq(col: string, v: unknown) { l.filtros.push([col, v]); return eslabon; },
        then: (ok: (v: Respuesta) => unknown, fail?: (e: unknown) => unknown) => Promise.resolve(respuesta).then(ok, fail),
      };
      return eslabon;
    },
  };
  return { cliente: cliente as unknown as ClienteDeSitios, llamadas };
}

describe("sitioDelFichaje", () => {
  it("dentro de un sitio: devuelve ese sitio y «en el sitio»", async () => {
    const { cliente } = base({ data: [CIRCULO], error: null });
    expect(await sitioDelFichaje(cliente, EMPRESA, DENTRO.lat, DENTRO.lng)).toEqual({ medido: true, siteId: SITIO, onSite: true });
  });

  it("fuera de todos los sitios: medido, sin sitio y «fuera»", async () => {
    const { cliente } = base({ data: [CIRCULO], error: null });
    expect(await sitioDelFichaje(cliente, EMPRESA, LEJOS.lat, LEJOS.lng)).toEqual({ medido: true, siteId: null, onSite: false });
  });

  it("una lista vacía SÍ es una respuesta: la empresa no tiene sitios, y entonces está fuera", async () => {
    const { cliente } = base({ data: [], error: null });
    expect(await sitioDelFichaje(cliente, EMPRESA, DENTRO.lat, DENTRO.lng)).toEqual({ medido: true, siteId: null, onSite: false });
  });

  it("si el SELECT falla NO dice que esté fuera: dice que no se midió", async () => {
    // El fallo de C-3, en una línea: antes de esto, `data: null` se leía como `sites ?? []`, no
    // casaba con ningún sitio y salía `onSite: false` — el mismo valor que un fichaje de verdad
    // fuera de radio, y con él la excepción `out_of_radius` contra la persona.
    const { cliente } = base({ data: null, error: { message: "canceling statement due to statement timeout" } });
    const r = await sitioDelFichaje(cliente, EMPRESA, DENTRO.lat, DENTRO.lng);
    expect(r.medido).toBe(false);
    expect("onSite" in r).toBe(false);
  });

  it("un error con filas de todas formas tampoco se mide: media lectura no es una lectura", async () => {
    const { cliente } = base({ data: [CIRCULO], error: { message: "RLS" } });
    expect((await sitioDelFichaje(cliente, EMPRESA, DENTRO.lat, DENTRO.lng)).medido).toBe(false);
  });

  it("`data` nulo sin error tampoco se lee como lista vacía", async () => {
    const { cliente } = base({ data: null, error: null });
    const r = await sitioDelFichaje(cliente, EMPRESA, DENTRO.lat, DENTRO.lng);
    expect(r).toEqual({ medido: false, detalle: "job_sites no devolvió filas ni error" });
  });

  it("el detalle del fallo viaja, para que quien llame pueda contarlo", async () => {
    const { cliente } = base({ data: null, error: { message: "permission denied for table job_sites" } });
    const r = await sitioDelFichaje(cliente, EMPRESA, DENTRO.lat, DENTRO.lng);
    expect(r.medido === false && r.detalle).toBe("permission denied for table job_sites");
  });

  it("el bypass de desarrollo marca «en el sitio» aunque no haya ninguno", async () => {
    const { cliente } = base({ data: [], error: null });
    expect(await sitioDelFichaje(cliente, EMPRESA, LEJOS.lat, LEJOS.lng, true)).toEqual({ medido: true, siteId: null, onSite: true });
  });

  it("pero el bypass NO tapa un fallo de lectura: sigue sin medirse", async () => {
    // Antes sí lo tapaba (`!!siteId || DEV_BYPASS_GEOFENCE`), así que en local una lectura rota se
    // veía como «en el sitio» y nadie se enteraba de que estaba rota.
    const { cliente } = base({ data: null, error: { message: "timeout" } });
    expect((await sitioDelFichaje(cliente, EMPRESA, DENTRO.lat, DENTRO.lng, true)).medido).toBe(false);
  });

  it("pregunta por los sitios ACTIVOS de esa empresa, y por las columnas de la geocerca", async () => {
    const { cliente, llamadas } = base({ data: [], error: null });
    await sitioDelFichaje(cliente, EMPRESA, DENTRO.lat, DENTRO.lng);
    expect(llamadas).toEqual([
      { tabla: "job_sites", columnas: COLUMNAS_DE_GEOCERCA, filtros: [["company_id", EMPRESA], ["active", true]] },
    ]);
    // Las columnas que la geocerca necesita de verdad: sin `boundary` un sitio de polígono no casa.
    for (const c of ["id", "latitude", "longitude", "radius_meters", "boundary", "padding_meters"]) {
      expect(COLUMNAS_DE_GEOCERCA, c).toContain(c);
    }
  });
});
