import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  AVISO_SI_NO_ABRIO_LA_CAMARA, decodificarEnElNavegador, detalleParaConsola, esHeic, leerFotoDelTelefono, mensajeDeFotoFallida,
  tipoPorLosBytes, type Decodificador, type ImagenDecodificada,
} from "./foto-del-telefono";
import { esHash } from "./fotos";
import { medidasComprimidas } from "@/lib/camara-de-varias-fotos";

/**
 * D-NEXT (2026-11-07). Roberto, tras la primera merma de Baudelio con el formulario nuevo: «no lo deja poner la foto; la
 * tiene que escoger del carrete». La cámara del asistente fallaba (en la app de Android, sin permiso de cámara no abre
 * nada) y, si algo fallaba al leer, no se decía por qué. Ahora: dos botones (cámara y galería) al mismo `agrega`, los
 * bytes se leen en el acto, decodificador con respaldo, y el motivo se enseña y va a la consola con el aparato.
 */
const leer = (r: string) => readFileSync(join(process.cwd(), r), "utf8").replace(/\r\n/g, "\n");

// ---- Ficheros de prueba: se fabrican aquí, con los bytes de verdad de cada formato -------------------------------------
const JPEG_GRANDE = new File([Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(5000, 7)])], "IMG_4000x3000.jpg", { type: "image/jpeg" });
const PNG = new File([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3])], "captura.png", { type: "image/png" });
/** Lo que da un iPhone con «Alta eficiencia»: cabecera HEIC de verdad, que el navegador no decodifica. */
const HEIC = new File([Buffer.concat([Buffer.from([0, 0, 0, 0x18]), Buffer.from("ftypheic"), Buffer.alloc(40, 1)])], "IMG_0001.HEIC", { type: "" });
/** Un fichero con nombre .heic pero bytes que no son de nada. */
const HEIC_RARO = new File([Buffer.from("esto no es una imagen")], "foto.heic", { type: "image/heic" });
const VACIO = new File([], "JPEG_20261107_101500_.jpg", { type: "image/jpeg" });
/** La cámara de Android: `type` vacío, pero los bytes son JPEG. */
const SIN_TIPO = new File([Buffer.from([0xff, 0xd8, 0xff, 0xdb, 9, 9])], "JPEG_x.jpg", { type: "" });

/** Un decodificador falso: «abre» todo lo que parezca imagen por los bytes, con las medidas que se le digan. */
function decodificador(ancho: number, alto: number, falla: (tipo: string) => boolean = () => false) {
  const llamadas: { tipo: string; bytes: number; cerrada: boolean }[] = [];
  const comprimidas: [number, number][] = [];
  const deps: Decodificador = {
    decodificar: async (blob) => {
      const l = { tipo: blob.type, bytes: blob.size, cerrada: false };
      llamadas.push(l);
      if (falla(blob.type)) throw new Error("InvalidStateError: The source image could not be decoded.");
      const img: ImagenDecodificada = { fuente: {} as CanvasImageSource, ancho, alto, cerrar: () => { l.cerrada = true; } };
      return img;
    },
    comprimir: (_f, w, h) => { const m = medidasComprimidas(w, h); comprimidas.push([m.w, m.h]); return `data:image/jpeg;base64,${Buffer.from(`${m.w}x${m.h}`).toString("base64")}`; },
    huella: async (d) => (await import("./fotos")).hashDeDataUrl(d),
  };
  return { deps, llamadas, comprimidas };
}

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe("1. el tipo por los bytes (lo que dice `file.type` a veces viene vacío)", () => {
  it("JPEG, PNG, GIF, WebP, HEIC y AVIF por su cabecera; cualquier otra cosa, vacío", () => {
    expect(tipoPorLosBytes(new Uint8Array([0xff, 0xd8, 0xff, 0xe1]))).toBe("image/jpeg");
    expect(tipoPorLosBytes(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))).toBe("image/png");
    expect(tipoPorLosBytes(new Uint8Array(Buffer.from("GIF89a")))).toBe("image/gif");
    expect(tipoPorLosBytes(new Uint8Array(Buffer.from("RIFF\0\0\0\0WEBPVP8 ")))).toBe("image/webp");
    expect(tipoPorLosBytes(new Uint8Array(Buffer.concat([Buffer.from([0, 0, 0, 0x18]), Buffer.from("ftypheic")])))).toBe("image/heic");
    expect(tipoPorLosBytes(new Uint8Array(Buffer.concat([Buffer.from([0, 0, 0, 0x18]), Buffer.from("ftypmif1")])))).toBe("image/heic");
    expect(tipoPorLosBytes(new Uint8Array(Buffer.concat([Buffer.from([0, 0, 0, 0x18]), Buffer.from("ftypavif")])))).toBe("image/avif");
    expect(tipoPorLosBytes(new Uint8Array(Buffer.from("hola")))).toBe("");
    expect(tipoPorLosBytes(new Uint8Array([]))).toBe("");
  });
  it("esHeic: por el tipo o por el nombre, sin importar mayúsculas", () => {
    expect(esHeic("IMG_0001.HEIC", "")).toBe(true);
    expect(esHeic("foto.heif", "")).toBe(true);
    expect(esHeic("x.jpg", "image/heic")).toBe(true);
    expect(esHeic("x.jpg", "image/jpeg")).toBe(false);
  });
});

