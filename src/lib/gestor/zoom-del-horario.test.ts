import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  anchoEstimado, anchosParaElTexto, desplazamientoParaCentrar, etiquetaQueCabe, filasDelHorario, formasDeLaEtiqueta,
  marcasDelEje, minutoEnElCentro, minutoEnLaPista, paradaDeCadaEntrega, porcentajeEnElEje, pxPorMinAjustado,
  RELLENO_DE_BARRA_PX, siguienteZoom, tramoDelHorario, TRAMO_SIN_PARADAS, vistaDelEje,
} from "@/lib/gestor/zoom-del-horario";

/**
 * D-503 · «📅 Horario»: zoom al tramo con paradas, etiquetas que caben y sin choferes vacíos. El dueño, 2026-10-08, con una
 * captura: «mira que fe se  mira si todos estan concentados ahi pues que se haga un zoom y si stevene no tiene nada que no
 * salga».
 */
const leer = (r: string) => readFileSync(join(process.cwd(), r), "utf8").split("\r\n").join("\n");
const plano = (s: string) => s.replace(/\s+/g, " ");
const gestor = plano(leer("src/app/(app)/routes/page.tsx"));
const gantt = plano(leer("src/components/GanttTimeline.tsx"));
const css = plano(leer("src/app/globals.css"));

const barra = (llegadaMin: number, finMin: number, ventana: [number, number] | null = null) => ({ llegadaMin, finMin, ventana });
/** El caso de la captura: todas las paradas entre 08:30 y 10:00. */
const DEL_DUENO = [barra(515, 530, [480, 1020]), barra(540, 555), barra(570, 600, [420, 1140])];

describe("1 · el tramo: de la primera parada a la última, con margen y a la media hora", () => {
  it("la captura del dueño (08:35 a 10:00) da 08:00–10:30, no 07:00–19:00", () => {
    expect(tramoDelHorario(DEL_DUENO)).toEqual({ inicio: 480, fin: 630 });
  });
  it("las ventanas no estiran el tramo (una de 07:00 a 19:00 deshacía el zoom)", () => {
    expect(tramoDelHorario([barra(515, 530, [420, 1140])])).toEqual(tramoDelHorario([barra(515, 530)]));
  });
  it("30 min de margen, redondeado HACIA FUERA a la media hora", () => {
    expect(tramoDelHorario([barra(481, 496)])).toEqual({ inicio: 450, fin: 540 }); // 08:01–08:16 → 07:30–09:00
    expect(tramoDelHorario([barra(510, 525)])).toEqual({ inicio: 480, fin: 570 }); // justo en la media hora: 08:00–09:30
  });
  it("cuenta la llegada más temprana y el FIN de descarga más tardío, en cualquier orden", () => {
    expect(tramoDelHorario([barra(600, 700), barra(500, 510)])).toEqual({ inicio: 450, fin: 750 });
  });
  it("no se sale del día", () => {
    expect(tramoDelHorario([barra(10, 20), barra(1400, 1430)])).toEqual({ inicio: 0, fin: 1440 });
  });
  it("sin paradas, el día de antes (07:00–19:00)", () => {
    expect(tramoDelHorario([])).toEqual(TRAMO_SIN_PARADAS);
    expect(TRAMO_SIN_PARADAS).toEqual({ inicio: 420, fin: 1140 });
  });
});

