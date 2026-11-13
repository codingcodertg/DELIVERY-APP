import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  LS_PAUSAS, MOTIVOS_DE_PAUSA, MOTIVOS_PARA_ELEGIR, cierreDePausa, guardaPausasLocales, horaDeCierre, inicioDePausa, leePausasLocales,
  minutosDePausa, nombreDelMotivo, numeroOpcional, pausaAbierta, pideRecibo, textoDePausaAbierta, type PausaDelChofer,
  diaDelNegocio, esParadaVieja, finDelDiaDe, horaDeCierreDe, horaDeCierreDeVieja, recibosPendientes, reciboTardio,
} from "@/lib/pausas-del-chofer";

// ============================================================
// D-520 · «⏸ Registrar parada». El dueño, 2026-10-11: «AGREGA A BUTTOM TO LOG A STOP PUEDE SER RESTROOM, STOP FOR GAS Y
// ASI» y «AND WHEN STOPPED FOR GAS ASK TO UPLOAD DE GAS RECEIPT».
// ============================================================

const leer = (r: string) => readFileSync(join(process.cwd(), r), "utf8").split("\r\n").join("\n");

const estado = vi.hoisted(() => ({ pausas: [] as unknown[], estado: "lista" as string, pedidas: [] as unknown[][] }));
vi.mock("@/lib/data-provider", () => ({ useData: () => ({ teaching: false, notify: () => {} }) }));
vi.mock("@/lib/prefs", () => ({ usePrefs: () => ({ t: (en: string) => en, lang: "en" }) }));
vi.mock("@/lib/usePausasDelChofer", () => ({
  usePausasDelChofer: (...args: unknown[]) => {
    estado.pedidas.push(args);
    return { pausas: estado.pausas, abierta: (estado.pausas as { termino_at: string | null }[]).find((p) => !p.termino_at) ?? null, estado: estado.estado, empezar: async () => ({ ok: true }), seguir: async () => ({ ok: true }), recibir: async () => ({ ok: true }), ubicarTarde: async () => {} };
  },
}));

const pausa = (p: Partial<PausaDelChofer> = {}): PausaDelChofer => ({
  id: "p1", driver_id: "u1", motivo: "gas", nota: null, empezo_at: "2026-10-11T15:42:00.000Z", termino_at: null,
  lat: null, lng: null, precision_m: null, recibo_foto: null, recibo_monto: null, recibo_galones: null, sin_recibo: false,
  created_at: "2026-10-11T15:42:00.000Z", ...p,
});

beforeEach(() => { estado.pausas = []; estado.estado = "lista"; estado.pedidas = []; });

describe("los motivos y el inicio", () => {
  it("baño, gasolina, comida, tráfico u otro, en los dos idiomas", () => {
    expect(MOTIVOS_DE_PAUSA.map((m) => m.clave)).toEqual(["restroom", "gas", "food", "traffic", "other"]);
    expect(MOTIVOS_DE_PAUSA.map((m) => m.es)).toEqual(["Baño", "Gasolina", "Comida", "Tráfico o espera", "Otro"]);
    expect(nombreDelMotivo("gas", "es")).toBe("⛽ Gasolina");
  });
  it("sin motivo no se empieza; «Otro» pide texto (3 letras); la nota es opcional y se limpia", () => {
    expect(inicioDePausa(null, "algo")).toBeNull();
    expect(inicioDePausa("nada", "")).toBeNull();
    expect(inicioDePausa("other", " x ")).toBeNull();
    expect(inicioDePausa("other", "  llanta   ponchada ")).toEqual({ motivo: "other", nota: "llanta ponchada" });
    // Nota D-547: era `{ motivo: "restroom", nota: null }`. «Baño» ya no se elige («Maybe they don't need to log restroom
    // breaks»); la nota opcional que se limpia se mide con «Comida».
    expect(inicioDePausa("restroom", "  ")).toBeNull();
    expect(inicioDePausa("food", "  ")).toEqual({ motivo: "food", nota: null });
    expect(inicioDePausa("food", "taco")).toEqual({ motivo: "food", nota: "taco" });
  });
});