describe("2. leerFotoDelTelefono: los cuatro ficheros de prueba", () => {
  it("un JPEG grande (4000×3000) se lee, se comprime a 1280×960 y sale con su huella SHA-256", async () => {
    const d = decodificador(4000, 3000);
    const r = await leerFotoDelTelefono(JPEG_GRANDE, d.deps);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.jpg.startsWith("data:image/jpeg;base64,")).toBe(true);
    expect(esHash(r.huella)).toBe(true);
    expect([r.ancho, r.alto, r.tipo, r.bytes]).toEqual([4000, 3000, "image/jpeg", JPEG_GRANDE.size]);
    expect(d.comprimidas).toEqual([[1280, 960]]);
    expect(d.llamadas[0].cerrada).toBe(true); // la imagen decodificada se suelta
  });
  it("un PNG se lee igual (el lienzo lo pasa a JPEG) y la huella es la del JPEG, no la del PNG", async () => {
    const d = decodificador(800, 600);
    const r = await leerFotoDelTelefono(PNG, d.deps);
    expect(r.ok && r.tipo).toBe("image/png");
    expect(d.llamadas[0].tipo).toBe("image/png");
    const { hashDeDataUrl } = await import("./fotos");
    if (r.ok) expect(r.huella).toBe(await hashDeDataUrl(r.jpg));
  });
  it("un HEIC que el navegador no decodifica: motivo «heic» (aviso propio), no «no-decodifica»", async () => {
    const d = decodificador(4032, 3024, (tipo) => tipo === "image/heic");
    const r = await leerFotoDelTelefono(HEIC, d.deps);
    expect(r).toMatchObject({ ok: false, motivo: "heic", tipo: "image/heic", bytes: HEIC.size });
    if (!r.ok) expect(r.detalle).toContain("could not be decoded");
    // Con nombre .heic y bytes de nada, también «heic».
    const r2 = await leerFotoDelTelefono(HEIC_RARO, decodificador(1, 1, () => true).deps);
    expect(r2).toMatchObject({ ok: false, motivo: "heic" });
  });
  it("un fichero vacío (la cámara de Android devuelve 0 bytes): motivo «vacia», sin intentar decodificar", async () => {
    const d = decodificador(1, 1);
    const r = await leerFotoDelTelefono(VACIO, d.deps);
    expect(r).toMatchObject({ ok: false, motivo: "vacia", bytes: 0 });
    expect(d.llamadas).toHaveLength(0);
  });
  it("si `arrayBuffer` falla (iOS quita el temporal), motivo «no-se-lee»; si falla la decodificación de un JPEG, «no-decodifica»", async () => {
    const roto = { name: "x.jpg", size: 10, type: "image/jpeg", arrayBuffer: async () => { throw new DOMException("The object can not be found here.", "NotFoundError"); } } as unknown as File;
    const r = await leerFotoDelTelefono(roto, decodificador(1, 1).deps);
    expect(r).toMatchObject({ ok: false, motivo: "no-se-lee" });
    if (!r.ok) expect(r.detalle).toContain("NotFoundError");
    const r2 = await leerFotoDelTelefono(JPEG_GRANDE, decodificador(1, 1, () => true).deps);
    expect(r2).toMatchObject({ ok: false, motivo: "no-decodifica", tipo: "image/jpeg" });
  });
  it("la cámara de Android manda `type` vacío: el tipo sale de los bytes y el blob que se decodifica lleva image/jpeg", async () => {
    const d = decodificador(100, 50);
    const r = await leerFotoDelTelefono(SIN_TIPO, d.deps);
    expect(r.ok && r.tipo).toBe("image/jpeg");
    expect(d.llamadas[0].tipo).toBe("image/jpeg");
  });
  it("los bytes se leen ANTES de decodificar: con el fichero ya «vaciado» por el input, la lectura sigue con los bytes que tomó", async () => {
    let leido = 0;
    const f = { name: "a.jpg", size: 4, type: "image/jpeg", arrayBuffer: async () => { leido++; return new Uint8Array([0xff, 0xd8, 0xff, 0xe0]).buffer; } } as unknown as File;
    const d = decodificador(10, 10);
    const r = await leerFotoDelTelefono(f, d.deps);
    expect(r.ok).toBe(true);
    expect(leido).toBe(1);
    expect(d.llamadas[0].bytes).toBe(4);
  });
});

