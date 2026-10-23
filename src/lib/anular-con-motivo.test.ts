import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { AUTO_CANCEL_LATE_ENABLED, canTransition, puedeAnular, ROLE_ORDER, STAGES } from "./constants";
import {
  claveDesdeEtiqueta, etiquetaDeMotivo, faltaParaAnular, motivoDeAnulacion, motivosDeAnulacion,
  MOTIVO_OTRO, MOTIVO_POR_RETRASO, MOTIVOS_QUE_NO_SE_BORRAN, MOTIVOS_SEMBRADOS,
} from "./cancel-reasons";
import { esMia } from "./ordenes-visibles";
import { notificationsForStage } from "./notifications";
import type { Profile, Stage, UserRole } from "./types";

/**
 * Anular deja motivo, y una entregada no se anula (D-291, migración 122).
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
/** El guard VIVO para el espejo de quién anula: la 191 (D-656) es la última que redefine `guard_delivery_stage` —la 188
 *  con una línea más para ventas—. Hasta D-656 esta prueba leía la 122, y entre medias el guard se redefinió muchas
 *  veces: el espejo comparaba con una versión vieja. La primera prueba de abajo dice cuándo deja de ser la última. */
const GUARD_VIVO = "191_ventas_anula_su_orden.sql";
const guardVivo = leer(`supabase/migrations/${GUARD_VIVO}`);
const modal = leer("src/components/OrderModal.tsx");
const lista = leer("src/app/(app)/page.tsx");
const tabla = leer("src/components/OrdersTable.tsx");
const datos = leer("src/app/(app)/data/page.tsx");

// ---- El espejo: lo que dice el guard ------------------------------------------------------------

/** El tramo del guard que decide los cambios de etapa de ventas, chofer, gerente y office. */
const bloqueEtapas = guardVivo.slice(
  guardVivo.indexOf("if r in ('sales','driver','manager','accounting') then"),
  guardVivo.indexOf("elsif r = 'warehouse' then"),
);
/** La dueñez que el guard pide en la línea de ventas: la misma que la factura de la 125 (D-656). */
const DUENEZ = "(OLD.created_by = auth.uid() or OLD.assigned_sales_rep = auth.uid())";
/** Las líneas de ese tramo que permiten anular, con los roles y las etapas que nombra cada una. */
const permisosDeAnular = bloqueEtapas
  .split(SALTO)
  .filter((l) => l.includes("new_stage = 'canceled'"))
  .map((l) => {
    const roles = /r in \(([^)]*)\)/.exec(l);
    const rolUno = /\br = '(\w+)'/.exec(l);
    const etapaUna = /old_stage = '(\w+)'/.exec(l);
    const etapasVarias = /old_stage in \(([^)]*)\)/.exec(l);
    const comillas = (s: string) => s.split(",").map((x) => x.trim().replace(/'/g, ""));
    return {
      roles: roles ? comillas(roles[1]) : rolUno ? [rolUno[1]] : ["sales", "driver", "manager", "accounting"],
      etapas: etapasVarias ? comillas(etapasVarias[1]) : etapaUna ? [etapaUna[1]] : [],
      soloSuya: l.includes(DUENEZ),
    };
  });

/** La invariante que va ANTES de la salida de admin: una entregada no se anula, tampoco para él. */
const entregadaBloqueada = guardVivo.includes("old_stage = 'delivered' and new_stage = 'canceled'")
  && guardVivo.indexOf("old_stage = 'delivered' and new_stage = 'canceled'") < guardVivo.indexOf("if r = 'admin' then return NEW; end if;");

/** ¿La base deja a este rol anular desde esta etapa, siendo (o no) su orden? Leído del `.sql`, no copiado. */
function laBaseDejaAnular(rol: UserRole, etapa: Stage, suya: boolean): boolean {
  if (etapa === "canceled") return false;                    // ya está anulada: no hay a dónde ir
  if (etapa === "delivered") return !entregadaBloqueada;
  if (rol === "admin") return true;                          // `if r = 'admin' then return NEW`
  return permisosDeAnular.some((p) => p.roles.includes(rol) && p.etapas.includes(etapa) && (!p.soloSuya || suya));
}