describe("al seguir: la gasolina pide recibo", () => {
  const vacio = { foto: null, monto: "", galones: "", sinRecibo: false };
  it("solo la gasolina", () => {
    expect(MOTIVOS_DE_PAUSA.filter((m) => pideRecibo(m.clave)).map((m) => m.clave)).toEqual(["gas"]);
  });
  it("sin foto y sin «No tengo recibo», no se puede seguir", () => {
    // D-548: sin foto y sin «no tengo», la parada se cierra con el recibo pendiente (no se bloquea).
    expect(cierreDePausa("gas", vacio)).toEqual({ recibo_foto: null, recibo_monto: null, recibo_galones: null, sin_recibo: false });
  });
  it("con la foto, se sigue; monto y galones si los puso", () => {
    expect(cierreDePausa("gas", { ...vacio, foto: "data:image/jpeg;base64,AA", monto: "$54.30", galones: "15,2" }))
      .toEqual({ recibo_foto: "data:image/jpeg;base64,AA", recibo_monto: 54.3, recibo_galones: 15.2, sin_recibo: false });
  });
  it("sin foto, solo con «No tengo recibo» dicho a propósito, que queda anotado", () => {
    expect(cierreDePausa("gas", { ...vacio, sinRecibo: true })).toEqual({ recibo_foto: null, recibo_monto: null, recibo_galones: null, sin_recibo: true });
  });
  it("la foto manda sobre «No tengo recibo»", () => {
    expect(cierreDePausa("gas", { ...vacio, foto: "data:image/jpeg;base64,AA", sinRecibo: true })).toMatchObject({ sin_recibo: false });
  });
  it("un monto o unos galones que no son números no pasan", () => {
    expect(cierreDePausa("gas", { ...vacio, sinRecibo: true, monto: "mucho" })).toEqual({ falta: "monto" });
    expect(cierreDePausa("gas", { ...vacio, sinRecibo: true, galones: "-3" })).toEqual({ falta: "galones" });
  });
  it("las demás se cierran sin preguntar, y no guardan recibo aunque se escribiera", () => {
    expect(cierreDePausa("restroom", { foto: "data:image/jpeg;base64,AA", monto: "3", galones: "1", sinRecibo: true }))
      .toEqual({ recibo_foto: null, recibo_monto: null, recibo_galones: null, sin_recibo: false });
  });
  it("números opcionales: vacío es nada; coma y $ se aceptan; negativo o texto, no", () => {
    expect(numeroOpcional("")).toBeNull();
    expect(numeroOpcional(" $12 ")).toBe(12);
    expect(numeroOpcional("3,5")).toBe(3.5);
    expect(numeroOpcional("-1")).toBeNaN();
    expect(numeroOpcional("abc")).toBeNaN();
  });
});

describe("la pausa abierta, la hora y el texto", () => {
  it("la abierta es la más nueva sin terminar", () => {
    expect(pausaAbierta([pausa({ id: "a", termino_at: "2026-10-11T16:00:00Z" })])).toBeNull();
    expect(pausaAbierta([pausa({ id: "a", empezo_at: "2026-10-11T15:00:00Z" }), pausa({ id: "b", empezo_at: "2026-10-11T16:00:00Z" })])?.id).toBe("b");
  });
  it("la hora de cierre nunca es anterior al inicio (un reloj de teléfono atrasado)", () => {
    expect(horaDeCierre("2026-10-11T16:00:00.000Z", new Date("2026-10-11T15:00:00Z"))).toBe("2026-10-11T16:00:00.000Z");
    expect(horaDeCierre("2026-10-11T16:00:00.000Z", new Date("2026-10-11T16:05:00Z"))).toBe("2026-10-11T16:05:00.000Z");
  });
  it("minutos: hasta el fin, o hasta ahora si sigue parado", () => {
    expect(minutosDePausa({ empezo_at: "2026-10-11T15:00:00Z", termino_at: "2026-10-11T15:12:00Z" })).toBe(12);
    expect(minutosDePausa({ empezo_at: "2026-10-11T15:00:00Z", termino_at: null }, new Date("2026-10-11T15:30:00Z"))).toBe(30);
  });
  it("«⏸ En parada: ⛽ Gasolina · 10:42»", () => {
    expect(textoDePausaAbierta(pausa(), "es", () => "10:42")).toBe("⏸ En parada: ⛽ Gasolina · 10:42");
    expect(textoDePausaAbierta(pausa({ motivo: "restroom" }), "en", () => "10:42")).toBe("⏸ Stopped: 🚻 Restroom · 10:42");
  });
  it("el demo y el modo enseñanza: en el navegador, y basura o nada es vacío", () => {
    const mem = new Map<string, string>();
    const almacen = { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => { mem.set(k, v); } };
    expect(leePausasLocales(almacen)).toEqual([]);
    expect(guardaPausasLocales(almacen, [pausa()])).toBe(true);
    expect(leePausasLocales(almacen)).toEqual([pausa()]);
    mem.set(LS_PAUSAS, "{no es json");
    expect(leePausasLocales(almacen)).toEqual([]);
    expect(leePausasLocales(null)).toEqual([]);
  });
});

