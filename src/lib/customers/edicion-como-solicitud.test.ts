import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  cambiosDeSolicitud, cambiosDelHistorial, cuerpoDeEdicion, edicionEsSolicitud, historialDeLaBase, mensajeDeEdicionPendiente, textoDeValor,
} from "./edicion-como-solicitud";
import { solicitudDeLaBase } from "./solicitud-de-cliente";
import { almacenDemoNuevo } from "./demo";
import type { Cliente } from "./reglas";

/** La edición de un cliente por vendedor o gerente es una solicitud que revisa el admin; todo queda en el historial (D-NEXT, 221). */

const leer = (r: string) => readFileSync(join(process.cwd(), r), "utf8").split("\r\n").join("\n");
const sinComentarios = (s: string) => s.replace(/\{\/\*[\s\S]*?\*\/\}/g, "").replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

describe("quién solicita la edición", () => {
  it("vendedor y gerente; el admin edita directo", () => {
    expect(edicionEsSolicitud("sales")).toBe(true);
    expect(edicionEsSolicitud("manager")).toBe(true);
    expect(edicionEsSolicitud("admin")).toBe(false);
    expect(edicionEsSolicitud(null)).toBe(false);
  });
});

describe("lo que se pide", () => {
  const cliente = { id: 7, store: "PHR", account: "Acme", phone: "956-555-0100", terms: "Net 30", credit_limit: 1000, contacts: [] } as unknown as Cliente;
  it("el cuerpo lleva SOLO lo que cambia (nuevo) y lo mismo con lo que había, la cuenta para reconocerla, la fila y la nota", () => {
    const c = cuerpoDeEdicion(cliente, { phone: "956-555-0199", terms: null, store: "MCA", credit_limit: undefined }, "  cambió de número  ");
    expect(c).toEqual({ kind: "edicion", customer_id: 7, stores: ["PHR"], payload: { phone: "956-555-0199", terms: null }, before: { account: "Acme", phone: "956-555-0100", terms: "Net 30" }, note: "cambió de número" });
    expect(cuerpoDeEdicion(cliente, { phone: "1" }, "   ").note).toBeNull();
  });
  it("los cambios salen con etiqueta, antes → después, en el orden de la ficha; contactos y redes en una línea", () => {
    const s = solicitudDeLaBase({ id: 1, kind: "edicion", customer_id: 7, requested_by: "u", stores: ["PHR"], status: "pending", created_at: "2026-10-30T10:00:00Z",
      payload: { terms: "Net 15", contacts: [{ name: "Ana", title: "Owner", phones: ["956-555-0100"], emails: [] }], socials: { facebook: "acme" }, address: "1 Main" },
      before: { account: "Acme", terms: "Net 30", contacts: [], socials: {}, address: null } });
    expect(s.kind).toBe("edicion");
    expect(s.customer_id).toBe(7);
    const c = cambiosDeSolicitud(s);
    expect(c.map((x) => x.key)).toEqual(["address", "terms", "contacts", "socials"]);
    expect(c[1]).toEqual({ key: "terms", en: "Terms", es: "Términos", antes: "Net 30", despues: "Net 15" });
    expect(c[2].despues).toBe("Ana · Owner · 956-555-0100");
    expect(c[2].antes).toBe("—");
    expect(c[3].despues).toBe("facebook: acme");
    expect(c[0].antes).toBe("—");
    expect(textoDeValor(1500)).toBe("1500");
    expect(mensajeDeEdicionPendiente({ id: 1, payload: s.payload, before: s.before, note: "la pidió el cliente" }, "es")).toContain("Términos: Net 30 → Net 15");
    expect(mensajeDeEdicionPendiente({ id: 1, payload: s.payload, before: s.before, note: "la pidió el cliente" }, "es")).toContain("Nota: la pidió el cliente");
  });
  it("una fila de alta de la base (sin la 221) se lee como alta", () => {
    const s = solicitudDeLaBase({ id: 2, requested_by: "u", stores: ["PHR"], payload: { account: "Acme" }, status: "pending", created_at: "" });
    expect(s).toMatchObject({ kind: "alta", customer_id: null, before: null, note: null });
  });
});

