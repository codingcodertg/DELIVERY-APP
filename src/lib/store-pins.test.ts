import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  AZUL_ORIGEN_FALLBACK,
  GRIS_OTRA_FALLBACK,
  TIENDA_CLASICA,
  dibujoTienda,
  dibujoTiendaUrl,
  estiloTienda,
  nombreNormalizado,
  tiendasParaElMapa,
} from "./store-pins";

// Pedido del dueño: «donde se pone set location, pon los puntos donde están las tiendas siempre,
// para referencia». Lo que se prueba de verdad aquí es el papel de cada tienda y el dibujo; lo
// que es cableado —quién pasa qué a qué mapa— se comprueba sobre el fuente, abajo.

const leer = (r: string) => readFileSync(join(process.cwd(), r), "utf8");

// Nombres INVENTADOS, y a propósito. Las tiendas de verdad las nombra el dueño desde Ajustes y
// puede renombrarlas cuando quiera: una prueba que afirmara los nombres reales se pondría roja
// ante un cambio de datos legítimo, y el CI estaría señalando como fallo algo que no lo es. Lo
// que aquí se prueba es la LÓGICA de emparejar, que no depende de cómo se llame ninguna tienda.
const SIETE = [
  { name: "Tienda Norte", lat: 25.9, lng: -97.49 },
  { name: "Tienda Sur", lat: 26.16, lng: -97.99 },
  { name: "Tienda Centro", lat: 26.19, lng: -98.18 },
  { name: "Tienda Oeste", lat: 26.2, lng: -98.23 },
  { name: "Tienda Este", lat: 26.21, lng: -98.32 },
  { name: "Almacén Viejo", lat: 26.3, lng: -98.16 },
  { name: "Bodega Azul", lat: 26.18, lng: -98.2 },
];

const papeles = (tienda: string | null | undefined) =>
  Object.fromEntries(tiendasParaElMapa(SIETE, tienda).map((t) => [t.name, t.papel]));

describe("cuál de las siete es la del pedido", () => {
  it("la tienda del pedido es `origen` y las otras seis `otra`", () => {
    const p = papeles("Tienda Oeste");
    expect(p["Tienda Oeste"]).toBe("origen");
    expect(Object.values(p).filter((x) => x === "origen")).toHaveLength(1);
    expect(Object.values(p).filter((x) => x === "otra")).toHaveLength(6);
  });
  it("un pedido cuya tienda ya no está en Ajustes: ninguna destacada, y no revienta", () => {
    // El caso de un renombrado, que es cosa corriente: el pedido guardó el nombre viejo. El mapa
    // sigue enseñando las siete como referencia y simplemente no destaca ninguna.
    const p = papeles("Tienda Que Ya No Existe");
    expect(Object.values(p).every((x) => x === "otra")).toBe(true);
    expect(Object.keys(p)).toHaveLength(7);
  });
  it("espacios de sobra y mayúsculas no rompen el destacado", () => {
    // El fallo que evita: un nombre guardado hace meses con un espacio de más dejaría la tienda
    // sin destacar y NADIE vería un error — solo faltaría el azul.
    expect(papeles("  tienda oeste  ")["Tienda Oeste"]).toBe("origen");
    expect(papeles("Tienda  Oeste")["Tienda Oeste"]).toBe("origen");
    expect(papeles("BODEGA AZUL")["Bodega Azul"]).toBe("origen");
    expect(nombreNormalizado("  Tienda   Centro ")).toBe("tienda centro");
  });
  it("normaliza, pero NO empareja cosas distintas", () => {
    // La frontera que puso el orquestador: espacios y mayúsculas, nada más. Ni prefijos, ni
    // parecidos, ni acentos — dos tiendas distintas siguen siendo distintas.
    expect(papeles("Tienda")["Tienda Centro"]).toBe("otra");
    expect(papeles("Oeste")["Tienda Oeste"]).toBe("otra");
    expect(papeles("Tienda Oeste ")["Tienda Este"]).toBe("otra");
  });
  it("sin tienda elegida, o con una que no existe, todas son referencia", () => {
    for (const v of [null, undefined, "", "   ", "Tienda Fantasma"]) {
      expect(Object.values(papeles(v)).every((x) => x === "otra"), String(v)).toBe(true);
    }
  });
  it("no pierde ni inventa tiendas, y conserva sus coordenadas", () => {
    const salida = tiendasParaElMapa(SIETE, "Tienda Centro");
    expect(salida).toHaveLength(7);
    expect(salida.map((t) => t.name)).toEqual(SIETE.map((t) => t.name));
    expect(salida[2]).toMatchObject({ name: "Tienda Centro", lat: 26.19, lng: -98.18, papel: "origen" });
  });
  it("lista vacía: no revienta", () => {
    expect(tiendasParaElMapa([], "Tienda Centro")).toEqual([]);
  });
});

