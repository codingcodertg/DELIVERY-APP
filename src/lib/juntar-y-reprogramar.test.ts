import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import {
  ETAPAS_EN_LAS_QUE_SE_JUNTA, esIntertienda, notaAlJuntar, ofreceJuntar, parcheAlJuntar, puedeJuntarEn, unirPOs,
} from "./juntar-intertienda";
import {
  argumentosDeReprogramar, caminoTrasReprogramar, ETAPAS_QUE_REPROGRAMA_VENTAS, puedeReprogramar,
} from "./reprogramar-orden";
import { esFuncionAusente } from "./cargas-partidas";
import type { Delivery } from "./types";

/**
 * D-549 (2026-10-14). Dos pedidos del dueño:
 *  A) «when intertienda has 2 of the same invoice order ask if you want to create a duplicate or to merge the order» /
 *     «entonces crea el merge option».
 *  B) «reprogamar buttom in ther order view put it the top right hand side insead» / «all sales people well everybody has
 *     the iption to reprogramar».
 */

const leer = (p: string) => readFileSync(p, "utf8").split("\r\n").join("\n");

// Los nombres de los tipos NO deciden: un tipo renombrado con las mismas banderas es Intertienda igual.
const REGLAS = {
  Intertienda: { storeToStore: true, docRef: "po" as const, homeIsDestination: true },
  "Compra a sucursal": { storeToStore: true, docRef: "any" as const, homeIsDestination: true },
  Transfer: { storeToStore: true, docRef: "estimate" as const },
  Customer: { storeToStore: false, docRef: "invoice" as const },
};

const orden = (o: Partial<Delivery>): Delivery => ({
  id: "x", order_no: 1, stage: "pending", order_type: "Intertienda", store: "Pharr", delivery_name: "McAllen",
  invoice_num: "INV-100", invoices_extra: null, po2: "PO-1", est_pallets: 3,
  ...o,
} as unknown as Delivery);

const NUEVA = { order_type: "Intertienda", invoice_num: " #inv-100 ", store: "pharr", delivery_name: "McAllen", po2: "PO-2", est_pallets: 2 };

