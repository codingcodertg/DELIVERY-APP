import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { AUTO_CANCEL_LATE_ENABLED, canTransition, puedeAnular, ROLE_ORDER, STAGES } from "./constants";
import {
  claveDesdeEtiqueta, etiquetaDeMotivo, faltaParaAnular, motivoDeAnulacion, motivosDeAnulacion,
  MOTIVO_OTRO, MOTIVO_POR_RETRASO, MOTIVOS_QUE_NO_SE_BORRAN, MOTIVOS_SEMBRADOS,
} from "./cancel-reasons";
import type { Stage, UserRole } from "./types";

/**
 * Anular deja motivo, y una entregada no se anula (D-NEXT, migración 122).
 *
 * Quién puede anular y desde qué etapa lo dicen dos sitios —la app y el guard—, así que la primera
 * prueba no copia la tabla: **la lee del `.sql`** y compara rol por rol y etapa por etapa. Si un día se
 * separan, cae aquí y no cuando alguien pulse un botón que la base le rechaza — que es justo lo que
 * pasaba con logística antes de esta decisión.
 */

const leer = (r: string) => readFileSync(r, "utf8").split("\r\n").join("\n");
/** El salto de línea por su código: escrito como escape, la herramienta que editó este fichero lo
 *  resolvía y partía la línea en dos. */
const SALTO = String.fromCharCode(10);
const sql = leer("supabase/migrations/122_anular_con_motivo.sql");
const modal = leer("src/components/OrderModal.tsx");
const lista = leer("src/app/(app)/page.tsx");
const tabla = leer("src/components/OrdersTable.tsx");
const datos = leer("src/app/(app)/data/page.tsx");

// ---- El espejo: lo que dice el guard ------------------------------------------------------------

/** El tramo del guard que decide los cambios de etapa de ventas, chofer, gerente y office. */
const bloqueEtapas = sql.slice(
  sql.indexOf("if r in ('sales','driver','manager','accounting') then"),
  sql.indexOf("elsif r = 'warehouse' then"),
);
/** Las líneas de ese tramo que permiten anular, con los roles y las etapas que nombra cada una. */
const permisosDeAnular = bloqueEtapas
  .split(SALTO)
  .filter((l) => l.includes("new_stage = 'canceled'"))
  .map((l) => {
    const roles = /r in \(([^)]*)\)/.exec(l);
    const etapaUna = /old_stage = '(\w+)'/.exec(l);
    const etapasVarias = /old_stage in \(([^)]*)\)/.exec(l);
    const comillas = (s: string) => s.split(",").map((x) => x.trim().replace(/'/g, ""));
    return {
      roles: roles ? comillas(roles[1]) : ["sales", "driver", "manager", "accounting"],
      etapas: etapasVarias ? comillas(etapasVarias[1]) : etapaUna ? [etapaUna[1]] : [],
    };
  });

/** La invariante que va ANTES de la salida de admin: una entregada no se anula, tampoco para él. */
const entregadaBloqueada = sql.includes("old_stage = 'delivered' and new_stage = 'canceled'")
  && sql.indexOf("old_stage = 'delivered' and new_stage = 'canceled'") < sql.indexOf("if r = 'admin' then return NEW; end if;");

/** ¿La base deja a este rol anular desde esta etapa? Leído del `.sql`, no copiado. */
function laBaseDejaAnular(rol: UserRole, etapa: Stage): boolean {
  if (etapa === "canceled") return false;                    // ya está anulada: no hay a dónde ir
  if (etapa === "delivered") return !entregadaBloqueada;
  if (rol === "admin") return true;                          // `if r = 'admin' then return NEW`
  return permisosDeAnular.some((p) => p.roles.includes(rol) && p.etapas.includes(etapa));
}

