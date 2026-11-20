import { describe, expect, it } from "vitest";
import {
  clavesDeContratista, enlaceDeBusqueda, esQuitado, notaDeTelefono, sinTelefono, sinTelefonoPorPool, sugerenciaDeTelefono,
  telefonoDeContratista, telefonoDeOtro, telefonoParaMostrar, telefonosAMano, tieneTelefono, validaTelefono,
} from "./telefonos";
import { filtrar, telUrl, type Lead } from "./reglas";
import { almacenDemo, leadsDemo, PERSONAS_DEMO } from "./demo";

/** Un lead mínimo para las pruebas: lo que no se nombra va vacío. */
function lead(p: Partial<Lead> & { id: string }): Lead {
  return {
    tabs_project: p.id.toUpperCase(), pool: "RDZ Brownsville", distance_miles: null, category: null, project_type: null,
    reason: null, county: null, registered_date: null, project_name: null, facility_name: null, type_of_work: null,
    scope_of_work: null, square_footage: null, estimated_cost: null, est_start_date: null, est_completion_date: null,
    permit_status: null, site_address: null, site_city: null, site_zip: null, owner_name: null, owner_phone: null,
    owner_contact: null, tenant_name: null, tenant_phone: null, design_firm_name: null, design_firm_phone: null,
    tdlr_link: null, status: "free", holder: null, holder_name: null, taken_at: null, touched_at: null,
    follow_up_note: null, follow_up_at: null, last_outcome: null, last_note: null, last_by: null, last_by_name: null,
    last_at: null, source: "privado", imported_at: null, customer_match_id: null,
    ...p,
  };
}

describe("validaTelefono: la forma única del hub, 10 dígitos de EE. UU.", () => {
  it("da forma a cualquier escritura de 10 dígitos", () => {
    for (const entrada of ["9565550123", "956-555-0123", "956.555.0123", "(956) 555 0123", "+1 956 555 0123", "1-956-555-0123"]) {
      expect(validaTelefono(entrada)).toEqual({ ok: true, valor: { telefono: "(956) 555-0123", ext: null } });
    }
  });
  it("rechaza lo vacío, lo corto y lo largo, con su motivo", () => {
    expect(validaTelefono("   ")).toEqual({ ok: false, motivo: "vacio" });
    expect(validaTelefono("555-0123")).toEqual({ ok: false, motivo: "digitos" });
    expect(validaTelefono("956555012345")).toEqual({ ok: false, motivo: "digitos" });
  });
  it("la extensión es opcional, de hasta 6 dígitos, y se toma también de «ext» escrito en el número", () => {
    expect(validaTelefono("956-555-0123", "12")).toEqual({ ok: true, valor: { telefono: "(956) 555-0123", ext: "12" } });
    expect(validaTelefono("956-555-0123 ext. 45")).toEqual({ ok: true, valor: { telefono: "(956) 555-0123", ext: "45" } });
    expect(validaTelefono("956-555-0123", "1234567")).toEqual({ ok: false, motivo: "ext" });
    expect(validaTelefono("956-555-0123", "1a")).toEqual({ ok: false, motivo: "ext" });
  });
});

