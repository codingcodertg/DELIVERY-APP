import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import type { SupabaseClient } from "@supabase/supabase-js";
import { borradorVacio, lineaSfVacia } from "@/lib/estimator/modelo";
import { almacenDeLaBase, faltaLaColumnaDelLead, filaDeBorrador, filaNueva } from "@/lib/estimator/almacen";
import {
  borradorDesdeLead, cotizacionesPorLead, decidirRelleno, direccionDeObra, enlaceACotizacion, enlaceACotizar, enlaceALead,
  idDeParametro, nombreDeLead, puedeCotizarLead, tieneEstimador, vinculoDeLead, type CotizacionDeLead,
} from "./cotizar";
import { enlaceDeLaBase, sinNadaQueContar } from "./enlace";
import { leadsDemo } from "./demo";
import type { Lead } from "./reglas";

// D-NEXT · Leads → Quote Builder, la primera conexión del mapa de apps. Lo que decide vive en cotizar.ts (y el guardado
// en estimator/almacen.ts); estas pruebas lo IMPORTAN. Las de texto, al final, solo prueban que las pantallas lo usan.

const base = leadsDemo(new Date("2026-10-15T12:00:00Z"))[0];
const lead = (patch: Partial<Lead> = {}): Lead => ({ ...base, id: "L1", status: "taken", holder: "u-ana", holder_name: "Ana", ...patch });
const ana = { id: "u-ana", admin: false };
const beto = { id: "u-beto", admin: false };
const admin = { id: "u-admin", admin: true };

describe("quién puede cotizar un lead", () => {
  it("tieneEstimador: el admin siempre, los demás con 'estimator' en module_access", () => {
    expect(tieneEstimador({ role: "admin", module_access: [] })).toBe(true);
    expect(tieneEstimador({ role: "sales", module_access: ["leads", "estimator"] })).toBe(true);
    expect(tieneEstimador({ role: "sales", module_access: ["leads"] })).toBe(false);
    expect(tieneEstimador({ role: "manager", module_access: null })).toBe(false);
    expect(tieneEstimador(null)).toBe(false);
  });

  it("sin el Quote Builder, nadie: ni el admin", () => {
    expect(puedeCotizarLead(lead(), admin, false)).toBe(false);
    expect(puedeCotizarLead(lead(), ana, false)).toBe(false);
  });

  it("el que lo tiene, tomado o vendido", () => {
    expect(puedeCotizarLead(lead({ status: "taken" }), ana, true)).toBe(true);
    expect(puedeCotizarLead(lead({ status: "won" }), ana, true)).toBe(true);
  });

  it("de otra persona no: su contacto está oculto", () => {
    expect(puedeCotizarLead(lead({ status: "taken" }), beto, true)).toBe(false);
    expect(puedeCotizarLead(lead({ status: "won" }), beto, true)).toBe(false);
  });

  it("un lead libre se toma primero (si no, se trabaja sin ocupar puesto)", () => {
    expect(puedeCotizarLead(lead({ status: "free", holder: null }), ana, true)).toBe(false);
    expect(puedeCotizarLead(lead({ status: "review", holder: null }), ana, true)).toBe(false);
  });

  it("un lead que tuvo pero ya no está tomado ni vendido, no (holder que quedó en un estado raro)", () => {
    expect(puedeCotizarLead(lead({ status: "archived", holder: "u-ana" }), ana, true)).toBe(false);
  });

  it("el admin, de cualquier lead que vea", () => {
    for (const status of ["free", "taken", "won", "review", "archived"] as const) {
      expect([status, puedeCotizarLead(lead({ status, holder: status === "free" ? null : "u-otro" }), admin, true)]).toEqual([status, true]);
    }
  });
});