describe("1 · la escala: el tramo llena el ancho", () => {
  const t = { inicio: 480, fin: 630 };
  it("ajustado, el tramo llena el ancho justo: sin desplazamiento lateral", () => {
    const v = vistaDelEje(t, 990, 1);
    expect(v.inicio).toBe(480);
    expect(v.fin).toBe(630);
    expect(v.pxPorMin).toBeCloseTo(6.6);
    expect(v.anchoPista).toBe(990);
    expect(v.zoom).toBeCloseTo(1);
  });
  it("un día largo (12 h) también cabe en una pantalla grande", () => {
    const v = vistaDelEje({ inicio: 450, fin: 1170 }, 990, 1);
    expect(v.anchoPista).toBe(990);
    expect(v.pxPorMin).toBeCloseTo(1.375);
  });
  it("pocas paradas juntas: el minuto crece hasta el tope (8 px/min) y el tramo se abre por los dos lados para llenar", () => {
    expect(pxPorMinAjustado({ inicio: 540, fin: 600 }, 990)).toBe(8);
    const v = vistaDelEje({ inicio: 540, fin: 600 }, 990, 1);
    expect(v.pxPorMin).toBe(8);
    expect(v.inicio).toBeCloseTo(508.125);
    expect(v.fin).toBeCloseTo(631.875);
    expect(v.anchoPista).toBe(990);
  });
  it("en el teléfono (pista de menos de 480 px) no baja de 2 px/min, y se desplaza de lado", () => {
    expect(pxPorMinAjustado({ inicio: 450, fin: 930 }, 230)).toBe(2);
    const v = vistaDelEje({ inicio: 450, fin: 930 }, 230, 1);
    expect(v.anchoPista).toBe(960);
    // En una pantalla de escritorio el mismo tramo NO tiene mínimo: llena el ancho.
    expect(pxPorMinAjustado({ inicio: 450, fin: 930 }, 600)).toBeCloseTo(1.25);
  });
  it("sin medir todavía, no inventa: sin ancho de pista", () => {
    const v = vistaDelEje(t, 0, 1);
    expect(v.anchoPista).toBeNull();
    expect(v.pxPorMin).toBe(0);
    expect([v.inicio, v.fin]).toEqual([480, 630]);
  });
});

describe("1 · ＋ / － / Ajustar", () => {
  const t = { inicio: 480, fin: 630 };
  it("＋ acerca: más px por minuto y una pista más ancha que la caja (se desplaza de lado)", () => {
    const v = vistaDelEje(t, 990, siguienteZoom(t, 990, 1, "mas"));
    expect(v.pxPorMin).toBeCloseTo(9.9);
    expect(v.anchoPista).toBe(1485);
    expect([v.inicio, v.fin]).toEqual([480, 630]);
  });
  it("－ aleja: el tramo se abre por los dos lados y sigue llenando el ancho", () => {
    const v = vistaDelEje(t, 990, siguienteZoom(t, 990, 1, "menos"));
    expect(v.pxPorMin).toBeCloseTo(4.4);
    expect(v.inicio).toBeCloseTo(442.5);
    expect(v.fin).toBeCloseTo(667.5);
    expect(v.anchoPista).toBe(990);
  });
  it("－ llega como mucho a 12 horas a la vista, y entonces se apaga", () => {
    const v = vistaDelEje(t, 990, 0.01);
    expect(v.fin - v.inicio).toBeCloseTo(720);
    expect(v.puedeAlejar).toBe(false);
    expect(v.puedeAcercar).toBe(true);
  });
  it("＋ llega como mucho a 24 px/min, y entonces se apaga", () => {
    const v = vistaDelEje(t, 990, 100);
    expect(v.pxPorMin).toBe(24);
    expect(v.puedeAcercar).toBe(false);
    expect(v.puedeAlejar).toBe(true);
  });
  it("pasado el tope, el botón contrario responde a la PRIMERA (el zoom se guarda ya dentro de sus topes)", () => {
    expect(vistaDelEje(t, 990, siguienteZoom(t, 990, 100, "menos")).pxPorMin).toBeCloseTo(16);
    expect(siguienteZoom(t, 990, 100, "mas")).toBeCloseTo(24 / 6.6);
  });
  it("al abrirse, el tramo no se sale del día: se corre hacia dentro", () => {
    const a = vistaDelEje({ inicio: 30, fin: 150 }, 990, 0.01);
    expect([a.inicio, a.fin]).toEqual([0, 720]);
    const b = vistaDelEje({ inicio: 1320, fin: 1440 }, 990, 0.01);
    expect([b.inicio, b.fin]).toEqual([720, 1440]);
  });
  it("acercar sobre el centro: el minuto del centro se queda en el centro", () => {
    const v = vistaDelEje(t, 990, 1.5);
    expect(minutoEnElCentro(v, 0, 990)).toBeCloseTo(530);
    expect(Math.abs(desplazamientoParaCentrar(v, 555, 990) - 247.5)).toBeLessThanOrEqual(0.5); // 75 min × 9,9 − 495
    expect(minutoEnElCentro(v, desplazamientoParaCentrar(v, 555, 990), 990)).toBeCloseTo(555, 0);
    expect(desplazamientoParaCentrar(v, 480, 990)).toBe(0);
    expect(desplazamientoParaCentrar(v, 630, 990)).toBe(495);
  });
  it("posición en el eje y minuto bajo el puntero, sin salirse", () => {
    expect(porcentajeEnElEje(t, 555)).toBe(50);
    expect(porcentajeEnElEje(t, 400)).toBe(0);
    expect(porcentajeEnElEje(t, 700)).toBe(100);
    expect(minutoEnLaPista(t, 495, 990)).toBe(555);
    expect(minutoEnLaPista(t, -5, 990)).toBe(480);
    expect(minutoEnLaPista(t, 2000, 990)).toBe(630);
  });
});