describe("una tienda no se confunde con la entrega, ni la del pedido con las demás", () => {
  it("la destacada es más grande, azul y lleva el nombre puesto", () => {
    const o = estiloTienda("origen"), x = estiloTienda("otra");
    expect(o.lado).toBeGreaterThan(x.lado);
    expect(o.etiquetaPermanente).toBe(true);
    expect(x.etiquetaPermanente).toBe(false);
    expect(o.fill).not.toBe(x.fill);
    expect(o.zIndex).toBeGreaterThan(x.zIndex);
  });
  it("ni rojo ni verde: el pin de la entrega es rojo y la zona local verde (D-219)", () => {
    // El motivo entero del encargo es que un vistazo baste. Dos rojos en el mismo mapa no lo son.
    for (const e of [estiloTienda("origen"), estiloTienda("otra")]) {
      expect(e.fill).not.toBe(TIENDA_CLASICA.fill);
      expect(e.fill).not.toBe("#1f9d61");   // = --green, el de la zona
      expect(e.fill).not.toBe("#d64545");   // = --red
    }
    expect([AZUL_ORIGEN_FALLBACK, GRIS_OTRA_FALLBACK]).toEqual(["#2456c9", "#6b7686"]);
  });
  it("los respaldos son los valores REALES del tema, no colores inventados", () => {
    // La misma regla que el verde de la zona: si el literal se despega de `globals.css`, el mapa
    // pinta un color que no existe en la app en cuanto falta el DOM.
    const css = leer("src/app/globals.css");
    expect(css).toContain(`--accent: ${AZUL_ORIGEN_FALLBACK};`);
    expect(css).toContain(`--gray: ${GRIS_OTRA_FALLBACK};`);
  });
  it("la forma distingue sin color: un cuadrado, no una gota ni un círculo", () => {
    // En blanco y negro también se tiene que ver cuál es la entrega: los pines de pedido son
    // círculos y el de la entrega una gota (📍).
    const d = dibujoTienda(estiloTienda("otra"), "Tienda Centro");
    expect(d.svg).toContain("<rect");
    expect(d.svg).not.toContain("<circle");
  });
});