describe("quién anula y desde dónde: la app y la base dicen lo mismo", () => {
  it("el tramo del guard se encontró y trae las tres líneas de anular (control)", () => {
    expect(bloqueEtapas.length).toBeGreaterThan(400);
    expect(permisosDeAnular.length).toBe(3);
    expect(permisosDeAnular.flatMap((p) => p.etapas).sort()).toEqual(
      ["approved", "draft", "fulfilling", "pending", "ready", "rejected"],
    );
  });

  it("rol por rol y etapa por etapa, sin copiar la tabla", () => {
    for (const rol of ROLE_ORDER) {
      for (const s of STAGES.map((x) => x.key)) {
        expect([rol, s, puedeAnular(rol, s)]).toEqual([rol, s, laBaseDejaAnular(rol, s)]);
      }
    }
  });

  it("una entregada no la anula nadie, ni el admin — y la base lo dice antes de dejarle pasar", () => {
    expect(entregadaBloqueada).toBe(true);
    for (const rol of ROLE_ORDER) expect([rol, puedeAnular(rol, "delivered")]).toEqual([rol, false]);
  });

  it("lo que abre esta decisión, y lo que no", () => {
    for (const s of ["pending", "approved", "fulfilling", "ready"] as Stage[]) {
      expect([s, puedeAnular("manager", s)]).toEqual([s, true]);
      expect([s, puedeAnular("accounting", s)]).toEqual([s, true]);
      expect([s, puedeAnular("sales", s)]).toEqual([s, false]);
    }
    // Ventas y chofer siguen donde estaban.
    for (const rol of ["sales", "driver"] as UserRole[]) {
      expect([rol, puedeAnular(rol, "draft"), puedeAnular(rol, "rejected")]).toEqual([rol, true, true]);
    }
    // Con la carga en el camión solo el admin; almacén y logística no anulan nunca.
    expect([puedeAnular("admin", "picked_up"), puedeAnular("manager", "picked_up")]).toEqual([true, false]);
    for (const s of STAGES.map((x) => x.key)) {
      expect([s, puedeAnular("warehouse", s)]).toEqual([s, false]);
      expect([s, puedeAnular("logistics", s)]).toEqual([s, false]);
    }
  });

  it("las etapas nuevas existen como salto, y `picked_up` a propósito no", () => {
    for (const s of ["pending", "approved", "fulfilling", "ready"] as Stage[]) {
      expect([s, canTransition(s, "canceled")]).toEqual([s, true]);
    }
    // El admin se salta la lista en los dos proveedores, así que no hace falta abrirla ahí.
    expect(canTransition("picked_up", "canceled")).toBe(false);
    expect(canTransition("delivered", "canceled")).toBe(false);
    // Y de una anulada no se sale por ningun lado: no hay salto de vuelta.
    for (const s of STAGES.map((x) => x.key)) expect([s, canTransition("canceled", s)]).toEqual([s, false]);
  });
});

// ---- Lo que exige el guard sobre el motivo -------------------------------------------------------

describe("el `.sql` exige motivo y no deja reescribirlo", () => {
  it("sin motivo no se queda en anulada", () => {
    expect(sql).toContain("if coalesce(btrim(NEW.canceled_reason), '') = '' then");
    expect(sql).toContain("raise exception 'A canceled order needs a reason'");
  });

  it("«otro» exige su texto libre, con la misma clave que usa la app", () => {
    expect(sql).toContain("if NEW.canceled_reason = 'other' and coalesce(btrim(NEW.canceled_reason_note), '') = '' then");
    expect(MOTIVO_OTRO).toBe("other");
  });

  it("quién y cuándo los estampa la base, no el cliente", () => {
    expect(sql).toContain("NEW.canceled_by := auth.uid();");
    expect(sql).toContain("NEW.canceled_at := now();");
  });

  it("el motivo escrito es historia: las cuatro columnas no se reescriben", () => {
    const tramo = sql.slice(sql.indexOf("if TG_OP = 'UPDATE' and not entrando"), sql.indexOf("if r = 'admin' then return NEW"));
    for (const col of ["canceled_reason", "canceled_reason_note", "canceled_by", "canceled_at"]) {
      expect(tramo, col).toContain(`NEW.${col}`);
    }
    expect(tramo).toContain("raise exception 'A cancellation reason is history: it cannot be rewritten'");
  });

  it("y las dos invariantes van antes de que el admin salga por su rama", () => {
    const salidaAdmin = sql.indexOf("if r = 'admin' then return NEW; end if;");
    expect(sql.indexOf("A canceled order needs a reason")).toBeLessThan(salidaAdmin);
    expect(sql.indexOf("A cancellation reason is history")).toBeLessThan(salidaAdmin);
  });

  it("la migración se registra en el ledger con su checksum", () => {
    expect(sql).toContain("-- @ledger-below");
    expect(sql).toMatch(/values \('122_anular_con_motivo\.sql', '[0-9a-f]{64}'\)/);
  });
});

// ---- Los motivos ---------------------------------------------------------------------------------

