import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  EVENTO_NO_ENCONTRADA,
  NOTA_NO_ENCONTRADA,
  avisoUbicacion,
  claveDireccion,
  necesitaUbicacion,
  parcheDeUbicacion,
  resultadoDeRespuesta,
} from "./geocode-on-save";

// El camino que se cierra: un pedido con dirección y sin punto solo se geocodificaba si alguien
// abría Mapa o Rutas con ese pedido dentro del día que miraba. Medición del 2026-09-08: 13 sin
// punto, todos con dirección, ocho de ellos ya entregados y de días cerrados. Y sin punto la zona
// la decide el nombre de la ciudad (D-219) — o sea que esto decide una tarifa.

const leer = (r: string) => readFileSync(join(process.cwd(), r), "utf8");
const DIR = "1 Palm Ave, McAllen, TX";

describe("a qué pedido hay que buscarle el punto", () => {
  it("con dirección y sin coordenadas: sí", () => {
    expect(necesitaUbicacion({ delivery_address: DIR })).toBe(true);
    expect(necesitaUbicacion({ delivery_address: DIR, delivery_lat: null, delivery_lng: null })).toBe(true);
  });
  it("con las dos coordenadas puestas: no, ni aunque se guarde mil veces", () => {
    expect(necesitaUbicacion({ delivery_address: DIR, delivery_lat: 26.2, delivery_lng: -98.2 })).toBe(false);
  });
  it("sin dirección: no hay nada que buscar, y no se gasta una llamada en averiguarlo", () => {
    for (const a of ["", "   ", null, undefined]) {
      expect(necesitaUbicacion({ delivery_address: a, delivery_lat: null }), String(a)).toBe(false);
    }
  });
  it("media coordenada es no tener punto", () => {
    // Una fila a medias no se queda a medias para siempre.
    expect(necesitaUbicacion({ delivery_address: DIR, delivery_lat: 26.2, delivery_lng: null })).toBe(true);
    expect(necesitaUbicacion({ delivery_address: DIR, delivery_lat: null, delivery_lng: -98.2 })).toBe(true);
  });
  it("`0,0` cuenta como NO tener punto — lo mismo que decidió D-219", () => {
    // Es el Golfo de Guinea, nunca una entrega. Si aquí dijera «ya tiene punto» y `puntoEnZonaLocal`
    // dijera «no tiene», el pedido se quedaría sin ubicar Y sin zona por pin: lo peor de las dos.
    expect(necesitaUbicacion({ delivery_address: DIR, delivery_lat: 0, delivery_lng: 0 })).toBe(true);
    // Pero un 0 solo en una de las dos es una coordenada legítima (meridiano/ecuador), no un hueco.
    expect(necesitaUbicacion({ delivery_address: DIR, delivery_lat: 0, delivery_lng: -98.2 })).toBe(false);
  });
  it("NaN o infinito no son un punto", () => {
    expect(necesitaUbicacion({ delivery_address: DIR, delivery_lat: NaN, delivery_lng: -98.2 })).toBe(true);
    expect(necesitaUbicacion({ delivery_address: DIR, delivery_lat: 26.2, delivery_lng: Infinity })).toBe(true);
  });
});

describe("la dirección como clave: un intento por dirección, no por pulsación", () => {
  it("espacios y mayúsculas no hacen de una dirección dos", () => {
    expect(claveDireccion("  1 PALM   Ave, McAllen, TX ")).toBe(claveDireccion(DIR));
  });
  it("dos direcciones distintas siguen siendo dos", () => {
    expect(claveDireccion("1 Palm Ave")).not.toBe(claveDireccion("2 Palm Ave"));
  });
  it("vacío y nulo dan la misma clave vacía, y esa nunca llega a pedirse", () => {
    expect(claveDireccion(null)).toBe("");
    expect(claveDireccion(undefined)).toBe("");
    expect(necesitaUbicacion({ delivery_address: "" })).toBe(false);
  });
});

