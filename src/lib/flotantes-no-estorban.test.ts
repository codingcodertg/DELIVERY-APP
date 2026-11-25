import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// 24 nov (el dueño, con una captura): «los botones de la esquina inferior están afectando ahí la view, y esto pasa
// seguido en el app. Quiero que hagas un audit completo, y cuando estén en esa función que eso no estorbe». La burbuja
// de la esquina, mientras un admin está dentro de otra persona, se hacía dos pastillas anchas y tapaba el botón
// «Continue to review» de la hoja de conteo. Esta prueba fija el arreglo: lo que se ve siempre va en la barra de
// arriba, la burbuja es compacta, y nada queda debajo de ella (`--fab-libre`) ni de una barra pegada abajo
// (`--barra-inferior-alto`).

const leer = (r: string) => readFileSync(join(process.cwd(), r), "utf8").split("\r\n").join("\n");
const sinComentarios = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
const CSS = leer("src/app/globals.css");

describe("parte 1: «viendo como» sale en la barra de arriba, no en la esquina", () => {
  const burbuja = sinComentarios(leer("src/components/BotonGeneral.tsx"));
  const barra = sinComentarios(leer("src/components/MenuDeCuenta.tsx"));

  it("el botón de la cuenta (en todas las barras) lleva el aviso, y su menú empieza con la vuelta de siempre", () => {
    expect(barra).toContain("data-viendo-como");
    expect(barra).toContain("data-volver-a-mi-usuario");
    expect(barra).toContain('(textos ? " viendo-como-chip" : "")');
    expect(barra).toContain('role="menuitem" data-volver-a-mi-usuario');
    // Y ya NO hay un chip aparte en la barra: ocupaba sitio y partía las barras llenas (medido en pantalla).
    expect(sinComentarios(leer("src/components/BarraDeApp.tsx"))).not.toContain("ChipDeSuplantacion");
    expect(barra).toContain('void volverAMiCuenta("manual"');
  });

  it("la burbuja no pinta el aviso ni el botón rojo fuera del menú abierto", () => {
    expect(burbuja).toContain("{abierto && sup.estado && <EtiquetaDeSuplantacion suplantacion={sup.estado} />}");
    expect(burbuja).toContain('{abierto && sup.estado && <BotonVolverAMiUsuario suplantacion={sup.estado} volviendo={sup.volviendo} onVolver={() => void sup.volver("manual")} />}');
    expect(burbuja).not.toMatch(/^\s*\{sup\.estado && <(EtiquetaDeSuplantacion|BotonVolverAMiUsuario)/m);
  });

  it("la burbuja queda de 46 px con anillo ámbar, sin la pastilla naranja", () => {
    expect(burbuja).toContain('(viendo ? " viendo-como" : "")');
    expect(CSS).toMatch(/\.fab-general\.viendo-como \{ box-shadow: 0 0 0 3px var\(--amber\)/);
    expect(CSS).not.toContain(".fab-general-caja.suplantando");
  });
});

describe("parte 2: nada queda debajo de la burbuja", () => {
  it("globals.css declara el token `--fab-libre` (46 + 20 + 12 px)", () => {
    expect(CSS).toContain(":root { --fab-libre: 78px; --barra-inferior-alto: 0px; }");
  });

  it("la burbuja sube por encima de una barra pegada abajo: su `bottom` suma `--barra-inferior-alto`", () => {
    expect(CSS).toMatch(/\.fab-general-caja \{\s*bottom: calc\(max\(20px, calc\(env\(safe-area-inset-bottom, 0px\) \+ 12px\)\) \+ var\(--barra-inferior-alto, 0px\)\);/);
    expect(CSS).toMatch(/\.fab-general-caja \{\s*bottom: calc\(max\(14px, calc\(env\(safe-area-inset-bottom, 0px\) \+ 8px\)\) \+ var\(--barra-inferior-alto, 0px\)\);/);
  });

  it("las pantallas con barra pegada abajo ponen la altura en su `body`", () => {
    expect(CSS).toMatch(/body:has\(\.ops-cerrar-abajo\), body:has\(\.ops-conteo-modal \.modal-actions\) \{ --barra-inferior-alto: 64px; \}/);
    expect(CSS).toMatch(/body:has\(\.recruiting-module \.compare-bar\)[^{]*\{ --barra-inferior-alto: 64px; \}/);
    expect(CSS).toMatch(/@media \(max-width: 719px\) \{\s*body:has\(\.ops-botonera\) \{ --barra-inferior-alto: 84px; \}/);
  });

  it("los contenedores con botones al final dejan el relleno del token", () => {
    expect(leer("src/app/estimator/estimator.css")).toContain(".est-vista-previa { padding-bottom: calc(16px + var(--fab-libre)); }");
    expect(leer("src/app/leads/leads.css")).toContain(".ld-dialogo { padding-bottom: calc(24px + var(--fab-libre)); }");
    // El `.overlay .modal` ya lo tenía (D-1008: 22 + 56 = 78 px): no se toca.
    expect(CSS).toContain(".overlay .modal { padding-bottom: calc(22px + 56px + env(safe-area-inset-bottom, 0px)); }");
  });

  it("los avisos de abajo suben en el teléfono por encima de la burbuja, y el de llegadas tiene clase propia", () => {
    expect(CSS).toMatch(/@media \(max-width: 640px\) \{\s*\.toast, \.recruiting-module \.toast \{ bottom: calc\(20px \+ var\(--fab-libre\)\); \}/);
    expect(leer("src/app/(app)/warehouse/arrivals/page.tsx")).toContain('className="toast-de-llegadas"');
    expect(leer("src/components/CierreDiario.tsx")).toContain('bottom: "calc(16px + var(--fab-libre))"');
  });
});