describe("el botón en «Mi ruta»", async () => {
  const { PausaDelChofer: Boton } = await import("@/components/PausaDelChofer");
  const pinta = (props: { driverId: string; soloLectura?: boolean }) => renderToStaticMarkup(createElement(Boton, props));
  it("sin parada abierta: «⏸ Log a stop»; mirando la de otro, apagado", () => {
    expect(pinta({ driverId: "u1" })).toMatch(/<button[^>]*data-registrar-parada="true"[^>]*>⏸ Log a stop/);
    expect(pinta({ driverId: "u1" })).not.toMatch(/data-registrar-parada="true"[^>]*disabled/);
    expect(pinta({ driverId: "u1", soloLectura: true })).toMatch(/data-registrar-parada="true"[^>]*disabled=""/);
    expect(estado.pedidas.at(-1)?.[0]).toBe("u1");
  });
  it("parado: el motivo, la hora y «▶ Continue»; mirando la de otro, se ve pero no se pulsa", () => {
    estado.pausas = [pausa({ nota: "Pemex de la 10" })];
    const html = pinta({ driverId: "u1" });
    expect(html).toContain('data-pausa-abierta="gas"');
    expect(html).toContain("⏸ Stopped: ⛽ Gas · ");
    expect(html).toContain("Pemex de la 10");
    expect(html).toMatch(/<button[^>]*data-seguir="true"[^>]*>✔ Finish stop/);
    expect(pinta({ driverId: "u1", soloLectura: true })).toMatch(/data-seguir="true"[^>]*disabled=""/);
  });
  it("el cableado: «Seguir» en la gasolina abre el recibo, en lo demás cierra; los dos cuadros confirman con la regla", () => {
    const c = leer("src/components/PausaDelChofer.tsx");
    expect(c).toContain("onClick={() => (pideRecibo(abierta.motivo) ? setCerrando(true) : void alSeguir(abierta, { foto: null, monto: \"\", galones: \"\", sinRecibo: false }))}");
    expect(c).toContain("const inicio = inicioDePausa(motivo, texto);");
    expect(c).toContain("disabled={!inicio || ocupado}");
    expect(c).toContain('const cierre = cierreDePausa("gas", entrada);');
    expect(c).toContain("disabled={!!falta || ocupado}");
    // La foto con el mismo componente que las fotos de una entrega (cámara del teléfono o archivo, comprimida).
    expect(c).toContain("<PhotoUpload photos={fotos}");
    // Sin la tabla (la 167 sin aplicar) se dice, y la pantalla sigue.
    expect(c).toContain("const avisoDeFallo = (r: Extract<ResultadoDePausa, { ok: false }>) => r.sinTabla");
    // La ubicación, como «Recogido»: sin esperar, y la tardía después.
    expect(c).toContain("const { immediate, eventual } = captureLocationSplit();");
    expect(c).toContain("if (!gps) void eventual.then((tarde) => { if (tarde) void ubicarTarde(r.pausa.id, tarde); });");
  });
  it("«Mi ruta» lo monta con SU chofer (el de la ruta que se mira) y en solo lectura si es de otro", () => {
    expect(leer("src/app/(app)/my-route/page.tsx")).toContain("<PausaDelChofer driverId={chofer?.id} soloLectura={soloLectura} dia={dia} />");
  });
});

