import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import {
  abiertaDe, abiertasEnOrden, choferInicial, destinoDelAvisoDeSolicitud, ETAPAS_QUE_SE_PIDEN, esRolQuePide,
  fechaPropuestaDeSolicitud, motivoValido, notaAlAprobar, pasosAlAprobar, puedeDecidirSolicitudes, puedePedirAsignacion,
  ROLES_QUE_DECIDEN, ROLES_QUE_PIDEN, solicitudValida, tablaAusente, ultimaDe, type SolicitudDeAsignacion,
} from "./solicitud-de-asignacion";
import { MINIMO_NOTA_REPROGRAMAR } from "./reprogramar-orden";

// D-NEXT. El dueño, 2026-10-15: «vamos a hacer un assign order request para employees y office que van or ejemplo sale una
// orden para manna pero el driver tiene spacio hoy ellos pueden pedir que sa orden se asgine para hoy hadciendo un
// reschedue y un assgin request». Ventas, Office y gerente piden; logística y admin deciden en el Gestor.

const lee = (p: string) => readFileSync(p, "utf8").split("\r\n").join("\n");
const FICHERO_SQL = "supabase/migrations/176_solicitudes_de_asignacion.sql";
const sql = lee(FICHERO_SQL);
const plano = sql.replace(/\s+/g, " ");

const HOY = "2026-10-15";
const sol = (p: Partial<SolicitudDeAsignacion>): SolicitudDeAsignacion => ({
  id: "s1", delivery_id: "o1", requested_by: "u1", requested_date: HOY, from_date: "2026-10-16", suggested_driver: null,
  note: null, status: "open", decided_by: null, decided_at: null, decision_note: null, assigned_driver: null,
  created_at: "2026-10-15T10:00:00Z", ...p,
});

describe("quién pide y quién decide", () => {
  const ROLES = ["admin", "manager", "sales", "warehouse", "driver", "logistics", "accounting"];
  it("piden ventas (solo la suya), Office y gerente; en las etapas abiertas", () => {
    expect(puedePedirAsignacion("sales", "approved", true)).toBe(true);
    expect(puedePedirAsignacion("sales", "approved", false)).toBe(false);
    expect(puedePedirAsignacion("accounting", "ready", false)).toBe(true);
    expect(puedePedirAsignacion("manager", "pending", false)).toBe(true);
    for (const rol of ["admin", "logistics", "warehouse", "driver"]) expect(puedePedirAsignacion(rol, "approved", true)).toBe(false);
  });
  it("ni recogida, ni entregada, ni anulada, ni rechazada", () => {
    for (const etapa of ["picked_up", "delivered", "canceled", "rejected", "", null]) {
      expect(puedePedirAsignacion("accounting", etapa, true)).toBe(false);
    }
    for (const etapa of ["draft", "pending", "approved", "fulfilling", "ready"]) expect(puedePedirAsignacion("accounting", etapa, true)).toBe(true);
  });
  it("deciden logística y admin, nadie más", () => {
    expect(ROLES.filter(puedeDecidirSolicitudes).sort()).toEqual(["admin", "logistics"]);
    expect(ROLES.filter(esRolQuePide).sort()).toEqual(["accounting", "manager", "sales"]);
  });
  it("la base tiene las MISMAS listas (más el admin al pedir, para «ver como»)", () => {
    const lista = (xs: readonly string[]) => xs.map((x) => `'${x}'`).join(", ");
    expect(plano).toContain(`if not coalesce(r in (${lista([...ROLES_QUE_PIDEN, "admin"])}), false) then raise exception 'SOLICITUD_NO_PERMITIDA: % cannot request an assignment'`);
    expect(plano).toContain(`with check (requested_by = (select auth.uid()) and (select public.current_user_role()) in (${lista([...ROLES_QUE_PIDEN, "admin"])}));`);
    expect(plano).toContain(`elsif NEW.status in ('approved', 'rejected') then if not coalesce(r in (${lista(ROLES_QUE_DECIDEN)}), false) then`);
    expect(plano).toContain(`using (requested_by = (select auth.uid()) or (select public.current_user_role()) in (${lista(ROLES_QUE_DECIDEN)}));`);
    expect(plano).toContain(`if o.stage not in (${lista(ETAPAS_QUE_SE_PIDEN)}) then`);
    expect(plano).toContain(`where p.role in (${lista(ROLES_QUE_DECIDEN)})`);
  });
});