describe("quién anula y desde dónde: la app y la base dicen lo mismo", () => {
  it("la 191 es la ÚLTIMA migración que define el guard: si otra lo redefine, el espejo tiene que leer esa (control)", () => {
    const dir = "supabase/migrations";
    // Sin distinguir mayúsculas: desde la 185 el guard se escribe `CREATE OR REPLACE FUNCTION`, y un `includes` en
    // minúsculas no lo ve.
    const conGuard = readdirSync(dir)
      .filter((f) => f.endsWith(".sql") && /function public\.guard_delivery_stage\(\)/i.test(leer(`${dir}/${f}`)))
      .sort();
    expect(conGuard.at(-1)).toBe(GUARD_VIVO);
    expect(conGuard.at(-2)).toBe("188_chofer_toma_orden.sql");
  });

  it("el tramo del guard se encontró y trae las cuatro líneas de anular (control)", () => {
    expect(bloqueEtapas.length).toBeGreaterThan(400);
    expect(permisosDeAnular.length).toBe(4);
    expect([...new Set(permisosDeAnular.flatMap((p) => p.etapas))].sort()).toEqual(
      ["approved", "draft", "fulfilling", "pending", "ready", "rejected"],
    );
    // La de ventas es la ÚNICA que mira de quién es la orden, y nombra solo a ventas.
    expect(permisosDeAnular.filter((p) => p.soloSuya)).toEqual([{ roles: ["sales"], etapas: ["pending", "approved"], soloSuya: true }]);
  });

  it("rol por rol, etapa por etapa y suya o no, sin copiar la tabla", () => {
    for (const rol of ROLE_ORDER) {
      for (const s of STAGES.map((x) => x.key)) {
        for (const suya of [false, true]) {
          expect([rol, s, suya, puedeAnular(rol, s, suya)]).toEqual([rol, s, suya, laBaseDejaAnular(rol, s, suya)]);
        }
      }
    }
  });

  it("la dueñez de la app (`esMia`) es la del guard: la creó O es su vendedor, aunque el otro campo diga otra persona", () => {
    // Datos que contradicen: `orderOwner` (el asignado, si lo hay) diría que la segunda NO es de Kevin; el guard dice que sí.
    const kevin = { id: "kevin" };
    expect(esMia({ created_by: "kevin", assigned_sales_rep: null }, kevin)).toBe(true);
    expect(esMia({ created_by: "kevin", assigned_sales_rep: "otro" }, kevin)).toBe(true);
    expect(esMia({ created_by: "oficina", assigned_sales_rep: "kevin" }, kevin)).toBe(true);
    expect(esMia({ created_by: "otro", assigned_sales_rep: "otro2" }, kevin)).toBe(false);
    expect(esMia({ created_by: "otro", assigned_sales_rep: null }, kevin)).toBe(false);
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
    // D-656 (191): ventas anula SU pendiente y SU programada (el FV216 de Kevin); la de otro vendedor, no; y desde
    // preparando en adelante tampoco la suya.
    expect([puedeAnular("sales", "pending", true), puedeAnular("sales", "approved", true)]).toEqual([true, true]);
    expect([puedeAnular("sales", "pending", false), puedeAnular("sales", "approved", false)]).toEqual([false, false]);
    for (const s of ["fulfilling", "ready", "picked_up", "delivered", "canceled"] as Stage[]) {
      expect([s, puedeAnular("sales", s, true)]).toEqual([s, false]);
    }
    // El chofer no gana nada con la dueñez: sigue en borrador y rechazada.
    expect([puedeAnular("driver", "pending", true), puedeAnular("driver", "approved", true)]).toEqual([false, false]);
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
    // Nota D-573 (2026-10-16): la escritura la arma `escrituraAlAnular` (la misma que la burbuja de Almacén): la clave y el
    // texto libre en sus columnas; la prueba de esa función está en `etapas-en-la-fila.test.ts`.
    expect(modal).toContain('const anulacion = escrituraAlAnular(cancelReason, cancelNote, motivos, lang);');
    expect(modal).toContain('extra = { ...extra, ...anulacion.extra };');
    expect(modal).toContain("{motivos.map((r) => <option key={r.key} value={r.key}>{t(r.en, r.es)}</option>)}");
    // La lista fija de seis motivos que vivía en el formulario ya no existe.
    expect(modal).not.toContain("CANCEL_REASONS");
  });

  it("el botón de anular de la ficha usa la regla compartida", () => {
    // Nota D-497: «Cancelar orden» es una opción del menú «Acciones ▾»; quién la ve lo decide
    // `lib/acciones-de-la-ficha.ts`, así que la regla se busca allí. El motivo y su «Confirmar» siguen en la ficha.
    const acciones = leer("src/lib/acciones-de-la-ficha.ts");
    expect(acciones).toContain("if (puedeAnular(yo.role, stage, esMia(pedido, yo))) {");
    expect(modal).toContain("anular: () => setShowCancel(true),");
    expect(modal).toContain("disabled={busy || !cancelListo}");
  });

  it("anular en bloque pide el motivo una vez y lo escribe en cada orden", () => {
    // Nota D-656: la tanda manda también la nota legible (la del evento y la del aviso a la oficina), como la ficha.
    expect(lista).toContain('const anulacion = { canceled_reason: bulkReason, canceled_reason_note: bulkReasonNote.trim() || null };');
    expect(lista).toContain('await bulkStage("canceled", anulacion, motivoDeAnulacion(anulacion, motivos, lang));');
    expect(lista).toContain("for (const d of chosen) { if (await setStage(d.id, to, nota, extra)) ok++; }");
    // Y el botón sale si algo de la selección se anula, con la dueñez de ventas (D-656).
    expect(lista).toContain("const puedeAnularAlgoDeLaSeleccion = chosen.some((d) => puedeAnular(me.role, d.stage, esMia(d, me)));");
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

// ---- D-656 (191): el vendedor anula su orden, y la oficina se entera ------------------------------

describe("el vendedor anula SU orden pendiente o programada (D-656, 191)", () => {
  const persona = (id: string, role: UserRole, full_name: string) => ({ id, role, full_name }) as Profile;
  const users = [
    persona("kevin", "sales", "Kevin Gonzalez"), persona("otro", "sales", "Otro Vendedor"),
    persona("ger", "manager", "Gerente"), persona("ofi", "accounting", "Office"), persona("alm", "warehouse", "Almacén"),
    persona("adm", "admin", "Admin"),
  ];
  const aviso = (actorId: string, actorRole: UserRole | null, reason: string | null) => notificationsForStage({
    stage: "canceled", order_no: 216, order_code: "FV216", delivery_id: "d1", creatorId: "kevin", actorId, actorRole, users, reason,
  });

  it("si anula un vendedor, se avisa a gerente y Office, con quién y el motivo; a nadie más", () => {
    const seeds = aviso("kevin", "sales", "Customer canceled");
    expect(seeds.map((s) => s.user_id).sort()).toEqual(["ger", "ofi"]);
    for (const s of seeds) {
      expect(s.kind).toBe("canceled");
      expect(s.message).toBe("Kevin Gonzalez canceled order #FV216: Customer canceled");
      expect(s.delivery_id).toBe("d1");
    }
  });

  it("sin motivo legible el aviso sale igual, sin los dos puntos", () => {
    expect(aviso("kevin", "sales", null)[0].message).toBe("Kevin Gonzalez canceled order #FV216");
  });

  it("si anula la oficina o el admin, no se avisa: lo hizo quien tendría que enterarse", () => {
    expect(aviso("ger", "manager", "Duplicate order")).toEqual([]);
    expect(aviso("ofi", "accounting", "Duplicate order")).toEqual([]);
    expect(aviso("adm", "admin", "Duplicate order")).toEqual([]);
    // Y sin saber el rol (quien llama no lo pasa), tampoco: no se inventa un vendedor.
    expect(aviso("kevin", null, "x")).toEqual([]);
  });

  it("los dos proveedores pasan el rol de quien escribe al armar los avisos", () => {
    expect(leer("src/lib/data-provider.tsx")).toContain(
      "const seeds = notificationsForStage({ ...args, actorId: me?.id ?? null, actorRole: me?.role ?? null, users });");
    expect(leer("src/lib/local-data-provider.tsx")).toContain(
      "const seeds = notificationsForStage({ ...args, actorId: me.id, actorRole: me.role, users: s.users });");
  });

  it("el demo rechaza lo que la base rechaza: la regla y la dueñez, antes de pedir el motivo", () => {
    const local = leer("src/lib/local-data-provider.tsx");
    const regla = "if (entrandoEnAnulada && cur && !puedeAnular(me.role, cur.stage, esMia(cur, me))) {";
    expect(local).toContain(regla);
    expect(local.indexOf(regla)).toBeLessThan(local.indexOf("const falta = faltaParaAnular("));
    expect(local).toContain("notify(`${me.role} cannot move an order from ${cur.stage} to canceled`);");
  });
});