describe("qué significó la respuesta — y por qué no todos los fallos son iguales", () => {
  it("200 con coordenadas: encontrado", () => {
    expect(resultadoDeRespuesta(200, { lat: 26.2, lng: -98.2 })).toEqual({ kind: "ok", lat: 26.2, lng: -98.2 });
  });
  it("404: la dirección no existe para el proveedor — definitivo", () => {
    // La ruta ya agotó Google, Mapbox y OSM antes de devolverlo (`api/geocode-point`), así que
    // repetirla daría el mismo 404. Esto es lo que permite no reintentar sin dejar de reintentar
    // NUNCA: solo este caso se recuerda.
    expect(resultadoDeRespuesta(404, { error: "Address not found" })).toEqual({ kind: "noEncontrada" });
  });
  it("500, 401, 0: temporal — se reintenta al volver a guardar", () => {
    for (const s of [500, 502, 401, 429, 0]) {
      expect(resultadoDeRespuesta(s, null), String(s)).toEqual({ kind: "falloTemporal" });
    }
  });
  it("200 con basura NO marca la dirección: el fallo es nuestro, no de ella", () => {
    // Si esto contara como «no encontrada», un error de nuestro lado dejaría esa dirección sin
    // punto para siempre, y el motivo verdadero no aparecería en ningún sitio.
    for (const cuerpo of [null, {}, { lat: "26.2", lng: "-98.2" }, { lat: 26.2 }, { lat: NaN, lng: 1 }]) {
      expect(resultadoDeRespuesta(200, cuerpo), JSON.stringify(cuerpo)).toEqual({ kind: "falloTemporal" });
    }
  });
  it("un `0,0` devuelto por el proveedor se rechaza: sería guardar un punto falso", () => {
    // Y encima uno que D-219 lee como «sin punto», o sea que quedaría un pedido con coordenadas
    // que ninguna pantalla usa. Mejor no escribirlo.
    expect(resultadoDeRespuesta(200, { lat: 0, lng: 0 })).toEqual({ kind: "falloTemporal" });
  });
});

describe("lo que se escribe en la base", () => {
  it("`geocoded`, NUNCA `manual` (D-221)", () => {
    // El aviso al chofer —«sin dirección formal, Navegar usa el pin»— se enciende solo con
    // `manual`. Esto no lo puso nadie: etiquetarlo así le mentiría justo en el pedido cuya
    // dirección se acaba de encontrar.
    expect(parcheDeUbicacion({ lat: 26.2, lng: -98.2 })).toEqual({
      delivery_lat: 26.2, delivery_lng: -98.2, delivery_pin_source: "geocoded",
    });
  });
  it("el parche no toca nada más que el punto y su procedencia", () => {
    expect(Object.keys(parcheDeUbicacion({ lat: 1, lng: 2 })).sort())
      .toEqual(["delivery_lat", "delivery_lng", "delivery_pin_source"]);
  });
  it("lo que se escribe deja de necesitar ubicación: no hay segunda vuelta", () => {
    // La escritura pasa otra vez por `updateDelivery`, que vuelve a preguntar. Si esto no fuera
    // cierto, cada guardado dispararía una llamada más, para siempre.
    const p = parcheDeUbicacion({ lat: 26.2, lng: -98.2 });
    expect(necesitaUbicacion({ delivery_address: DIR, ...p })).toBe(false);
  });
});

describe("el fallo deja de ser mudo", () => {
  it("cada fallo tiene su aviso, en los dos idiomas, y el acierto no avisa de nada", () => {
    expect(avisoUbicacion({ kind: "ok", lat: 1, lng: 2 }, "en")).toBeNull();
    expect(avisoUbicacion({ kind: "noEncontrada" }, "en")).toContain("couldn't be found");
    expect(avisoUbicacion({ kind: "noEncontrada" }, "es")).toContain("no se pudo ubicar");
    expect(avisoUbicacion({ kind: "falloTemporal" }, "en")).toContain("retried");
    expect(avisoUbicacion({ kind: "falloTemporal" }, "es")).toContain("reintentará");
  });
  it("los dos avisos dicen primero que el pedido SÍ se guardó", () => {
    // Es lo primero que el usuario necesita saber: no perdió su trabajo. Si el aviso pareciera un
    // error de guardado, volvería a pulsar Guardar, que es otra llamada y ningún arreglo.
    for (const lang of ["en", "es"]) {
      for (const r of [{ kind: "noEncontrada" }, { kind: "falloTemporal" }] as const) {
        expect(avisoUbicacion(r, lang)!.toLowerCase(), `${lang} ${r.kind}`).toMatch(/^(saved|se guardó)/);
      }
    }
  });
  it("el aviso de «no encontrada» dice qué hacer, no solo qué pasó", () => {
    expect(avisoUbicacion({ kind: "noEncontrada" }, "en")).toMatch(/check it|drop the exact pin/i);
    expect(avisoUbicacion({ kind: "noEncontrada" }, "es")).toMatch(/revísela|marque el pin/i);
  });
  it("un idioma desconocido cae al inglés, no a una cadena vacía", () => {
    expect(avisoUbicacion({ kind: "noEncontrada" }, "fr")).toBe(avisoUbicacion({ kind: "noEncontrada" }, "en"));
  });
});