describe("A · Juntar dos Intertiendas con la misma factura", () => {
  it("es Intertienda por la REGLA (de tienda a tienda y la propia como destino), no por el nombre", () => {
    expect(esIntertienda("Intertienda", REGLAS)).toBe(true);
    expect(esIntertienda("Compra a sucursal", REGLAS)).toBe(true);
    expect(esIntertienda("Transfer", REGLAS)).toBe(false);
    expect(esIntertienda("Customer", REGLAS)).toBe(false);
  });

  it("ofrece juntar con la Intertienda abierta de la misma factura, tienda y destino (factura comparada sin #, espacios ni mayúsculas)", () => {
    const otra = orden({ id: "a" });
    expect(ofreceJuntar(NUEVA, [otra], REGLAS)?.id).toBe("a");
    // También si la factura está entre las agregadas (D-339).
    expect(ofreceJuntar(NUEVA, [orden({ id: "b", invoice_num: "INV-9", invoices_extra: ["INV-100"] })], REGLAS)?.id).toBe("b");
  });

  it("no ofrece juntar: otro tipo, sin factura, otra factura, otra tienda, otro destino", () => {
    const otra = orden({ id: "a" });
    expect(ofreceJuntar({ ...NUEVA, order_type: "Customer" }, [otra], REGLAS)).toBeNull();
    expect(ofreceJuntar({ ...NUEVA, order_type: "Transfer" }, [orden({ id: "t", order_type: "Transfer" })], REGLAS)).toBeNull();
    expect(ofreceJuntar(NUEVA, [orden({ id: "c", order_type: "Customer" })], REGLAS)).toBeNull();
    expect(ofreceJuntar({ ...NUEVA, invoice_num: "  " }, [otra], REGLAS)).toBeNull();
    expect(ofreceJuntar({ ...NUEVA, invoice_num: "INV-101" }, [otra], REGLAS)).toBeNull();
    expect(ofreceJuntar({ ...NUEVA, store: "Weslaco" }, [otra], REGLAS)).toBeNull();
    expect(ofreceJuntar({ ...NUEVA, delivery_name: "Mission" }, [otra], REGLAS)).toBeNull();
    // Sin destino en una de las dos, no se descarta por el destino.
    expect(ofreceJuntar({ ...NUEVA, delivery_name: null }, [otra], REGLAS)?.id).toBe("a");
  });

  it("solo con una orden ABIERTA: ni recogida, ni entregada, ni anulada, ni rechazada", () => {
    expect([...ETAPAS_EN_LAS_QUE_SE_JUNTA]).toEqual(["draft", "pending", "approved", "fulfilling", "ready"]);
    for (const stage of ["picked_up", "delivered", "canceled", "rejected"]) {
      expect([stage, ofreceJuntar(NUEVA, [orden({ id: "a", stage: stage as Delivery["stage"] })], REGLAS)]).toEqual([stage, null]);
    }
    for (const stage of ETAPAS_EN_LAS_QUE_SE_JUNTA) {
      expect([stage, ofreceJuntar(NUEVA, [orden({ id: "a", stage: stage as Delivery["stage"] })], REGLAS)?.id]).toEqual([stage, "a"]);
    }
  });

  it("con varias, la más reciente (order_no más alto), venga en el orden que venga", () => {
    const lista = [orden({ id: "vieja", order_no: 5 }), orden({ id: "nueva", order_no: 9 }), orden({ id: "media", order_no: 7 })];
    expect(ofreceJuntar(NUEVA, lista, REGLAS)?.id).toBe("nueva");
    expect(ofreceJuntar(NUEVA, [...lista].reverse(), REGLAS)?.id).toBe("nueva");
  });

  it("quién puede juntar: el espejo del tramo «misma etapa» del guard (169)", () => {
    const abiertas = ["draft", "pending", "approved", "fulfilling", "ready"];
    for (const etapa of abiertas) {
      for (const rol of ["admin", "manager", "accounting", "logistics"]) expect([rol, etapa, puedeJuntarEn(rol, etapa)]).toEqual([rol, etapa, true]);
      const ventas = etapa === "draft" || etapa === "pending";
      expect(["sales", etapa, puedeJuntarEn("sales", etapa)]).toEqual(["sales", etapa, ventas]);
      expect(["driver", etapa, puedeJuntarEn("driver", etapa)]).toEqual(["driver", etapa, ventas]);
      const almacen = ["approved", "fulfilling", "ready"].includes(etapa);
      expect(["warehouse", etapa, puedeJuntarEn("warehouse", etapa)]).toEqual(["warehouse", etapa, almacen]);
    }
    for (const etapa of ["picked_up", "delivered", "canceled", "rejected", null]) expect(puedeJuntarEn("admin", etapa)).toBe(false);
    expect(puedeJuntarEn(null, "pending")).toBe(false);
    // Lo que el guard dice hoy (lo que sostiene la tabla de arriba).
    const guard = leer("supabase/migrations/169_fotos_del_chofer.sql");
    expect(guard).toContain("if r in ('sales','driver') and old_stage in ('draft','pending','rejected') then return NEW; end if;");
    expect(guard).toContain("if r in ('manager','accounting') then return NEW; end if;");
    expect(guard).toContain("if r = 'warehouse'  and old_stage in ('approved','fulfilling','ready','picked_up','delivered') then return NEW; end if;");
    expect(guard).toContain("if r = 'logistics'  and old_stage in ('draft','pending','approved','fulfilling','ready') then return NEW; end if;");
  });

  it("las PO se juntan con «, » y sin repetir ninguna", () => {
    expect(unirPOs("PO-1", "PO-2")).toBe("PO-1, PO-2");
    expect(unirPOs("PO-1, PO-2", " po-2 ")).toBe("PO-1, PO-2");
    expect(unirPOs("PO-1,PO-2", "PO-3, PO-1")).toBe("PO-1, PO-2, PO-3");
    expect(unirPOs(null, "PO-9")).toBe("PO-9");
    expect(unirPOs("", "  ")).toBeNull();
  });

  it("el parche suma la PO y los pallets a la que existe y recalcula las duraciones; no toca nada más", () => {
    const parche = parcheAlJuntar({ po2: "PO-1", est_pallets: 3 }, { po2: "PO-2", est_pallets: 2 }, { recoger: 4, entregar: 6 });
    expect(parche).toEqual({ po2: "PO-1, PO-2", est_pallets: 5, pickup_duration: "20 min", delivery_duration: "30 min" });
    // Sin pallets en la nueva, los pallets no se tocan; con la misma PO, la PO tampoco.
    expect(parcheAlJuntar({ po2: "PO-1", est_pallets: 3 }, { po2: "po-1", est_pallets: null }, { recoger: 4, entregar: 6 })).toEqual({});
    // Sin pallets en la que existe, cuenta como cero.
    expect(parcheAlJuntar({ po2: null, est_pallets: null }, { po2: "PO-7", est_pallets: 4 }, { recoger: 5, entregar: 5 }))
      .toEqual({ po2: "PO-7", est_pallets: 4, pickup_duration: "20 min", delivery_duration: "20 min" });
  });

  it("la nota del historial dice qué PO, cuántos pallets y por qué", () => {
    expect(notaAlJuntar({ po2: "PO-2", est_pallets: 2, invoice_num: "INV-100" }, "es")).toBe("Se juntó la PO PO-2 (2 pallets) — misma factura #INV-100");
    expect(notaAlJuntar({ po2: null, est_pallets: null, invoice_num: "INV-100" }, "en")).toBe("PO no PO joined (0 pallets) — same invoice #INV-100");
  });

  // Nota D-557 (2026-10-15): «SOLO el botón de crear» deja de valer para la ficha entera: guardar una orden que ya existe y
  // «Agregar material» también preguntan, con otra pregunta (`useJuntarExistente`, que anula una de las dos; pruebas en
  // `juntar-existentes.test.ts`). Lo que sigue fijando esta prueba: `ofreceJuntar` (la de CREAR) solo la llama el botón de crear.
  it("la ficha: la pregunta de CREAR solo en el botón de crear; «Juntar» no crea nada; «Crear duplicada» no repite el aviso de factura", () => {
    const modal = leer("src/components/OrderModal.tsx");
    const crear = modal.slice(modal.indexOf("// Intertienda con la factura de otra Intertienda abierta (D-549)"), modal.indexOf("const row = await addDelivery(payload);", modal.indexOf("// Intertienda con la factura de otra Intertienda abierta (D-549)")));
    expect(crear).toContain("const conQuien = ofreceJuntar(payload, deliveries, settings.order_type_rules);");
    expect(crear).toContain("const respuesta = await preguntarJuntar(conQuien, puedeJuntarEn(me.role, conQuien.stage));");
    expect(crear).toContain('if (respuesta === "cancelar") return;');
    expect(crear).toContain('if (respuesta === "juntar") { if (await juntarCon(conQuien, payload)) onClose(); return; }');
    expect(crear).toContain("if (!(await passesChecks(payload, { facturaYaDecidida: !!conQuien }))) return;");
    expect(modal.split("ofreceJuntar(").length - 1).toBe(1);
    expect(modal).toContain("if (dupInv && !sharedInvoice && !opts.facturaYaDecidida && !(await confirmAction(t(");
    // Juntar escribe en la OTRA orden lo que dice el parche, y la nota en su historial.
    expect(modal).toContain("const parche = parcheAlJuntar(con, nueva, { recoger: settings.pickup_min_per_pallet, entregar: settings.delivery_min_per_pallet });");
    expect(modal).toContain("const ok = Object.keys(parche).length ? await updateDelivery(con.id, parche) : true;");
    expect(modal).toContain("if (ok) await addNote(con.id, notaAlJuntar(nueva, lang));");
    // El botón «Juntar» solo se pinta si el rol puede.
    expect(modal).toContain("{preguntaJuntar.puede && (");
    expect(modal).toContain("{!preguntaJuntar.puede && (");
  });
});