describe("logística y admin las ven en el Recorrido del chofer", async () => {
  const { PausasDelDia } = await import("@/components/PausasDelDia");
  const pinta = () => renderToStaticMarkup(createElement(PausasDelDia, { driverId: "u1", fecha: "2026-10-11", clock: () => "10:42" }));
  it("cada parada con su motivo, sus horas, y el recibo o «sin recibo»", () => {
    estado.pausas = [
      pausa({ id: "a", termino_at: "2026-10-11T15:54:00.000Z", recibo_foto: "data:image/jpeg;base64,AA", recibo_monto: 54.3, recibo_galones: 15.2, lat: 26.2, lng: -98.2 }),
      pausa({ id: "b", termino_at: "2026-10-11T16:30:00.000Z", sin_recibo: true }),
      pausa({ id: "c", motivo: "restroom", nota: "Stripes" }),
    ];
    const html = pinta();
    expect(estado.pedidas.at(-1)?.slice(0, 2)).toEqual(["u1", "2026-10-11"]);
    expect(html).toContain("Stops the driver logged");
    expect(html).toContain('src="data:image/jpeg;base64,AA"');
    expect(html).toContain("$54.30");
    expect(html).toContain("15.2 gal");
    expect(html).toContain("No receipt (driver said)");
    expect(html).toContain("still stopped");
    expect(html).toContain("Stripes");
    expect(html).toContain("12 min");
    expect(html).toContain("https://www.google.com/maps/search/?api=1&amp;query=26.2,-98.2");
  });
  it("sin la 167 aplicada lo dice, en vez de una lista vacía que parezca «no paró nunca»", () => {
    estado.estado = "sin-tabla";
    expect(pinta()).toContain("migration 167");
  });
  it("el Recorrido la monta con el chofer y el día que se miran", () => {
    expect(leer("src/app/(app)/track/page.tsx")).toContain("{unSolo && <PausasDelDia driverId={driverId} fecha={fecha} clock={(iso) => clock(iso, lang)} />}") // D-833;
  });
});

describe("la base: la 167 y el gancho que la lee", () => {
  const sql = leer("supabase/migrations/167_pausas_del_chofer.sql");
  const gancho = leer("src/lib/usePausasDelChofer.ts");
  it("el gancho escribe y lee en la tabla de la 167, y sin ella dice «sin-tabla»", () => {
    expect(gancho).toContain('export const TABLA_DE_PAUSAS = "pausas_del_chofer";');
    expect(sql).toContain("create table if not exists public.pausas_del_chofer (");
    expect(gancho).toContain('if (error) { setEstado(faltaLaTabla(error) ? "sin-tabla" : "error"); return; }');
    // D-549: la parada abierta se busca sin importar el día (ayer seguía abierta y no salía en «Hoy»).
    expect(gancho).toContain('sb.from(TABLA_DE_PAUSAS).select("*").eq("driver_id", driverId).is("termino_at", null)');
    // En el demo y en el modo enseñanza, en el navegador: nada de lo que se practica llega a la base.
    expect(gancho).toContain("const local = SIN_BASE || !!opciones.practica;");
  });
  it("las reglas que la pantalla aplica también las aplica la base", () => {
    expect(sql).toContain("constraint pausas_motivo check (motivo in ('restroom', 'gas', 'food', 'traffic', 'other'))");
    expect(sql).toContain("constraint pausas_otro_con_texto check (motivo <> 'other' or length(btrim(coalesce(nota, ''))) >= 3)");
    expect(sql).toContain("constraint pausas_gasolina_con_recibo check (motivo <> 'gas' or termino_at is null or recibo_foto is not null or sin_recibo)");
    // D-548: la 306 la quita (la de gasolina puede cerrarse sin recibo).
    expect(leer("supabase/migrations/306_pausas_recibo_despues.sql")).toContain("drop constraint if exists pausas_gasolina_con_recibo");
    expect(sql).toContain("create unique index if not exists pausas_del_chofer_una_abierta on public.pausas_del_chofer (driver_id) where termino_at is null;");
  });
  it("RLS: el chofer las suyas (y solo la abierta se toca); admin, logística y gerentes leen; nadie borra", () => {
    expect(sql).toContain("alter table public.pausas_del_chofer enable row level security;");
    expect(sql).toContain("grant select, insert, update on public.pausas_del_chofer to authenticated;");
    expect(sql).not.toMatch(/grant[^;]*delete/);
    expect(sql).toContain("or coalesce((select public.current_user_role()), '') in ('admin', 'logistics', 'manager'));");
    expect(sql).toContain("with check (driver_id = (select auth.uid()));");
    expect(sql).toContain("using (driver_id = (select auth.uid()) and termino_at is null)");
  });
  it("sin su propio begin/commit, y con su línea de registro tras el marcador", () => {
    const cuerpo = sql.slice(0, sql.indexOf("-- @ledger-below"));
    expect(cuerpo.split("\n").filter((l) => !/^\s*--/.test(l)).join("\n")).not.toMatch(/^\s*(begin|commit)\s*;/im);
    expect(sql).toMatch(/-- @ledger-below\ninsert into public\.schema_migrations \(name, checksum\) values \('167_pausas_del_chofer\.sql', '[0-9a-f]{64}'\)/);
  });
});