describe("del lead a la cotización", () => {
  const vacio = () => ({ ...borradorVacio("2026-10-15"), estimate_num: "E-77", lines: [{ ...lineaSfVacia(), id: "x" }] });
  const tiendas = ["RDZ Brownsville", "RDZ Edinburg"];

  it("el contacto es el nombre, el dueño de la obra la empresa, y el teléfono con el formato del campo", () => {
    const d = borradorDesdeLead(lead({ owner_contact: " Juan Pérez ", owner_name: "Obras Sur LLC", owner_phone: "(956) 555-0142" }), vacio(), tiendas);
    expect(d.customer).toEqual({ salutation: "Mr.", full_name: "Juan Pérez", company: "Obras Sur LLC", phone: "956-555-0142" });
  });

  it("sin contacto, el dueño va de nombre y la empresa queda vacía", () => {
    const d = borradorDesdeLead(lead({ owner_contact: null, owner_name: "María Garza" }), vacio(), tiendas);
    expect(d.customer.full_name).toBe("María Garza");
    expect(d.customer.company).toBe("");
  });

  it("un teléfono que no es de 10 dígitos se deja como venía (el campo lo marca)", () => {
    expect(borradorDesdeLead(lead({ owner_phone: "555-01" }), vacio(), tiendas).customer.phone).toBe("555-01");
    expect(borradorDesdeLead(lead({ owner_phone: null }), vacio(), tiendas).customer.phone).toBe("");
  });

  it("la dirección de la obra es la de entrega, sin pin ni millas viejas; el modo no cambia", () => {
    const b = vacio();
    b.delivery = { ...b.delivery, mode: "pickup", address: "otra", lat: 1, lng: 2, pin_source: "manual", miles: 9 };
    const d = borradorDesdeLead(lead({ site_address: "100 Calle Uno", site_city: "Brownsville", site_zip: "78520" }), b, tiendas);
    expect(d.delivery).toMatchObject({ mode: "pickup", address: "100 Calle Uno, Brownsville, TX 78520", lat: null, lng: null, pin_source: null, miles: null });
  });

  it("sin dirección de obra, la entrega se queda como estaba", () => {
    const b = vacio();
    b.delivery = { ...b.delivery, address: "la mía", lat: 1, lng: 2 };
    const d = borradorDesdeLead(lead({ site_address: null, site_city: null, site_zip: "78520", pool: "Nada" }), b, tiendas);
    expect(d.delivery).toEqual(b.delivery);
  });

  it("la tienda de salida es la del pool solo si es una tienda de Ajustes (sin mayúsculas ni espacios que la separen)", () => {
    const b = vacio();
    b.delivery = { ...b.delivery, store: "RDZ Edinburg", miles: 4 };
    expect(borradorDesdeLead(lead({ pool: " rdz brownsville " }), b, tiendas).delivery.store).toBe("RDZ Brownsville");
    expect(borradorDesdeLead(lead({ pool: "No store", site_address: null, site_city: null }), b, tiendas).delivery).toMatchObject({ store: "RDZ Edinburg", miles: 4 });
  });

  it("no toca el estimado, las líneas, la extensión ni el resumen (que SE IMPRIME)", () => {
    const b = { ...vacio(), sales_ext: "214", project_summary: "" };
    const d = borradorDesdeLead(lead({ project_name: "Clínica Norte" }), b, tiendas);
    expect([d.estimate_num, d.lines, d.sales_ext, d.project_summary, d.valid_through, d.display_level])
      .toEqual([b.estimate_num, b.lines, b.sales_ext, "", b.valid_through, b.display_level]);
  });

  it("direccionDeObra: con ciudad sola también; sin calle ni ciudad, vacía", () => {
    expect(direccionDeObra({ site_address: null, site_city: "Weslaco", site_zip: null })).toBe("Weslaco, TX");
    expect(direccionDeObra({ site_address: null, site_city: null, site_zip: "78596" })).toBe("");
  });

  it("nombreDeLead: el título de su tarjeta (proyecto, local o TABS #)", () => {
    expect(nombreDeLead({ project_name: "P", facility_name: "F", tabs_project: "T" })).toBe("P");
    expect(nombreDeLead({ project_name: " ", facility_name: "F", tabs_project: "T" })).toBe("F");
    expect(nombreDeLead({ project_name: null, facility_name: null, tabs_project: "T" })).toBe("T");
  });
});

