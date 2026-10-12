import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  BLOQUEOS_DE_DESHACER, ETAPAS_QUE_SE_RECOGEN_SIN_LISTO, KIND_RECOGIDA_SIN_LISTO, MINIMO_NOTA_SIN_LISTO, avisosDeRecogidaSinListo,
  deshacerRecogida, entregaConCamara, escrituraDeshacerRecogida, esRecogidaSinListo, mensajeDelGuard, notaDeRecogidaSinListo,
  notaSinListoValida, puedeRecogerSinListo,
} from "@/lib/recogida-del-chofer";
import { autoresDeFotos, fotosAlEntregar } from "@/lib/fotos-de-entrega";
import { canTransition } from "@/lib/constants";
import { useCamaraDeEntrega } from "@/components/CamaraDeEntrega";

// ============================================================
// D-527 (2026-10-11) · La recogida del chofer: recoger aunque no esté lista (con nota y aviso), deshacer «Recogido», y la
// cámara de «Entregado». Las reglas puras, la migración 168 contra la 157, y que el proveedor y la ficha las usan.
// El dueño, literal: «have the driver be able to override a pickup even if the warheouse doesnt have it ready just put a
// note down for it» · «the driver can undo an arrive or a pickup» · «when you pres deliverd it should open the camera so
// you can add the proof of delikvery for the driver».
// ============================================================

const leer = (r: string) => readFileSync(join(process.cwd(), r), "utf8").split("\r\n").join("\n");
const t = (en: string) => en;
const CHOFER = { id: "u-diego", role: "driver", full_name: "Diego Driver" };

describe("recoger aunque no esté lista: quién y cuándo (espejo de la 168)", () => {
  it("el chofer, en SU orden aprobada o preparándose", () => {
    expect(ETAPAS_QUE_SE_RECOGEN_SIN_LISTO).toEqual(["approved", "fulfilling"]);
    expect(puedeRecogerSinListo(CHOFER, { stage: "approved", assigned_driver: "Diego Driver" })).toBe(true);
    expect(puedeRecogerSinListo(CHOFER, { stage: "fulfilling", assigned_driver: "Diego Driver" })).toBe(true);
  });
  it("no en la de otro, ni en una sin chofer, ni sin aprobar, ni lista, ni para otro rol", () => {
    expect(puedeRecogerSinListo(CHOFER, { stage: "approved", assigned_driver: "Otro" })).toBe(false);
    expect(puedeRecogerSinListo(CHOFER, { stage: "approved", assigned_driver: null })).toBe(false);
    for (const stage of ["draft", "pending", "rejected", "ready", "picked_up", "delivered", "canceled"]) {
      expect(puedeRecogerSinListo(CHOFER, { stage, assigned_driver: "Diego Driver" }), stage).toBe(false);
    }
    for (const role of ["admin", "manager", "warehouse", "logistics", "accounting", "sales"]) {
      expect(puedeRecogerSinListo({ ...CHOFER, role }, { stage: "approved", assigned_driver: "Diego Driver" }), role).toBe(false);
    }
    expect(puedeRecogerSinListo({ ...CHOFER, full_name: "" }, { stage: "approved", assigned_driver: "" })).toBe(false);
    expect(puedeRecogerSinListo(null, { stage: "approved", assigned_driver: "Diego Driver" })).toBe(false);
  });
  it("los dos proveedores ya no lo paran antes de escribir (lo decide el guard)", () => {
    expect(canTransition("approved", "picked_up")).toBe(true);
    expect(canTransition("fulfilling", "picked_up")).toBe(true);
    // Lo de siempre no cambia.
    expect(canTransition("pending", "picked_up")).toBe(false);
    expect(canTransition("approved", "ready")).toBe(false);
  });
});

