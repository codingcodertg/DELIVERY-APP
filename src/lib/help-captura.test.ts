import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { LIMITES_DE_ADJUNTOS, nombreSaneado, validaAdjuntos } from "./help-attachments";
import {
  LADO_MINIMO_DEL_RECUADRO, MAX_LADO_DE_CAPTURA, TIPOS_DE_CAPTURA, TIPO_DE_CAPTURA, acotaRect,
  alFotograma, conAyudaOculta, esCancelacionDeCaptura, falloDeCaptura, grosorDelRecuadro,
  mensajeDeFalloDeCaptura, nombreDeCaptura, porcentajesDelRecuadro, rectDeArrastre,
  recuadroDelArrastre, soportaCaptura, tamanoDeCaptura, validaCaptura,
} from "./help-captura";
import { COLOR_DEL_RECUADRO, EditorDeCaptura, VistaDeCaptura } from "@/components/CapturaDeAyuda";

/**
 * Capturar la pantalla desde Ayuda y señalar el problema (D-509).
 *
 * **Nada de esto abre un navegador.** `getDisplayMedia`, el `<video>`, el lienzo y el blob viven en
 * `CapturaDeAyuda.tsx` y NO se prueban aquí: no se pueden medir en vitest y una prueba que los finja no
 * podría fallar. Lo que sí se mide es todo lo que decide: el rectángulo, el escalado, el nombre, qué se
 * acepta, el orden en que Ayuda se esconde, y que la pantalla llame a todo eso.
 */

const leer = (r: string) => readFileSync(join(process.cwd(), r), "utf8").split("\r\n").join("\n");
const t = (_en: string, es: string) => es;

describe("¿puede este navegador capturar?", () => {
  it("solo si `getDisplayMedia` es una función de verdad", () => {
    expect(soportaCaptura({ mediaDevices: { getDisplayMedia: () => {} } })).toBe(true);
    expect(soportaCaptura({ mediaDevices: {} })).toBe(false);
    expect(soportaCaptura({})).toBe(false);
    expect(soportaCaptura(undefined)).toBe(false);
    expect(soportaCaptura(null)).toBe(false);
    // Un navegador que la tiene pero no como función (un móvil con el hueco puesto a `undefined`).
    expect(soportaCaptura({ mediaDevices: { getDisplayMedia: undefined } })).toBe(false);
    expect(soportaCaptura({ mediaDevices: { getDisplayMedia: true } })).toBe(false);
  });
});

describe("el recuadro: un arrastre en cualquier dirección", () => {
  it("arrastrar hacia arriba y a la izquierda da el MISMO rect, con ancho y alto positivos", () => {
    const abajoDerecha = rectDeArrastre({ x: 10, y: 20 }, { x: 110, y: 170 });
    expect(abajoDerecha).toEqual({ x: 10, y: 20, w: 100, h: 150 });
    // Los mismos dos puntos, soltando donde se empezó: el rect no puede cambiar.
    expect(rectDeArrastre({ x: 110, y: 170 }, { x: 10, y: 20 })).toEqual(abajoDerecha);
    // Y las dos diagonales mixtas, igual.
    expect(rectDeArrastre({ x: 110, y: 20 }, { x: 10, y: 170 })).toEqual(abajoDerecha);
    expect(rectDeArrastre({ x: 10, y: 170 }, { x: 110, y: 20 })).toEqual(abajoDerecha);
  });

  it("acotado a la imagen: lo que se sale por un borde se recorta ahí", () => {
    const limites = { ancho: 200, alto: 100 };
    expect(acotaRect({ x: -50, y: -30, w: 100, h: 60 }, limites)).toEqual({ x: 0, y: 0, w: 50, h: 30 });
    expect(acotaRect({ x: 150, y: 80, w: 100, h: 60 }, limites)).toEqual({ x: 150, y: 80, w: 50, h: 20 });
    // Entero fuera: no queda recuadro, no un recuadro pegado al borde.
    expect(acotaRect({ x: -200, y: -200, w: 50, h: 50 }, limites)).toEqual({ x: 0, y: 0, w: 0, h: 0 });
    // Y lo que cabe no se toca.
    expect(acotaRect({ x: 10, y: 10, w: 20, h: 20 }, limites)).toEqual({ x: 10, y: 10, w: 20, h: 20 });
  });

  it("un clic suelto no deja recuadro; el arrastre mínimo sí", () => {
    const limites = { ancho: 500, alto: 400 };
    expect(recuadroDelArrastre({ x: 50, y: 50 }, { x: 50, y: 50 }, limites)).toBeNull();
    const corto = LADO_MINIMO_DEL_RECUADRO - 1;
    expect(recuadroDelArrastre({ x: 50, y: 50 }, { x: 50 + corto, y: 50 + corto }, limites)).toBeNull();
    // Justo el mínimo, en las dos direcciones, sí cuenta.
    expect(recuadroDelArrastre({ x: 50, y: 50 }, { x: 50 + LADO_MINIMO_DEL_RECUADRO, y: 50 + LADO_MINIMO_DEL_RECUADRO }, limites))
      .toEqual({ x: 50, y: 50, w: LADO_MINIMO_DEL_RECUADRO, h: LADO_MINIMO_DEL_RECUADRO });
    // Alto suficiente pero ancho de un pelo: tampoco. Una raya no señala nada.
    expect(recuadroDelArrastre({ x: 50, y: 50 }, { x: 52, y: 300 }, limites)).toBeNull();
    // Y el acotado se aplica antes del mínimo: 4 px dentro de la imagen no son un recuadro.
    expect(recuadroDelArrastre({ x: 496, y: 10 }, { x: 600, y: 200 }, limites)).toBeNull();
  });
});