describe("1 · las marcas de hora", () => {
  it("cada 15 min si caben (6,6 px/min); la del borde, hacia dentro", () => {
    const m = marcasDelEje({ inicio: 480, fin: 630, pxPorMin: 6.6 });
    expect(m.map((x) => x.texto)).toEqual(["08:00", "08:15", "08:30", "08:45", "09:00", "09:15", "09:30", "09:45", "10:00", "10:15", "10:30"]);
    expect(m[0].alinea).toBe("inicio");
    expect(m[1].alinea).toBe("centro");
    expect(m[m.length - 1].alinea).toBe("fin");
    expect(m[m.length - 1].pct).toBe(100);
  });
  it("el paso crece si no caben: 30 min a 2 px/min, 60 a 1, 4 h a 0,3", () => {
    const paso = (px: number) => { const m = marcasDelEje({ inicio: 0, fin: 1440, pxPorMin: px }); return m[1].min - m[0].min; };
    expect(paso(2)).toBe(30);
    expect(paso(1)).toBe(60);
    expect(paso(0.3)).toBe(240);
  });
  it("con el tramo abierto (no en la media hora), la primera marca es la siguiente en punto", () => {
    const m = marcasDelEje({ inicio: 508.125, fin: 631.875, pxPorMin: 8 });
    expect(m[0].texto).toBe("08:30");
    expect(m[0].alinea).toBe("inicio");
    expect(m[m.length - 1].texto).toBe("10:30");
    expect(m[m.length - 1].alinea).toBe("fin");
  });
  it("un borde que cae en punto por aritmética (05:00 y una millonésima) sigue llevando su marca", () => {
    const m = marcasDelEje({ inicio: 300.0000001, fin: 1020, pxPorMin: 1.375 });
    expect(m[0].texto).toBe("05:00");
  });
});