describe("3. el decodificador del navegador: createImageBitmap y, si falla, <img>", () => {
  it("createImageBitmap primero; si lanza, <img> con object URL, y el URL se suelta al cerrar", async () => {
    vi.stubGlobal("createImageBitmap", vi.fn(async () => { throw new Error("InvalidStateError"); }));
    const urls: string[] = [];
    vi.stubGlobal("URL", { createObjectURL: () => { urls.push("blob:1"); return "blob:1"; }, revokeObjectURL: (u: string) => urls.splice(urls.indexOf(u), 1) });
    class ImagenFalsa { src = ""; naturalWidth = 640; naturalHeight = 480; async decode() {} }
    vi.stubGlobal("Image", ImagenFalsa);
    const img = await decodificarEnElNavegador(new Blob([new Uint8Array([1])], { type: "image/jpeg" }));
    expect([img.ancho, img.alto]).toEqual([640, 480]);
    expect(urls).toEqual(["blob:1"]);
    img.cerrar();
    expect(urls).toEqual([]);
  });
  it("si createImageBitmap funciona, no se toca <img>", async () => {
    const bitmap = { width: 30, height: 20, close: vi.fn() };
    vi.stubGlobal("createImageBitmap", vi.fn(async () => bitmap));
    vi.stubGlobal("Image", class { constructor() { throw new Error("no debía usarse"); } });
    const img = await decodificarEnElNavegador(new Blob([new Uint8Array([1])]));
    expect([img.ancho, img.alto]).toEqual([30, 20]);
    img.cerrar();
    expect(bitmap.close).toHaveBeenCalled();
  });
  it("si tampoco <img> la abre, lanza (y el URL no se queda colgado)", async () => {
    vi.stubGlobal("createImageBitmap", undefined);
    const revocados: string[] = [];
    vi.stubGlobal("URL", { createObjectURL: () => "blob:2", revokeObjectURL: (u: string) => revocados.push(u) });
    vi.stubGlobal("Image", class { src = ""; naturalWidth = 0; naturalHeight = 0; async decode() { throw new Error("EncodingError"); } });
    await expect(decodificarEnElNavegador(new Blob([new Uint8Array([1])]))).rejects.toThrow("EncodingError");
    expect(revocados).toEqual(["blob:2"]);
  });
});

describe("4. los avisos: por motivo, en los dos idiomas, y con «Siguiente» solo si la foto no es obligatoria", () => {
  it("cada motivo tiene su texto y el HEIC explica el ajuste del iPhone", () => {
    expect(mensajeDeFotoFallida("vacia", "es")).toMatch(/vacía/);
    expect(mensajeDeFotoFallida("vacia", "en")).toMatch(/empty/);
    expect(mensajeDeFotoFallida("heic", "es")).toMatch(/HEIC.*Más compatible/);
    expect(mensajeDeFotoFallida("heic", "en")).toMatch(/HEIC.*Most compatible/);
    expect(mensajeDeFotoFallida("no-se-lee", "en")).toMatch(/Could not read the photo/);
    expect(mensajeDeFotoFallida("no-decodifica", "es")).toMatch(/No se pudo abrir esa foto/);
    expect(mensajeDeFotoFallida("no-decodifica", "en", true)).toMatch(/tap Next to skip/);
    expect(mensajeDeFotoFallida("no-decodifica", "es", true)).toMatch(/Siguiente para saltarla/);
    expect(mensajeDeFotoFallida("no-decodifica", "es")).not.toMatch(/Siguiente/);
  });
  it("el aviso de la cámara que no abrió dice cómo dar el permiso y que la galería sigue ahí", () => {
    for (const l of ["en", "es"] as const) {
      expect(AVISO_SI_NO_ABRIO_LA_CAMARA[l]).toMatch(/RTG Hub/);
      expect(AVISO_SI_NO_ABRIO_LA_CAMARA[l]).toMatch(/galer|gallery/i);
    }
  });
  it("la línea de consola lleva motivo, origen, fichero, bytes, tipo, detalle y el user agent (nunca la foto)", () => {
    const linea = detalleParaConsola({ motivo: "vacia", bytes: 0, tipo: "image/jpeg", detalle: "0 bytes" }, VACIO, "Linux; Android 16; moto g power … RDZDeliveries/6", "camara");
    expect(linea).toBe('[merma/foto] vacia · origen=camara · fichero="JPEG_20261107_101500_.jpg" 0 B type="image/jpeg" · bytes=0 tipo=image/jpeg · 0 bytes · ua=Linux; Android 16; moto g power … RDZDeliveries/6');
    expect(linea).not.toMatch(/base64/);
  });
});

