import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  ATAJOS, ATAJO_INICIAL, NOMBRE_DE_ATAJO, diaEnRango, eleccionAUrl, eleccionDeUrl, esAtajo, etiquetaDeRango, filtrarPorRango,
  perdidaEnRango, rangoAManoValido, rangoDeAtajo, rangoDeEleccion, sumarDias,
} from "./rango-de-merma";
import { hoyEnTexas } from "./fecha-del-dano";

/**
 * D-911: «on the scrap select date range». Atajos y rango a mano, por el día en que se rompió, en días de Texas; manda
 * sobre la lista de merma y sobre la pérdida por tienda; viaja en la URL.
 */
const leer = (r: string) => readFileSync(join(process.cwd(), r), "utf8").replace(/\r\n/g, "\n");
const params = (o: Record<string, string>) => new URLSearchParams(o);
const HOY = "2026-11-06"; // viernes; la semana empezó el domingo 1

describe("los atajos dan el rango esperado, contado desde hoy en Texas", () => {
  it("hoy, esta semana (desde el domingo), este mes", () => {
    expect(rangoDeAtajo("hoy", HOY)).toEqual({ desde: HOY, hasta: HOY });
    expect(rangoDeAtajo("semana", HOY)).toEqual({ desde: "2026-11-01", hasta: HOY });
    expect(rangoDeAtajo("mes", HOY)).toEqual({ desde: "2026-11-01", hasta: HOY });
  });
  it("la semana pasada son los siete días domingo a sábado anteriores, aunque crucen de mes", () => {
    expect(rangoDeAtajo("semana-pasada", HOY)).toEqual({ desde: "2026-10-25", hasta: "2026-10-31" });
    // Un domingo: esta semana es solo hoy y la pasada termina ayer.
    expect(rangoDeAtajo("semana", "2026-11-08")).toEqual({ desde: "2026-11-08", hasta: "2026-11-08" });
    expect(rangoDeAtajo("semana-pasada", "2026-11-08")).toEqual({ desde: "2026-11-01", hasta: "2026-11-07" });
  });
  it("el mes pasado va del 1 al último día, también en enero y en febrero bisiesto", () => {
    expect(rangoDeAtajo("mes-pasado", HOY)).toEqual({ desde: "2026-10-01", hasta: "2026-10-31" });
    expect(rangoDeAtajo("mes-pasado", "2027-01-15")).toEqual({ desde: "2026-12-01", hasta: "2026-12-31" });
    expect(rangoDeAtajo("mes-pasado", "2028-03-01")).toEqual({ desde: "2028-02-01", hasta: "2028-02-29" });
    expect(rangoDeAtajo("mes", "2026-12-31")).toEqual({ desde: "2026-12-01", hasta: "2026-12-31" });
  });
  it("los últimos 30 días incluyen hoy (30 días en total) y cruzan el año", () => {
    expect(rangoDeAtajo("30-dias", HOY)).toEqual({ desde: "2026-10-08", hasta: HOY });
    expect(rangoDeAtajo("30-dias", "2027-01-10")).toEqual({ desde: "2026-12-12", hasta: "2027-01-10" });
    expect(sumarDias("2026-03-01", -1)).toBe("2026-02-28");
  });
  it("sin «hoy» explícito usa el día de Texas, no el del aparato", () => {
    expect(rangoDeAtajo("hoy")).toEqual({ desde: hoyEnTexas(), hasta: hoyEnTexas() });
  });
  it("«a mano» devuelve lo escrito y descarta lo que no sea un día", () => {
    expect(rangoDeAtajo("otro", HOY, { desde: "2026-10-01", hasta: "2026-10-31" })).toEqual({ desde: "2026-10-01", hasta: "2026-10-31" });
    expect(rangoDeAtajo("otro", HOY, { desde: "ayer", hasta: "2026-02-30" })).toEqual({ desde: "", hasta: "" });
  });
  it("hay siete atajos, con nombre en los dos idiomas, y el inicial es este mes", () => {
    expect(ATAJOS).toEqual(["hoy", "semana", "semana-pasada", "mes", "mes-pasado", "30-dias", "otro"]);
    for (const a of ATAJOS) { expect(NOMBRE_DE_ATAJO[a].en).toBeTruthy(); expect(NOMBRE_DE_ATAJO[a].es).toBeTruthy(); }
    expect(ATAJO_INICIAL).toBe("mes");
    expect(esAtajo("mes")).toBe(true);
    expect(esAtajo("ayer")).toBe(false);
  });
});