describe("2 · la etiqueta de la barra: completa si cabe, si no una forma corta, nunca cortada", () => {
  const mide = (s: string) => [...s].length * 7;
  it("las formas, de la más larga a la más corta: varias facturas, los últimos dígitos, el número de parada, ⚠", () => {
    expect(formasDeLaEtiqueta("17938 / 17942", true, 3)).toEqual(["⚠17938 / 17942", "⚠17938 +1", "⚠…7938", "⚠…938", "⚠3", "⚠", ""]);
    expect(formasDeLaEtiqueta("INV-3009", false, 2)).toEqual(["INV-3009", "…3009", "…009", "2", ""]);
    expect(formasDeLaEtiqueta("#1009", false)).toEqual(["#1009", "…009", ""]);
  });
  it("elige la más larga que cabe en el ancho (con el relleno de la barra)", () => {
    expect(RELLENO_DE_BARRA_PX).toBe(14);
    expect(etiquetaQueCabe("INV-3009", false, 70, mide, 2)).toBe("INV-3009");
    expect(etiquetaQueCabe("INV-3009", false, 69, mide, 2)).toBe("…3009");
    expect(etiquetaQueCabe("INV-3009", false, 48, mide, 2)).toBe("…009");
    expect(etiquetaQueCabe("INV-3009", false, 41, mide, 2)).toBe("2");
    expect(etiquetaQueCabe("INV-3009", false, 20, mide, 2)).toBe("");
    expect(etiquetaQueCabe("17938 / 17942", true, 30, mide, 3)).toBe("⚠3");
    expect(etiquetaQueCabe("17938 / 17942", true, 27, mide, 3)).toBe("⚠");
  });
  it("lo que elige nunca es más ancho que la barra, en ningún ancho (no más «#!» ni «99» cortados)", () => {
    for (const p of ["17938 / 17942", "INV-3009", "#1009", "99", "14"]) {
      for (let w = 0; w <= 160; w++) {
        const e = etiquetaQueCabe(p, w % 2 === 0, w, mide, 12);
        expect(e === "" || mide(e) + RELLENO_DE_BARRA_PX <= w, `${p} en ${w}px: «${e}»`).toBe(true);
      }
    }
  });
  it("sin lienzo para medir, estima por lo alto", () => {
    expect(anchoEstimado("⚠")).toBe(13);
    expect(anchoEstimado("INV-3009")).toBeGreaterThan(50); // en el navegador mide ~50 px
    expect(etiquetaQueCabe("INV-3009", false, 20)).toBe("");
  });
  it("si una barra pisa a la siguiente, su texto solo tiene hasta donde empieza la otra", () => {
    const a = anchosParaElTexto([{ id: "c", izquierda: 100, ancho: 20 }, { id: "a", izquierda: 0, ancho: 50 }, { id: "b", izquierda: 30, ancho: 40 }]);
    expect(a.get("a")).toBe(30);
    expect(a.get("b")).toBe(40);
    expect(a.get("c")).toBe(20);
  });
  it("el número de parada es el de la tabla y el mapa (D-485): cuenta la parada en la tienda; una orden en dos cargas, la primera", () => {
    const filas = [{ tipo: "P" as const }, { tipo: "D" as const, orden: "a" }, { tipo: "D" as const, orden: "b" }, { tipo: "P" as const }, { tipo: "D" as const, orden: "a" }];
    const m = paradaDeCadaEntrega(filas, [1, 2, 2, 3, 4]);
    expect([...m.entries()]).toEqual([["a", 2], ["b", 2]]);
  });
});

describe("3 · quién sale: solo las rutas con paradas, y las que deja el filtro del panel", () => {
  const filas = [{ key: "Ana", barras: [1] }, { key: "Steven", barras: [] }, { key: "Beto", barras: [1, 2] }];
  it("Steven, sin nada ese día, no sale", () => {
    expect(filasDelHorario(filas, () => true).map((f) => f.key)).toEqual(["Ana", "Beto"]);
  });
  it("una ruta que el filtro del panel deja fuera tampoco sale (D-488)", () => {
    expect(filasDelHorario(filas, (k) => k !== "Beto").map((f) => f.key)).toEqual(["Ana"]);
    expect(filasDelHorario(filas, () => false)).toEqual([]);
  });
});