describe("qué teléfono se enseña: el de mano manda sobre el del Excel", () => {
  it("con teléfono de mano, ese; si no, el del Excel; si ninguno, null", () => {
    expect(telefonoDeContratista({ owner_phone: "(956) 555-0100", owner_phone_manual: "(956) 555-0177" })).toBe("(956) 555-0177");
    expect(telefonoDeContratista({ owner_phone: "(956) 555-0100", owner_phone_manual: null })).toBe("(956) 555-0100");
    expect(telefonoDeContratista({ owner_phone: null, owner_phone_manual: "  " })).toBeNull();
    expect(telefonoDeOtro({ tenant_phone: null, tenant_phone_manual: "(956) 555-0188" })).toBe("(956) 555-0188");
  });
  it("el teléfono de mano no se borra con el del Excel: son dos campos", () => {
    const l = { owner_phone: null, owner_phone_manual: "(956) 555-0177" };
    expect(sinTelefono(l)).toBe(false);
    expect(sinTelefono({ owner_phone: null, owner_phone_manual: null })).toBe(true);
  });
  it("«sin teléfono» exige al menos 7 dígitos que sirvan para llamar", () => {
    expect(tieneTelefono("-")).toBe(false);
    expect(tieneTelefono("unk")).toBe(false);
    expect(tieneTelefono("555-0123")).toBe(true);
    expect(tieneTelefono("(956) 555-0123 ext. 4")).toBe(true);
  });
  it("se muestra con la extensión a la vista, y el enlace de llamada no marca la extensión", () => {
    expect(telefonoParaMostrar("(956) 555-0123 ext. 45")).toBe("(956) 555-0123 ext. 45");
    expect(telefonoParaMostrar("9565550123")).toBe("(956) 555-0123");
    expect(telUrl("(956) 555-0123 ext. 45")).toBe("tel:9565550123");
    expect(telUrl("(956) 555-0123")).toBe("tel:9565550123");
  });
});

describe("el mismo contratista: nombre normalizado y la misma fuente", () => {
  it("quita acentos, puntuación y las siglas de empresa", () => {
    expect(clavesDeContratista("Tomas Management Solutions, LLC")).toEqual(["tomas management solutions"]);
    expect(clavesDeContratista("TOMÁS  Management-Solutions Inc.")).toEqual(["tomas management solutions"]);
    expect(clavesDeContratista("The Smith & Sons Co.")).toEqual(["smith sons"]);
  });
  it("con coma, cuenta también «Nombre Apellido»", () => {
    expect(clavesDeContratista("Ochoa, Albert")).toEqual(["ochoa albert", "albert ochoa"]);
  });
  it("un nombre de menos de 4 letras no cuenta", () => {
    expect(clavesDeContratista("LLC")).toEqual([]);
    expect(clavesDeContratista(null)).toEqual([]);
  });
  it("sugiere el teléfono de otro permiso del mismo contratista, de mano antes que del Excel", () => {
    const a = lead({ id: "a", owner_name: "Tomas Management Solutions LLC", owner_phone: "(956) 555-0100", imported_at: "2026-11-01" });
    const b = lead({ id: "b", owner_name: "Tomas Management Solutions, LLC.", owner_phone: null, owner_phone_manual: null });
    const c = lead({ id: "c", owner_name: "Tomas Management Solutions", owner_phone: "(956) 555-0900", owner_phone_manual: "(956) 555-0999", last_at: "2026-11-02" });
    const s = sugerenciaDeTelefono(b, [a, b, c], new Map());
    expect(s).toEqual({ telefono: "(956) 555-0999", origen: { tipo: "permiso", tabs: "C", nombre: "Tomas Management Solutions" } });
  });
  it("NO cruza entre fuentes (tdlr y privado son mundos aparte)", () => {
    const a = lead({ id: "a", source: "tdlr", owner_name: "Tomas Management Solutions", owner_phone: "(956) 555-0100" });
    const b = lead({ id: "b", source: "privado", owner_name: "Tomas Management Solutions", owner_phone: null });
    expect(sugerenciaDeTelefono(b, [a, b], new Map())).toBeNull();
  });
  it("no sugiere de un lead archivado, ni de sí mismo, ni si el lead ya tiene teléfono", () => {
    const archivado = lead({ id: "x", status: "archived", owner_name: "Tomas Management Solutions", owner_phone: "(956) 555-0100" });
    const b = lead({ id: "b", owner_name: "Tomas Management Solutions", owner_phone: null });
    expect(sugerenciaDeTelefono(b, [archivado, b], new Map())).toBeNull();
    expect(sugerenciaDeTelefono({ ...b, owner_phone: "(956) 555-0100" }, [{ ...b, owner_phone: "(956) 555-0100" }], new Map())).toBeNull();
  });
  it("si no hay otro permiso, sugiere el teléfono del cliente cruzado (solo su campo phone)", () => {
    const b = lead({ id: "b", owner_name: "Nadie Parecido", owner_phone: null, customer_match_id: 7 });
    const s = sugerenciaDeTelefono(b, [b], new Map([[7, { account: "Cliente Siete", phone: "(956) 555-0777" }]]));
    expect(s).toEqual({ telefono: "(956) 555-0777", origen: { tipo: "cliente", cuenta: "Cliente Siete" } });
    expect(sugerenciaDeTelefono(b, [b], new Map([[7, { account: "Sin tel", phone: null }]]))).toBeNull();
  });
});