describe("5. las dos entradas (fuente): el asistente y «Agregar foto» usan los mismos dos botones al mismo `agrega`", () => {
  const botones = leer("src/app/operaciones/BotonesDeFoto.tsx");
  const asistente = leer("src/app/operaciones/Asistente.tsx");
  const lista = leer("src/app/operaciones/ListaDeReportes.tsx");
  it("BotonesDeFoto: un input CON capture (cámara) y otro SIN (galería), los dos al mismo onFoto, y el aviso al `cancel` de la cámara", () => {
    expect(botones).toContain('<input ref={camara} type="file" accept="image/*" capture="environment" hidden onChange={entrega("camara")} data-entrada="camara" />');
    expect(botones).toContain('<input ref={galeria} type="file" accept="image/*" hidden onChange={entrega("galeria")} data-entrada="galeria" />');
    expect(botones).toContain('data-accion="foto"');
    expect(botones).toContain('data-accion="foto-galeria"');
    // La File se entrega antes de vaciar el input; el que la recibe lee los bytes en el acto.
    expect(botones).toContain('if (f) { setSinFoto(false); onFoto(f, origen); }\n    e.target.value = "";');
    expect(botones).toContain('el.addEventListener("cancel", alCancelar)');
    expect(botones).toContain('data-aviso="camara-sin-foto"');
    expect(botones).toContain("ops-camara-principal");
  });
  it("el asistente y «Agregar foto» ya no tienen su propio <input capture> ni createImageBitmap a secas: pasan por leerFotoDelTelefono y enseñan el motivo", () => {
    for (const src of [asistente, lista]) {
      expect(src).not.toContain('capture="environment"');
      expect(src).not.toContain("createImageBitmap");
      expect(src).toContain("<BotonesDeFoto onFoto={(f, origen) => void agrega(f, origen)}");
      expect(src).toContain("const leida = await leerFotoDelTelefono(f);");
      expect(src).toContain("console.error(detalleParaConsola(leida, f, navigator.userAgent, origen));");
      expect(src).toContain('data-aviso="foto-fallida"');
    }
    // El asistente no toca el estado si la pantalla se desmontó a media lectura.
    expect(asistente).toContain("if (!vivo.current) return;");
    expect(asistente).toContain("setError(mensajeDeFotoFallida(leida.motivo, lang, !obligatoria));");
  });
  it("los estilos: los dos botones apilados y la cámara como principal", () => {
    const css = leer("src/app/operaciones/operaciones.css");
    expect(css).toContain(".ops-botones-foto { display: grid; gap: 8px; }");
    expect(css).toContain(".ops-camara-principal { border-color: var(--accent); border-style: solid; }");
  });
});

describe("6. la app de Android (fuente): la cámara de <input capture> sin permiso ya no se queda callada", () => {
  const java = leer("mobile/android/app/src/main/java/net/rdztilegroup/deliveries/CamaraDelFormulario.java");
  const main = leer("mobile/android/app/src/main/java/net/rdztilegroup/deliveries/MainActivity.java");
  it("MainActivity pone CamaraDelFormulario como WebChromeClient después de super.onCreate (sus launchers se registran antes de onStart)", () => {
    expect(main).toContain("super.onCreate(savedInstanceState);");
    expect(main.indexOf("super.onCreate(savedInstanceState);")).toBeLessThan(main.indexOf("setWebChromeClient(new CamaraDelFormulario(getBridge()))"));
  });
  it("solo interviene con capture de imagen y sin permiso; pide el permiso; si lo dan sigue Capacitor, si no, aviso y galería; cancelar devuelve null", () => {
    expect(java).toContain("extends BridgeWebChromeClient");
    expect(java).toContain("if (!quiereCamara || conPermiso) {\n            return super.onShowFileChooser(webView, filePathCallback, fileChooserParams);");
    expect(java).toContain("permiso.launch(Manifest.permission.CAMERA);");
    expect(java).toContain("super.onShowFileChooser(w, cb, p);");
    expect(java).toContain("Toast.makeText(a, \"Sin permiso de cámara");
    expect(java).toContain("galeria.launch(intent);");
    expect(java).toContain("cb.onReceiveValue(FileChooserParams.parseResult(r.getResultCode(), r.getData()));");
    expect(java).toContain("if (pendiente != null) pendiente.onReceiveValue(null);");
  });
});
