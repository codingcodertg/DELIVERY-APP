import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { FUERA_DE_LA_CAPTURA, marcaFueraDeLaCaptura } from "@/components/CapturaDeAyuda";

/**
 * D-513 · La foto de Ayuda sin permiso: un clic, lo que se ve, sin la ventana de Ayuda.
 *
 * El dueño: «EL SCREENSHOT NO FUNCIONA COMO YO QUIERO, QUIERO ALGO MAS RAPIDO SIN QUE ESTE PIDIENDO
 * TANTO PERMISO Y ASI». Lo que la pantalla hace de verdad —clonar el DOM, tardar 0,25–1,2 s, no llamar a
 * `getDisplayMedia`, dejar Ayuda fuera, sacar el mapa y las fuentes— se midió en el navegador contra el
 * demo y está en la entrada de decisiones; vitest corre en `node` y no puede pintar nada.
 *
 * Lo que sí se fija aquí son las piezas de las que depende, cada una por lo que rompería:
 *
 *  - la marca: si el nombre del atributo y el selector se separan, Ayuda vuelve a salir en la foto;
 *  - el `crossOrigin` de las fuentes: sin él la foto sale con la letra del sistema;
 *  - la carga diferida: un import estático metería 89 KB comprimidos en todas las páginas;
 *  - que la foto normal no toque `getDisplayMedia`, que es lo que pide el permiso.
 */

const leer = (r: string) => readFileSync(r, "utf8").split("\r\n").join("\n");
/** El fuente sin las líneas de comentario. Un comentario que CITA el código que se cuenta lo cuenta dos
 *  veces: el de `marcaFueraDeLaCaptura` dice literalmente cómo se esparce, y esta prueba daba 2 donde hay 1. */
const soloCodigo = (s: string) => s.split("\n").filter((l) => !/^\s*(\/\/|\/\*|\*)/.test(l)).join("\n");
const boton = leer("src/components/HelpButton.tsx");
const captura = leer("src/components/CapturaDeAyuda.tsx");
const layout = leer("src/app/layout.tsx");

describe("la marca que deja a Ayuda fuera de la foto", () => {
  it("es un atributo data-, y lo que se esparce en el JSX es exactamente ese atributo", () => {
    // Importado, no leído como texto: si alguien cambia el nombre en un sitio, esto lo ve.
    expect(FUERA_DE_LA_CAPTURA).toMatch(/^data-[a-z-]+$/);
    expect(marcaFueraDeLaCaptura).toEqual({ [FUERA_DE_LA_CAPTURA]: "" });
  });

  it("el selector que se excluye al clonar se construye con la MISMA constante", () => {
    expect(captura).toContain("exclude: [`[${FUERA_DE_LA_CAPTURA}]`],");
  });

  it("la llevan las cuatro piezas de Ayuda: el botón flotante, su panel, su aviso y el editor del recuadro", () => {
    const fab = boton.indexOf('className="help-fab no-print"');
    expect(fab).toBeGreaterThan(-1);
    expect(boton.slice(fab, boton.indexOf(">", fab))).toContain("{...marcaFueraDeLaCaptura}");

    const panel = boton.indexOf('<div className="overlay" style={{ zIndex: Z_PANEL_DE_AYUDA }} {...marcaFueraDeLaCaptura}');
    expect(panel).toBeGreaterThan(-1);

    expect(captura).toContain('<div className="overlay" style={{ zIndex: Z_PANEL_DE_AYUDA + 10 }} {...marcaFueraDeLaCaptura}>');
    // El aviso de abajo es de la burbuja desde D-530 (antes era el de Entregas): «enviada», «no se pudo»… no
    // tiene que salir en una foto que se toma justo después.
    expect(boton).toContain('{aviso && <div className="toast no-print" role="status" style={{ zIndex: Z_PANEL_DE_AYUDA + 20 }} {...marcaFueraDeLaCaptura}>{aviso}</div>}');

    // Exactamente esas: una de más escondería algo que la persona quería enseñar. (Eran 2 en el botón hasta
    // D-530; la tercera es el aviso, que antes no era suyo.)
    expect((soloCodigo(boton).match(/\{\.\.\.marcaFueraDeLaCaptura\}/g) ?? []).length).toBe(3);
    expect((soloCodigo(captura).match(/\{\.\.\.marcaFueraDeLaCaptura\}/g) ?? []).length).toBe(1);
  });
});

