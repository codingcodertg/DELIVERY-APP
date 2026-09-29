import { describe, expect, it } from "vitest";
import { toCSV } from "@/lib/utils";
import { AREA_KEYS } from "./areas";
import {
  diaDe, eleccionesDe, filtrarPorFechas, MAX_DIAS_SERIE, paraContactar, porArea, porcentajeNada, respuestasPorDia, tablaCsv,
  textosOther, type RespuestaEncuesta,
} from "./resumen";
import { almacenDeLaBase, filaDeLaBase, PAGINA } from "./almacen";
import { almacenDemo } from "./demo";

/** Una respuesta con lo mínimo; lo demás se pisa por caso. */
const r = (id: string, created_at: string, extra: Partial<RespuestaEncuesta> = {}): RespuestaEncuesta => ({
  id, created_at, nothing_to_improve: false, selected_areas: [], other_text: null, ratings: {}, wants_contact: false,
  contact_name: null, contact_phone: null, contact_email: null, contacted: false, contacted_at: null, ...extra,
});

describe("el día es el de Texas, no el UTC", () => {
  it("las 03:00 UTC del 29 son todavía el 28 en Texas", () => {
    expect(diaDe("2026-09-29T03:00:00Z")).toBe("2026-09-28");
    expect(diaDe("2026-09-29T06:00:00Z")).toBe("2026-09-29");
  });
});

describe("filtrarPorFechas", () => {
  // Desordenadas a propósito: un filtro que confiara en el orden fallaría aquí.
  const filas = [r("c", "2026-09-10T18:00:00Z"), r("a", "2026-09-01T18:00:00Z"), r("b", "2026-09-05T18:00:00Z"), r("d", "2026-09-11T02:00:00Z")];
  it("incluye los dos extremos, en día de Texas", () => {
    expect(filtrarPorFechas(filas, "2026-09-05", "2026-09-10").map((f) => f.id)).toEqual(["c", "b", "d"]);
  });
  it("un extremo vacío no limita", () => {
    expect(filtrarPorFechas(filas, null, "2026-09-05").map((f) => f.id)).toEqual(["a", "b"]);
    expect(filtrarPorFechas(filas, "2026-09-06", null).map((f) => f.id)).toEqual(["c", "d"]);
    expect(filtrarPorFechas(filas, null, null)).toHaveLength(4);
  });
});

describe("respuestasPorDia", () => {
  const filas = [r("x", "2026-09-03T18:00:00Z"), r("y", "2026-09-01T18:00:00Z"), r("z", "2026-09-03T20:00:00Z")];
  it("rellena con cero los días sin respuestas, en el rango del filtro", () => {
    expect(respuestasPorDia(filas, "2026-08-31", "2026-09-04")).toEqual([
      { dia: "2026-08-31", n: 0 }, { dia: "2026-09-01", n: 1 }, { dia: "2026-09-02", n: 0 }, { dia: "2026-09-03", n: 2 }, { dia: "2026-09-04", n: 0 },
    ]);
  });
  it("sin filtro, del primer al último día de las filas", () => {
    expect(respuestasPorDia(filas, null, null).map((s) => s.dia)).toEqual(["2026-09-01", "2026-09-02", "2026-09-03"]);
  });
  it("sin filas y sin filtro, vacía; con el rango al revés, vacía", () => {
    expect(respuestasPorDia([], null, null)).toEqual([]);
    expect(respuestasPorDia(filas, "2026-09-05", "2026-09-01")).toEqual([]);
  });
  it("un rango enorme se corta a los últimos MAX_DIAS_SERIE días", () => {
    const s = respuestasPorDia(filas, "2020-01-01", "2026-09-04");
    expect(s).toHaveLength(MAX_DIAS_SERIE);
    expect(s[s.length - 1].dia).toBe("2026-09-04");
  });
});

describe("porArea", () => {
  const filas = [
    r("1", "2026-09-01T18:00:00Z", { selected_areas: ["pricing", "wait_time"], ratings: { pricing: 2, wait_time: 5 } }),
    r("2", "2026-09-02T18:00:00Z", { selected_areas: ["pricing"], ratings: { pricing: 5 } }),
    r("3", "2026-09-03T18:00:00Z", { nothing_to_improve: true }),
    r("4", "2026-09-04T18:00:00Z", { selected_areas: ["pricing"], ratings: { pricing: 4 } }),
  ];
  const res = porArea(filas);
  it("las ocho áreas, en el orden de la encuesta", () => {
    expect(res.map((a) => a.key)).toEqual([...AREA_KEYS]);
  });
  it("veces elegida y media de sus calificaciones", () => {
    const precio = res.find((a) => a.key === "pricing")!;
    expect(precio.veces).toBe(3);
    expect(precio.media).toBeCloseTo(11 / 3, 10);
    expect(res.find((a) => a.key === "wait_time")).toEqual({ key: "wait_time", veces: 1, media: 5 });
  });
  it("un área que nadie eligió: cero y sin media (no 0 estrellas)", () => {
    expect(res.find((a) => a.key === "returns_exchanges")).toEqual({ key: "returns_exchanges", veces: 0, media: null });
  });
});