describe("el rango a mano", () => {
  it("vale cuando Desde ≤ Hasta; un extremo vacío es abierto", () => {
    expect(rangoAManoValido({ desde: "2026-10-01", hasta: "2026-10-31" })).toBe(true);
    expect(rangoAManoValido({ desde: "2026-10-31", hasta: "2026-10-31" })).toBe(true);
    expect(rangoAManoValido({ desde: "2026-10-01", hasta: "" })).toBe(true);
    expect(rangoAManoValido({ desde: "", hasta: "2026-10-31" })).toBe(true);
    expect(rangoAManoValido({ desde: "", hasta: "" })).toBe(true);
  });
  it("no vale con Desde después de Hasta, con un día inventado, o sin nada", () => {
    expect(rangoAManoValido({ desde: "2026-11-01", hasta: "2026-10-31" })).toBe(false);
    expect(rangoAManoValido({ desde: "2026-02-30", hasta: "" })).toBe(false);
    expect(rangoAManoValido(null)).toBe(false);
  });
  it("la elección con un rango que no cuadra no da rango (la pantalla avisa y no filtra nada)", () => {
    expect(rangoDeEleccion({ atajo: "otro", desde: "2026-11-01", hasta: "2026-10-31" }, HOY)).toBeNull();
    expect(rangoDeEleccion({ atajo: "otro", desde: "2026-10-01", hasta: "" }, HOY)).toEqual({ desde: "2026-10-01", hasta: "" });
    expect(rangoDeEleccion({ atajo: "mes", desde: "", hasta: "" }, HOY)).toEqual({ desde: "2026-11-01", hasta: HOY });
  });
});

describe("la URL", () => {
  it("sin nada abre con este mes; con un atajo, ese; «otro» trae Desde y Hasta", () => {
    expect(eleccionDeUrl(null)).toEqual({ atajo: "mes", desde: "", hasta: "" });
    expect(eleccionDeUrl(params({}))).toEqual({ atajo: "mes", desde: "", hasta: "" });
    expect(eleccionDeUrl(params({ rango: "semana-pasada" }))).toEqual({ atajo: "semana-pasada", desde: "", hasta: "" });
    expect(eleccionDeUrl(params({ rango: "otro", desde: "2026-10-01", hasta: "2026-10-31" }))).toEqual({ atajo: "otro", desde: "2026-10-01", hasta: "2026-10-31" });
  });
  it("un atajo que no existe o días mal escritos no rompen nada", () => {
    expect(eleccionDeUrl(params({ rango: "ayer", desde: "2026-10-01" }))).toEqual({ atajo: "mes", desde: "", hasta: "" });
    expect(eleccionDeUrl(params({ rango: "otro", desde: "x", hasta: "2026-13-01" }))).toEqual({ atajo: "otro", desde: "", hasta: "" });
    // Con un atajo puesto, Desde/Hasta sueltos se ignoran.
    expect(eleccionDeUrl(params({ rango: "hoy", desde: "2020-01-01" }))).toEqual({ atajo: "hoy", desde: "", hasta: "" });
  });
  it("ida y vuelta: lo que se escribe se vuelve a leer igual; el atajo inicial no deja rastro", () => {
    expect(eleccionAUrl({ atajo: "mes", desde: "", hasta: "" })).toEqual({});
    expect(eleccionAUrl({ atajo: "30-dias", desde: "", hasta: "" })).toEqual({ rango: "30-dias" });
    expect(eleccionAUrl({ atajo: "otro", desde: "2026-10-01", hasta: "" })).toEqual({ rango: "otro", desde: "2026-10-01" });
    for (const e of [{ atajo: "otro" as const, desde: "2026-10-01", hasta: "2026-10-31" }, { atajo: "semana" as const, desde: "", hasta: "" }]) {
      expect(eleccionDeUrl(params(eleccionAUrl(e)))).toEqual(e);
    }
  });
});

