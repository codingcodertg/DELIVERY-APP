import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  AVISO_SIN_CAMARA, CALIDAD_JPEG, LADO_MAXIMO, PETICION_DE_CAMARA, agregarALaRafaga, fotosAlCerrarLaRafaga, hayCamaraEnVivo,
  huecoDeFotos, jpegComprimido, medidasComprimidas, pararCamara, quitarDeLaRafaga, sesionDeCamara, type FlujoDeCamara,
  type NavegadorConCamara,
} from "./camara-de-varias-fotos";

// ============================================================
// D-637 (2026-10-22) · «📸 Varias fotos». El dueño: «que él pueda un solo desde la cámara tomar, no que se lo imponga
// [...] que pueda tomar varias fotos de un solo y que él las pueda subir más rápido». La cámara dentro de la app saca
// varias seguidas y «✅ Listo» las entrega todas; «Entregado» ya no abre la cámara solo; la prueba de entrega y «Fotos del
// material» enseñan las tres opciones.
// ============================================================

// `createPortal` necesita un DOM; aquí basta con pintar lo de dentro tal cual.
vi.mock("react-dom", async (original) => ({ ...(await original<typeof import("react-dom")>()), createPortal: (n: unknown) => n }));
vi.mock("@/lib/data-provider", () => ({ useData: () => ({ teaching: false, notify: () => {} }) }));
vi.mock("@/lib/prefs", () => ({ usePrefs: () => ({ t: (en: string) => en, lang: "en" }) }));

const leer = (r: string) => readFileSync(join(process.cwd(), r), "utf8").split("\r\n").join("\n");
const t = (en: string) => en;
const FOTO = (n: number) => `data:image/jpeg;base64,${Buffer.from(`foto-${n}`).toString("base64")}`;

afterEach(() => { vi.unstubAllGlobals(); });

describe("la compresión: la misma para el fichero elegido y para la ráfaga", () => {
  it("el lado mayor a 1280 como mucho, sin agrandar", () => {
    expect(LADO_MAXIMO).toBe(1280);
    expect(CALIDAD_JPEG).toBe(0.7);
    expect(medidasComprimidas(4000, 3000)).toEqual({ w: 1280, h: 960 });
    expect(medidasComprimidas(3000, 4000)).toEqual({ w: 960, h: 1280 });
    expect(medidasComprimidas(1920, 1080)).toEqual({ w: 1280, h: 720 });
    expect(medidasComprimidas(800, 600)).toEqual({ w: 800, h: 600 });
  });
  it("jpegComprimido dibuja la fuente en un lienzo a esas medidas y la saca como JPEG 0,7", () => {
    const dibujos: unknown[][] = [];
    const lienzo = {
      width: 0, height: 0,
      getContext: () => ({ drawImage: (...a: unknown[]) => dibujos.push(a) }),
      toDataURL: (tipo: string, q: number) => `data:${tipo};q=${q};${lienzo.width}x${lienzo.height}`,
    };
    vi.stubGlobal("document", { createElement: (tag: string) => (tag === "canvas" ? lienzo : null) });
    const video = { soy: "video" };
    expect(jpegComprimido(video as unknown as CanvasImageSource, 1920, 1080)).toBe("data:image/jpeg;q=0.7;1280x720");
    expect(dibujos).toEqual([[video, 0, 0, 1280, 720]]);
  });
  it("PhotoUpload y la ráfaga llaman a la MISMA función (no hay una copia)", () => {
    const grid = leer("src/components/PhotoUpload.tsx");
    const camara = leer("src/components/CamaraDeVariasFotos.tsx");
    expect(grid).toContain("try { resolve(jpegComprimido(img, img.width, img.height)); } catch (e) { reject(e); }");
    expect(camara).toContain("foto = jpegComprimido(video, video.videoWidth, video.videoHeight);");
    for (const src of [grid, camara]) expect(src).not.toContain("toDataURL");
  });
});