describe("de la imagen como se ve a los píxeles del fotograma", () => {
  it("el recuadro se escala por cada eje, con sus propias proporciones", () => {
    // La imagen se ve a 600×300 dentro del modal; el fotograma es de 1200×900 (eje x ×2, eje y ×3).
    const r = alFotograma({ x: 100, y: 50, w: 200, h: 100 }, { ancho: 600, alto: 300 }, { ancho: 1200, alto: 900 });
    expect(r).toEqual({ x: 200, y: 150, w: 400, h: 300 });
  });

  it("sin medidas de vista no se inventa nada (no `Infinity` ni `NaN` en el lienzo)", () => {
    const sinAncho = alFotograma({ x: 1, y: 1, w: 2, h: 2 }, { ancho: 0, alto: 300 }, { ancho: 1200, alto: 900 });
    expect(sinAncho).toEqual({ x: 0, y: 0, w: 0, h: 0 });
    expect(alFotograma({ x: 1, y: 1, w: 2, h: 2 }, { ancho: 600, alto: 0 }, { ancho: 1200, alto: 900 }))
      .toEqual({ x: 0, y: 0, w: 0, h: 0 });
  });
});

describe("lo que va a medir la captura", () => {
  it("una pantalla grande se encoge a 1920 por el lado largo, guardando la proporción", () => {
    expect(MAX_LADO_DE_CAPTURA).toBe(1920);
    expect(tamanoDeCaptura({ ancho: 3840, alto: 2160 })).toEqual({ ancho: 1920, alto: 1080 });
    // Vertical: el lado largo es el alto, y es ese el que manda.
    expect(tamanoDeCaptura({ ancho: 1080, alto: 2400 })).toEqual({ ancho: 864, alto: 1920 });
  });

  it("nunca agranda: una ventana pequeña se queda como está", () => {
    expect(tamanoDeCaptura({ ancho: 800, alto: 600 })).toEqual({ ancho: 800, alto: 600 });
    expect(tamanoDeCaptura({ ancho: 1920, alto: 1080 })).toEqual({ ancho: 1920, alto: 1080 });
  });

  it("un fotograma vacío se queda en cero, que es lo que el componente trata como «salió vacía»", () => {
    expect(tamanoDeCaptura({ ancho: 0, alto: 0 })).toEqual({ ancho: 0, alto: 0 });
    expect(tamanoDeCaptura({ ancho: 1920, alto: 0 })).toEqual({ ancho: 0, alto: 0 });
  });

  it("el borde se ve en cualquier resolución: nunca menos de 2 px, y 5 en una de 1920", () => {
    expect(grosorDelRecuadro({ ancho: 1920, alto: 1080 })).toBe(5);
    expect(grosorDelRecuadro({ ancho: 400, alto: 300 })).toBe(2);
    expect(grosorDelRecuadro({ ancho: 0, alto: 0 })).toBe(2);
  });
});