describe("la lista de motivos", () => {
  it("trae sembrados los tres que pidió el dueño", () => {
    const claves = MOTIVOS_SEMBRADOS.map((m) => m.key);
    expect(claves).toContain("duplicate");
    expect(claves).toContain("customer_canceled");
    expect(claves).toContain("customer_pickup");
    expect(MOTIVOS_SEMBRADOS.find((m) => m.key === "customer_pickup")?.es).toBe("Cliente recogerá en tienda");
  });

  it("«otro» pide texto libre y no se puede borrar; el del retraso tampoco", () => {
    expect(MOTIVOS_SEMBRADOS.find((m) => m.key === MOTIVO_OTRO)?.free_text).toBe(true);
    expect([...MOTIVOS_QUE_NO_SE_BORRAN].sort()).toEqual([MOTIVO_POR_RETRASO, MOTIVO_OTRO].sort());
  });

  it("manda la lista del admin; sin ella —o vacía— los sembrados", () => {
    const mia = [{ key: "solo_uno", en: "Only one", es: "Solo uno" }];
    expect(motivosDeAnulacion({ cancel_reasons: mia })).toEqual(mia);
    expect(motivosDeAnulacion({})).toEqual(MOTIVOS_SEMBRADOS);
    expect(motivosDeAnulacion({ cancel_reasons: [] })).toEqual(MOTIVOS_SEMBRADOS);
  });

  it("la clave se traduce al mirarla; una desconocida se enseña tal cual", () => {
    expect(etiquetaDeMotivo("duplicate", MOTIVOS_SEMBRADOS, "es")).toBe("Orden duplicada");
    expect(etiquetaDeMotivo("duplicate", MOTIVOS_SEMBRADOS, "en")).toBe("Duplicate order");
    // Una orden anulada antes de la 122, o con un motivo que el admin borró después.
    expect(etiquetaDeMotivo("Cliente canceló", MOTIVOS_SEMBRADOS, "en")).toBe("Cliente canceló");
    expect(etiquetaDeMotivo(null, MOTIVOS_SEMBRADOS, "es")).toBe("");
  });

  it("lo que se lee en la ficha lleva el texto libre detrás", () => {
    const d = { canceled_reason: MOTIVO_OTRO, canceled_reason_note: "el cliente se mudó" };
    expect(motivoDeAnulacion(d, MOTIVOS_SEMBRADOS, "es")).toBe("Otro — el cliente se mudó");
    expect(motivoDeAnulacion({ canceled_reason: "duplicate", canceled_reason_note: null }, MOTIVOS_SEMBRADOS, "es"))
      .toBe("Orden duplicada");
  });
});

describe("lo que impide anular", () => {
  it("sin motivo, no", () => {
    expect(faltaParaAnular("", null, MOTIVOS_SEMBRADOS, "es")).toBe("Una orden anulada necesita un motivo.");
    expect(faltaParaAnular("   ", null, MOTIVOS_SEMBRADOS, "es")).not.toBeNull();
    expect(faltaParaAnular(null, "una nota suelta", MOTIVOS_SEMBRADOS, "es")).not.toBeNull();
  });

  it("«otro» sin escribir cuál, tampoco", () => {
    expect(faltaParaAnular(MOTIVO_OTRO, "", MOTIVOS_SEMBRADOS, "es")).toContain("necesita que se escriba");
    expect(faltaParaAnular(MOTIVO_OTRO, "  ", MOTIVOS_SEMBRADOS, "es")).not.toBeNull();
    expect(faltaParaAnular(MOTIVO_OTRO, "se equivocaron de tienda", MOTIVOS_SEMBRADOS, "es")).toBeNull();
  });

  it("un motivo normal no pide texto", () => {
    expect(faltaParaAnular("duplicate", null, MOTIVOS_SEMBRADOS, "es")).toBeNull();
    expect(faltaParaAnular("customer_pickup", "", MOTIVOS_SEMBRADOS, "en")).toBeNull();
  });
});

describe("la clave de un motivo nuevo", () => {
  it("sale de la etiqueta, sin acentos ni signos", () => {
    expect(claveDesdeEtiqueta("Cliente recogerá en tienda", [])).toBe("cliente_recogera_en_tienda");
    expect(claveDesdeEtiqueta("  ¡Se dañó!  ", [])).toBe("se_dano");
  });

  it("no pisa una que ya exista, y nunca sale vacía", () => {
    expect(claveDesdeEtiqueta("Duplicate order", ["duplicate_order"])).toBe("duplicate_order_2");
    expect(claveDesdeEtiqueta("···", [])).toBe("reason");
  });
});

// ---- El cableado ---------------------------------------------------------------------------------