describe("al abrir el Quote Builder con ?lead=", () => {
  it("decidirRelleno: error, no visible, de otro, o rellenar", () => {
    expect(decidirRelleno({ ok: false, error: "boom" }, ana)).toEqual({ tipo: "error", error: "boom" });
    expect(decidirRelleno({ ok: true, valor: null }, ana)).toEqual({ tipo: "no-visible" });
    expect(decidirRelleno({ ok: true, valor: lead() }, beto).tipo).toBe("sin-permiso");
    expect(decidirRelleno({ ok: true, valor: lead({ status: "free", holder: null }) }, ana).tipo).toBe("sin-permiso");
    expect(decidirRelleno({ ok: true, valor: lead() }, ana)).toEqual({ tipo: "rellenar", lead: lead() });
    expect(decidirRelleno({ ok: true, valor: lead({ status: "free", holder: null }) }, admin).tipo).toBe("rellenar");
  });

  it("idDeParametro: un uuid o un id del demo; nada que no lo parezca", () => {
    expect(idDeParametro("3f2b1c9e-0d6a-4f7e-9a51-1b2c3d4e5f60")).toBe("3f2b1c9e-0d6a-4f7e-9a51-1b2c3d4e5f60");
    expect(idDeParametro(" demo-lead-03 ")).toBe("demo-lead-03");
    for (const malo of [null, "", "../x", "a,b", "a b", "x".repeat(65)]) expect([malo, idDeParametro(malo)]).toEqual([malo, null]);
  });

  it("los tres enlaces, con el id escapado", () => {
    expect(enlaceACotizar("L 1")).toBe("/estimator?lead=L%201");
    expect(enlaceALead("L1")).toBe("/leads?lead=L1");
    expect(enlaceACotizacion("q&1")).toBe("/estimator?quote=q%261");
  });
});

describe("lo que la cotización dice de su lead, y lo que el lead cuenta", () => {
  it("vinculoDeLead: ninguno, cargando, visible con enlace, oculto, error", () => {
    expect(vinculoDeLead(null, lead())).toEqual({ estado: "ninguno" });
    expect(vinculoDeLead("L1", undefined)).toEqual({ estado: "cargando" });
    expect(vinculoDeLead("L1", lead({ project_name: "Clínica" }))).toEqual({ estado: "visible", nombre: "Clínica", href: "/leads?lead=L1" });
    expect(vinculoDeLead("L1", null)).toEqual({ estado: "oculto" });
    expect(vinculoDeLead("L1", "error")).toEqual({ estado: "error" });
    // Un lead leído que no es el de la cotización no se enseña con su nombre.
    expect(vinculoDeLead("L2", lead())).toEqual({ estado: "oculto" });
  });

  it("cotizacionesPorLead agrupa por lead y pone la más reciente primero (los datos llegan desordenados)", () => {
    const c = (id: string, lead_id: string, updated_at: string): CotizacionDeLead => ({ id, estimate_num: id.toUpperCase(), lead_id, updated_at });
    const m = cotizacionesPorLead([
      c("a", "L1", "2026-10-01T00:00:00Z"), c("b", "L2", "2026-10-02T00:00:00Z"), c("c", "L1", "2026-10-03T00:00:00Z"),
      c("d", "", "2026-10-04T00:00:00Z"),
    ]);
    expect([...m.keys()].sort()).toEqual(["L1", "L2"]);
    expect(m.get("L1")!.map((x) => x.id)).toEqual(["c", "a"]);
    expect(m.get("L2")!.map((x) => x.id)).toEqual(["b"]);
  });
});

// ---- guardar el enlace, antes y después de la 175 ------------------------------------------------------------------