describe("el recuadro encima de la imagen, en porcentajes", () => {
  it("cada lado se mide contra SU eje del fotograma", () => {
    const p = porcentajesDelRecuadro({ x: 300, y: 50, w: 200, h: 150 }, { ancho: 1000, alto: 500 });
    expect(p).toEqual({ left: "30%", top: "10%", width: "20%", height: "30%" });
  });

  it("un fotograma sin medidas da 0% y no `NaN%`, que el navegador ignoraría en silencio", () => {
    const p = porcentajesDelRecuadro({ x: 10, y: 10, w: 10, h: 10 }, { ancho: 0, alto: 0 });
    expect(p).toEqual({ left: "0%", top: "0%", width: "0%", height: "0%" });
  });
});

describe("el nombre y qué se acepta: lo mismo que el cubo de la 119", () => {
  it("el nombre lleva la hora y pasa INTACTO por `nombreSaneado`", () => {
    const nombre = nombreDeCaptura(new Date("2026-10-10T15:04:05.123Z"));
    expect(nombre).toBe("captura-2026-10-10-15-04-05.png");
    // Lo que se ve en el correo es lo que se eligió aquí: si `rutaDeAdjunto` lo reescribiera, el
    // nombre del adjunto y el del fichero del cubo dejarían de coincidir.
    expect(nombreSaneado(nombre)).toBe(nombre);
    expect(nombre).not.toContain(":");
  });

  it("una captura es un adjunto normal: `validaAdjuntos` la acepta sin reglas aparte", () => {
    const comoAdjunto = { name: nombreDeCaptura(new Date()), size: 1024, type: TIPO_DE_CAPTURA };
    expect(validaAdjuntos([comoAdjunto])).toBeNull();
    // Y los tipos que admite la captura son un subconjunto de los del cubo, no una lista paralela.
    for (const tipo of TIPOS_DE_CAPTURA) expect(LIMITES_DE_ADJUNTOS.tipos, tipo).toContain(tipo);
  });

  it("10 MB y PNG/JPEG, el tope del cubo; lo demás se para antes de subir", () => {
    const captura = (size: number, type = TIPO_DE_CAPTURA) => ({ name: "captura.png", size, type });
    expect(validaCaptura(captura(LIMITES_DE_ADJUNTOS.maxBytes))).toBeNull();
    expect(validaCaptura(captura(LIMITES_DE_ADJUNTOS.maxBytes + 1))).toEqual({ motivo: "tamano", fichero: "captura.png" });
    expect(validaCaptura(captura(1024, "image/jpeg"))).toBeNull();
    // Un lienzo sin soporte de PNG devuelve el blob en otro tipo: eso lo rechazaría el cubo.
    expect(validaCaptura(captura(1024, "image/webp"))).toEqual({ motivo: "tipo", fichero: "captura.png" });
    expect(validaCaptura(captura(1024, ""))).toEqual({ motivo: "tipo", fichero: "captura.png" });
    expect(LIMITES_DE_ADJUNTOS.maxBytes).toBe(10485760);
  });
});

describe("cancelar el diálogo del navegador no es una avería", () => {
  it("`NotAllowedError` y `AbortError` son cancelaciones; lo demás, no", () => {
    expect(esCancelacionDeCaptura({ name: "NotAllowedError" })).toBe(true);
    expect(esCancelacionDeCaptura({ name: "AbortError" })).toBe(true);
    expect(esCancelacionDeCaptura({ name: "NotReadableError" })).toBe(false);
    expect(esCancelacionDeCaptura(new Error("roto"))).toBe(false);
    expect(esCancelacionDeCaptura(null)).toBe(false);
    expect(esCancelacionDeCaptura(undefined)).toBe(false);
  });

  it("cerrar el diálogo se cuenta como cancelada ANTES de mirar nuestro propio error", () => {
    // Lo que tira el navegador no es un `ErrorDeCaptura`: no trae `fallo`, trae `name`.
    expect(falloDeCaptura({ name: "NotAllowedError" })).toBe("cancelada");
    // Lo nuestro sí, y se respeta.
    expect(falloDeCaptura({ fallo: "sin-fotograma" })).toBe("sin-fotograma");
    expect(falloDeCaptura({ fallo: "no-soportado" })).toBe("no-soportado");
    // Un error cualquiera no se traduce a cancelada: eso haría desaparecer un fallo real.
    expect(falloDeCaptura(new Error("el lienzo no dio contexto"))).toBe("sin-fotograma");
    expect(falloDeCaptura({ fallo: "cualquier-cosa" })).toBe("sin-fotograma");
    expect(falloDeCaptura(undefined)).toBe("sin-fotograma");
  });

  it("los tres avisos son distintos, y los tres dejan en pie el camino de adjuntar a mano", () => {
    const avisos = (["no-soportado", "cancelada", "sin-fotograma"] as const).map((f) => mensajeDeFalloDeCaptura(f, t));
    expect(new Set(avisos).size).toBe(3);
    expect(avisos[0]).toContain("Adjunte una foto");
    expect(avisos[1]).toContain("no se tomó ninguna foto");
    expect(avisos[2]).toContain("adjunte una foto");
    // En inglés también dicen algo: `t` aquí devuelve el español, así que se comprueba al revés.
    const enIngles = mensajeDeFalloDeCaptura("cancelada", (en) => en);
    expect(enIngles).toContain("cancelled");
  });
});