describe("porcentajeNada", () => {
  it("sin respuestas no hay porcentaje (0 % sería mentir)", () => {
    expect(porcentajeNada([])).toBeNull();
  });
  it("1 de 4 es 25", () => {
    expect(porcentajeNada([r("a", "2026-09-01T18:00:00Z", { nothing_to_improve: true }), r("b", "2026-09-01T18:00:00Z"), r("c", "2026-09-01T18:00:00Z"), r("d", "2026-09-01T18:00:00Z")])).toBe(25);
  });
});

describe("textosOther", () => {
  it("solo los de «Other», recortados, del más reciente al más antiguo, con su calificación", () => {
    const filas = [
      r("viejo", "2026-09-01T18:00:00Z", { selected_areas: ["other"], other_text: " Parking ", ratings: { other: 2 } }),
      r("sin", "2026-09-05T18:00:00Z", { selected_areas: ["pricing"], ratings: { pricing: 3 } }),
      r("nuevo", "2026-09-04T18:00:00Z", { selected_areas: ["pricing", "other"], other_text: "Horario", ratings: { pricing: 4, other: 1 } }),
    ];
    expect(textosOther(filas)).toEqual([
      { id: "nuevo", created_at: "2026-09-04T18:00:00Z", texto: "Horario", calificacion: 1 },
      { id: "viejo", created_at: "2026-09-01T18:00:00Z", texto: "Parking", calificacion: 2 },
    ]);
  });
});

describe("paraContactar", () => {
  it("solo quienes lo pidieron; pendientes primero y, dentro, lo más reciente arriba", () => {
    const filas = [
      r("hecho-nuevo", "2026-09-09T18:00:00Z", { wants_contact: true, contacted: true, contacted_at: "2026-09-10T18:00:00Z" }),
      r("pend-viejo", "2026-09-01T18:00:00Z", { wants_contact: true }),
      r("no-quiere", "2026-09-08T18:00:00Z"),
      r("pend-nuevo", "2026-09-07T18:00:00Z", { wants_contact: true }),
      r("hecho-viejo", "2026-09-02T18:00:00Z", { wants_contact: true, contacted: true, contacted_at: "2026-09-03T18:00:00Z" }),
    ];
    expect(paraContactar(filas).map((f) => f.id)).toEqual(["pend-nuevo", "pend-viejo", "hecho-nuevo", "hecho-viejo"]);
  });
});

describe("eleccionesDe", () => {
  it("«Nada» con su rótulo; las áreas con su calificación, en su idioma", () => {
    expect(eleccionesDe(r("a", "2026-09-01T18:00:00Z", { nothing_to_improve: true }), "es")).toBe("Nada, todo estuvo bien");
    const f = r("b", "2026-09-01T18:00:00Z", { selected_areas: ["wait_time", "other"], ratings: { wait_time: 2, other: 4 } });
    expect(eleccionesDe(f, "es")).toBe("Tiempo de espera 2 · Otro 4");
    expect(eleccionesDe(f, "en")).toBe("Wait time 2 · Other 4");
  });
});

describe("tablaCsv", () => {
  const f = r("id-1", "2026-09-29T03:05:00Z", {
    selected_areas: ["pricing", "other"], other_text: "Más, por favor", ratings: { pricing: 3, other: 5 },
    wants_contact: true, contact_name: "Ana", contact_email: "ana@example.com",
  });
  const { cabeceras, filas } = tablaCsv([f]);
  it("una columna de calificación por área, alineada con su cabecera", () => {
    expect(cabeceras).toHaveLength(19);
    const fila = filas[0];
    expect(fila).toHaveLength(cabeceras.length);
    expect(fila[cabeceras.indexOf("rating_pricing")]).toBe(3);
    expect(fila[cabeceras.indexOf("rating_other")]).toBe(5);
    expect(fila[cabeceras.indexOf("rating_wait_time")]).toBeNull();
  });
  it("la hora es la de Texas y el texto con coma sale entre comillas", () => {
    expect(filas[0][1]).toBe("2026-09-28 22:05");
    expect(toCSV(cabeceras, filas).split("\n")[1]).toContain('"Más, por favor"');
    expect(filas[0][cabeceras.indexOf("contact_phone")]).toBeNull();
    expect(filas[0][cabeceras.indexOf("wants_contact")]).toBe("yes");
  });
});