describe("qué se puede pedir", () => {
  it("hoy o después, y no la fecha que ya tiene", () => {
    expect(solicitudValida(HOY, "2026-10-16", HOY)).toBe(true);
    expect(solicitudValida("2026-10-14", "2026-10-16", HOY)).toBe(false);
    expect(solicitudValida("2026-10-16", "2026-10-16", HOY)).toBe(false);
    expect(solicitudValida("2026-10-17", "2026-10-16T00:00:00", HOY)).toBe(true);
    expect(solicitudValida(HOY, null, HOY)).toBe(true);
    expect(solicitudValida("", "2026-10-16", HOY)).toBe(false);
  });
  it("propone hoy; si la orden ya es de hoy, mañana", () => {
    expect(fechaPropuestaDeSolicitud("2026-10-16", HOY, "2026-10-16")).toBe(HOY);
    expect(fechaPropuestaDeSolicitud(HOY, HOY, "2026-10-16")).toBe("2026-10-16");
    expect(fechaPropuestaDeSolicitud(null, HOY, "2026-10-16")).toBe(HOY);
  });
});

describe("listas", () => {
  const lista = [
    sol({ id: "a", delivery_id: "o1", status: "rejected", created_at: "2026-10-15T09:00:00Z" }),
    sol({ id: "b", delivery_id: "o1", status: "open", created_at: "2026-10-15T11:00:00Z" }),
    sol({ id: "c", delivery_id: "o2", status: "open", created_at: "2026-10-15T08:00:00Z" }),
    sol({ id: "d", delivery_id: "o1", status: "approved", created_at: "2026-10-15T10:00:00Z" }),
  ];
  it("la abierta de una orden, y la última (no la primera de la lista)", () => {
    expect(abiertaDe(lista, "o1")?.id).toBe("b");
    expect(abiertaDe(lista, "o3")).toBeNull();
    expect(ultimaDe(lista, "o1")?.id).toBe("b");
    expect(ultimaDe(lista.filter((s) => s.id !== "b"), "o1")?.id).toBe("d");
  });
  it("la bandeja: solo las abiertas, la más vieja primero", () => {
    expect(abiertasEnOrden(lista).map((s) => s.id)).toEqual(["c", "b"]);
  });
});

describe("sin la 176 no revienta", () => {
  it("la tabla ausente se reconoce por código o por mensaje", () => {
    expect(tablaAusente({ code: "42P01" })).toBe(true);
    expect(tablaAusente({ code: "PGRST205", message: "Could not find the table 'public.assign_requests' in the schema cache" })).toBe(true);
    expect(tablaAusente({ message: "relation \"public.assign_requests\" does not exist" })).toBe(true);
    expect(tablaAusente({ code: "42501", message: "permission denied" })).toBe(false);
    expect(tablaAusente(null)).toBe(false);
  });
  it("el gancho apaga todo si falta la tabla, en el demo y en modo enseñanza", () => {
    const g = lee("src/lib/usa-solicitudes-de-asignacion.ts");
    expect(g).toContain("const apagado = SIN_BASE || teaching || !activo || !me;");
    expect(g).toContain("if (tablaAusente(error)) { setDisponible(false); setLista([]); }");
    // y la ficha y la bandeja no pintan nada sin `disponible === true`
    expect(lee("src/components/PedirAsignacion.tsx")).toContain("if (disponible !== true) return null;");
    expect(lee("src/components/BandejaDeSolicitudes.tsx")).toContain("if (disponible !== true) return null;");
  });
  it("una decisión que la RLS deja en cero filas no cuenta como hecha", () => {
    const g = lee("src/lib/usa-solicitudes-de-asignacion.ts");
    expect(g).toContain('.update(patch).eq("id", id).eq("status", "open").select("id");');
    expect(g).toContain("if (!data || data.length === 0) {");
  });
});