const fila = (id: string, store: string, broken_on: string | null, total_loss: number | null, created_at = "2026-11-06T15:00:00Z", kind = "scrap") =>
  ({ id, kind, store, broken_on, total_loss, created_at });
const MERMAS = [
  fila("a", "McAllen", "2026-10-20", 100),
  fila("b", "McAllen", "2026-11-02", 10),
  fila("c", "Edinburg", "2026-11-06", 5.5),
  fila("d", "Edinburg", "2026-10-31", 2.25),
  fila("e", "McAllen", null, 7, "2026-11-05T15:00:00Z"), // reporte viejo sin fecha del daño: cuenta por cuándo se reportó (Texas)
  fila("f", "McAllen", "2026-11-01", null), // sin costo: $0
];

describe("filtrar por el día en que se rompió", () => {
  it("dentro / fuera / en los bordes, con extremos abiertos", () => {
    const oct = { desde: "2026-10-01", hasta: "2026-10-31" };
    expect(diaEnRango("2026-10-01", oct)).toBe(true);
    expect(diaEnRango("2026-10-31", oct)).toBe(true);
    expect(diaEnRango("2026-09-30", oct)).toBe(false);
    expect(diaEnRango("2026-11-01", oct)).toBe(false);
    expect(diaEnRango("2020-01-01", { desde: "", hasta: "2026-10-31" })).toBe(true);
    expect(diaEnRango("2030-01-01", { desde: "2026-10-01", hasta: "" })).toBe(true);
  });
  it("una merma reportada hoy pero rota el mes pasado cae en «el mes pasado», no en «este mes»", () => {
    expect(filtrarPorRango(MERMAS, rangoDeAtajo("mes-pasado", HOY)).map((f) => f.id)).toEqual(["a", "d"]);
    expect(filtrarPorRango(MERMAS, rangoDeAtajo("mes", HOY)).map((f) => f.id)).toEqual(["b", "c", "e", "f"]);
    expect(filtrarPorRango(MERMAS, rangoDeAtajo("hoy", HOY)).map((f) => f.id)).toEqual(["c"]);
    expect(filtrarPorRango(MERMAS, rangoDeAtajo("semana-pasada", HOY)).map((f) => f.id)).toEqual(["d"]);
  });
  it("lo que no es merma sigue contando por cuándo se reportó", () => {
    const inc = fila("x", "McAllen", null, null, "2026-10-15T15:00:00Z", "incident");
    expect(filtrarPorRango([inc], rangoDeAtajo("mes-pasado", HOY))).toHaveLength(1);
    expect(filtrarPorRango([inc], rangoDeAtajo("mes", HOY))).toHaveLength(0);
  });
});

describe("la pérdida por tienda en el rango", () => {
  it("suma solo lo que cae en el rango, por tienda y en total, a centavos", () => {
    expect(perdidaEnRango(MERMAS, rangoDeAtajo("mes-pasado", HOY))).toEqual({ "*": 102.25, McAllen: 100, Edinburg: 2.25 });
    expect(perdidaEnRango(MERMAS, rangoDeAtajo("mes", HOY))).toEqual({ "*": 22.5, McAllen: 17, Edinburg: 5.5 });
    expect(perdidaEnRango(MERMAS, rangoDeAtajo("hoy", HOY))).toEqual({ "*": 5.5, Edinburg: 5.5 });
    expect(perdidaEnRango(MERMAS, { desde: "", hasta: "" })["*"]).toBe(124.75);
  });
  it("un rango sin nada da $0 total y ninguna tienda; lo que no es merma no suma", () => {
    expect(perdidaEnRango(MERMAS, { desde: "2020-01-01", hasta: "2020-01-31" })).toEqual({ "*": 0 });
    expect(perdidaEnRango([{ ...fila("x", "McAllen", "2026-11-06", 999), kind: "incident" }], rangoDeAtajo("hoy", HOY))).toEqual({ "*": 0 });
  });
});