describe("la ráfaga: el tope, quitar, y qué se entrega al cerrar", () => {
  it("cada disparo suma una foto hasta el máximo; llena, ya no suma", () => {
    let fotos: string[] = [];
    for (let i = 0; i < 5; i++) fotos = agregarALaRafaga(fotos, FOTO(i), 3);
    expect(fotos).toEqual([FOTO(0), FOTO(1), FOTO(2)]);
  });
  it("la ✕ de una miniatura quita esa y deja las demás en su orden", () => {
    expect(quitarDeLaRafaga([FOTO(0), FOTO(1), FOTO(2)], 1)).toEqual([FOTO(0), FOTO(2)]);
  });
  it("el hueco: lo que cabe en el sitio donde se usa, nunca negativo", () => {
    expect(huecoDeFotos(2, 6)).toBe(4);
    expect(huecoDeFotos(6, 6)).toBe(0);
    expect(huecoDeFotos(8, 6)).toBe(0);
  });
  it("«✅ Listo» entrega TODAS las sacadas, en su orden; «Cancelar», ninguna", () => {
    const tres = [FOTO(0), FOTO(1), FOTO(2)];
    expect(fotosAlCerrarLaRafaga({ tipo: "listo", fotos: tres }, 6)).toEqual(tres);
    expect(fotosAlCerrarLaRafaga({ tipo: "cancelar" }, 6)).toEqual([]);
    // Si el sitio se llenó mientras tanto, entrega las que caben.
    expect(fotosAlCerrarLaRafaga({ tipo: "listo", fotos: tres }, 2)).toEqual([FOTO(0), FOTO(1)]);
    expect(fotosAlCerrarLaRafaga({ tipo: "listo", fotos: tres }, -1)).toEqual([]);
  });
});

describe("abrir y parar la cámara", () => {
  function camaraDePrueba(opts: { niega?: boolean } = {}) {
    const paradas: string[] = [];
    const flujo: FlujoDeCamara = { getTracks: () => [{ stop: () => paradas.push("video") }] };
    const pedidas: unknown[] = [];
    let soltar: (f: FlujoDeCamara) => void = () => {};
    const nav: NavegadorConCamara = {
      mediaDevices: {
        getUserMedia: (c) => {
          pedidas.push(c);
          if (opts.niega) return Promise.reject(new Error("NotAllowedError"));
          return new Promise<FlujoDeCamara>((r) => { soltar = r; });
        },
      },
    };
    return { nav, flujo, paradas, pedidas, soltar: () => soltar(flujo) };
  }

  it("pide la cámara trasera, sin audio", async () => {
    const c = camaraDePrueba();
    const s = sesionDeCamara(c.nav);
    const p = s.abrir();
    c.soltar();
    expect(await p).toEqual({ ok: true, flujo: c.flujo });
    expect(c.pedidas).toEqual([PETICION_DE_CAMARA]);
    expect(PETICION_DE_CAMARA.audio).toBe(false);
    expect(PETICION_DE_CAMARA.video.facingMode).toEqual({ ideal: "environment" });
  });
  it("cerrar para todas las pistas (la luz de la cámara se apaga)", async () => {
    const c = camaraDePrueba();
    const s = sesionDeCamara(c.nav);
    const p = s.abrir();
    c.soltar();
    await p;
    expect(c.paradas).toEqual([]);
    s.cerrar();
    expect(c.paradas).toEqual(["video"]);
  });
  it("cerrada ANTES de que llegue la cámara: la que llega tarde se para en el acto y no se usa", async () => {
    const c = camaraDePrueba();
    const s = sesionDeCamara(c.nav);
    const p = s.abrir();
    s.cerrar();
    c.soltar();
    expect(await p).toEqual({ ok: false, motivo: "cerrada" });
    expect(c.paradas).toEqual(["video"]);
  });
  it("sin getUserMedia (página sin https, WebView viejo) o con el permiso negado: no se queda colgada", async () => {
    expect(hayCamaraEnVivo(undefined)).toBe(false);
    expect(hayCamaraEnVivo({})).toBe(false);
    expect(hayCamaraEnVivo({ mediaDevices: {} })).toBe(false);
    expect(await sesionDeCamara({}).abrir()).toEqual({ ok: false, motivo: "sin-camara" });
    expect(await sesionDeCamara(camaraDePrueba({ niega: true }).nav).abrir()).toEqual({ ok: false, motivo: "negada" });
    expect(() => pararCamara(null)).not.toThrow();
  });
  it("el aviso de una línea dice qué hacer, en los dos idiomas", () => {
    expect(AVISO_SIN_CAMARA.es).toBe("Esta versión de la app no deja usar la cámara aquí: use 📷 Una foto o 🖼 Galería, o actualice la app.");
    expect(AVISO_SIN_CAMARA.en).toContain("📷 One photo or 🖼 Gallery");
  });
});