describe("«Aprobar»", () => {
  const orden = { stage: "approved" as const, delivery_date: "2026-10-16" };
  it("reprograma si la fecha cambia, y asigna al elegido", () => {
    expect(pasosAlAprobar({ solicitud: sol({}), orden, chofer: "Max", hoy: HOY })).toEqual({ reprogramar: true, asignar: "Max", error: null });
  });
  it("sin chofer elegido: solo reprograma (queda en «Sin asignar» ese día)", () => {
    expect(pasosAlAprobar({ solicitud: sol({}), orden, chofer: " ", hoy: HOY })).toEqual({ reprogramar: true, asignar: null, error: null });
  });
  it("si ya tiene esa fecha, no reprograma (la función diría «misma fecha»)", () => {
    expect(pasosAlAprobar({ solicitud: sol({}), orden: { ...orden, delivery_date: HOY }, chofer: "Max", hoy: HOY }))
      .toEqual({ reprogramar: false, asignar: "Max", error: null });
  });
  it("no: cerrada, sin orden, etapa que ya salió, día pasado", () => {
    expect(pasosAlAprobar({ solicitud: sol({ status: "canceled" }), orden, chofer: "", hoy: HOY })).toEqual({ error: "cerrada" });
    expect(pasosAlAprobar({ solicitud: sol({}), orden: null, chofer: "", hoy: HOY })).toEqual({ error: "sin-orden" });
    expect(pasosAlAprobar({ solicitud: sol({}), orden: { ...orden, stage: "picked_up" }, chofer: "", hoy: HOY })).toEqual({ error: "etapa" });
    expect(pasosAlAprobar({ solicitud: sol({ requested_date: "2026-10-14" }), orden, chofer: "", hoy: HOY })).toEqual({ error: "fecha-pasada" });
  });
  it("la nota de la reprogramación pasa el mínimo de `reprogramar_orden` aunque no haya nota", () => {
    expect(notaAlAprobar("", null, "es").length).toBeGreaterThanOrEqual(MINIMO_NOTA_REPROGRAMAR);
    expect(notaAlAprobar("Ana", "  cliente  en casa ", "es")).toBe("Solicitud de asignación de Ana: cliente en casa");
    expect(notaAlAprobar("Ana", null, "en")).toBe("Assign request from Ana");
  });
  it("el chofer del cuadro: el sugerido solo si es un chofer de la lista", () => {
    expect(choferInicial("Max", ["Max", "Leo"])).toBe("Max");
    expect(choferInicial("Maxx", ["Max", "Leo"])).toBe("");
    expect(choferInicial(null, ["Max"])).toBe("");
  });
  it("rechazar pide motivo de tres letras", () => {
    expect(motivoValido(" no ")).toBe(false);
    expect(motivoValido("sin espacio")).toBe(true);
  });
});