describe("la etiqueta del rango", () => {
  it("«Oct 1 – Oct 31», un solo día, y con año si no es el de hoy", () => {
    expect(etiquetaDeRango({ desde: "2026-10-01", hasta: "2026-10-31" }, "en", HOY)).toBe("Oct 1 – Oct 31");
    expect(etiquetaDeRango({ desde: HOY, hasta: HOY }, "en", HOY)).toBe("Nov 6");
    expect(etiquetaDeRango({ desde: "2025-12-12", hasta: "2026-01-10" }, "en", HOY)).toBe("Dec 12, 2025 – Jan 10, 2026");
    expect(etiquetaDeRango({ desde: "2026-10-01", hasta: "" }, "en", HOY)).toBe("From Oct 1");
    expect(etiquetaDeRango({ desde: "", hasta: "2026-10-31" }, "en", HOY)).toBe("Until Oct 31");
    expect(etiquetaDeRango({ desde: "", hasta: "" }, "en", HOY)).toBe("All time");
  });
  it("en español", () => {
    expect(etiquetaDeRango({ desde: "2026-10-01", hasta: "2026-10-31" }, "es", HOY)).toMatch(/^1 oct – 31 oct$/);
    expect(etiquetaDeRango({ desde: "", hasta: "" }, "es", HOY)).toBe("Siempre");
  });
});

describe("la pantalla", () => {
  const lista = leer("src/app/operaciones/ListaDeReportes.tsx");
  const css = leer("src/app/operaciones/operaciones.css");
  it("lee el rango y la pestaña de la URL y los escribe con router.replace (aguantan un refresh, se comparten)", () => {
    expect(lista).toContain("const eleccion = useMemo(() => eleccionDeUrl(params), [params]);");
    // KPI de entregas: la tercera pestaña («entregas») viaja igual en la URL; «revision» (280) se sumó a la cuarta.
    expect(lista).toContain('(pedida === "merma" || pedida === "entregas" || pedida === "revision") ? pedida : "lista"');
    expect(lista).toContain('data-pestana="entregas"');
    expect(lista).toContain("router.replace(qs ? `${ruta}?${qs}` : ruta, { scroll: false });");
    expect(lista).not.toContain('useState<"lista" | "merma">');
  });
  it("el rango manda sobre la lista de merma y sobre la pérdida por tienda, y la tabla lleva la etiqueta del rango", () => {
    expect(lista).toContain("const mermasEnRango = useMemo(() => (rango ? filtrarPorRango(mermas, rango) : []), [mermas, rango]);");
    expect(lista).toContain("const enRango = useMemo(() => (rango ? perdidaEnRango(mermas, rango) : { \"*\": 0 }), [mermas, rango]);");
    expect(lista).toContain('<th className="ops-col-rango">{etiqueta}</th>');
    // D-921 (270): la lista del rango pasa además por el filtro de etapa (mermasPorEtapa = mermasEnRango sin filtro).
    expect(lista).toContain("const mermasPorEtapa = useMemo(() => (etapaFiltro ? mermasEnRango.filter((r) => etapaDe(r) === etapaFiltro) : mermasEnRango)");
    // La lista de merma es la tabla tipo Excel de Roberto (tabla-de-merma.ts); la de todos los reportes sigue siendo TablaDeReportes.
    expect(lista).toContain('<TablaDeMermaExcel filas={mermasPorEtapa} ctx={ctx} onAbrir={setAbierto} repetidas={repetidas} data-lista="merma-en-rango"');
    expect(lista).toContain("{ATAJOS.map((a) => (");
    expect(lista).toContain('data-campo="rango-desde"');
    expect(lista).toContain('data-campo="rango-hasta"');
    expect(lista).toContain("data-rango-invalido");
  });
  it("los dos extremos a mano no pasan de hoy en Texas; y en el teléfono la cifra del rango ocupa la fila entera", () => {
    expect(lista.match(/max=\{hoy\}/g) ?? []).toHaveLength(2);
    expect(css).toContain(".ops-merma-total-rango { grid-column: 1 / -1; }");
  });
});