describe("Ayuda fuera de la foto: el orden, que es la garantía", () => {
  /** El repintado termina en un microtask posterior: si quien captura no lo esperase, «captura» se
   *  apuntaría antes que «repintado». */
  const pasosDe = () => {
    const hechos: string[] = [];
    return {
      hechos,
      esconde: () => { hechos.push("esconde"); },
      esperaUnRepintado: async () => {
        await Promise.resolve();
        await Promise.resolve();
        hechos.push("repintado");
      },
      devuelve: () => { hechos.push("devuelve"); },
    };
  };

  it("se esconde, se repinta SIN Ayuda, se captura, y Ayuda vuelve — en ese orden", async () => {
    const p = pasosDe();
    const foto = await conAyudaOculta({
      ...p,
      captura: async () => { p.hechos.push("captura"); return "fotograma"; },
    });
    expect(p.hechos).toEqual(["esconde", "repintado", "captura", "devuelve"]);
    expect(foto).toBe("fotograma");
  });

  it("si se cancela el diálogo, Ayuda VUELVE y el fallo sigue subiendo", async () => {
    const p = pasosDe();
    const cancelada = Object.assign(new Error("cancelada"), { name: "NotAllowedError" });
    await expect(conAyudaOculta({
      ...p,
      captura: async () => { p.hechos.push("captura"); throw cancelada; },
    })).rejects.toBe(cancelada);
    // Sin esto, quien cancela se queda sin panel y con su mensaje a medio escribir dentro.
    expect(p.hechos).toEqual(["esconde", "repintado", "captura", "devuelve"]);
  });
});

describe("lo que se pinta encima de la captura", () => {
  const fotograma = { url: "data:image/png;base64,iVBORw0KGgo=", ancho: 1000, alto: 500 };

  it("sin recuadro no hay recuadro pintado, solo la imagen", () => {
    const html = renderToStaticMarkup(createElement(VistaDeCaptura, { fotograma, recuadro: null, t }));
    expect(html).toContain(fotograma.url);
    expect(html).not.toContain(COLOR_DEL_RECUADRO);
  });

  it("con recuadro, el div va en porcentajes del fotograma y cada lado en su eje", () => {
    const html = renderToStaticMarkup(createElement(VistaDeCaptura, {
      fotograma, recuadro: { x: 300, y: 50, w: 200, h: 150 }, t,
    }));
    expect(html).toContain("left:30%");
    expect(html).toContain("top:10%");
    expect(html).toContain("width:20%");
    expect(html).toContain("height:30%");
    expect(html).toContain(`border:2px solid ${COLOR_DEL_RECUADRO}`);
  });

  it("el editor abre sin recuadro, lo dice, y «Quitar recuadro» nace apagado", () => {
    const html = renderToStaticMarkup(createElement(EditorDeCaptura, {
      fotograma, t, onUsar: () => {}, onDescartar: () => {}, onDeNuevo: () => {},
    }));
    expect(html).toContain("Señale el problema");
    expect(html).toContain("Sin recuadro todavía");
    const quitar = html.indexOf("Quitar recuadro");
    expect(quitar).toBeGreaterThan(-1);
    // El `disabled` del botón, que en el markup va delante de su texto.
    expect(html.slice(html.lastIndexOf("<button", quitar), quitar)).toContain("disabled");
    // Adjuntar nace encendido: el recuadro es opcional, el dueño pidió señalar, no obligar a señalar.
    const adjuntar = html.indexOf("Adjuntar a la solicitud");
    expect(adjuntar).toBeGreaterThan(-1);
    expect(html.slice(html.lastIndexOf("<button", adjuntar), adjuntar)).not.toContain("disabled");
  });
});

