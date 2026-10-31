import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  altaEsSolicitud, cuerpoDeSolicitud, mensajeDeAltaPendiente, PAGINA_DE_SOLICITUDES, pendientes, resumenDeSolicitud, solicitudDeLaBase,
} from "./solicitud-de-cliente";
import { almacenDemoNuevo } from "./demo";

/** El alta de un cliente por vendedor o gerente es una solicitud que aprueba el admin (D-743, migración 216). */

const leer = (r: string) => readFileSync(join(process.cwd(), r), "utf8").split("\r\n").join("\n");
const sinComentarios = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

describe("quién solicita", () => {
  it("vendedor y gerente; el admin crea directo", () => {
    expect(altaEsSolicitud("sales")).toBe(true);
    expect(altaEsSolicitud("manager")).toBe(true);
    expect(altaEsSolicitud("admin")).toBe(false);
    expect(altaEsSolicitud("accounting")).toBe(false);
  });
});

describe("lo que se guarda y lo que se lee", () => {
  it("el cuerpo lleva las tiendas (sin repetir ni vacías) y los campos, sin tienda ni empresa", () => {
    const c = cuerpoDeSolicitud({ account: "Acme", store: "PHR", company_id: "x", phone: "956-555-0100", credit_limit: null }, ["PHR", " MCA", "PHR", ""]);
    expect(c).toEqual({ stores: ["PHR", "MCA"], payload: { account: "Acme", phone: "956-555-0100", credit_limit: null } });
  });
  it("una fila de la base, saneada; un estado desconocido se lee como pendiente", () => {
    const s = solicitudDeLaBase({ id: 3, requested_by: "u1", requested_name: "Ana", stores: ["PHR", 7], payload: { account: "Acme" }, status: "approved", created_at: "2026-10-29T10:00:00Z", decided_at: null, decision_note: "", created_ids: [10, "x", 11] });
    expect(s).toMatchObject({ id: 3, requested_by: "u1", requested_name: "Ana", stores: ["PHR"], payload: { account: "Acme" }, status: "approved", created_at: "2026-10-29T10:00:00Z", decided_at: null, decision_note: null, created_ids: [10, 11] });
    expect(solicitudDeLaBase({ id: 4, status: "raro", payload: [] }).status).toBe("pending");
    expect(solicitudDeLaBase({ id: 4, payload: [] }).payload).toEqual({});
  });
  it("el resumen: cuenta, tiendas, y contacto/teléfono de las columnas o del primer contacto", () => {
    expect(resumenDeSolicitud({ stores: ["PHR", "MCA"], payload: { account: "Acme", contact_name: "Ana", phone: "956-555-0100" } }))
      .toEqual({ cuenta: "Acme", tiendas: "PHR, MCA", detalle: "Ana · 956-555-0100" });
    expect(resumenDeSolicitud({ stores: ["PHR"], payload: { account: "Acme", contacts: [{ name: "Luis", phones: ["956-555-0101"] }] } }).detalle).toBe("Luis · 956-555-0101");
    expect(resumenDeSolicitud({ stores: [], payload: {} })).toEqual({ cuenta: "—", tiendas: "", detalle: "" });
  });
  it("el aviso al admin dice qué cuenta, en qué tiendas y dónde decidir; y vuelve a Clientes con la ventana abierta", () => {
    const m = mensajeDeAltaPendiente({ id: 9, stores: ["PHR"], payload: { account: "Acme", contact_name: "Ana" } }, "es");
    expect(m.split("\n")).toEqual(["Solicitud de cliente nuevo (Clientes) #9", "Cuenta: Acme", "Tiendas: PHR", "Contacto: Ana", "Apruébala o recházala en Clientes → Solicitudes."]);
    expect(mensajeDeAltaPendiente({ id: 9, stores: ["PHR"], payload: { account: "Acme" } }, "en")).toContain("New customer request (Customers) #9");
    expect(PAGINA_DE_SOLICITUDES).toBe("/customers?solicitudes=1");
  });
  it("`pendientes` filtra por estado", () => {
    const a = solicitudDeLaBase({ id: 1, status: "pending", payload: {} }), b = solicitudDeLaBase({ id: 2, status: "rejected", payload: {} });
    expect(pendientes([a, b]).map((s) => s.id)).toEqual([1]);
  });
});