describe("B · «📅 Reprogramar» en la ficha, para todos menos el chofer", () => {
  const ETAPAS = ["draft", "pending", "approved", "fulfilling", "ready", "picked_up", "delivered", "canceled", "rejected"];
  const ROLES = ["admin", "logistics", "manager", "accounting", "warehouse", "sales", "driver"];

  it("ventas: SOLO su orden, de borrador a lista; nunca en camino, entregada, anulada ni rechazada", () => {
    expect([...ETAPAS_QUE_REPROGRAMA_VENTAS]).toEqual(["draft", "pending", "approved", "fulfilling", "ready"]);
    for (const etapa of ETAPAS) {
      const abierta = ETAPAS_QUE_REPROGRAMA_VENTAS.includes(etapa);
      expect(["suya", etapa, puedeReprogramar("sales", etapa, true)]).toEqual(["suya", etapa, abierta]);
      expect(["ajena", etapa, puedeReprogramar("sales", etapa, false)]).toEqual(["ajena", etapa, false]);
    }
  });

  it("el chofer no reprograma, ni su propia orden", () => {
    for (const etapa of ETAPAS) expect([etapa, puedeReprogramar("driver", etapa, true)]).toEqual([etapa, false]);
  });

  it("la función de la base (173) deja EXACTAMENTE lo que deja `puedeReprogramar`, rol por rol y etapa por etapa", () => {
    const sql = leer("supabase/migrations/173_reprogramar_orden.sql");
    const funcion = sql.slice(sql.indexOf("create or replace function public.reprogramar_orden("));
    // Nota D-549: el permiso va en `coalesce(…, false)` (el agujero del NULL, ver el bloque «el permiso no se abre con un NULL»).
    const bloque = funcion.slice(funcion.indexOf("if not coalesce(("), funcion.indexOf("), false) then", funcion.indexOf("if not coalesce((")));
    const clausulas = [...bloque.matchAll(/\(r (?:= '(\w+)'|in \(([^)]*)\)) and o\.stage in \(([^)]*)\)(?=([^\n]*\n?[^\n]*))/g)].map((m) => ({
      roles: m[1] ? [m[1]] : m[2].split(",").map((s) => s.trim().replace(/'/g, "")),
      etapas: m[3].split(",").map((s) => s.trim().replace(/'/g, "")),
      pideSuya: /o\.created_by = yo or o\.assigned_sales_rep = yo/.test(m[4]),
    }));
    expect(clausulas.length).toBe(4);
    const deja = (rol: string, etapa: string, suya: boolean) =>
      clausulas.some((c) => c.roles.includes(rol) && c.etapas.includes(etapa) && (!c.pideSuya || suya));
    for (const rol of ROLES) for (const etapa of ETAPAS) for (const suya of [true, false]) {
      expect([rol, etapa, suya, deja(rol, etapa, suya)]).toEqual([rol, etapa, suya, puedeReprogramar(rol, etapa, suya)]);
    }
  });

  it("la función: invoker, solo `delivery_date`, la marca puesta y quitada alrededor del UPDATE, nota y fecha comprobadas", () => {
    const sql = leer("supabase/migrations/173_reprogramar_orden.sql");
    const f = sql.slice(sql.indexOf("create or replace function public.reprogramar_orden("), sql.indexOf("revoke execute on function public.reprogramar_orden"));
    expect(f).toContain("security invoker");
    expect(f).not.toMatch(/security definer/i);
    const marca = f.indexOf("perform set_config('rtg.reprogramar_orden', p_id::text, true);");
    const update = f.indexOf("update public.deliveries set delivery_date = p_fecha where id = p_id;");
    const quita = f.indexOf("perform set_config('rtg.reprogramar_orden', '', true);");
    expect(marca).toBeGreaterThan(-1);
    expect(update).toBeGreaterThan(marca);
    expect(quita).toBeGreaterThan(update);
    expect(f.split("update public.deliveries").length - 1).toBe(1);
    expect(f).toContain("if p_fecha is null or p_fecha < hoy then");
    expect(f).toContain("hoy    date := (now() at time zone 'America/Chicago')::date;");
    expect(f).toContain("if o.delivery_date is not distinct from p_fecha then");
    expect(f).toContain("if char_length(limpia) < 3 then");
    expect(f).toContain("limpia text := btrim(regexp_replace(coalesce(p_nota, ''), '\\s+', ' ', 'g'));");
    // Las dos notas, como las dejaba la pantalla (`changedFieldsNote` y `notaDeReprogramacion`).
    expect(f).toContain("'Changed: Delivery Date: ' || coalesce(o.delivery_date::text, '—') || ' → ' || p_fecha::text");
    expect(f).toContain("then 'Rescheduled from ' || de || ' to ' || p_fecha::text || ': ' || limpia");
    expect(f).toContain("else 'Reprogramada de ' || de || ' a ' || p_fecha::text || ': ' || limpia end,");
    expect(sql).toContain("revoke execute on function public.reprogramar_orden(uuid, date, text, text) from public, anon;");
    expect(sql).toContain("grant execute on function public.reprogramar_orden(uuid, date, text, text) to authenticated;");
  });

  it("el guard de la 173 es el de la 169 letra por letra MÁS un bloque, y ese bloque solo deja pasar la fecha", () => {
    const fin = "end $function$\n;";
    const guardDe = (txt: string) => {
      const i = txt.indexOf("create or replace function public.guard_delivery_stage()");
      return txt.slice(i, txt.indexOf(fin, i) + fin.length);
    };
    const g169 = guardDe(leer("supabase/migrations/169_fotos_del_chofer.sql"));
    const g173 = guardDe(leer("supabase/migrations/173_reprogramar_orden.sql"));
    const i = g173.indexOf("    -- 173:");
    const j = g173.indexOf("    end if;\n", g173.indexOf("if current_setting('rtg.reprogramar_orden', true) = OLD.id::text then")) + "    end if;\n".length;
    expect(i).toBeGreaterThan(-1);
    const bloque = g173.slice(i, j);
    expect(g173.slice(0, i) + g173.slice(j)).toBe(g169);
    expect(bloque).toContain("      probe := NEW;\n      probe.delivery_date := OLD.delivery_date;\n      probe.updated_at    := OLD.updated_at;\n      if probe is not distinct from OLD then return NEW; end if;");
    // Va en el tramo de misma etapa, antes de que gerente y oficina salgan.
    expect(g173.indexOf("if new_stage is not distinct from old_stage then")).toBeLessThan(i);
    expect(g173.indexOf("    if r in ('manager','accounting') then return NEW; end if;")).toBeGreaterThan(j - 1);
  });

  it("la migración: sin transacción propia, con su registro y el checksum que da `--sum`", async () => {
    const ledger = await import(pathToFileURL(join(process.cwd(), "scripts/db/ledger.mjs")).href);
    const sql = readFileSync("supabase/migrations/173_reprogramar_orden.sql", "utf8");
    expect(ledger.llevaTransaccionPropia(sql)).toBe(false);
    expect(ledger.shaDeclarado(sql, "173_reprogramar_orden.sql")).toBe(ledger.checksum(sql));
    expect(sql).not.toContain("D-549");
  });

  it("qué hace la pantalla con la respuesta: guardada, respaldo (sin la función) o error; «no existe» = `esFuncionAusente`", () => {
    expect(caminoTrasReprogramar(null)).toBe("guardada");
    const casos = [
      { code: "PGRST202", message: "Could not find the function public.reprogramar_orden" },
      { code: "42883", message: "function public.reprogramar_orden(uuid, date, text, text) does not exist" },
      { code: null, message: "Could not find the function public.reprogramar_orden(p_fecha, p_id) in the schema cache" },
      { code: "42501", message: "REPROGRAMAR_NO_PERMITIDO: sales cannot reschedule this order in the picked_up stage" },
      { code: "22023", message: "REPROGRAMAR_SIN_NOTA: write why it is moving" },
      { code: "P0001", message: "You cannot edit an order in the approved stage" },
    ];
    for (const e of casos) expect([e.code, caminoTrasReprogramar(e)]).toEqual([e.code, esFuncionAusente(e) ? "respaldo" : "error"]);
    expect(caminoTrasReprogramar(casos[0])).toBe("respaldo");
    expect(caminoTrasReprogramar(casos[3])).toBe("error");
    expect(argumentosDeReprogramar("id-1", "2026-10-15", " cliente  cerró ", "es"))
      .toEqual({ p_id: "id-1", p_fecha: "2026-10-15", p_nota: " cliente  cerró ", p_lang: "es" });
  });

  it("la ficha lleva «📅 Reprogramar» arriba a la derecha (antes de la ✕), con `puedeReprogramar` y `esMia`", () => {
    const modal = leer("src/components/OrderModal.tsx");
    const boton = modal.indexOf("{!editing && existing && puedeReprogramar(me.role, stage, esMia(existing, me)) && (");
    const cerrar = modal.indexOf('<button className="btn btn-sm" onClick={requestClose} style={{ flex: "0 0 auto" }}>✕</button>');
    expect(boton).toBeGreaterThan(-1);
    expect(cerrar).toBeGreaterThan(boton);
    // En la cabecera: después del título de la orden.
    expect(boton).toBeGreaterThan(modal.indexOf('`${t("Order", "Orden")} #${orderLabel(existing!)}`'));
    expect(modal).toContain("<ReprogramarOrden pedido={existing} rol={me.role} lang={lang} t={t} reprogramarOrden={reprogramarOrden} notify={notify} />");
  });

  it("el cuadro guarda por `reprogramarOrden`, y el proveedor llama a la función con respaldo", () => {
    const cuadro = leer("src/components/ReprogramarOrden.tsx");
    expect(cuadro).toContain("const ok = await reprogramarOrden(pedido.id, fecha, nota, lang, caso);");
    expect(cuadro).not.toContain("updateDelivery(");
    const prov = leer("src/lib/data-provider.tsx");
    const i = prov.indexOf("const reprogramarOrden = useCallback");
    const cuerpo = prov.slice(i, prov.indexOf("  );\n", i));
    expect(cuerpo).toContain('const { error } = await supabase.rpc("reprogramar_orden", argumentosDeReprogramar(id, fecha, nota, lang));');
    expect(cuerpo).toContain('if (camino === "respaldo") return comoAntes();');
    expect(cuerpo).toContain('if (camino === "error") { notify("Error: " + (error?.message ?? "")); return false; }');
    expect(cuerpo).toContain("if (teaching) return comoAntes();");
    for (const pagina of ["src/app/(app)/routes/page.tsx", "src/app/(app)/warehouse/page.tsx"]) {
      expect([pagina, leer(pagina).includes("reprogramarOrden={reprogramarOrden}")]).toEqual([pagina, true]);
    }
  });
});

// Cazado en el ensayo contra producción con ROLLBACK (2026-10-14): con `assigned_sales_rep` vacío, `o.assigned_sales_rep = yo`
// da NULL, `not (… or NULL)` da NULL y `if NULL then raise` NO lanza: cualquier vendedor reprogramaba una orden ajena sin
// vendedor asignado. El permiso va envuelto en `coalesce(…, false)`: lo que no se sabe, no se permite.
describe("173 · el permiso no se abre con un NULL", () => {
  it("la condición de permiso va dentro de coalesce(…, false)", () => {
    const sql = leer("supabase/migrations/173_reprogramar_orden.sql").replace(/\s+/g, " ");
    expect(sql).toContain("if not coalesce(( (r = 'admin'");
    expect(sql).toContain("and (o.created_by = yo or o.assigned_sales_rep = yo)) ), false) then raise exception 'REPROGRAMAR_NO_PERMITIDO");
  });
});