describe("el historial", () => {
  it("una fila de la base, saneada; una clase desconocida se lee como edit; al crear se listan los campos con valor", () => {
    const h = historialDeLaBase({ id: 5, customer_id: 7, at: "2026-10-30T10:00:00Z", by: "u", kind: "raro", before: { terms: "a" }, after: { terms: "b" }, note: "", request_id: 3, requested_by: null, decision_note: "ok" });
    expect(h).toMatchObject({ id: 5, customer_id: 7, kind: "edit", before: { terms: "a" }, after: { terms: "b" }, note: null, request_id: 3, requested_by: null, decision_note: "ok", by_name: null });
    expect(cambiosDelHistorial(h)).toEqual([{ key: "terms", en: "Terms", es: "Términos", antes: "a", despues: "b" }]);
    const c = historialDeLaBase({ id: 6, customer_id: 7, at: "", kind: "create", after: { id: 7, account: "Acme", phone: null, contacts: [], socials: {}, terms: "Net 30" } });
    expect(cambiosDelHistorial(c).map((x) => [x.key, x.despues])).toEqual([["account", "Acme"], ["terms", "Net 30"]]);
  });
  it("en el demo: pedir una edición no toca la fila; aprobarla la aplica y deja 'approved' con la solicitud y las notas; rechazarla deja 'rejected'", async () => {
    const a = almacenDemoNuevo();
    const lista = await a.leer();
    const cliente = lista.ok ? lista.valor[0] : null;
    expect(cliente).not.toBeNull();
    if (!cliente) return;
    const s = await a.solicitarEdicion(cliente, { terms: "Net 45" }, "el cliente pidió más plazo");
    expect(s.ok && s.valor).toMatchObject({ kind: "edicion", customer_id: cliente.id, payload: { terms: "Net 45" }, note: "el cliente pidió más plazo", status: "pending" });
    const sinTocar = await a.leer();
    expect(sinTocar.ok && sinTocar.valor.find((c) => c.id === cliente.id)?.terms).toBe(cliente.terms);
    const ok = await a.aprobarEdicion(s.ok ? s.valor.id : -1, "aprobado");
    expect(ok.ok).toBe(true);
    const despues = await a.leer();
    expect(despues.ok && despues.valor.find((c) => c.id === cliente.id)?.terms).toBe("Net 45");
    const h = await a.historial(cliente.id);
    expect(h.ok && h.valor[0]).toMatchObject({ kind: "approved", before: { terms: cliente.terms ?? null }, after: { terms: "Net 45" }, note: "el cliente pidió más plazo", decision_note: "aprobado", request_id: s.ok ? s.valor.id : -1 });
    expect((await a.aprobarEdicion(s.ok ? s.valor.id : -1, "")).ok).toBe(false);
    const s2 = await a.solicitarEdicion(cliente, { terms: "Net 60" }, "");
    expect((await a.rechazarSolicitud(s2.ok ? s2.valor.id : -1, "no")).ok).toBe(true);
    const h2 = await a.historial(cliente.id);
    expect(h2.ok && h2.valor[0]).toMatchObject({ kind: "rejected", after: { terms: "Net 60" }, decision_note: "no" });
    // Una edición directa (el admin) también deja su fila, con el diff de columnas.
    await a.guardar(cliente.id, { terms: "Net 10" });
    const h3 = await a.historial(cliente.id);
    expect(h3.ok && h3.valor[0]).toMatchObject({ kind: "edit", before: { terms: "Net 45" }, after: { terms: "Net 10" } });
    const todas = await a.solicitudes();
    expect(todas.ok && todas.valor.map((x) => x.status)).toEqual(["rejected", "approved"]);
  });
});