describe("el dibujo: uno solo para los dos motores", () => {
  it("el ancla es el centro del cuadrado, no el del lienzo con la etiqueta", () => {
    // Si el ancla fuera el centro del lienzo, la tienda destacada aparecería desplazada al norte
    // de donde está de verdad, y solo la destacada — un error que se ve raro y no se explica.
    const e = estiloTienda("origen");
    const d = dibujoTienda(e, "Tienda Norte");
    expect(d.anclaX).toBe(d.ancho / 2);
    expect(d.anclaY).toBeCloseTo(e.grosor + 1 + e.lado / 2, 6);
    expect(d.anclaY).toBeLessThan(d.alto / 2);   // el lienzo crece hacia abajo por la etiqueta
  });
  it("sin etiqueta permanente no hay texto en el SVG y el lienzo es del tamaño del cuadrado", () => {
    const e = estiloTienda("otra");
    const d = dibujoTienda(e, "Tienda Sur");
    expect(d.svg).not.toContain("<text");
    expect(d.alto).toBe(e.lado + e.grosor * 2 + 2);
    expect(d.anclaY).toBeCloseTo(d.alto / 2, 6);
  });
  it("la etiqueta lleva el nombre y el lienzo crece con él", () => {
    const e = estiloTienda("origen");
    const corto = dibujoTienda(e, "Tienda Centro");
    const largo = dibujoTienda(e, "Almacén de la Carretera Vieja");
    expect(corto.svg).toContain(">Tienda Centro</text>");
    expect(largo.ancho).toBeGreaterThan(corto.ancho);
    expect(largo.alto).toBe(corto.alto);   // solo crece a lo ancho
  });
  it("un `&` o un `<` en el nombre no rompen el SVG", () => {
    // El mismo saneado que `pinIcon`: un nombre es dato de Ajustes, y acaba dentro de un XML.
    const d = dibujoTienda(estiloTienda("origen"), 'Tile & Stone <"Norte">');
    // El SVG lleva `<` y `>` propios (son etiquetas), pero ninguno puede venir del nombre: si el
    // saneado fallara, el `<"Norte">` abriría una etiqueta y el marcador no se dibujaría.
    expect(d.svg).not.toContain("&");
    expect(d.svg).not.toContain('<"');
    expect(d.svg).toContain(">Tile  Stone Norte</text>");
  });
  it("la URL `data:` de Google lleva exactamente el mismo SVG que Leaflet inserta tal cual", () => {
    // Es la razón de que el dibujo viva en el módulo: `MapView` conmuta según haya llave, y
    // producción usa Google. Un cuadrado que solo existiera en un motor sería medio arreglo.
    const e = estiloTienda("origen");
    const url = dibujoTiendaUrl(e, "Tienda Oeste");
    expect(decodeURIComponent(url.url.replace("data:image/svg+xml;charset=UTF-8,", ""))).toBe(dibujoTienda(e, "Tienda Oeste").svg);
    expect(url.anclaX).toBe(dibujoTienda(e, "Tienda Oeste").anclaX);
  });
});