describe("la foto rápida", () => {
  const cuerpo = captura.slice(
    captura.indexOf("export async function tomaFotogramaDeLaPagina"),
    captura.indexOf("export async function tomaFotograma(): Promise"),
  );

  it("existe, y no toca `getDisplayMedia` — que es lo que pide permiso", () => {
    expect(cuerpo.length).toBeGreaterThan(0);
    expect(cuerpo).not.toContain("getDisplayMedia");
    expect(cuerpo).toContain("snapdom.toCanvas(document.body, opcionesDeLaPagina(true))");
  });

  it("toma lo que se ve, no la página desde arriba: la página entera, recortada por el scroll (D-733)", () => {
    expect(captura).not.toContain('clip: "viewport"');
    expect(cuerpo).toContain("recorteDeLaVista(lienzo, document.body.getBoundingClientRect(), window)");
  });

  it("snapdom se carga al usarla, no con cada página", () => {
    expect(captura).toContain('import("@zumer/snapdom")');
    // Ningún import estático del paquete: ese sí entraría en el bundle de todas las páginas.
    expect(captura).not.toMatch(/^import [^;]*from "@zumer\/snapdom"/m);
  });

  it("se calienta al abrir Ayuda, en el mismo clic que abre el panel", () => {
    const fab = boton.indexOf('className="help-fab no-print"');
    // Acotado por longitud y no por el primer `>`: el `=>` de la flecha lo cortaría a la mitad. Desde D-530 el
    // mismo clic pide también quién escribe y el teléfono (`traeContacto`).
    const suTag = boton.slice(fab, fab + 700);
    expect(suTag).toContain("onClick={() => { setOpen(true); calientaCaptura(); void traeContacto(); }}");
  });

  it("el calentamiento cede el hilo y la captura de verdad no", () => {
    // `fast: false` deja que la página siga pintando mientras se escribe; `true` es lo más rápido.
    expect(captura).toContain(".then((snapdom) => snapdom.toCanvas(document.body, opcionesDeLaPagina(false)))");
    expect(cuerpo).toContain("opcionesDeLaPagina(true)");
    expect(captura).toContain("fast: deUnTiron,");
  });

  it("y mientras captura, el botón se apaga: dos clics no lanzan dos capturas", () => {
    const rapida = boton.slice(boton.indexOf("const capturaRapida = async"), boton.indexOf("const capturaConElNavegador = async"));
    expect(rapida).toContain("if (capturando) return;");
    expect(rapida.indexOf("setCapturando(true);")).toBeGreaterThan(-1);
    // Se apaga en `finally`: un fallo no puede dejarlo colgado en «Capturando…».
    expect(rapida.slice(rapida.indexOf("} finally {"))).toContain("setCapturando(false);");
    expect(boton).toContain("disabled={busy || capturando}");
  });
});

describe("las fuentes de la foto", () => {
  it("la hoja de Google Fonts va con crossOrigin, o la foto sale con la letra del sistema", () => {
    const hoja = layout.indexOf("fonts.googleapis.com/css2");
    expect(hoja).toBeGreaterThan(-1);
    const suLink = layout.slice(layout.lastIndexOf("<link", hoja), layout.indexOf("/>", hoja));
    expect(suLink).toContain('rel="stylesheet"');
    expect(suLink).toContain('crossOrigin="anonymous"');
  });

  it("y el preconnect también: anónima y con credenciales son piscinas distintas", () => {
    expect(layout).toContain('<link rel="preconnect" href="https://fonts.googleapis.com" crossOrigin="anonymous" />');
  });
});
