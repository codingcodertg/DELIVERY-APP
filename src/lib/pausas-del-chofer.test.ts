import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  LS_PAUSAS, MOTIVOS_DE_PAUSA, MOTIVOS_PARA_ELEGIR, cierreDePausa, guardaPausasLocales, horaDeCierre, inicioDePausa, leePausasLocales,
  minutosDePausa, nombreDelMotivo, numeroOpcional, pausaAbierta, pideRecibo, textoDePausaAbierta, type PausaDelChofer,
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
    return { pausas: estado.pausas, estado: estado.estado, empezar: async () => ({ ok: true }), seguir: async () => ({ ok: true }), ubicarTarde: async () => {} };
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
    expect(inicioDePausa("restroom", "  ")).toEqual({ motivo: "restroom", nota: null });
    expect(inicioDePausa("food", "taco")).toEqual({ motivo: "food", nota: "taco" });
  });
});

describe("al seguir: la gasolina pide recibo", () => {
  const vacio = { foto: null, monto: "", galones: "", sinRecibo: false };
  it("solo la gasolina", () => {
    expect(MOTIVOS_DE_PAUSA.filter((m) => pideRecibo(m.clave)).map((m) => m.clave)).toEqual(["gas"]);
  });
  it("sin foto y sin «No tengo recibo», no se puede seguir", () => {
    expect(cierreDePausa("gas", vacio)).toEqual({ falta: "recibo" });
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
    expect(html).toMatch(/<button[^>]*data-seguir="true"[^>]*>▶ Continue/);
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
    expect(leer("src/app/(app)/my-route/page.tsx")).toContain("<PausaDelChofer driverId={chofer?.id} soloLectura={soloLectura} />");
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
    expect(leer("src/app/(app)/track/page.tsx")).toContain("{driverId && <PausasDelDia driverId={driverId} fecha={fecha} clock={(iso) => clock(iso, lang)} />}");
  });
});

describe("la base: la 167 y el gancho que la lee", () => {
  const sql = leer("supabase/migrations/167_pausas_del_chofer.sql");
  const gancho = leer("src/lib/usePausasDelChofer.ts");
  it("el gancho escribe y lee en la tabla de la 167, y sin ella dice «sin-tabla»", () => {
    expect(gancho).toContain('export const TABLA_DE_PAUSAS = "pausas_del_chofer";');
    expect(sql).toContain("create table if not exists public.pausas_del_chofer (");
    expect(gancho).toContain('if (error) { setEstado(faltaLaTabla(error) ? "sin-tabla" : "error"); return; }');
    // En el demo y en el modo enseñanza, en el navegador: nada de lo que se practica llega a la base.
    expect(gancho).toContain("const local = SIN_BASE || !!opciones.practica;");
  });
  it("las reglas que la pantalla aplica también las aplica la base", () => {
    expect(sql).toContain("constraint pausas_motivo check (motivo in ('restroom', 'gas', 'food', 'traffic', 'other'))");
    expect(sql).toContain("constraint pausas_otro_con_texto check (motivo <> 'other' or length(btrim(coalesce(nota, ''))) >= 3)");
    expect(sql).toContain("constraint pausas_gasolina_con_recibo check (motivo <> 'gas' or termino_at is null or recibo_foto is not null or sin_recibo)");
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

// D-NEXT. El dueño, 2026-10-13: «from stops in driver dtop buttom will be jsut gas, restroom, food and other and for other add the note».
describe("los motivos que elige el chofer", () => {
  it("solo gasolina, baño, comida y otro, en ese orden", () => {
    expect(MOTIVOS_PARA_ELEGIR.map((m) => m.clave)).toEqual(["gas", "restroom", "food", "other"]);
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