describe("la pantalla de la ráfaga (CamaraDeVariasFotos)", () => {
  const src = leer("src/components/CamaraDeVariasFotos.tsx");

  it("nace con el contador a cero, el disparador apagado hasta que hay vídeo, «Listo (0)» apagado y «Cancelar»", async () => {
    vi.stubGlobal("document", { body: {} });
    const { CamaraDeVariasFotos } = await import("@/components/CamaraDeVariasFotos");
    const html = renderToStaticMarkup(createElement(CamaraDeVariasFotos, { max: 5, onTerminar: () => {}, onSinCamara: () => {}, t }));
    expect(html).toContain("data-camara-rafaga");
    expect(html).toContain('data-contador-rafaga="true">0 / 5</span>');
    expect(html).toMatch(/<button[^>]*data-rafaga-disparar="true"[^>]*disabled=""/);
    expect(html).toMatch(/<button[^>]*data-rafaga-listo="true" disabled=""[^>]*>✅ Done \(0\)<\/button>/);
    expect(html).toMatch(/<button[^>]*data-rafaga-cancelar="true"[^>]*>Cancel<\/button>/);
    expect(html).toContain('<video autoPlay="" muted="" playsInline=""></video>');
  });
  it("«Listo» entrega la lista entera; «Cancelar» no entrega nada", () => {
    expect(src).toContain('onClick={() => onTerminar({ tipo: "listo", fotos })}');
    expect(src).toContain('onClick={() => onTerminar({ tipo: "cancelar" })}');
  });
  it("la cámara se para al desmontar, y si no abre avisa (salvo que ya se cerrara)", () => {
    const efecto = src.slice(src.indexOf("useEffect(() => {"), src.indexOf("const llena"));
    expect(efecto).toContain("const sesion = sesionDeCamara(navigator as unknown as NavegadorConCamara);");
    expect(efecto).toContain("return () => sesion.cerrar();");
    expect(efecto).toContain('if (r.motivo !== "cerrada") sinCamaraRef.current();');
  });
  it("cada disparo pasa por el tope de la ráfaga", () => {
    expect(src).toContain("setFotos((antes) => agregarALaRafaga(antes, foto, max));");
    expect(src).toContain("setFotos((antes) => quitarDeLaRafaga(antes, i))");
  });
});

