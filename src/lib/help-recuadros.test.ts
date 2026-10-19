import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { grosorDelRecuadro } from "./help-captura";
import {
  MAX_RECUADROS, agregaRecuadro, escribeProblema, etiquetaDelRecuadro, listaDeProblemas, mensajeConProblemas,
  porcentajesDeLaEtiqueta, quitaRecuadro, renumera, type RecuadroNumerado,
} from "./help-recuadros";
import { COLOR_DEL_RECUADRO, EditorDeCaptura, VistaDeCaptura } from "@/components/CapturaDeAyuda";

/**
 * Varios recuadros numerados sobre la misma captura, cada uno con su problema (D-583).
 *
 * El dueño: «en el mismo screenshot pueda hacer multiple boxes showing an error y ahí él pueda por cada
 * box describir un problema». Lo que se mide aquí: la lista y su numeración, el texto compuesto que viaja
 * en la solicitud, dónde va el número sobre la imagen, y que el editor y HelpButton pasan por aquí.
 */

const leer = (r: string) => readFileSync(join(process.cwd(), r), "utf8").split("\r\n").join("\n");
const t = (_en: string, es: string) => es;
const rect = (x: number) => ({ x, y: 10, w: 50, h: 40 });

describe("la lista de recuadros: 1..N en el orden en que se dibujaron", () => {
  it("cada arrastre añade uno al final, con el siguiente número y sin texto", () => {
    const uno = agregaRecuadro([], rect(0));
    const dos = agregaRecuadro(uno, rect(100));
    const tres = agregaRecuadro(dos, rect(200));
    expect(tres.map((r) => r.n)).toEqual([1, 2, 3]);
    expect(tres.map((r) => r.rect.x)).toEqual([0, 100, 200]);
    expect(tres.every((r) => r.texto === "")).toBe(true);
    // No muta la lista que recibe: el estado de React se reemplaza, no se toca.
    expect(uno).toHaveLength(1);
  });

  it("quitar el 2 convierte al 3 en 2: en la imagen no puede quedar un «3» sin su línea en el texto", () => {
    const tres = agregaRecuadro(agregaRecuadro(agregaRecuadro([], rect(0)), rect(100)), rect(200));
    const sinElDos = quitaRecuadro(tres, 2);
    expect(sinElDos.map((r) => [r.n, r.rect.x])).toEqual([[1, 0], [2, 200]]);
    // Quitar uno que no existe no cambia nada.
    expect(quitaRecuadro(tres, 9)).toEqual(tres);
  });

  it("renumerar respeta el orden y arregla cualquier hueco", () => {
    const rota: RecuadroNumerado[] = [{ n: 4, rect: rect(0), texto: "a" }, { n: 9, rect: rect(1), texto: "b" }];
    expect(renumera(rota).map((r) => [r.n, r.texto])).toEqual([[1, "a"], [2, "b"]]);
  });

  it("el texto se escribe solo en su recuadro", () => {
    const dos = agregaRecuadro(agregaRecuadro([], rect(0)), rect(100));
    const escrito = escribeProblema(dos, 2, "el botón no hace nada");
    expect(escrito[0].texto).toBe("");
    expect(escrito[1].texto).toBe("el botón no hace nada");
    expect(escrito[1].rect).toEqual(rect(100));
  });

  it(`al llegar a ${MAX_RECUADROS} no se añade más, y el tope es un dígito`, () => {
    expect(MAX_RECUADROS).toBeLessThanOrEqual(9);
    let lista: RecuadroNumerado[] = [];
    for (let i = 0; i < MAX_RECUADROS + 3; i++) lista = agregaRecuadro(lista, rect(i));
    expect(lista).toHaveLength(MAX_RECUADROS);
    expect(lista[lista.length - 1].n).toBe(MAX_RECUADROS);
  });
});