describe("la 221", () => {
  const sql = leer("supabase/migrations/221_clientes_edicion_como_solicitud.sql");
  it("solicitud con clase, fila, antes y nota; historial con RLS y sin escritura por la tabla; UPDATE solo del admin; aprobar edición y rechazar con historial", () => {
    expect(sql).toContain("add column if not exists kind text not null default 'alta'");
    expect(sql).toContain("check (kind in ('alta', 'edicion'))");
    expect(sql).toContain("create table if not exists erp.customer_history (");
    expect(sql).toContain("grant select on erp.customer_history to authenticated;");
    expect(sql).toContain("create trigger customers_zz_historial after insert or update on erp.customers");
    expect(sql).toContain('drop policy if exists "customers update (writers)" on erp.customers;');
    expect(sql).toContain('create policy "customers update (admin)" on erp.customers as permissive for update to authenticated');
    expect(sql).toContain("create or replace function erp.aprueba_edicion_de_cliente(p_id bigint, p_nota text default null)");
    expect(sql).toContain("perform set_config('rtg.solicitud', p_id::text, true);");
    expect(sql).toContain("if s.kind = 'edicion' and s.customer_id is not null then");
    expect(sql).toContain("coalesce(r.contacts, '[]'::jsonb)");
    expect(sql).not.toMatch(/^\s*(begin|commit);/m);
    expect(sql).not.toContain("'PENDIENTE'");
  });
});

describe("las pantallas", () => {
  const lista = sinComentarios(leer("src/app/customers/Clientes.tsx"));
  const ficha = sinComentarios(leer("src/app/customers/FichaDeCliente.tsx"));
  const pagina = sinComentarios(leer("src/app/customers/page.tsx"));
  const ventana = sinComentarios(leer("src/app/customers/SolicitudesDeCliente.tsx"));
  it("la página dice quién solicita; la lista lo pasa a la ficha y abre «Solicitudes» también para quien pide ediciones", () => {
    expect(pagina).toContain("edicionComoSolicitud={edicionEsSolicitud(role)}");
    expect(lista).toContain("edicionComoSolicitud={edicionComoSolicitud}");
    expect(lista).toContain("{(esAdmin || altaComoSolicitud || edicionComoSolicitud) && (");
    expect(lista).toContain("if (!esAdmin && !altaComoSolicitud && !edicionComoSolicitud) return;");
  });
  it("en la ficha: «Solicitar edición», la nota del porqué, «Enviar solicitud» en vez de guardar, aviso al admin, y el historial plegado (no para el vendedor)", () => {
    expect(ficha).toContain('edicionComoSolicitud && !nuevo ? t("Request edit", "Solicitar edición") : t("Edit", "Editar")');
    expect(ficha).toContain("if (edicionComoSolicitud) { await solicitarLaEdicion(); return; }");
    expect(ficha).toContain("almacen.solicitarEdicion(cliente, parche, notaDeEdicion)");
    expect(ficha).toContain("mensajeDeEdicionPendiente(r.valor, lang)");
    expect(ficha).toContain("data-nota-de-edicion");
    expect(ficha).toContain('edicionComoSolicitud ? t("Send request", "Enviar solicitud") : t("Save", "Guardar")');
    expect(ficha).toContain("{cliente && !editando && !esVendedor && <HistorialDelCliente clienteId={cliente.id} almacen={almacen} t={t} />}");
    expect(ficha.indexOf("if (edicionComoSolicitud) { await solicitarLaEdicion(); return; }")).toBeLessThan(ficha.indexOf("almacen.guardar(cliente.id, parche)"));
  });
  it("la ventana de solicitudes pinta cada cambio antes → después, la nota, y aprueba la edición con su función", () => {
    expect(ventana).toContain("data-cambios-pedidos");
    expect(ventana).toContain("almacen.aprobarEdicion(s.id, notas[s.id] ?? \"\")");
    expect(ventana).toContain("data-nota-de-decision={s.id}");
    expect(ventana).toContain('{edicion && s.note && <div className="mt-0.5 text-xs text-slate-600">📝 {t("Why", "Por qué")}: {s.note}</div>}');
  });
  it("la función nueva está clasificada como de las que escriben (modo enseñanza)", () => {
    expect(leer("src/lib/ensenanza-general.ts")).toContain('"aprueba_edicion_de_cliente"');
  });
});