// D-541. El dueño, 2026-10-13: «from stops in driver dtop buttom will be jsut gas, restroom, food and other and for other add the note».
describe("los motivos que elige el chofer", () => {
  // Nota D-547: eran gasolina, baño, comida y otro. El dueño, 2026-10-14: «Maybe they don't need to log restroom breaks 😆
  // that might be too much». Fuera «Baño».
  it("D-547: solo gasolina, comida y otro, en ese orden", () => {
    expect(MOTIVOS_PARA_ELEGIR.map((m) => m.clave)).toEqual(["gas", "food", "other"]);
  });
  it("D-547: «baño» ya no se puede empezar, pero una parada vieja de baño se sigue leyendo con su nombre", () => {
    expect(inicioDePausa("restroom", "")).toBeNull();
    expect(nombreDelMotivo("restroom", "es")).toBe("🚻 Baño");
    expect(textoDePausaAbierta(pausa({ motivo: "restroom" }), "en", () => "10:42")).toBe("⏸ Stopped: 🚻 Restroom · 10:42");
  });
  it("«tráfico» ya no se puede empezar, pero su nombre se sigue leyendo", () => {
    expect(inicioDePausa("traffic", "")).toBeNull();
    expect(MOTIVOS_DE_PAUSA.some((m) => m.clave === "traffic")).toBe(true);
  });
  it("«otro» sin nota no se guarda; con nota, sí", () => {
    expect(inicioDePausa("other", "  ")).toBeNull();
    expect(inicioDePausa("other", "llanta")).toEqual({ motivo: "other", nota: "llanta" });
    expect(inicioDePausa("gas", "")).toEqual({ motivo: "gas", nota: null });
  });
  it("el botón pinta MOTIVOS_PARA_ELEGIR", () => {
    expect(readFileSync("src/components/PausaDelChofer.tsx", "utf8")).toContain("{MOTIVOS_PARA_ELEGIR.map((m) => (");
  });
});