describe("la pantalla: Ayuda no sale en la foto y la captura entra por la puerta de siempre", () => {
  const boton = leer("src/components/HelpButton.tsx");
  const captura = leer("src/components/CapturaDeAyuda.tsx");

  it("mientras se captura, HelpButton no dibuja NADA — una condición, no cuatro", () => {
    // La garantía que pidió el dueño en una sola línea: sin esto habría que comprobar pieza por pieza
    // (el botón flotante, el panel, el editor) que ninguna se quedó dentro.
    const corte = boton.indexOf("if (ocultoParaCapturar) return null;");
    expect(corte).toBeGreaterThan(-1);
    // Y va ANTES del único `return (` que pinta algo: después no esconde nada. Se busca con su salto de línea
    // y su sangría: desde D-NEXT hay antes un `return () => clearTimeout(id);` (el aviso de la burbuja).
    const pinta = boton.indexOf("\n  return (\n");
    expect(pinta).toBeGreaterThan(corte);
    // No se esconde con CSS. Un `display:none` o una opacidad siguen estando en el DOM, y lo que está
    // en el DOM puede salir en el fotograma de la pantalla.
    const dondeSeEsconde = boton.slice(corte, pinta);
    expect(dondeSeEsconde).not.toContain("display");
    expect(dondeSeEsconde).not.toContain("opacity");
  });

  it("y la bandera se enciende y se apaga por `conAyudaOculta`, no a mano alrededor de la captura", () => {
    const ini = boton.indexOf("await conAyudaOculta({");
    expect(ini).toBeGreaterThan(-1);
    const bloque = boton.slice(ini, boton.indexOf("});", ini));
    expect(bloque).toContain("esconde: () => setOcultoParaCapturar(true),");
    expect(bloque).toContain("esperaUnRepintado,");
    expect(bloque).toContain("captura: tomaFotograma,");
    expect(bloque).toContain("devuelve: () => setOcultoParaCapturar(false),");
    // Nadie más toca la bandera: si alguien la encendiera por su cuenta, el orden dejaría de estar
    // medido por las pruebas de `conAyudaOculta`.
    expect((boton.match(/setOcultoParaCapturar\(/g) ?? []).length).toBe(2);
  });

  it("el botón de siempre es la foto rápida, y no depende de que el navegador sepa capturar la pantalla", () => {
    // D-513: «Capturar esta pantalla» llama a la rápida y se pinta SIEMPRE. Antes iba dentro de
    // `{puedeCapturar ? (`, y un móvil sin `getDisplayMedia` se quedaba sin botón.
    const texto = boton.indexOf('t("Capture this screen", "Capturar esta pantalla")');
    expect(texto).toBeGreaterThan(-1);
    const suBoton = boton.slice(boton.lastIndexOf("<button", texto), texto);
    expect(suBoton).toContain("onClick={capturaRapida}");
    // Que no quede ningún `puedeCapturar ?` envolviendo el botón principal.
    expect(boton.slice(0, texto)).not.toContain("{puedeCapturar ? (");
  });

  it("el método del navegador solo aparece si la rápida falló, y sin soporte se dice por qué", () => {
    expect(boton).toContain("soportaCaptura(typeof navigator === \"undefined\" ? null : navigator)");
    const ini = boton.indexOf("{respaldoVisible && (puedeCapturar ? (");
    expect(ini).toBeGreaterThan(-1);
    // Las dos ramas, cada una acotada: el `)}` de un `t(...)` de dentro serviría de ancla falsa.
    const medio = boton.indexOf("\n              ) : (", ini);
    const fin = boton.indexOf("\n              ))}", medio);
    expect(medio).toBeGreaterThan(ini);
    expect(fin).toBeGreaterThan(medio);
    expect(boton.slice(ini, medio)).toContain("onClick={capturaConElNavegador}");
    // Sin soporte no hay botón que no funcione: hay una frase que explica por qué.
    expect(boton.slice(medio, fin)).toContain('{mensajeDeFalloDeCaptura("no-soportado", t)}');
    expect(boton.slice(medio, fin)).not.toContain("<button");
    // Y lo que lo enciende es exactamente el fallo de la rápida, en su `catch`.
    const rapida = boton.slice(boton.indexOf("const capturaRapida = async"), boton.indexOf("const capturaConElNavegador = async"));
    const elCatch = rapida.slice(rapida.indexOf("} catch {"), rapida.indexOf("} finally {"));
    expect(elCatch).toContain("setRespaldoVisible(true);");
  });

  it("un fallo de captura se cuenta con el mensaje que le toca, sin romper el panel", () => {
    expect(boton).toContain("notify(mensajeDeFalloDeCaptura(falloDeCaptura(e), t));");
    expect((boton.match(/mensajeDeFalloDeCaptura\(falloDeCaptura\(e\), t\)/g) ?? []).length).toBe(2);
  });

  it("la captura se valida y se mete en la MISMA lista de adjuntos que un fichero elegido a mano", () => {
    const ini = boton.indexOf("const adjuntaCaptura = async");
    expect(ini).toBeGreaterThan(-1);
    const bloque = boton.slice(ini, boton.indexOf("  const send = async", ini));
    expect(bloque).toContain("await ficheroDeCaptura(tomada, recuadro, new Date());");
    const valida = bloque.indexOf("const malo = validaCaptura(imagen);");
    const agrega = bloque.indexOf("agregaFicheros([imagen]);");
    expect(valida).toBeGreaterThan(-1);
    expect(agrega).toBeGreaterThan(valida);
    // `agregaFicheros` es la misma puerta que usa el input de ficheros, con `validaAdjuntos` dentro.
    expect(boton).toContain("const eligeFicheros = (lista: FileList | null) => agregaFicheros([...(lista ?? [])]);");
    // Y de ahí sale por donde salía: `ficheros` → `enviaSolicitudDeAyuda` → cubo `help-files`.
    // Desde D-NEXT quién escribe sale de la sesión (`quien`, de `/api/help`) y el destino lo pone el servidor.
    expect(boton).toContain("userId: quien.id, message, ficheros, page: pathname,");
    expect(boton).not.toContain(".upload(");
  });

  it("el flujo de la pantalla se corta siempre: ninguna barra de «estás compartiendo» se queda puesta", () => {
    const ini = captura.indexOf("const flujo = await navigator.mediaDevices.getDisplayMedia(opciones);");
    expect(ini).toBeGreaterThan(-1);
    const bloque = captura.slice(ini);
    const fin = bloque.indexOf("} finally {");
    expect(fin).toBeGreaterThan(-1);
    expect(bloque.slice(fin)).toContain("for (const carril of flujo.getTracks()) carril.stop();");
  });

  it("y se captura la pantalla de verdad: `preferCurrentTab`, no el DOM dibujado en un lienzo", () => {
    expect(captura).toContain("preferCurrentTab: true");
    // El mapa es la razón: `html2canvas` y los suyos no lo pintan. Si algún día se cambia de camino,
    // que no sea por descuido.
    expect(captura).not.toContain("html2canvas");
  });
});

describe("Ayuda vuelve aunque la espera se cuelgue (medido en Chrome, D-509)", () => {
  it("si `esperaUnRepintado` no termina nunca, Ayuda NO se queda escondida: el fallo sube y devuelve corre", async () => {
    // El caso real: pestaña en segundo plano, `requestAnimationFrame` congelado. Antes, esconder y esperar
    // iban FUERA del try, así que `devuelve()` no corría y el panel desaparecía hasta recargar.
    const pasos: string[] = [];
    const colgada = conAyudaOculta({
      esconde: () => { pasos.push("esconde"); },
      esperaUnRepintado: () => new Promise<void>(() => { /* no termina jamás */ }),
      captura: async () => { pasos.push("captura"); return "foto"; },
      devuelve: () => { pasos.push("devuelve"); },
    });
    // No se resuelve; lo que importa es que, si la espera FALLA, devuelve corre.
    const conFallo = conAyudaOculta({
      esconde: () => { pasos.push("esconde2"); },
      esperaUnRepintado: async () => { throw new Error("rAF congelado"); },
      captura: async () => { pasos.push("captura2"); return "foto"; },
      devuelve: () => { pasos.push("devuelve2"); },
    });
    await expect(conFallo).rejects.toThrow("rAF congelado");
    expect(pasos).toEqual(["esconde", "esconde2", "devuelve2"]);
    expect(pasos).not.toContain("captura2");
    void colgada;
  });
});