describe("PhotoUpload con `rafaga`: tres opciones del mismo tamaño", () => {
  it("«Several photos», «One photo» (con `capture`) y «Gallery» (varias, sin `capture`), con la misma clase", async () => {
    const { PhotoUpload } = await import("@/components/PhotoUpload");
    const html = renderToStaticMarkup(createElement(PhotoUpload, { photos: [], onChange: () => {}, t, rafaga: true }));
    const botones = html.match(/<button[^>]*class="foto-opcion"[^>]*>[^<]*<span>[^<]*<\/span><\/button>/g) ?? [];
    expect(botones.map((b) => b.replace(/<[^>]+>/g, ""))).toEqual(["📸Several photos", "📷One photo", "🖼Gallery"]);
    expect(botones[0]).toContain("data-foto-rafaga");
    const entradas = html.match(/<input[^>]*>/g) ?? [];
    expect(entradas).toHaveLength(2);
    expect(entradas.filter((e) => e.includes('capture="environment"'))).toHaveLength(1);
    const galeria = entradas.find((e) => e.includes("data-entrada-galeria"))!;
    expect(galeria).not.toContain("capture");
    expect(galeria).toContain('multiple=""');
    // Ni el «Add photo» de siempre ni el par de D-523: las tres opciones lo sustituyen.
    expect(html).not.toContain("photo-add");
  });
  it("llena o de solo ver, no hay opciones; con hueco, sí", async () => {
    const { PhotoUpload } = await import("@/components/PhotoUpload");
    const llena = renderToStaticMarkup(createElement(PhotoUpload, { photos: [FOTO(1)], onChange: () => {}, t, max: 1, rafaga: true }));
    expect(llena).not.toContain("data-opciones-de-foto");
    const verSolo = renderToStaticMarkup(createElement(PhotoUpload, { photos: [], onChange: () => {}, t, disabled: true, rafaga: true }));
    expect(verSolo).not.toContain("data-opciones-de-foto");
    const conHueco = renderToStaticMarkup(createElement(PhotoUpload, { photos: [FOTO(1)], onChange: () => {}, t, max: 6, rafaga: true }));
    expect(conHueco).toContain("data-opciones-de-foto");
  });
  it("sin cámara dentro de la página, «Varias fotos» no abre nada: avisa y quedan las otras dos", () => {
    const grid = leer("src/components/PhotoUpload.tsx");
    const abrir = grid.slice(grid.indexOf("const abrirRafaga = () => {"), grid.indexOf("const cerrarRafaga"));
    expect(abrir).toContain("if (!hayCamaraEnVivo(navigator as unknown as NavegadorConCamara)) { setSinCamara(true); return; }");
    expect(grid).toContain("onSinCamara={() => { setRafagaAbierta(false); setSinCamara(true); }}");
    expect(grid).toContain("⚠ {t(AVISO_SIN_CAMARA.en, AVISO_SIN_CAMARA.es)}");
    // La ráfaga recibe solo el hueco que queda, y al cerrar entrega por `fotosAlCerrarLaRafaga` y la misma subida.
    expect(grid).toContain("max={huecoDeFotos(photos.length, max)}");
    const cerrar = grid.slice(grid.indexOf("const cerrarRafaga = async (fin: FinDeRafaga) => {"), grid.indexOf("const remove ="));
    expect(cerrar).toContain("setRafagaAbierta(false);");
    expect(cerrar).toContain("const nuevas = fotosAlCerrarLaRafaga(fin, huecoDeFotos(photos.length, max));");
    expect(cerrar).toContain("try { await guardarComprimidas(nuevas); } finally { setBusy(false); }");
  });
});

describe("dónde el chofer pone fotos: con las tres opciones; los demás, como estaban", () => {
  const ficha = leer("src/components/OrderModal.tsx");

  it("la prueba de entrega y «Fotos del material» llevan `rafaga`", () => {
    expect(ficha).toContain("<PhotoUpload photos={fotosDeLaEntrega} disabled={busy} onChange={setFotosDeLaEntrega} t={t} rafaga onOcupado={setFotosProcesando} />");
    expect(ficha).toMatch(/<PhotoUpload\s+photos=\{fotosOrden\.photos \?\? \[\]\}[\s\S]*?subir=\{subirFotos\}\s+rafaga\s/);
  });
  it("inspecciones y la pausa del chofer no cambian (sin `rafaga`)", () => {
    for (const f of ["src/components/PausaDelChofer.tsx", "src/components/inspeccion/FormularioDeInspeccion.tsx", "src/components/inspeccion/InspeccionesDelDia.tsx"]) {
      const src = leer(f);
      expect(src, f).toContain("<PhotoUpload");
      expect(src, f).not.toMatch(/<PhotoUpload[^>]*\brafaga\b/);
    }
  });
});

// D-726 (2026-10-28): «Remove that limit — drivers should be able to upload as many images as they want».
describe("D-726: sin tope de fotos por defecto", () => {
  it("PhotoUpload no limita si no se le pasa max, y con tope infinito no avisa de máximo", async () => {
    const src = readFileSync(new URL("../components/PhotoUpload.tsx", import.meta.url), "utf8");
    expect(src).toContain("max = Infinity,");
    expect(src).not.toContain("max = 6,");
    expect(huecoDeFotos(50, Infinity)).toBe(Infinity);
    const { PhotoUpload } = await import("@/components/PhotoUpload");
    const html = renderToStaticMarkup(createElement(PhotoUpload, { photos: Array.from({ length: 7 }, (_, i) => FOTO(i + 1)), onChange: () => {}, t, rafaga: true }));
    expect(html).not.toContain("Maximum");
    expect(html).toContain("data-foto-rafaga");
  });
});