describe("el cableado: una sola definición, y el guardado nunca espera", () => {
  const provider = leer("src/lib/data-provider.tsx");
  const barrido = leer("src/lib/useAutoGeocode.ts");

  it("se dispara en las DOS escrituras, crear y editar", () => {
    // Aquí y no en la ficha: por `addDelivery`/`updateDelivery` pasan todas las formas de crear o
    // editar un pedido —la ficha, la importación de CSV, los repartos—, y una regla que dependa de
    // que cada sitio se acuerde de invocarla se pierde. Es el mismo argumento con el que la
    // autoría de las fotos vive en `updateDelivery`.
    expect(provider.match(/void ubicarSiHaceFalta\(/g) ?? []).toHaveLength(2);
    expect(provider).toContain("void ubicarSiHaceFalta(row.id, row);");
  });
  it("al editar se mira la fila COMO QUEDA, no el parche", () => {
    // Un guardado que no toca la dirección deja un pedido que sigue teniéndola y sigue sin punto:
    // ese es justo el que hay que ubicar. Mirando solo el parche, no se ubicaría nunca.
    expect(provider).toContain("void ubicarSiHaceFalta(id, { ...(before ?? {}), ...patch });");
  });
  it("no bloquea el guardado: `void`, sin `await`", () => {
    expect(provider).not.toMatch(/await ubicarSiHaceFalta/);
  });
  it("el sandbox de enseñanza no gasta cuota de nadie", () => {
    expect(provider).toMatch(/if \(teaching\) return;\s*\/\/ el sandbox no gasta cuota/);
  });
  it("una dirección que no existe no se vuelve a pedir; una que falló por la red, sí", () => {
    // La diferencia entera entre «sin reintentos en bucle» y «sin reintentos nunca».
    expect(provider).toContain('if (resultado.kind === "noEncontrada") {');
    expect(provider).toContain("direccionesSinPunto.current.add(clave);");
    expect(provider).not.toMatch(/falloTemporal[\s\S]{0,80}direccionesSinPunto/);
  });
  it("dos guardados seguidos de la misma dirección no piden dos veces", () => {
    expect(provider).toContain("ubicacionesEnCurso.current.has(clave)");
    expect(provider).toContain("ubicacionesEnCurso.current.delete(clave)");
  });
  it("el fallo definitivo queda en el registro del pedido, con su propio tipo de evento", () => {
    expect(provider).toContain("logEvent(id, EVENTO_NO_ENCONTRADA,");
    expect(EVENTO_NO_ENCONTRADA).toBe("geocode_failed");
    expect(NOTA_NO_ENCONTRADA).toContain("No se pudo ubicar");
  });
  it("el barrido viejo usa las MISMAS funciones: no hay una tercera definición", () => {
    // Si cada camino decidiera por su cuenta qué es «necesita punto», se separarían con el tiempo
    // y un pedido podría estar ubicado para uno y no para el otro.
    expect(barrido).toContain('from "@/lib/geocode-on-save"');
    expect(barrido).toContain("necesitaUbicacion(d)");
    expect(barrido).toContain("parcheDeUbicacion(resultado)");
    // Y ya no queda escrito a mano ni el criterio ni el parche.
    expect(barrido).not.toContain("d.delivery_lat == null &&");
    expect(barrido).not.toContain('delivery_pin_source: "geocoded"');
  });
  it("el `catch {}` mudo de antes ya no decide nada", () => {
    // Era la línea que dejaba una dirección sin punto para siempre y sin rastro. El `catch` que
    // queda solo cubre la red, y su rama de negocio la decide `resultadoDeRespuesta`.
    expect(barrido).not.toContain("best-effort — a pin just won't appear");
    expect(barrido).toContain("resultadoDeRespuesta(res.status,");
  });
  it("nada retroactivo ni masivo en el guardado: se ubica el pedido que se guarda, y solo ese", () => {
    const desde = provider.indexOf("const ubicarSiHaceFalta");
    const trozo = provider.slice(desde, provider.indexOf("// ---------------- Delivery CRUD"));
    expect(trozo).not.toMatch(/deliveries\.filter|for \(const|\.map\(/);
    expect(trozo.match(/fetch\(/g) ?? []).toHaveLength(1);
  });
});