describe("el Gestor reutiliza, no copia", () => {
  const pagina = lee("src/app/(app)/routes/page.tsx");
  const i = pagina.indexOf("const apruebaSolicitud = async");
  const cuerpo = pagina.slice(i, pagina.indexOf("\n  };\n", i));
  it("existe y pinta la bandeja solo a quien decide y fuera de solo lectura", () => {
    expect(i).toBeGreaterThan(-1);
    expect(pagina).toContain("{!soloLectura && puedeDecidirSolicitudes(me?.role) && (");
    expect(pagina).toContain("aprobar={apruebaSolicitud}");
  });
  it("la fecha por `reprogramarOrden` (D-549) y DESPUÉS el chofer por `manualAssign` (el «Asignar a…»)", () => {
    const r = cuerpo.indexOf("await reprogramarOrden(s.delivery_id, s.requested_date, notaAlAprobar(");
    const a = cuerpo.indexOf("await manualAssign(s.delivery_id, pasos.asignar);");
    expect(r).toBeGreaterThan(-1);
    expect(a).toBeGreaterThan(-1);
    expect(r).toBeLessThan(a);
    expect(cuerpo).not.toContain("updateDelivery(");
    expect(cuerpo).not.toContain("supabase");
  });
  it("si reprogramar falla, no asigna", () => {
    expect(cuerpo).toMatch(/const ok = await reprogramarOrden\([^\n]*\n\s*if \(!ok\) return false;/);
  });
  it("`manualAssign` devuelve la escritura para poder esperarla", () => {
    expect(pagina).toContain("const hecho = assignTo(id, driver);");
    expect(pagina).toContain("    return hecho;\n  };");
  });
  it("la bandeja marca la solicitud SOLO si la orden quedó como se pidió", () => {
    const b = lee("src/components/BandejaDeSolicitudes.tsx");
    expect(b).toContain('if (await aprobar(s, chofer)) await decidir(s.id, { status: "approved", chofer });');
  });
});

describe("la ficha y la campana", () => {
  it("la ficha monta «Pedir para hoy» con la dueñez de D-544 (`esMia`)", () => {
    const f = lee("src/components/OrderModal.tsx");
    expect(f).toContain("<PedirAsignacion pedido={existing} me={me} esSuya={esMia(existing, me)}");
    expect(f).toContain("{!editing && existing && (esRolQuePide(me.role) || puedeDecidirSolicitudes(me.role)) && (");
    const p = lee("src/components/PedirAsignacion.tsx");
    expect(p).toContain("const puede = puedePedirAsignacion(me.role, pedido.stage, esSuya);");
    expect(p).toContain("{puede && !abierta && (");
    expect(p).toContain("min={hoy}");
  });
  it("el aviso nuevo lleva a la bandeja; el decidido, a la orden", () => {
    expect(destinoDelAvisoDeSolicitud("assign_request", "o1")).toBe("/routes?solicitudes=1");
    expect(destinoDelAvisoDeSolicitud("assign_request_approved", "o1")).toBe("/?order=o1");
    expect(destinoDelAvisoDeSolicitud("assign_request_rejected", "o1")).toBe("/?order=o1");
    expect(destinoDelAvisoDeSolicitud("approved", "o1")).toBeNull();
    expect(lee("src/components/NotificationBell.tsx")).toContain("else if (solicitud) router.push(solicitud);");
  });
});

describe("176 · la migración", () => {
  it("sin transacción propia, con su registro y el checksum que da `--sum`, y sin D-NEXT dentro", async () => {
    const ledger = await import(pathToFileURL(join(process.cwd(), "scripts/db/ledger.mjs")).href);
    const crudo = readFileSync(FICHERO_SQL, "utf8");
    expect(ledger.llevaTransaccionPropia(crudo)).toBe(false);
    expect(ledger.shaDeclarado(crudo, "176_solicitudes_de_asignacion.sql")).toBe(ledger.checksum(crudo));
    expect(crudo).not.toContain("D-NEXT");
  });
  it("una sola abierta por orden", () => {
    expect(plano).toContain("create unique index if not exists assign_requests_una_abierta on public.assign_requests (delivery_id) where status = 'open';");
  });
  it("el guard es invoker (la orden con la RLS de quien pide) y los avisos definer; y lo comprueba", () => {
    expect(plano).toContain("create or replace function public.assign_requests_guard() returns trigger language plpgsql security invoker");
    expect(plano).toContain("create or replace function public.assign_requests_avisa() returns trigger language plpgsql security definer");
    expect(plano).toContain("raise exception '176: el guard NO debe ser security definer");
  });
  it("ventas solo la suya, con coalesce (la lección de la 173)", () => {
    expect(plano).toContain("if r = 'sales' and not coalesce(o.created_by = yo or o.assigned_sales_rep = yo, false) then");
  });
  it("no días pasados, no la misma fecha; y quien pide lo pone la base", () => {
    expect(plano).toContain("if NEW.requested_date is null or NEW.requested_date < hoy then");
    expect(plano).toContain("if o.delivery_date is not distinct from NEW.requested_date then");
    expect(plano).toContain("NEW.requested_by := yo; NEW.from_date := o.delivery_date; NEW.status := 'open';");
  });
  it("una decisión es una sola vez; cancelar, solo quien pidió; rechazar, con motivo", () => {
    expect(plano).toContain("if OLD.status <> 'open' then raise exception 'SOLICITUD_CERRADA");
    expect(plano).toContain("if OLD.requested_by is distinct from yo then raise exception 'SOLICITUD_NO_PERMITIDA: only who asked can cancel");
    expect(plano).toContain("raise exception 'SOLICITUD_SIN_MOTIVO");
    expect(plano).toContain("raise exception 'SOLICITUD_INMUTABLE");
  });
  it("sin DELETE: tres políticas y ningún grant de borrar", () => {
    expect(plano).toContain("grant select, insert, update on public.assign_requests to authenticated;");
    expect((sql.match(/^create policy /gm) ?? []).length).toBe(3);
    expect(sql).not.toMatch(/for (delete|all) to/i);
  });
  it("los avisos: la nueva a quien decide (no a quien pidió), la decidida a quien pidió (no si decidió él mismo)", () => {
    expect(plano).toContain("and p.id is distinct from NEW.requested_by;");
    expect(plano).toContain("and NEW.requested_by is distinct from NEW.decided_by then");
    expect(plano).toContain("create trigger assign_requests_avisa after insert or update of status on public.assign_requests");
  });
});