describe("el almacén demo hace lo mismo que la base", () => {
  it("solicitar → pendiente; aprobar crea una fila por tienda con la misma empresa; rechazar deja la nota", async () => {
    const a = almacenDemoNuevo();
    const antes = (await a.leer()).ok ? ((await a.leer()) as { ok: true; valor: unknown[] }).valor.length : 0;
    const s = await a.solicitarAlta({ account: "Zeta Floors", phone: "956-555-0199" }, ["PHR", "MCA"]);
    expect(s.ok && s.valor.status === "pending" && s.valor.stores).toEqual(["PHR", "MCA"]);
    const lista = await a.solicitudes();
    expect(lista.ok && lista.valor.some((x) => x.status === "pending" && x.payload.account === "Zeta Floors")).toBe(true);
    const ok = await a.aprobarSolicitud(s.ok ? s.valor.id : -1);
    expect(ok.ok && ok.valor.length).toBe(2);
    const despues = await a.leer();
    expect(despues.ok && despues.valor.length).toBe(antes + 2);
    const creadas = despues.ok ? despues.valor.filter((c) => c.account === "Zeta Floors") : [];
    expect(creadas.map((c) => c.store).sort()).toEqual(["MCA", "PHR"]);
    expect(new Set(creadas.map((c) => c.company_id)).size).toBe(1);
    expect((await a.aprobarSolicitud(s.ok ? s.valor.id : -1)).ok).toBe(false);
    const s2 = await a.solicitarAlta({ account: "Otra" }, ["PHR"]);
    const r = await a.rechazarSolicitud(s2.ok ? s2.valor.id : -1, "ya existe");
    expect(r.ok).toBe(true);
    const fin = await a.solicitudes();
    expect(fin.ok && fin.valor.find((x) => x.id === (s2.ok ? s2.valor.id : -1))).toMatchObject({ status: "rejected", decision_note: "ya existe" });
  });
});

describe("la 216", () => {
  const sql = leer("supabase/migrations/216_solicitudes_de_cliente.sql");
  it("tabla con RLS (3 políticas: puerta, leer suya o admin, insertar suya), sin update/delete por la tabla, y las dos funciones solo para el admin", () => {
    expect(sql).toContain("create table if not exists erp.customer_requests (");
    expect(sql).toContain("grant select, insert on erp.customer_requests to authenticated;");
    expect(sql).toContain("using (requested_by = (select auth.uid()) or (select public.is_admin()));");
    expect(sql).toContain("with check (requested_by = (select auth.uid()) and status = 'pending' and (select erp.customers_can_write()));");
    expect(sql).toContain("create or replace function erp.aprueba_solicitud_de_cliente(p_id bigint)");
    expect(sql).toContain("create or replace function erp.rechaza_solicitud_de_cliente(p_id bigint, p_nota text default null)");
    expect(sql).toContain("if not public.is_admin() then raise exception 'solo el admin aprueba solicitudes de cliente'");
    expect(sql).toContain("update erp.customers set created_by = s.requested_by where id = nuevo_id;");
    expect(sql).toContain("coalesce(r.contacts, '[]'::jsonb)");
    expect(sql).not.toMatch(/^\s*(begin|commit);/m);
    expect(sql).not.toContain("'PENDIENTE'");
  });
});

describe("las pantallas", () => {
  const lista = sinComentarios(leer("src/app/customers/Clientes.tsx"));
  const ficha = sinComentarios(leer("src/app/customers/FichaDeCliente.tsx"));
  const pagina = sinComentarios(leer("src/app/customers/page.tsx"));
  it("la página dice quién solicita; la lista lo pasa a la ficha y cambia el botón", () => {
    expect(pagina).toContain("altaComoSolicitud={altaEsSolicitud(role)}");
    expect(lista).toContain("altaComoSolicitud={altaComoSolicitud}");
    expect(lista).toContain('{altaComoSolicitud ? t("Request new customer", "Solicitar cliente nuevo") : t("New customer", "Nuevo cliente")}');
  });
  it("en la ficha, el alta como solicitud guarda la solicitud, avisa al admin por ayuda y lo dice; el botón dice «Enviar solicitud»", () => {
    expect(ficha).toContain("if (nuevo && altaComoSolicitud) { await solicitarEnLasTiendas(); return; }");
    expect(lista).toContain("lang={lang}");
    expect(ficha).toContain("almacen.solicitarAlta(parche, tiendasAlta)");
    expect(ficha).toContain("mensajeDeAltaPendiente(r.valor, lang)");
    expect(ficha).toContain("page: PAGINA_DE_SOLICITUDES,");
    expect(ficha).toContain('altaComoSolicitud ? t("Send request", "Enviar solicitud") : t("Create", "Crear")');
  });
  it("la lista enseña «Solicitudes» con las pendientes, abre la ventana (también con ?solicitudes=1) y relee al decidir", () => {
    expect(lista).toContain("data-abrir-solicitudes");
    expect(lista).toContain("<SolicitudesDeCliente solicitudes={solicitudes} esAdmin={esAdmin} almacen={almacen} onDecidida={() => { void cargar(); void cargaSolicitudes(); }}");
    expect(lista).toContain('new URLSearchParams(window.location.search).get("solicitudes")');
  });
  it("las dos funciones de la 216 están clasificadas como las que escriben (modo enseñanza)", () => {
    const e = leer("src/lib/ensenanza-general.ts");
    expect(e).toContain('"aprueba_solicitud_de_cliente"');
    expect(e).toContain('"rechaza_solicitud_de_cliente"');
  });
});