describe("la nota: obligatoria, y en el evento", () => {
  it("tres letras como mínimo, sin espacios de sobra", () => {
    expect(MINIMO_NOTA_SIN_LISTO).toBe(3);
    expect(notaSinListoValida("")).toBeNull();
    expect(notaSinListoValida("  ab ")).toBeNull();
    expect(notaSinListoValida(null)).toBeNull();
    expect(notaSinListoValida("  faltan   2 cajas ")).toBe("faltan 2 cajas");
  });
  it("la nota del evento lleva el prefijo, la nota y lo cargado; y se reconoce en los dos idiomas", () => {
    const es = notaDeRecogidaSinListo("faltan 2 cajas", "Cargadas: 4 pallets", "es");
    expect(es).toBe("Recogida sin estar lista: faltan 2 cajas · Cargadas: 4 pallets");
    const en = notaDeRecogidaSinListo("2 boxes missing", "Loaded: 4 pallets", "en");
    expect(en).toBe("Picked up before it was ready: 2 boxes missing · Loaded: 4 pallets");
    expect(esRecogidaSinListo(es)).toBe(true);
    expect(esRecogidaSinListo(en)).toBe(true);
    expect(esRecogidaSinListo("Loaded: 4 pallets")).toBe(false);
    expect(esRecogidaSinListo(null)).toBe(false);
  });
});

describe("el aviso en la app: almacén de esa tienda (o su grupo) y logística, nunca quien lo hizo", () => {
  const tiendas = [{ name: "McAllen", address: "", group: "valle" }, { name: "Pharr", address: "", group: "valle" }, { name: "Mission", address: "" }];
  const users = [
    { id: "u-log", role: "logistics", store: null },
    { id: "u-wh-mca", role: "warehouse", store: "McAllen" },
    { id: "u-wh-pharr", role: "warehouse", store: "Pharr" },      // mismo grupo que McAllen
    { id: "u-wh-mission", role: "warehouse", store: "Mission" },
    { id: "u-wh-sin", role: "warehouse", store: null },
    { id: "u-admin", role: "admin", store: null },
    { id: "u-diego", role: "driver", store: null },
    { id: "u-log-yo", role: "logistics", store: null },
  ];
  it("a quién", () => {
    const s = avisosDeRecogidaSinListo({
      users, actorId: "u-log-yo", pedido: { id: "d1", order_no: 7, store: "McAllen", pickup_name: "RDZ McAllen Warehouse" },
      tiendas, etiqueta: "#7", nota: "faltan 2 cajas", chofer: "Diego Driver",
    });
    expect(s.map((x) => x.user_id)).toEqual(["u-log", "u-wh-mca", "u-wh-pharr"]);
    expect(s[0]).toEqual({
      user_id: "u-log", delivery_id: "d1", order_no: 7, kind: KIND_RECOGIDA_SIN_LISTO,
      message: "Order #7 was picked up before it was marked ready (Diego Driver) at RDZ McAllen Warehouse: faltan 2 cajas",
    });
  });
  it("la tienda se mira en `pickup_name` también (una Intertienda que se recoge en otra tienda)", () => {
    const s = avisosDeRecogidaSinListo({ users, actorId: "u-diego", pedido: { id: "d1", order_no: 7, store: "Edinburg", pickup_name: "Mission" }, tiendas, etiqueta: "#7", nota: "x y z", chofer: null });
    expect(s.map((x) => x.user_id)).toEqual(["u-log", "u-wh-mission", "u-log-yo"]);
  });
});