describe("el mensaje que viaja: «1) … 2) …» debajo de lo que ya había escrito", () => {
  const lista: RecuadroNumerado[] = [
    { n: 1, rect: rect(0), texto: "botón 1 no funciona" },
    { n: 2, rect: rect(1), texto: "  " },
    { n: 3, rect: rect(2), texto: "botón 2 sí funciona pero tarda" },
  ];

  it("una línea por recuadro, con su número; un punto sin texto se dice, no se omite", () => {
    expect(listaDeProblemas(lista, t)).toBe("1) botón 1 no funciona\n2) (sin descripción)\n3) botón 2 sí funciona pero tarda");
    expect(listaDeProblemas(lista, (en) => en)).toContain("2) (no description)");
  });

  it("con mensaje, la lista va debajo separada por una línea en blanco; sin mensaje, la lista sola", () => {
    expect(mensajeConProblemas("La página de órdenes.", lista, t)).toBe(
      "La página de órdenes.\n\n1) botón 1 no funciona\n2) (sin descripción)\n3) botón 2 sí funciona pero tarda",
    );
    expect(mensajeConProblemas("", lista, t)).toBe(listaDeProblemas(lista, t));
    expect(mensajeConProblemas("   ", lista, t)).toBe(listaDeProblemas(lista, t));
  });

  it("sin recuadros, el mensaje se queda tal cual (ni se recorta ni se le pega nada)", () => {
    expect(mensajeConProblemas("hola ", [], t)).toBe("hola ");
    expect(mensajeConProblemas("", [], t)).toBe("");
  });
});

describe("el número sobre la imagen", () => {
  const fotograma = { ancho: 1920, alto: 1080 };

  it("va en la esquina superior izquierda del recuadro, por dentro, y escala con el grosor del borde", () => {
    const e = etiquetaDelRecuadro({ x: 300, y: 50, w: 200, h: 150 }, fotograma);
    expect(e.x).toBe(300);
    expect(e.y).toBe(50);
    expect(e.lado).toBe(grosorDelRecuadro(fotograma) * 7);
    expect(e.fuente).toBeGreaterThan(0);
    expect(e.fuente).toBeLessThan(e.lado);
    // En una captura pequeña la etiqueta es más pequeña, pero nunca desaparece.
    const chica = etiquetaDelRecuadro({ x: 0, y: 0, w: 20, h: 20 }, { ancho: 400, alto: 300 });
    expect(chica.lado).toBeLessThan(e.lado);
    expect(chica.lado).toBeGreaterThanOrEqual(14);
  });

  it("en porcentajes, cada lado contra SU eje del fotograma, igual que el recuadro", () => {
    const pc = porcentajesDeLaEtiqueta({ x: 192, y: 108, w: 200, h: 150 }, fotograma);
    expect(pc.left).toBe("10%");
    expect(pc.top).toBe("10%");
    const lado = grosorDelRecuadro(fotograma) * 7;
    expect(pc.width).toBe(`${(lado / 1920) * 100}%`);
    expect(pc.height).toBe(`${(lado / 1080) * 100}%`);
    expect(porcentajesDeLaEtiqueta(rect(0), { ancho: 0, alto: 0 }).left).toBe("0%");
  });
});