// D-548 / D-549 (2026-11-13). Ernesto: parada de gasolina abierta desde el 4 de noviembre a las 09:14 (CST, UTC-6).
describe("paradas viejas y recibos pendientes (D-548, D-549)", () => {
  const abiertaEl = (iso: string, extra: Partial<PausaDelChofer> = {}) => pausa({ empezo_at: iso, created_at: iso, ...extra });
  const ahoraDeAhora = new Date("2026-11-13T18:00:00.000Z");

  it("el día del negocio es el de Central, no el de UTC", () => {
    expect(diaDelNegocio("2026-11-05T05:50:00.000Z")).toBe("2026-11-04");
    expect(diaDelNegocio("2026-11-05T06:10:00.000Z")).toBe("2026-11-05");
    expect(finDelDiaDe("2026-11-04T15:14:21.720Z")).toBe("2026-11-05T06:00:00.000Z");
  });

  it("una parada de otro día sigue abierta es vieja; una de hoy con menos del tope no", () => {
    expect(esParadaVieja(abiertaEl("2026-11-04T15:14:21.720Z"), ahoraDeAhora)).toBe(true);
    expect(esParadaVieja(abiertaEl("2026-11-13T15:00:00.000Z"), new Date("2026-11-13T16:00:00.000Z"))).toBe(false);
    // Hoy, pero ya pasaron más de 3 h desde que empezó.
    expect(esParadaVieja(abiertaEl("2026-11-13T15:00:00.000Z"), new Date("2026-11-13T19:00:00.000Z"))).toBe(true);
    // Una cerrada nunca es vieja.
    expect(esParadaVieja(abiertaEl("2026-11-04T15:14:21.720Z", { termino_at: "2026-11-04T16:00:00.000Z" }), ahoraDeAhora)).toBe(false);
  });

  it("la hora de cierre de una vieja es inicio + tope, o la medianoche de su día si llega antes; nunca «ahora»", () => {
    // 09:14 CST + 3 h = 12:14 CST, antes de medianoche.
    expect(horaDeCierreDeVieja("2026-11-04T15:14:21.720Z")).toBe("2026-11-04T18:14:21.720Z");
    // 23:50 CST: la medianoche (00:00 CST del día siguiente) llega antes que las 3 h.
    expect(horaDeCierreDeVieja("2026-11-05T05:50:00.000Z")).toBe("2026-11-05T06:00:00.000Z");
    // Nunca antes del inicio.
    expect(horaDeCierreDeVieja("2026-11-05T05:59:59.000Z")).toBe("2026-11-05T06:00:00.000Z");
  });

  it("al seguir: una vieja se cierra a su hora de cierre, una de hoy a ahora", () => {
    const vieja = abiertaEl("2026-11-04T15:14:21.720Z");
    expect(horaDeCierreDe(vieja, ahoraDeAhora)).toBe("2026-11-04T18:14:21.720Z");
    const deHoy = abiertaEl("2026-11-13T17:30:00.000Z");
    expect(horaDeCierreDe(deHoy, new Date("2026-11-13T17:40:00.000Z"))).toBe("2026-11-13T17:40:00.000Z");
  });

  it("la de gasolina sin recibo es pendiente; con «no tengo» o con foto ya no", () => {
    const sinNada = pausa({ motivo: "gas" });
    expect(recibosPendientes([sinNada]).map((p) => p.id)).toEqual(["p1"]);
    expect(recibosPendientes([pausa({ motivo: "gas", sin_recibo: true })])).toEqual([]);
    expect(recibosPendientes([pausa({ motivo: "gas", recibo_foto: "data:image/jpeg;base64,AA" })])).toEqual([]);
    // Las de baño, comida u otro no piden recibo.
    expect(recibosPendientes([pausa({ motivo: "food" }), pausa({ motivo: "restroom" })])).toEqual([]);
  });

  it("la lista va de la más vieja a la más nueva", () => {
    const pendientes = recibosPendientes([
      pausa({ id: "b", empezo_at: "2026-11-13T16:00:00.000Z" }),
      pausa({ id: "a", empezo_at: "2026-11-13T15:00:00.000Z" }),
    ]);
    expect(pendientes.map((p) => p.id)).toEqual(["a", "b"]);
  });

  it("cerrar una gasolina sin foto la deja pendiente (no se bloquea); monto mal escrito sí", () => {
    expect(cierreDePausa("gas", { foto: null, monto: "", galones: "", sinRecibo: false }))
      .toEqual({ recibo_foto: null, recibo_monto: null, recibo_galones: null, sin_recibo: false });
    expect(cierreDePausa("gas", { foto: null, monto: "abc", galones: "", sinRecibo: false })).toEqual({ falta: "monto" });
  });

  it("el recibo que llega después: foto obligatoria, cifras opcionales y numéricas", () => {
    expect(reciboTardio({ foto: null, monto: "", galones: "" })).toEqual({ falta: "foto" });
    expect(reciboTardio({ foto: "data:image/jpeg;base64,AA", monto: "$54,30", galones: "" }))
      .toEqual({ recibo_foto: "data:image/jpeg;base64,AA", recibo_monto: 54.3, recibo_galones: null });
    expect(reciboTardio({ foto: "data:image/jpeg;base64,AA", monto: "", galones: "x" })).toEqual({ falta: "galones" });
  });
});

describe("la base de los recibos después (306)", () => {
  const sql = readFileSync(join(process.cwd(), "supabase/migrations/306_pausas_recibo_despues.sql"), "utf8").split("\r\n").join("\n");
  it("quita la constraint de gasolina, y el alta solo es de ahora", () => {
    expect(sql).toContain("alter table public.pausas_del_chofer drop constraint if exists pausas_gasolina_con_recibo;");
    expect(sql).toContain("and empezo_at between now() - interval '2 minutes' and now() + interval '2 minutes');");
  });
  it("update: la abierta, o una cerrada de gasolina sin recibo; y el trigger deja cambiar solo el recibo", () => {
    expect(sql).toContain("and (termino_at is null or (motivo = 'gas' and recibo_foto is null and sin_recibo = false)))");
    expect(sql).toContain("before update on public.pausas_del_chofer");
    expect(sql).toContain("if new.recibo_foto is null then");
  });
  it("sin begin/commit y con su línea de registro tras el marcador", () => {
    const cuerpo = sql.slice(0, sql.indexOf("-- @ledger-below"));
    expect(cuerpo.split("\n").filter((l) => !/^\s*--/.test(l)).join("\n")).not.toMatch(/^\s*(begin|commit)\s*;/im);
    expect(sql).toMatch(/-- @ledger-below\ninsert into public\.schema_migrations \(name, checksum\) values \('306_pausas_recibo_despues\.sql', '[0-9a-f]{64}'\)/);
  });
});