describe("«Sin teléfono» y su conteo", () => {
  const leads = [
    lead({ id: "1", pool: "RDZ Brownsville", owner_phone: null }),
    lead({ id: "2", pool: "RDZ Brownsville", owner_phone: "(956) 555-0100" }),
    lead({ id: "3", pool: "RDZ Edinburg", owner_phone: null, owner_phone_manual: "(956) 555-0177" }),
    lead({ id: "4", pool: "RDZ Edinburg", owner_phone: null, status: "archived" }),
    lead({ id: "5", pool: "No store", owner_phone: "-" }),
  ];
  it("el filtro deja solo los que no tienen teléfono de contratista, ni de mano ni del Excel", () => {
    const ids = filtrar(leads, { pool: null, categoria: "todas", tipo: "", ciudad: "", busca: "", sinTelefono: true }).map((l) => l.id);
    expect(ids).toEqual(["1", "5"]);
  });
  it("el conteo por pool cuenta los vigentes sin teléfono y pone «No store» al final", () => {
    expect(sinTelefonoPorPool(leads)).toEqual([{ pool: "RDZ Brownsville", n: 1 }, { pool: "No store", n: 1 }]);
  });
});

describe("buscar un número", () => {
  it("la búsqueda encuentra el teléfono de mano por sus dígitos y por su texto", () => {
    const l = lead({ id: "m", owner_phone: null, owner_phone_manual: "(956) 555-0177", owner_phone_manual_contact: "Juan Pérez" });
    expect(filtrar([l], { pool: null, categoria: "todas", tipo: "", ciudad: "", busca: "9565550177", sinTelefono: false })).toHaveLength(1);
    expect(filtrar([l], { pool: null, categoria: "todas", tipo: "", ciudad: "", busca: "555-0177", sinTelefono: false })).toHaveLength(1);
    expect(filtrar([l], { pool: null, categoria: "todas", tipo: "", ciudad: "", busca: "juan perez", sinTelefono: false })).toHaveLength(1);
  });
});

describe("el enlace de búsqueda de un teléfono", () => {
  it("contratista + ciudad + «phone», codificado, en Google sin API", () => {
    const url = enlaceDeBusqueda({ owner_name: "Tomas Management Solutions LLC", tenant_name: null, site_city: "Pharr" });
    expect(url).toBe("https://www.google.com/search?q=" + encodeURIComponent("Tomas Management Solutions LLC Pharr phone"));
    expect(url).toContain("q=Tomas%20Management");
  });
  it("sin nombre de contratista no hay enlace", () => {
    expect(enlaceDeBusqueda({ owner_name: null, tenant_name: null, site_city: "Pharr" })).toBeNull();
  });
});