describe("el cableado: quién pasa qué, y a quién NO", () => {
  const modal = leer("src/components/OrderModal.tsx");
  const leaflet = leer("src/components/LeafletMap.tsx");
  const google = leer("src/components/GoogleMapView.tsx");

  it("los DOS selectores de pin de la ficha reciben las tiendas con su papel", () => {
    expect(modal.match(/stores=\{tiendasConPapel\}/g) ?? []).toHaveLength(2);
    expect(modal).toContain("const tiendasDelMapa = useStoreMarkers(settings.stores);");
    expect(modal).toContain("tiendasParaElMapa(tiendasDelMapa, d.store)");
  });
  it("el encuadre NO cambia: las tiendas no entran en `fitTo` ni en `center`", () => {
    // Criterio 4 del encargo. Con siete puntos en el marco el mapa se alejaría y se perdería el
    // detalle alrededor del pin, que es justo lo que se está mirando.
    expect(modal).not.toMatch(/fitTo=\{[^}]*tienda/i);
    expect(modal).not.toMatch(/center=\{[^}]*tienda/i);
    // Y en los motores, el efecto que dibuja tiendas sigue sin tocar el encuadre: va desde que
    // vacía su lista de marcadores hasta el cierre `}, [stores…]`.
    for (const [nombre, src] of [["leaflet", leaflet], ["google", google]] as const) {
      const desde = src.indexOf("storeMarkersRef.current = [];");
      const hasta = src.indexOf("}, [stores", desde);
      expect(desde, nombre).toBeGreaterThan(0);
      expect(hasta, nombre).toBeGreaterThan(desde);
      expect(src.slice(desde, hasta), nombre).not.toMatch(/fitBounds|latLngBounds|LatLngBounds|\.extend\(|setView|setZoom/);
    }
  });
  it("el dibujo se EXTIENDE, no se reescribe: un solo módulo y ningún rojo suelto", () => {
    // Si el rojo volviera a estar escrito en los motores, cambiarlo dejaría de ser un solo sitio
    // y las cuatro pantallas de despacho se desincronizarían sin que nadie lo notara.
    expect(leaflet).toContain('from "@/lib/store-pins"');
    expect(google).toContain('from "@/lib/store-pins"');
    expect(leaflet).not.toContain(TIENDA_CLASICA.fill);
    expect(google).not.toContain(TIENDA_CLASICA.fill);
    expect(leer("src/lib/store-pins.ts")).toContain(`fill: "${TIENDA_CLASICA.fill}"`);
  });
  it("el punto rojo de siempre sale IDÉNTICO, carácter a carácter, en los dos motores", () => {
    // Esto no es una impresión: son los dos literales que main tenía escritos a mano, copiados
    // aquí tal cual, y reconstruidos desde la constante. Si alguien toca `TIENDA_CLASICA`
    // creyendo que solo afecta a la ficha, esta prueba le enseña los cuatro mapas de despacho
    // (Mapa, Rutas, Mi ruta, Rastreo) que acaba de mover.
    //
    // Y OJO con la asimetría, que es de main y esta rama no la corrige: los dos motores NO
    // dibujan la tienda igual. Google es un SVG de 26×26 con el borde a caballo del trazo;
    // Leaflet es un div de 24×24 con el borde por fuera y sombra. Cada uno conserva el suyo
    // exactamente — que es la única forma de no cambiar nada en las cuatro pantallas.
    expect(TIENDA_CLASICA).toEqual({ fill: "#e11414", diametro: 24, borde: "#fff", grosor: 3 });

    const googleDeMain = `<svg xmlns="http://www.w3.org/2000/svg" width="26" height="26" viewBox="0 0 26 26"><circle cx="13" cy="13" r="9" fill="#e11414" stroke="#fff" stroke-width="3"/></svg>`;
    const googleDeAhora =
      `<svg xmlns="http://www.w3.org/2000/svg" width="26" height="26" viewBox="0 0 26 26">` +
      `<circle cx="13" cy="13" r="9" fill="${TIENDA_CLASICA.fill}" stroke="${TIENDA_CLASICA.borde}" ` +
      `stroke-width="${TIENDA_CLASICA.grosor}"/></svg>`;
    expect(googleDeAhora).toBe(googleDeMain);

    const leafletDeMain = `<div style="width:24px;height:24px;border-radius:50%;background:#e11414;border:3px solid #fff;box-shadow:0 2px 6px rgba(0,0,0,.55)"></div>`;
    const leafletDeAhora = `<div style="width:${TIENDA_CLASICA.diametro}px;height:${TIENDA_CLASICA.diametro}px;border-radius:50%;background:${TIENDA_CLASICA.fill};border:${TIENDA_CLASICA.grosor}px solid ${TIENDA_CLASICA.borde};box-shadow:0 2px 6px rgba(0,0,0,.55)"></div>`;
    expect(leafletDeAhora).toBe(leafletDeMain);

    // Y que cada motor siga armando ESA cadena, no otra parecida.
    expect(google).toContain('<circle cx="13" cy="13" r="9" fill="${TIENDA_CLASICA.fill}" stroke="${TIENDA_CLASICA.borde}" ');
    expect(leaflet).toContain("box-shadow:0 2px 6px rgba(0,0,0,.55)");
    expect(leaflet).toContain("iconSize: [TIENDA_CLASICA.diametro, TIENDA_CLASICA.diametro]");
  });
  it("los otros CUATRO mapas que ya pintaban tiendas siguen sin pasar papel", () => {
    for (const ruta of ["src/app/(app)/map/page.tsx", "src/app/(app)/routes/page.tsx", "src/app/(app)/my-route/page.tsx", "src/app/(app)/track/page.tsx"]) {
      const src = leer(ruta);
      expect(src, ruta).toContain("useStoreMarkers(settings.stores)");
      expect(src, ruta).not.toContain("papel");
      expect(src, ruta).not.toContain("store-pins");
    }
  });
  it("`papel` es opcional en el tipo: un mapa que no lo pase compila igual", () => {
    expect(leaflet).toMatch(/papel\?: PapelTienda;/);
  });
  it("las tiendas se leen, no se escriben: cero cambios sobre `settings.stores`", () => {
    expect(modal).not.toMatch(/set\w*\(\s*["']stores["']/);
    expect(modal).not.toMatch(/settings\.stores\s*=/);
    // Y el módulo es puro de verdad: ni importa nada ni habla con nadie. (Se mira el código, no
    // los comentarios, que sí citan `settings.stores` para explicar de dónde vienen los nombres.)
    const modulo = leer("src/lib/store-pins.ts").replace(/\/\*[\s\S]*?\*\/|\/\/.*/g, "");
    expect(modulo).not.toMatch(/\bimport\b|supabase|fetch\(|settings/);
  });
});