describe("no queda ningún camino que anule sin motivo", () => {
  it("los dos proveedores preguntan antes de escribir, y en el camino que se recorre", () => {
    // No basta con que la llamada aparezca: escondida tras un `if (false)` el fichero sigue
    // conteniéndola y la prueba seguía verde (lo cazó un mutante). Se exige la condición entera.
    expect(leer("src/lib/data-provider.tsx")).toContain(
      'if (stage === "canceled" && (!current || current.stage !== "canceled")) {');
    expect(leer("src/lib/local-data-provider.tsx")).toContain(
      'const entrandoEnAnulada = stage === "canceled" && (!cur || cur.stage !== "canceled");');
    for (const f of ["src/lib/data-provider.tsx", "src/lib/local-data-provider.tsx"]) {
      const src = leer(f);
      expect(src, f).toContain("const falta = faltaParaAnular(");
      expect(src, f).toContain("if (falta) { notify(falta); return false; }");
      expect(src, f).toContain("motivosDeAnulacion(");
    }
    // Y el modo local estampa quién/cuándo, que en producción pone el guard.
    expect(leer("src/lib/local-data-provider.tsx")).toContain(
      "if (entrandoEnAnulada) { patch.canceled_by = me.id; patch.canceled_at = new Date().toISOString(); }");
  });

  it("la ficha manda la clave en sus columnas, no la etiqueta traducida", () => {
    expect(modal).toContain('extra = { ...extra, canceled_reason: cancelReason, canceled_reason_note: cancelNote.trim() || null };');
    expect(modal).toContain("{motivos.map((r) => <option key={r.key} value={r.key}>{t(r.en, r.es)}</option>)}");
    // La lista fija de seis motivos que vivía en el formulario ya no existe.
    expect(modal).not.toContain("CANCEL_REASONS");
  });

  it("el botón de anular de la ficha usa la regla compartida", () => {
    expect(modal).toContain("if (puedeAnular(me.role, stage)) {");
    expect(modal).toContain("disabled={busy || !cancelListo}");
  });

  it("anular en bloque pide el motivo una vez y lo escribe en cada orden", () => {
    expect(lista).toContain('await bulkStage("canceled", { canceled_reason: bulkReason, canceled_reason_note: bulkReasonNote.trim() || null });');
    expect(lista).toContain("for (const d of chosen) { if (await setStage(d.id, to, undefined, extra)) ok++; }");
    // Y el camino viejo, que llamaba a `setStage` sin nada, ya no está.
    expect(lista).not.toContain('bulkStage("canceled")');
  });

  it("logística ya no ve el botón de anular en bloque", () => {
    const barra = lista.slice(lista.indexOf("const puedeAnularAlgoDeLaSeleccion"), lista.indexOf("bulkMarkDelivered}"));
    expect(barra).toContain("puedeAnularAlgoDeLaSeleccion && !bulkCancel");
    // La condición vieja nombraba a logística junto a gerente y admin para anular.
    const anular = lista.slice(lista.indexOf("Confirmar anulación") - 2000, lista.indexOf("Confirmar anulación"));
    expect(anular).not.toContain('["manager", "admin", "logistics"].includes(me.role) && (' + SALTO + '            <button className="btn btn-danger btn-sm"');
  });

  it("la barrida automática sigue apagada, y si se enciende deja motivo", () => {
    expect(AUTO_CANCEL_LATE_ENABLED).toBe(false);
    expect(lista).toContain("{ canceled_reason: MOTIVO_POR_RETRASO });");
  });
});

describe("el motivo se ve", () => {
  it("en la ficha, con quién y cuándo", () => {
    const tramo = modal.slice(modal.indexOf('{existing.stage === "canceled" && ('), modal.indexOf("{existing.assigned_sales_rep && ("));
    expect(tramo).toContain("motivoDeAnulacion(existing, motivos, lang)");
    expect(tramo).toContain("userName(existing.canceled_by)");
    expect(tramo).toContain("fmtDateTime(existing.canceled_at)");
  });

  it("y en la lista, al lado de la etapa", () => {
    expect(tabla).toContain('const porQue = d.stage === "canceled" ? motivoDeAnulacion(d, motivos ?? [], lang) : "";');
    expect(tabla).toContain("motivos: motivosDeAnulacion(settings)");
  });

  it("y el admin edita la lista en Datos, donde la clave no se toca", () => {
    expect(datos).toContain("<CancelReasonsEditor settings={settings} deliveries={deliveries} save={save} t={t} />");
    expect(datos).toContain("const key = r.key || claveDesdeEtiqueta(en || es, fuera.map((x) => x.key));");
    expect(datos).toContain("!MOTIVOS_QUE_NO_SE_BORRAN.includes(r.key) && (");
  });
});