type Respuesta = { data?: unknown; error?: { code: string; message: string } | null };
/** Un cliente de Supabase de mentira: apunta cada cadena de llamadas y responde, en orden, lo que se le da. */
function clienteFalso(respuestas: Respuesta[]) {
  const cadenas: { op: string; args: unknown[] }[][] = [];
  const from = (tabla: string) => {
    const cadena = [{ op: "from", args: [tabla] as unknown[] }];
    cadenas.push(cadena);
    const b: unknown = new Proxy({}, {
      get(_, prop) {
        if (prop === "then") {
          const r = respuestas.shift() ?? {};
          return (ok: (v: unknown) => unknown, ko: (e: unknown) => unknown) =>
            Promise.resolve({ data: r.data ?? null, error: r.error ?? null }).then(ok, ko);
        }
        return (...args: unknown[]) => { cadena.push({ op: String(prop), args }); return b; };
      },
    });
    return b;
  };
  return { cliente: { from } as unknown as SupabaseClient, cadenas };
}
const escrito = (cadena: { op: string; args: unknown[] }[]) => cadena.find((x) => x.op === "insert" || x.op === "update")!;
const SIN_COLUMNA_AL_ESCRIBIR = { code: "PGRST204", message: "Could not find the 'lead_id' column of 'estimator_quotes' in the schema cache" };
const SIN_COLUMNA_AL_LEER = { code: "42703", message: "column estimator_quotes.lead_id does not exist" };

describe("guardar el enlace (estimator/almacen.ts)", () => {
  const d = () => ({ ...borradorVacio("2026-10-15"), estimate_num: "E-1" });

  it("faltaLaColumnaDelLead: solo PGRST204/42703 Y que la columna sea lead_id", () => {
    expect(faltaLaColumnaDelLead(SIN_COLUMNA_AL_ESCRIBIR)).toBe(true);
    expect(faltaLaColumnaDelLead(SIN_COLUMNA_AL_LEER)).toBe(true);
    expect(faltaLaColumnaDelLead({ code: "PGRST204", message: "Could not find the 'price_match' column" })).toBe(false);
    expect(faltaLaColumnaDelLead({ code: "42501", message: "lead_id" })).toBe(false);
    expect(faltaLaColumnaDelLead(null)).toBe(false);
  });

  it("filaNueva: con lead lleva lead_id; sin lead, ni la clave (una base sin la 175 la acepta)", () => {
    const uno = d();
    expect(filaNueva(uno, "L1")).toEqual({ ...filaDeBorrador(uno), lead_id: "L1" });
    expect("lead_id" in filaNueva(d(), null)).toBe(false);
    expect("lead_id" in filaNueva(d(), "")).toBe(false);
  });

  it("crear desde un lead manda lead_id una vez y devuelve el id", async () => {
    const { cliente, cadenas } = clienteFalso([{ data: [{ id: "q1" }] }]);
    const r = await almacenDeLaBase(cliente).guardar(null, d(), "L1");
    expect(r).toEqual({ ok: true, valor: "q1" });
    expect(cadenas).toHaveLength(1);
    expect(escrito(cadenas[0]).args[0]).toMatchObject({ lead_id: "L1", estimate_num: "E-1" });
  });

  it("sin la 175: se vuelve a mandar SIN lead_id, se guarda, y se dice (sinLead)", async () => {
    const { cliente, cadenas } = clienteFalso([{ error: SIN_COLUMNA_AL_ESCRIBIR }, { data: [{ id: "q2" }] }]);
    const r = await almacenDeLaBase(cliente).guardar(null, d(), "L1");
    expect(r).toEqual({ ok: true, valor: "q2", sinLead: true });
    expect(cadenas).toHaveLength(2);
    expect("lead_id" in (escrito(cadenas[1]).args[0] as object)).toBe(false);
  });

  it("otra columna que falta NO se reintenta: es un error y se dice", async () => {
    const { cliente, cadenas } = clienteFalso([{ error: { code: "PGRST204", message: "Could not find the 'otra' column" } }]);
    const r = await almacenDeLaBase(cliente).guardar(null, d(), "L1");
    expect(r.ok).toBe(false);
    expect(cadenas).toHaveLength(1);
  });

  it("editar una guardada NUNCA manda lead_id, aunque se le pase", async () => {
    const { cliente, cadenas } = clienteFalso([{ data: [{ id: "q3" }] }]);
    await almacenDeLaBase(cliente).guardar("q3", d(), "L1");
    const e = escrito(cadenas[0]);
    expect(e.op).toBe("update");
    expect("lead_id" in (e.args[0] as object)).toBe(false);
  });

  it("abrir una guardada trae su lead_id; sin la 175 se vuelve a pedir sin la columna y se abre igual", async () => {
    const fila = { id: "q1", owner_id: "u", store: null, print_count: 0, estimate_num: "E-1", customer: {}, delivery: {}, lines: [] };
    const con = clienteFalso([{ data: { ...fila, lead_id: "L1" } }]);
    const r1 = await almacenDeLaBase(con.cliente).cargar("q1");
    expect(r1.ok && r1.valor.lead_id).toBe("L1");
    expect(String(con.cadenas[0].find((x) => x.op === "select")!.args[0])).toContain("lead_id");

    const sin = clienteFalso([{ error: SIN_COLUMNA_AL_LEER }, { data: fila }]);
    const r2 = await almacenDeLaBase(sin.cliente).cargar("q1");
    expect(r2.ok && r2.valor.lead_id).toBe(null);
    expect(String(sin.cadenas[1].find((x) => x.op === "select")!.args[0])).not.toContain("lead_id");
  });
});