describe("el error del guard sin la 168, dicho para el chofer", () => {
  it("el de recoger sin estar lista se traduce; cualquier otro, no", () => {
    expect(mensajeDelGuard("driver cannot move an order from approved to picked_up", "es")).toBe("Aún no disponible: falta una actualización del sistema — avisa a la oficina");
    expect(mensajeDelGuard("driver cannot move an order from fulfilling to picked_up", "en")).toBe("Not available yet: the system is missing an update — tell the office");
    expect(mensajeDelGuard("driver cannot move an order from ready to delivered", "es")).toBeNull();
    expect(mensajeDelGuard("You cannot edit an order in the picked_up stage", "es")).toBeNull();
    expect(mensajeDelGuard(null, "es")).toBeNull();
  });
  it("el proveedor lo usa al escribir la etapa y al vaciar la cola sin red", () => {
    const p = leer("src/lib/data-provider.tsx");
    expect(p).toContain("notify(mensajeDelGuard(error.message, lang) ?? error.message);");
    expect(p).toContain("`No se pudo enviar un cambio: ${mensajeDelGuard(error.message, lang) ?? error.message}`");
  });
});

describe("deshacer «Recogido»", () => {
  const pedido = { id: "d1", stage: "picked_up", assigned_driver: "Diego Driver" };
  const ev = (over: Partial<{ kind: string; note: string | null; created_by: string | null; created_at: string; delivery_id: string }>) => ({
    delivery_id: "d1", kind: "picked_up", note: "Loaded: 4 pallets", created_by: "u-diego", created_at: "2026-10-11T15:00:00Z", ...over,
  });
  it("su recogida, normal: se puede", () => {
    expect(deshacerRecogida({ pedido, yo: CHOFER, eventos: [ev({})] })).toEqual({ bloqueo: null });
  });
  it("no se ofrece: otro rol, otra orden, no está en el camión, rechazada por el cliente", () => {
    expect(deshacerRecogida({ pedido, yo: { ...CHOFER, role: "warehouse" }, eventos: [ev({})] })).toBeNull();
    expect(deshacerRecogida({ pedido: { ...pedido, assigned_driver: "Otro" }, yo: CHOFER, eventos: [ev({})] })).toBeNull();
    expect(deshacerRecogida({ pedido: { ...pedido, stage: "delivered" }, yo: CHOFER, eventos: [ev({})] })).toBeNull();
    expect(deshacerRecogida({ pedido: { ...pedido, stage: "ready" }, yo: CHOFER, eventos: [ev({})] })).toBeNull();
    expect(deshacerRecogida({ pedido, yo: CHOFER, eventos: [ev({})], rechazada: true })).toBeNull();
    expect(deshacerRecogida({ pedido, yo: null, eventos: [ev({})] })).toBeNull();
  });
  it("apagado, con a quién pedírselo: sin la recogida en el historial, de otra persona, carga partida, sin estar lista", () => {
    expect(deshacerRecogida({ pedido, yo: CHOFER, eventos: [] })).toEqual({ bloqueo: BLOQUEOS_DE_DESHACER.sinEvento });
    expect(deshacerRecogida({ pedido, yo: CHOFER, eventos: [ev({ delivery_id: "otra" })] })).toEqual({ bloqueo: BLOQUEOS_DE_DESHACER.sinEvento });
    expect(deshacerRecogida({ pedido, yo: CHOFER, eventos: [ev({ created_by: "u-oficina" })] })).toEqual({ bloqueo: BLOQUEOS_DE_DESHACER.deOtro });
    expect(deshacerRecogida({ pedido, yo: CHOFER, eventos: [ev({ note: "Carga parcial: 4 de 10 pallets — resto dividido a #12b" })] })).toEqual({ bloqueo: BLOQUEOS_DE_DESHACER.partida });
    expect(deshacerRecogida({ pedido, yo: CHOFER, eventos: [ev({ note: "Partial load: 4 of 10 pallets — remainder split to #12b" })] })).toEqual({ bloqueo: BLOQUEOS_DE_DESHACER.partida });
    expect(deshacerRecogida({ pedido, yo: CHOFER, eventos: [ev({ note: "Recogida sin estar lista: faltan cajas · Cargadas: 4 pallets" })] })).toEqual({ bloqueo: BLOQUEOS_DE_DESHACER.sinListo });
    for (const b of Object.values(BLOQUEOS_DE_DESHACER)) expect(b.es).toMatch(/oficina/);
  });
  it("manda la ÚLTIMA recogida (por hora, no por orden en la lista)", () => {
    const vieja = ev({ created_by: "u-oficina", created_at: "2026-10-10T15:00:00Z" });
    const nueva = ev({ created_at: "2026-10-11T15:00:00Z" });
    expect(deshacerRecogida({ pedido, yo: CHOFER, eventos: [vieja, nueva] })).toEqual({ bloqueo: null });
    expect(deshacerRecogida({ pedido, yo: CHOFER, eventos: [nueva, { ...vieja, created_at: "2026-10-12T15:00:00Z" }] })).toEqual({ bloqueo: BLOQUEOS_DE_DESHACER.deOtro });
  });
  it("lo que escribe: borra los tres sellos de la recogida (como «Dejar en tienda») y deja una nota", () => {
    const e = escrituraDeshacerRecogida(t);
    expect(e.patch).toEqual({ pickup_lat: null, pickup_lng: null, pickup_gps_at: null });
    expect(e.note).toBe("Pickup undone by the driver — back to ready at the store");
  });
});

