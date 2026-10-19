import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  codigoDeTienda, contactoDelGuardado, cuerpoDelContacto, digitos, inicialesDelPuesto, nombreParaRingCentral, telefonoE164,
  TIPOS_QUE_GUARDAN, yaEstaEnLaAgenda, yaGuardadoEnRingCentral,
} from "./contacto-ringcentral";

// D-591 · «cuando le pongo mandar texto o llamar, puedes automaticamente guardar ese contacto en ring central, y ponerle
// el nombre iniciales del puesto y tienda como decir Andres Ugarte WA BRO warehouse associate brownville» (2026-10-19).

const leer = (p: string) => readFileSync(p, "utf8").split("\r\n").join("\n");
const andres = { id: "c1", name: " Andres  Ugarte ", phone: "(956) 555-0101", role: "Warehouse Associate", location: "Brownsville" };

describe("el nombre del contacto: nombre + iniciales del puesto + código de la tienda", () => {
  it("«Andres Ugarte WA BRO», el ejemplo del dueño; el sufijo va en el apellido", () => {
    expect(nombreParaRingCentral(andres)).toEqual({ firstName: "Andres", lastName: "Ugarte WA BRO", display: "Andres Ugarte WA BRO" });
  });
  it("sin apellido el sufijo va solo; sin puesto ni tienda, solo el nombre; dos apellidos se quedan", () => {
    expect(nombreParaRingCentral({ name: "Andres", role: "Sales", location: "McAllen" })).toEqual({ firstName: "Andres", lastName: "S MCA", display: "Andres S MCA" });
    expect(nombreParaRingCentral({ name: "Ana Pérez", role: null, location: "TBD" })).toEqual({ firstName: "Ana", lastName: "Pérez", display: "Ana Pérez" });
    expect(nombreParaRingCentral({ name: "Ana María Pérez López", role: "Driver", location: "Pharr" }).display).toBe("Ana María Pérez López D PHR");
  });
  it("las iniciales: una letra por palabra, en mayúsculas, solo letras", () => {
    expect(inicialesDelPuesto("Warehouse Associate")).toBe("WA");
    expect(inicialesDelPuesto("sales/ventas")).toBe("SV");
    expect(inicialesDelPuesto("  ")).toBe("");
    expect(inicialesDelPuesto(null)).toBe("");
  });
  it("los códigos: los de Entregas por el nombre corto de RR. HH.; «RDZ » no estorba; desconocida, tres letras; TBD, nada", () => {
    expect(["Brownsville", "Weslaco", "Pharr", "McAllen", "Mission", "Edinburg"].map(codigoDeTienda)).toEqual(["BRO", "WES", "PHR", "MCA", "MIS", "EDG"]);
    expect(codigoDeTienda("RDZ McAllen")).toBe("MCA");
    expect(codigoDeTienda("Harlingen")).toBe("HAR");
    expect(codigoDeTienda("TBD")).toBe("");
    expect(codigoDeTienda(null)).toBe("");
  });
});

describe("el teléfono y el cuerpo", () => {
  it("E.164: 10 dígitos con +1; 11 con 1 delante; otra cosa, null", () => {
    expect(telefonoE164("(956) 555-0101")).toBe("+19565550101");
    expect(telefonoE164("1 956 555 0101")).toBe("+19565550101");
    expect(telefonoE164("555-0101")).toBeNull();
    expect(telefonoE164(null)).toBeNull();
  });
  it("el cuerpo lleva nombre con sufijo, móvil, cargo, empresa y de dónde salió; sin teléfono válido, null", () => {
    expect(cuerpoDelContacto(andres)).toEqual({
      firstName: "Andres", lastName: "Ugarte WA BRO", mobilePhone: "+19565550101",
      jobTitle: "Warehouse Associate", company: "Brownsville", notes: "RTG Hub · candidato c1",
    });
    expect(cuerpoDelContacto({ ...andres, phone: "123" })).toBeNull();
  });
  it("ya está en la agenda si algún teléfono del contacto tiene los mismos dígitos, con o sin el 1", () => {
    const agenda = [{ firstName: "X", mobilePhone: "+19565550101" }, { businessPhone: "956-555-0202" }];
    expect(yaEstaEnLaAgenda(agenda, "(956) 555-0101")).toBe(true);
    expect(yaEstaEnLaAgenda(agenda, "9565550202")).toBe(true);
    expect(yaEstaEnLaAgenda(agenda, "9565550303")).toBe(false);
    expect(yaEstaEnLaAgenda(agenda, "")).toBe(false);
    expect(digitos("+1 (956) 555-0101")).toBe("9565550101");
  });
});

describe("cuándo se guarda y la traza", () => {
  it("lo disparan llamar y textear, nada más; y solo si el historial no dice que ya se guardó", () => {
    expect([...TIPOS_QUE_GUARDAN].sort()).toEqual(["Call", "SMS"]);
    expect(TIPOS_QUE_GUARDAN.has("Note")).toBe(false);
    expect(yaGuardadoEnRingCentral([{ type: "SMS", result: "sent" }])).toBe(false);
    expect(yaGuardadoEnRingCentral([{ type: "RingCentral", result: "saved" }])).toBe(true);
    expect(contactoDelGuardado("Andres Ugarte WA BRO")).toEqual({ type: "RingCentral", result: "saved", note: "Andres Ugarte WA BRO" });
  });
  it("el proveedor lo dispara desde `addContact` sin esperar, y deja la traza con lo que contestó el servidor", () => {
    const prov = leer("src/lib/recruiting-data-provider.tsx");
    expect(prov).toContain("if (entry.type && TIPOS_QUE_GUARDAN.has(entry.type) && !yaGuardadoEnRingCentral(contacts.filter((k) => k.candidate_id === candidateId))) {\n        void guardarEnRingCentral(candidateId);");
    expect(prov).toContain('const res = await fetch("/api/recruiting/rc-contact", {');
    // D-NEXT: la traza lleva también en qué agendas quedó.
    expect(prov).toContain("const traza = { candidate_id: candidateId, created_by: me?.id ?? null, ...contactoDelGuardado(notaDelGuardado(b.display ?? \"\", agendas)) };");
  });
  it("la ruta: sesión + RLS del candidato (404 si no lo ve), sin RingCentral no gasta (dryRun), y no duplica por teléfono", () => {
    const ruta = leer("src/app/api/recruiting/rc-contact/route.ts");
    expect(ruta).toContain("const auth = await requireUser();");
    expect(ruta).toContain('const { data: c, error } = await auth.supabase.schema("recruiting").from("candidates")');
    expect(ruta).toContain('if (!c) return NextResponse.json({ error: "Candidate not found" }, { status: 404 });');
    expect(ruta).toContain("if (!ringcentralConfigured()) return NextResponse.json({ ok: false, dryRun: true, display });");
    // D-NEXT: la misma regla por agenda (`guardarEn`), con las credenciales de cada una.
    expect(ruta).toContain("if (yaEstaEnLaAgenda(agenda, phone)) return { nombre, created: false };");
    expect(ruta).toContain("await ringcentralAddContact(cuerpo, creds);");
    const rc = leer("src/lib/ringcentral.ts");
    expect(rc).toContain("/restapi/v1.0/account/~/extension/~/address-book/contact?perPage=250");
    expect(rc).toMatch(/address-book\/contact`, \{\s*method: "POST"/);
  });
});