describe("lo que se pinta: cada recuadro con su número, y el borrador sin número", () => {
  const fotograma = { url: "data:image/png;base64,iVBORw0KGgo=", ancho: 1000, alto: 500 };
  const lista: RecuadroNumerado[] = [
    { n: 1, rect: { x: 100, y: 50, w: 200, h: 100 }, texto: "" },
    { n: 2, rect: { x: 600, y: 250, w: 100, h: 100 }, texto: "" },
  ];

  it("dos recuadros, dos bordes y dos etiquetas «1» y «2» en su sitio", () => {
    const html = renderToStaticMarkup(createElement(VistaDeCaptura, { fotograma, recuadros: lista, t }));
    expect((html.match(new RegExp(`border:2px solid ${COLOR_DEL_RECUADRO}`, "g")) ?? []).length).toBe(2);
    expect((html.match(/class="numero-de-recuadro"/g) ?? []).length).toBe(2);
    expect(html).toContain(">1</span>");
    expect(html).toContain(">2</span>");
    // La etiqueta del 2 está donde empieza el 2: left 60%, top 50%.
    const dos = html.indexOf(">2</span>");
    const etiqueta = html.slice(html.lastIndexOf("<span", dos), dos);
    expect(etiqueta).toContain("left:60%");
    expect(etiqueta).toContain("top:50%");
  });

  it("el borrador se pinta como recuadro pero sin número: todavía no es un punto", () => {
    const html = renderToStaticMarkup(createElement(VistaDeCaptura, {
      fotograma, recuadros: [], borrador: { x: 0, y: 0, w: 100, h: 100 }, t,
    }));
    expect(html).toContain(`border:2px solid ${COLOR_DEL_RECUADRO}`);
    expect(html).not.toContain("numero-de-recuadro");
  });

  it("el editor pasa la lista entera a «Adjuntar», y el × de cada línea quita ESE recuadro", () => {
    const editor = leer("src/components/CapturaDeAyuda.tsx");
    expect(editor).toContain("onUsar: (recuadros: RecuadroNumerado[]) => void;");
    expect(editor).toContain("onClick={() => onUsar(recuadros)}");
    expect(editor).toContain("if (borrador) setRecuadros((lista) => agregaRecuadro(lista, borrador));");
    expect(editor).toContain("onClick={() => setRecuadros((lista) => quitaRecuadro(lista, n))}");
    expect(editor).toContain("onChange={(e) => setRecuadros((lista) => escribeProblema(lista, n, e.target.value))}");
    // Lleno: no se empieza otro arrastre.
    expect(editor).toContain("if (ocupado || lleno) return;");
    expect(editor).toContain("const lleno = recuadros.length >= MAX_RECUADROS;");
    // El lienzo pinta el número de cada uno con la misma etiqueta que la vista.
    expect(editor).toContain("ctx.fillText(String(n), etiqueta.x + etiqueta.lado / 2, etiqueta.y + etiqueta.lado / 2);");
    expect(editor).toContain("for (const { n, rect: recuadro } of recuadros) {");
  });

  it("el editor con texto sale bilingüe, y el título habla en plural", () => {
    const es = renderToStaticMarkup(createElement(EditorDeCaptura, { fotograma, t, onUsar: () => {}, onDescartar: () => {}, onDeNuevo: () => {} }));
    const en = renderToStaticMarkup(createElement(EditorDeCaptura, { fotograma, t: (e) => e, onUsar: () => {}, onDescartar: () => {}, onDeNuevo: () => {} }));
    expect(es).toContain("Señale los problemas");
    expect(es).toContain(`hasta ${MAX_RECUADROS}`);
    expect(en).toContain("Mark the problems");
    expect(en).toContain(`up to ${MAX_RECUADROS}`);
  });
});

describe("HelpButton: una solicitud con N puntos, no N solicitudes", () => {
  const boton = leer("src/components/HelpButton.tsx");

  it("al adjuntar la captura, los puntos se pegan al mensaje que ya había, y luego se manda UNA vez", () => {
    const ini = boton.indexOf("const adjuntaCaptura = async (recuadros: RecuadroNumerado[]) => {");
    expect(ini).toBeGreaterThan(-1);
    const bloque = boton.slice(ini, boton.indexOf("  const send = async", ini));
    const agrega = bloque.indexOf("agregaFicheros([imagen]);");
    const mensaje = bloque.indexOf("setMsg((actual) => mensajeConProblemas(actual, recuadros, t));");
    expect(agrega).toBeGreaterThan(-1);
    // El mensaje se compone DESPUÉS de que la imagen entró: si la imagen se rechaza, el texto no se toca.
    expect(mensaje).toBeGreaterThan(agrega);
    // Una sola llamada a enviar: no hay bucle por recuadro.
    expect((boton.match(/enviaSolicitudDeAyuda\(/g) ?? []).length).toBe(1);
  });

  it("el color de la etiqueta vive en el CSS, el mismo rojo que el lienzo", () => {
    const css = leer("src/app/globals.css");
    expect(css).toContain(`.numero-de-recuadro { background: ${COLOR_DEL_RECUADRO}; color: #ffffff; }`);
  });
});