describe("la cámara de «Entregado»", () => {
  it("solo para el chofer", () => {
    expect(entregaConCamara("driver")).toBe(true);
    for (const r of ["admin", "manager", "warehouse", "logistics", "accounting", "sales", null]) expect(entregaConCamara(r), String(r)).toBe(false);
  });
  it("el `<input>` de la cámara: foto, cámara trasera, escondido; `abrir` lo pulsa sin nada asíncrono antes", () => {
    function Prueba() { const c = useCamaraDeEntrega(() => {}); return c.input; }
    expect(renderToStaticMarkup(createElement(Prueba))).toBe('<input type="file" accept="image/*" capture="environment" hidden="" data-camara-de-entrega=""/>');
    const src = leer("src/components/CamaraDeEntrega.tsx");
    const abrir = src.slice(src.indexOf("const abrir = () => {"), src.indexOf("const alElegir"));
    expect(abrir).toContain("input.click();");
    expect(abrir).not.toMatch(/async|await|setTimeout|then\(/);
    // La misma compresión que PhotoUpload (1280 px, JPEG 0,7).
    expect(src).toContain('import { compress } from "@/components/PhotoUpload";');
    expect(src).toContain("fotos.push(await compress(f));");
  });
  it("las fotos tomadas al entregar se suman a las de la orden, sin repetir, y se firman por quien entrega", () => {
    expect(fotosAlEntregar(["a"], ["b", "a", "c"])).toEqual(["a", "b", "c"]);
    expect(fotosAlEntregar(null, ["b"])).toEqual(["b"]);
    expect(autoresDeFotos(["a", "b"], { a: { by: "u-sara", at: "ayer" } }, "u-diego", "hoy")).toEqual({ a: { by: "u-sara", at: "ayer" }, b: { by: "u-diego", at: "hoy" } });
    expect(autoresDeFotos(["b"], { a: { by: "u-sara", at: "ayer" } }, "u-diego", "hoy")).toEqual({ b: { by: "u-diego", at: "hoy" } });
    // Y el proveedor firma con la misma función al subir una foto suelta.
    expect(leer("src/lib/data-provider.tsx")).toContain("patch = { ...patch, photo_meta: autoresDeFotos(patch.photos, before?.photo_meta, me.id, new Date().toISOString()) };");
  });
});

describe("la migración 168 (escrita, NO aplicada: la aplica el orquestador tras el merge)", () => {
  const sql = leer("supabase/migrations/168_chofer_recoge_sin_listo.sql");
  const guard = (texto: string) => {
    const i = texto.indexOf("create or replace function public.guard_delivery_stage()");
    const fin = "end $function$\n;\n";
    return texto.slice(i, texto.indexOf(fin, i) + fin.length);
  };

  it("el guard es el de la 157 letra por letra, con UNA cláusula más: el chofer recoge SU orden en approved/fulfilling", () => {
    const de157 = guard(leer("supabase/migrations/157_partes_de_orden.sql"));
    const de168 = guard(sql);
    expect(de157.length).toBeGreaterThan(10000);
    const l157 = de157.split("\n"), l168 = de168.split("\n");
    // Ninguna línea de la 157 se perdió ni cambió de sitio: quitando las nuevas, queda la 157 exacta.
    expect(l157.filter((l) => !l168.includes(l))).toEqual([]);
    expect(l168.filter((l) => l157.includes(l))).toEqual(l157);
    const nuevas = l168.filter((l) => !l157.includes(l)).map((l) => l.trim());
    expect(nuevas.filter((l) => !l.startsWith("--"))).toEqual([
      "or (r = 'driver' and old_stage in ('approved','fulfilling') and new_stage = 'picked_up'",
      "and OLD.assigned_driver = (select p.full_name from public.profiles p where p.id = auth.uid()))",
    ]);
    expect(nuevas.filter((l) => l.startsWith("--")).every((l) => l.startsWith("-- 168") || !l.includes("157"))).toBe(true);
    // Va dentro de la rama de ventas/chofer/gerente/office, antes de `picked_up -> ready` del chofer.
    const i = de168.indexOf("old_stage in ('approved','fulfilling') and new_stage = 'picked_up'");
    expect(i).toBeGreaterThan(de168.indexOf("if r in ('sales','driver','manager','accounting') then"));
    expect(i).toBeLessThan(de168.indexOf("or (r = 'driver' and old_stage = 'picked_up' and new_stage = 'ready') then"));
    expect(i).toBeGreaterThan(de168.indexOf("or (r = 'driver' and old_stage = 'picked_up' and new_stage = 'delivered')"));
  });
  it("compara el NOMBRE del chofer (texto), no `auth.uid()` a pelo: `assigned_driver` es text y `text = uuid` reventaría toda la rama", () => {
    const codigo = guard(sql).split("\n").filter((l) => !l.trim().startsWith("--")).join("\n");
    expect(codigo).not.toMatch(/assigned_driver\s*=\s*auth\.uid\(\)/);
    expect(codigo).toContain("OLD.assigned_driver = (select p.full_name from public.profiles p where p.id = auth.uid())");
    // Y la columna sigue siendo texto (lo comprueban la 128 y la 133).
    expect(leer("supabase/migrations/128_driver_settings.sql")).toContain("raise exception '128: deliveries.assigned_driver ya no es text';");
  });
  it("nada más: ni tabla, ni columna, ni política, ni dato; sin begin/commit; con autocomprobación, reversión y su fila", () => {
    const codigo = sql.split("\n").filter((l) => !l.trim().startsWith("--")).join("\n");
    expect(codigo).not.toMatch(/create table|alter table|add column|drop column|create policy|drop policy|alter policy|create trigger|insert into public\.deliveries|update public\.deliveries|delete from public\.deliveries/i);
    expect(codigo).not.toMatch(/(^|;)\s*(begin|commit|rollback)\s*;/im);
    expect((codigo.match(/create or replace function/g) ?? []).length).toBe(1);
    expect(codigo).toContain("raise exception '168: el guard no deja al chofer recoger su orden sin estar lista';");
    expect(sql).toContain("--   1. Volver a aplicar SOLO el bloque `create or replace function public.guard_delivery_stage() ... end");
    // Sin el número de SU decisión (numerarla al fusionar cambiaría el cuerpo y su checksum, D-512); citar otras sí.
    expect(sql).not.toContain("D-" + "NEXT");
    const [cuerpo, registro] = sql.split("-- @ledger-below");
    const sha = createHash("sha256").update(cuerpo, "utf8").digest("hex");
    expect(registro.trim()).toBe(`insert into public.schema_migrations (name, checksum) values ('168_chofer_recoge_sin_listo.sql', '${sha}') on conflict (name) do nothing;`);
  });
});