describe("filaDeLaBase", () => {
  it("tipa lo que llega de la base y tira lo que no es número en ratings", () => {
    const f = filaDeLaBase({ id: "x", created_at: "2026-09-01T00:00:00Z", nothing_to_improve: false, selected_areas: ["pricing", 3], ratings: { pricing: 4, raro: "5" }, wants_contact: false, contacted: null });
    expect(f.selected_areas).toEqual(["pricing"]);
    expect(f.ratings).toEqual({ pricing: 4 });
    expect(f.contacted).toBe(false);
    expect(filaDeLaBase({ id: "y", created_at: "z", selected_areas: null, ratings: null }).selected_areas).toEqual([]);
  });
});

/** Un cliente de Supabase de mentira: registra lo que se le pide y devuelve lo que se le diga por página. */
function clienteFalso(paginas: { data: unknown[] | null; error: { code: string; message: string } | null }[], rpc?: { data: unknown; error: { code: string; message: string } | null }) {
  const rangos: [number, number][] = [];
  const llamadas: { fn: string; args: unknown }[] = [];
  let i = 0;
  const cadena = {
    select: () => cadena,
    order: () => cadena,
    range: (a: number, b: number) => { rangos.push([a, b]); return Promise.resolve(paginas[i++] ?? { data: [], error: null }); },
  };
  const cliente = {
    from: (t: string) => { llamadas.push({ fn: "from", args: t }); return cadena; },
    rpc: (fn: string, args: unknown) => { llamadas.push({ fn, args }); return Promise.resolve(rpc ?? { data: null, error: null }); },
  };
  return { cliente: cliente as unknown as Parameters<typeof almacenDeLaBase>[0], rangos, llamadas };
}

describe("almacenDeLaBase", () => {
  const fila = { id: "a", created_at: "2026-09-01T00:00:00Z", nothing_to_improve: true, selected_areas: [], ratings: {}, wants_contact: false, contacted: false };
  it("pide por páginas hasta que una llega corta, sin perder las viejas", async () => {
    const llena = Array.from({ length: PAGINA }, (_, k) => ({ ...fila, id: `p${k}` }));
    const { cliente, rangos, llamadas } = clienteFalso([{ data: llena, error: null }, { data: [fila], error: null }]);
    const res = await almacenDeLaBase(cliente).leer();
    expect(res.ok && res.valor.length).toBe(PAGINA + 1);
    expect(rangos).toEqual([[0, PAGINA - 1], [PAGINA, 2 * PAGINA - 1]]);
    expect(llamadas[0]).toEqual({ fn: "from", args: "survey_responses" });
  });
  it("sin la 155 dice sinTabla; otro error es error", async () => {
    const a = await almacenDeLaBase(clienteFalso([{ data: null, error: { code: "PGRST205", message: "no table" } }]).cliente).leer();
    expect(a).toEqual({ ok: false, sinTabla: true, error: "no table" });
    const b = await almacenDeLaBase(clienteFalso([{ data: null, error: { code: "08006", message: "red" } }]).cliente).leer();
    expect(b).toEqual({ ok: false, sinTabla: false, error: "red" });
  });
  it("marcar contactado es la función de la 155, con sus dos argumentos, y devuelve la hora que puso la base", async () => {
    const { cliente, llamadas } = clienteFalso([], { data: "2026-09-29T15:00:00+00:00", error: null });
    const res = await almacenDeLaBase(cliente).marcarContactado("id-9", true);
    expect(llamadas).toEqual([{ fn: "mark_survey_contacted", args: { p_id: "id-9", p_value: true } }]);
    expect(res).toEqual({ ok: true, valor: "2026-09-29T15:00:00+00:00" });
  });
});

describe("almacenDemo", () => {
  it("marca con hora, conserva la hora al volver a marcar, y desmarcar la borra", async () => {
    const a = almacenDemo();
    const antes = await a.leer();
    const f = antes.ok ? antes.valor.find((x) => x.wants_contact && !x.contacted)! : null!;
    const m1 = await a.marcarContactado(f.id, true);
    const m2 = await a.marcarContactado(f.id, true);
    expect(m1.ok && m1.valor).toBeTruthy();
    expect(m2).toEqual(m1);
    const m3 = await a.marcarContactado(f.id, false);
    expect(m3).toEqual({ ok: true, valor: null });
  });
  it("no deja marcar a quien no pidió contacto", async () => {
    const a = almacenDemo();
    const todas = await a.leer();
    const sin = todas.ok ? todas.valor.find((x) => !x.wants_contact)! : null!;
    expect((await a.marcarContactado(sin.id, true)).ok).toBe(false);
  });
});