describe("la pantalla usa las piezas", () => {
  it("el Gestor y «Ruta de hoy» pintan `filasDelHorario` con el filtro de choferes (también el Gestor, no solo en solo lectura)", () => {
    expect(gestor).toContain("const filasDelGantt = filasDelHorario(ganttRows, pasaFiltro);");
    expect(gestor).not.toContain("soloLectura ? ganttRows.filter(");
    expect(gestor).toContain("<GanttTimeline rows={filasDelGantt} t={t}");
    expect(gestor).toContain("{filasDelGantt.length === 0");
    // Con rutas con paradas pero ninguna marcada, lo dice (no «Aún no hay órdenes asignadas»).
    expect(gestor).toContain('<div className="empty" data-horario-vacio>{ganttRows.some((r) => r.barras.length > 0) ? t("No driver with stops is ticked in “Drivers & routes”.", "Ningún chofer con paradas está marcado en «Choferes y rutas».")');
  });
  it("cada fila lleva el número de parada de la tabla (`paradasDeLaRuta` sobre la misma lectura)", () => {
    expect(gestor).toContain("const filas = lecturaDe(r.clave, stops).filas;");
    expect(gestor).toContain("paradaDe: paradaDeCadaEntrega(filas, paradasDeLaRuta(filas, stops).deFila),");
  });
  it("el eje sale del tramo con paradas y de la escala medida, no de 07:00–19:00", () => {
    expect(gantt).toContain("const tramo = useMemo(() => tramoDelHorario(rows.flatMap((r) => r.barras)), [rows]);");
    expect(gantt).toContain("const vista = vistaDelEje(tramo, anchoDisponible, zoom);");
    expect(gantt).toContain("const pct = (m: number) => porcentajeEnElEje(vista, m);");
    expect(gantt).toContain("const marcas = marcasDelEje(vista);");
    expect(gantt).not.toContain("AXIS_START");
    expect(gantt).not.toContain("AXIS_END_MIN");
    expect(gantt).toContain("width: `calc(var(--gantt-nombre) + ${HUECO_COLUMNAS_PX}px + ${vista.anchoPista}px)`");
    expect(gantt).toContain("setAnchoDisponible(anchoVisible())");
  });
  it("al arrastrar, el minuto bajo el puntero sale de la MISMA escala", () => {
    expect(gantt).toContain("const min = minutoEnLaPista(vista, x - pi.left, pi.width);");
  });
  it("los botones ＋ / － / Ajustar, con su tope y su «Ajustar» que vuelve al 1", () => {
    expect(gantt).toContain('data-gantt-zoom="mas" disabled={!vista.puedeAcercar}');
    expect(gantt).toContain('data-gantt-zoom="menos" disabled={!vista.puedeAlejar}');
    expect(gantt).toContain('data-gantt-zoom="ajustar" disabled={ajustado}');
    expect(gantt).toContain("setZoom(siguienteZoom(tramo, anchoDisponible, zoom, hacia));");
    expect(gantt).toContain('if (hacia === "ajustar") { centroPendiente.current = null; setZoom(1);');
    expect(gantt).toContain("c.scrollLeft = desplazamientoParaCentrar(vista, centro, anchoVisible());");
    expect(gantt).toContain('{t("Fit", "Ajustar")}');
  });
  it("cada barra escribe lo que cabe (hasta la siguiente), con el texto entero y el número de parada en el `title`", () => {
    expect(gantt).toContain("const anchoDelTexto = vista.pxPorMin > 0 ? anchosParaElTexto(row.barras.map(pxDeBarra)) : null;");
    expect(gantt).toContain("etiquetaQueCabe(nombre(b.id), b.tardeMin > 0, anchoDelTexto.get(b.id) ?? 0, mideTexto, parada)");
    expect(gantt).toContain("const parada = row.paradaDe?.get(b.id) ?? b.puesto + 1;");
    expect(gantt).toContain('· ${t("stop", "parada")} ${parada} ·');
  });
  it("CSS: sin el ancho mínimo fijo, el texto de la barra no se parte en dos renglones, y los nombres quedan fijos al desplazarse", () => {
    expect(css).not.toContain("min-width: 620px");
    expect(css).toMatch(/\.gantt-bar \{[^}]*white-space: nowrap;/);
    expect(css).toMatch(/\.gantt-rowlabel \{[^}]*position: sticky; left: 0;/);
    expect(css).toContain(".gantt-hour-fin { transform: translateX(-100%); }");
  });
});