describe("el historial de teléfonos", () => {
  it("la nota dice quién y si se quitó", () => {
    expect(notaDeTelefono("Contratista", "(956) 555-0123", "Juan")).toBe("Contratista: (956) 555-0123 · Juan");
    expect(notaDeTelefono("Propietario", "(956) 555-0123", null)).toBe("Propietario: (956) 555-0123");
    expect(notaDeTelefono("Contratista", null, null)).toBe("Contratista: quitado");
    expect(esQuitado("Contratista: quitado")).toBe(true);
    expect(esQuitado("Contratista: (956) 555-0123")).toBe(false);
  });
  it("cuenta los añadidos a mano del mes, por persona, sin los quitados ni los de otro mes", () => {
    const ahora = new Date(2026, 10, 19);
    const eventos = [
      { kind: "phone", at: new Date(2026, 10, 2).toISOString(), note: "Contratista: (956) 555-0123", actor_name: "Ana" },
      { kind: "phone", at: new Date(2026, 10, 9).toISOString(), note: "Contratista: (956) 555-0124", actor_name: "Ana" },
      { kind: "phone", at: new Date(2026, 10, 10).toISOString(), note: "Propietario: (956) 555-0199", actor_name: "Beto" },
      { kind: "phone", at: new Date(2026, 10, 11).toISOString(), note: "Contratista: quitado", actor_name: "Beto" },
      { kind: "phone", at: new Date(2026, 9, 30).toISOString(), note: "Contratista: (956) 555-0100", actor_name: "Beto" },
      { kind: "progress", at: new Date(2026, 10, 3).toISOString(), note: "nota", actor_name: "Beto" },
    ];
    expect(telefonosAMano(eventos, ahora)).toEqual({ total: 3, porPersona: [{ nombre: "Ana", n: 2 }, { nombre: "Beto", n: 1 }] });
  });
});

describe("el demo guarda como la base", () => {
  it("hay leads sin teléfono y uno con sugerencia de otro permiso", () => {
    const todos = leadsDemo();
    expect(todos.some((l) => sinTelefono(l))).toBe(true);
    const sugeridos = todos.filter((l) => sinTelefono(l) && sugerenciaDeTelefono(l, todos, new Map([[1, { account: "Cliente demo", phone: "(956) 555-0199" }]])));
    expect(sugeridos.length).toBeGreaterThanOrEqual(2);
    expect(sugeridos.some((l) => sugerenciaDeTelefono(l, todos, new Map())?.origen.tipo === "permiso")).toBe(true);
  });
  it("guardar un teléfono lo deja a la vista, con su nota en el historial, y lo quita", async () => {
    const admin = PERSONAS_DEMO[2];
    const almacen = almacenDemo(() => admin);
    const r = await almacen.leer();
    if (!r.ok) throw new Error("no lectura");
    const sin = r.valor.leads.find((l) => sinTelefono(l))!;
    const puesto = await almacen.guardarTelefono(sin.id, "owner", "956.555.0188", "7", " Juan ");
    expect(puesto.ok).toBe(true);
    if (!puesto.ok) return;
    expect(puesto.valor.owner_phone_manual).toBe("(956) 555-0188 ext. 7");
    expect(puesto.valor.owner_phone_manual_contact).toBe("Juan");
    expect(puesto.valor.owner_phone_manual_by_name).toBe(admin.name);
    expect(telefonoDeContratista(puesto.valor)).toBe("(956) 555-0188 ext. 7");
    const h = await almacen.historial(sin.id);
    if (!h.ok) throw new Error("no historial");
    expect(h.valor.at(-1)).toMatchObject({ kind: "phone", note: "Contratista: (956) 555-0188 ext. 7 · Juan" });
    const quitado = await almacen.guardarTelefono(sin.id, "owner", null, null, null);
    expect(quitado.ok && quitado.valor.owner_phone_manual).toBeNull();
  });
  it("rechaza un teléfono inválido igual que la base", async () => {
    const almacen = almacenDemo(() => PERSONAS_DEMO[2]);
    const r = await almacen.leer();
    if (!r.ok) throw new Error("no lectura");
    const l = r.valor.leads[0]!;
    expect(await almacen.guardarTelefono(l.id, "owner", "123", null, null)).toMatchObject({ ok: false, motivo: "dato_invalido" });
    expect(await almacen.guardarTelefono(l.id, "owner", "9565550123", "1234567", null)).toMatchObject({ ok: false, motivo: "dato_invalido" });
  });
});