describe("las lecturas que cruzan (leads/enlace.ts)", () => {
  it("las cotizaciones de cada lead: sin la 175 o sin la 148, cero y no error; otra avería, error", async () => {
    expect(sinNadaQueContar(SIN_COLUMNA_AL_LEER)).toBe(true);
    expect(sinNadaQueContar({ code: "PGRST205", message: "no table" })).toBe(true);
    expect(sinNadaQueContar({ code: "42501", message: "permission denied" })).toBe(false);
    const sin175 = await enlaceDeLaBase(clienteFalso([{ error: SIN_COLUMNA_AL_LEER }]).cliente).cotizacionesConLead();
    expect(sin175).toEqual({ ok: true, valor: [] });
    const roto = await enlaceDeLaBase(clienteFalso([{ error: { code: "08006", message: "connection" } }]).cliente).cotizacionesConLead();
    expect(roto).toEqual({ ok: false, error: "connection" });
  });

  it("pide solo las que tienen lead, y con la sesión de quien mira (la RLS de la 148 filtra)", async () => {
    const { cliente, cadenas } = clienteFalso([{ data: [{ id: "q", estimate_num: "E", lead_id: "L1", updated_at: "x" }] }]);
    const r = await enlaceDeLaBase(cliente).cotizacionesConLead();
    expect(r.ok && r.valor).toHaveLength(1);
    expect(cadenas[0].find((x) => x.op === "not")!.args).toEqual(["lead_id", "is", null]);
  });

  it("leer un lead que no se ve es null, no error; una avería, error", async () => {
    expect(await enlaceDeLaBase(clienteFalso([{ data: null }]).cliente).leerLead("L1")).toEqual({ ok: true, valor: null });
    expect(await enlaceDeLaBase(clienteFalso([{ error: { code: "08006", message: "x" } }]).cliente).leerLead("L1")).toEqual({ ok: false, error: "x" });
  });
});

describe("las pantallas usan estas reglas", () => {
  const leer = (f: string) => readFileSync(f, "utf8").split("\r\n").join("\n");
  it("Leads: el botón sale de puedeCotizarLead con el módulo que dijo el servidor, y lleva a enlaceACotizar", () => {
    const p = leer("src/app/leads/Leads.tsx");
    expect(p).toContain("cotizar={puedeCotizarLead(l, yo, cotiza)}");
    expect(p).toContain("{cotizar && (");
    expect(p).toContain("href={enlaceACotizar(l.id)} data-crear-cotizacion");
    expect(p).toContain("setCotizaciones(cotizacionesPorLead(r.valor))");
    const page = leer("src/app/leads/page.tsx");
    expect(page).toContain("cotiza = tieneEstimador(data);");
  });
  it("Quote Builder: rellena por decidirRelleno, y el lead solo viaja al crear", () => {
    const p = leer("src/app/estimator/Estimador.tsx");
    expect(p).toContain("const que = decidirRelleno(leido, me);");
    expect(p).toContain('} else {\n        setDraft((d) => borradorDesdeLead(que.lead, d, ajustes.stores.map((s) => s.name)));');
    expect(p).toContain("almacen.guardar(quoteIdRef.current, draft, quoteIdRef.current ? null : leadId)");
    expect(p).toContain("ponerLead(c.valor.lead_id ?? null);");
  });
});
