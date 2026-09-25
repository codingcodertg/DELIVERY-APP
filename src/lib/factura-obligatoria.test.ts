import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { avisoSinFactura, escrituraSinFactura, ETAPAS_SIN_FACTURA, resumenSinFactura } from "./factura-obligatoria";
import { submitBlockers, textoDeBloqueo, type OrderTypeRules } from "./required";
import type { Delivery, Stage } from "./types";

/**
 * Una orden cuyo tipo pide factura (Customer) no sale de borrador ni se entrega sin ella (D-399, migración 146).
 *
 * El dueño (2026-09-25): «el pending invoice no debería aparecer para customer porque el customer siempre debe
 * llevar invoice». La factura solo se exigía en el botón de enviar del modal; estas pruebas fijan la guarda que
 * ahora está en los dos proveedores de datos, y que el `.sql` de la 146 dice lo mismo.
 */

const leer = (r: string) => readFileSync(r, "utf8").split("\r\n").join("\n");

/** Las reglas de producción (medidas por el orquestador el 2026-09-25): Customer → invoice, Transfer → estimate,
 *  Intertienda → po. */
const REGLAS: OrderTypeRules = {
  Customer: { storeToStore: false, docRef: "invoice" },
  Intertienda: { storeToStore: true, docRef: "po", homeIsDestination: true },
  Transfer: { storeToStore: true, docRef: "estimate" },
};

const orden = (o: Partial<Delivery>): Delivery => ({
  id: "o1", order_no: 1, order_type: "Customer", stage: "approved", invoice_num: "INV-1", store: "Pharr",
  est_pallets: 3, delivery_fee: 0, ...o,
} as Delivery);

/** ¿Bloquea? `true` si devuelve algo. */
const bloquea = (antes: Delivery | undefined, cambio: Partial<Delivery>, reglas: OrderTypeRules = REGLAS) =>
  escrituraSinFactura(antes, cambio, reglas).length > 0;

describe("crear: una Customer no nace fuera de borrador sin factura", () => {
  it("crear aprobada, pendiente o entregada sin factura se bloquea; con factura pasa", () => {
    for (const stage of ["pending", "approved", "delivered", "ready"] as Stage[]) {
      expect(bloquea(undefined, { order_type: "Customer", stage, invoice_num: "" }), stage).toBe(true);
      expect(bloquea(undefined, { order_type: "Customer", stage, invoice_num: null }), stage).toBe(true);
      expect(bloquea(undefined, { order_type: "Customer", stage, invoice_num: "INV-9" }), stage).toBe(false);
    }
  });
  it("un borrador sin factura se guarda (D-049), y una rechazada o anulada también", () => {
    for (const stage of ["draft", "rejected", "canceled"] as Stage[]) {
      expect(bloquea(undefined, { order_type: "Customer", stage, invoice_num: "" }), stage).toBe(false);
    }
    // Sin etapa es un borrador.
    expect(bloquea(undefined, { order_type: "Customer", invoice_num: "" })).toBe(false);
  });
  it("Intertienda y Transfer no piden factura: su documento es otro y esto no lo toca", () => {
    expect(bloquea(undefined, { order_type: "Intertienda", stage: "approved", invoice_num: "" })).toBe(false);
    expect(bloquea(undefined, { order_type: "Transfer", stage: "approved", invoice_num: "" })).toBe(false);
  });
  it("la re-entrega y el resto de una carga partida de una Customer sin factura, también se bloquean", () => {
    expect(bloquea(undefined, { order_type: "Customer", stage: "approved", invoice_num: null, redelivery_of: "o9" })).toBe(true);
    expect(bloquea(undefined, { order_type: "Customer", stage: "ready", invoice_num: null, order_suffix: "b" })).toBe(true);
  });
});

describe("mover: sin factura no se envía, aprueba ni entrega", () => {
  const sinFactura = (stage: Stage) => orden({ stage, invoice_num: null });
  it("«Marcar entregada ya» desde aprobada, preparando, lista o recogida se bloquea", () => {
    for (const de of ["approved", "fulfilling", "ready", "picked_up"] as Stage[]) {
      expect(bloquea(sinFactura(de), { stage: "delivered" }), de).toBe(true);
    }
  });
  it("enviar o aprobar un borrador (uno a uno o en bloque) se bloquea", () => {
    expect(bloquea(sinFactura("draft"), { stage: "pending" })).toBe(true);
    expect(bloquea(sinFactura("draft"), { stage: "approved" })).toBe(true);
    expect(bloquea(sinFactura("rejected"), { stage: "pending" })).toBe(true);
    expect(bloquea(sinFactura("pending"), { stage: "approved" })).toBe(true);
  });
  it("anular, rechazar o volver a borrador pasa: la dejan donde la factura aún no hace falta", () => {
    expect(bloquea(sinFactura("approved"), { stage: "canceled", canceled_reason: "other" })).toBe(false);
    expect(bloquea(sinFactura("pending"), { stage: "rejected" })).toBe(false);
    expect(bloquea(sinFactura("pending"), { stage: "draft" })).toBe(false);
  });
  it("con factura, todo pasa como antes", () => {
    expect(bloquea(orden({ stage: "approved" }), { stage: "delivered" })).toBe(false);
    expect(bloquea(orden({ stage: "draft" }), { stage: "approved" })).toBe(false);
  });
});

describe("editar: ni se vacía la factura ni se cambia el tipo sin ponerla", () => {
  it("borrar la factura de una aprobada se bloquea; de un borrador, no", () => {
    expect(bloquea(orden({ stage: "approved" }), { invoice_num: "" })).toBe(true);
    expect(bloquea(orden({ stage: "approved" }), { invoice_num: "   " })).toBe(true);
    expect(bloquea(orden({ stage: "draft" }), { invoice_num: "" })).toBe(false);
  });
  it("pasar una Intertienda viva a Customer sin factura se bloquea; con factura, pasa", () => {
    const inter = orden({ order_type: "Intertienda", stage: "approved", invoice_num: null, po2: "PO-1" });
    expect(bloquea(inter, { order_type: "Customer" })).toBe(true);
    expect(bloquea(inter, { order_type: "Customer", invoice_num: "INV-5" })).toBe(false);
  });
});

describe("las viejas sin factura (las 5 de producción) no revientan al tocarlas", () => {
  const vieja = orden({ stage: "delivered", invoice_num: null });
  it("una edición que no cambia etapa, tipo ni factura pasa", () => {
    expect(bloquea(vieja, { assigned_driver: "Diego" })).toBe(false);
    expect(bloquea(vieja, { delivery_date: "2026-09-30" })).toBe(false);
    expect(bloquea(vieja, { delivery_notes: "nota" })).toBe(false);
    // El guardado del modal manda la fila entera, con los mismos valores: no es un cambio.
    expect(bloquea(vieja, { ...vieja, delivery_notes: "otra" })).toBe(false);
    expect(bloquea(vieja, { stage: "delivered", order_type: "Customer", invoice_num: "" })).toBe(false);
  });
  it("ponerle la factura pasa, y moverla de etapa sin ponerla no", () => {
    expect(bloquea(vieja, { invoice_num: "INV-7" })).toBe(false);
    expect(bloquea(vieja, { stage: "picked_up" })).toBe(true);
  });
  it("una clave con `undefined` no cuenta como cambio ni borra lo que había", () => {
    expect(bloquea(orden({ stage: "approved" }), { invoice_num: undefined })).toBe(false);
    expect(bloquea(vieja, { stage: undefined, order_type: undefined })).toBe(false);
  });
});

describe("lo decide la regla del tipo, no el nombre «Customer»", () => {
  it("si Ajustes dice que Customer no pide documento, no se bloquea", () => {
    const sinDoc: OrderTypeRules = { ...REGLAS, Customer: { storeToStore: false, docRef: "none" } };
    expect(bloquea(undefined, { order_type: "Customer", stage: "approved", invoice_num: "" }, sinDoc)).toBe(false);
  });
  it("otro tipo con docRef = invoice se bloquea igual", () => {
    const conObra: OrderTypeRules = { ...REGLAS, Obra: { storeToStore: false, docRef: "invoice" } };
    expect(bloquea(undefined, { order_type: "Obra", stage: "approved", invoice_num: "" }, conObra)).toBe(true);
  });
  it("las etapas libres son exactamente borrador, rechazada y anulada", () => {
    expect([...ETAPAS_SIN_FACTURA].sort()).toEqual(["canceled", "draft", "rejected"]);
  });
});

describe("el aviso es el del envío", () => {
  it("dice «Todavía falta: • Factura #», el mismo texto que el botón de enviar", () => {
    const faltan = escrituraSinFactura(undefined, { order_type: "Customer", stage: "approved", invoice_num: "" }, REGLAS);
    expect(avisoSinFactura(faltan, "es")).toBe("No se guardó — Todavía falta:\n\n• Factura #");
    expect(avisoSinFactura(faltan, "en")).toBe("Not saved — Still missing:\n\n• Invoice #");
    // Y es el mismo cuerpo que arma el envío para la misma orden.
    const envio = submitBlockers({ order_type: "Customer", stage: "draft", invoice_num: "", est_pallets: 3 }, REGLAS, []);
    expect(textoDeBloqueo(envio, "es")).toBe("Todavía falta:\n\n• Factura #");
  });
  it("el botón de enviar del modal arma su aviso con `textoDeBloqueo`", () => {
    const modal = leer("src/components/OrderModal.tsx");
    expect(modal).toContain(`notify(t("Can't submit for approval — ", "No se puede enviar a aprobación — ") + textoDeBloqueo(blockers, lang));`);
  });
});

describe("en bloque: el resumen dice cuáles se quedaron por la factura", () => {
  const sin = orden({ id: "a", order_no: 7, stage: "draft", invoice_num: null });
  const con = orden({ id: "b", order_no: 8, stage: "draft" });
  const inter = orden({ id: "c", order_no: 9, stage: "draft", order_type: "Intertienda", invoice_num: null });
  const etiqueta = (d: Delivery) => String(d.order_no);
  it("nombra solo las Customer sin factura, con el texto del envío", () => {
    expect(resumenSinFactura([sin, con, inter], "approved", REGLAS, etiqueta, "es"))
      .toBe("\n\nSin factura, no se movieron: #7. Todavía falta:\n\n• Factura #");
    expect(resumenSinFactura([sin], "delivered", REGLAS, etiqueta, "en"))
      .toBe("\n\nNo invoice, not moved: #7. Still missing:\n\n• Invoice #");
  });
  it("nada que decir si todas llevan factura, o si el bloque es anular", () => {
    expect(resumenSinFactura([con, inter], "approved", REGLAS, etiqueta, "es")).toBe("");
    expect(resumenSinFactura([sin], "canceled", REGLAS, etiqueta, "es")).toBe("");
  });
  it("los tres botones en bloque de Órdenes añaden el resumen a su aviso", () => {
    const pagina = leer("src/app/(app)/page.tsx");
    expect(pagina).toContain("const sinFactura = resumenSinFactura(chosen, to, settings.order_type_rules, orderLabel, lang);");
    expect(pagina).toContain(`const sinFactura = resumenSinFactura(chosen, "delivered", settings.order_type_rules, orderLabel, lang);`);
    expect(pagina.split("resumenSinFactura(chosen, to,").length - 1).toBe(2);   // enviar/aprobar/anular y forzar estado
    expect(pagina.split("orden(es) actualizadas`) + sinFactura);").length - 1).toBe(1);
    expect(pagina.split("marcadas como entregadas`) + sinFactura);").length - 1).toBe(1);
    expect(pagina.split("orden(es) a ${label}`) + sinFactura);").length - 1).toBe(1);
  });
});

describe("quien llama: los dos proveedores pasan TODA escritura por la guarda", () => {
  for (const f of ["src/lib/data-provider.tsx", "src/lib/local-data-provider.tsx"]) {
    const src = leer(f);
    const tramo = (nombre: string) => {
      const ini = src.indexOf(`useCallback<DataState["${nombre}"]>`);
      const fin = src.indexOf("useCallback<DataState[", ini + 10);
      expect(ini, nombre).toBeGreaterThan(0);
      return src.slice(ini, fin);
    };
    const esperado: Record<string, RegExp> = {
      addDelivery: /escrituraSinFactura\(undefined, d, (s\.)?settings\.order_type_rules\)/,
      updateDelivery: /escrituraSinFactura\((effectiveDeliveries|s\.deliveries)\.find\(\(c\) => c\.id === id\), (patchIn|patch), (s\.)?settings\.order_type_rules\)/,
      setStage: /escrituraSinFactura\((current|cur), \{ stage, \.\.\.extra \}, (s\.)?settings\.order_type_rules\)/,
    };
    for (const nombre of Object.keys(esperado)) {
      it(`${f.replace("src/lib/", "")}: ${nombre} llama a la guarda con la orden de antes y el cambio, y avisa`, () => {
        const cuerpo = tramo(nombre);
        const m = esperado[nombre].exec(cuerpo);
        expect(m, nombre).not.toBeNull();
        const guardaEn = m!.index;
        // El resultado se usa: si hay algo, se avisa con `avisoSinFactura` y se sale.
        expect(cuerpo.slice(guardaEn)).toMatch(/if \(sinFacturaAl\w+\.length\) \{ (if \(!opts\?\.quiet\) )?notify\(avisoSinFactura\(sinFacturaAl\w+, (lang|"en")\)\); return (null|false); \}/);
        // Antes de la primera escritura: el modo enseñanza, la base o el almacén local.
        for (const escritura of ["if (teaching)", "supabase.from(\"deliveries\")", "persist("]) {
          const en = cuerpo.indexOf(escritura);
          if (en >= 0) expect(guardaEn, `${nombre}: ${escritura}`).toBeLessThan(en);
        }
      });
    }
  }
  it("en setStage la guarda no depende del rol: el admin también (va fuera del `if` de canTransition)", () => {
    for (const f of ["src/lib/data-provider.tsx", "src/lib/local-data-provider.tsx"]) {
      const src = leer(f);
      const ini = src.indexOf('useCallback<DataState["setStage"]>');
      const cuerpo = src.slice(ini, src.indexOf("useCallback<DataState[", ini + 10));
      const linea = cuerpo.split("\n").find((l) => l.includes("escrituraSinFactura("))!;
      expect(linea, f).toBeDefined();
      expect(linea).not.toMatch(/role|admin/);
    }
  });
});

// ------------------------------------------------------------------------------------------------------------
// La base: la 146
// ------------------------------------------------------------------------------------------------------------
const sql = leer("supabase/migrations/146_customer_siempre_con_factura.sql");
const sinComentarios = (s: string) => s.split("\n").filter((l) => !l.trim().startsWith("--")).join("\n");
/** Como la autocomprobación: sin líneas de comentario y con los espacios colapsados. */
const codigo = (s: string) => sinComentarios(s).replace(/\s+/g, " ");
const funcion = (() => {
  const i = sql.indexOf("create or replace function public.guard_factura_obligatoria()");
  const f = sql.indexOf("end $function$", i);
  return i >= 0 && f > i ? sql.slice(i, f + "end $function$".length) : "";
})();

describe("la 146", () => {
  it("se leyó de verdad (control): la función y su disparador están", () => {
    expect(funcion.length).toBeGreaterThan(300);
    expect(codigo(sql)).toContain("create trigger deliveries_guard_invoice before insert or update on public.deliveries for each row execute function public.guard_factura_obligatoria();");
  });

  it("las etapas libres son las mismas que las de la pantalla", () => {
    const m = /if coalesce\(NEW\.stage, 'draft'\) in \(([^)]*)\) then return NEW; end if;/.exec(codigo(funcion));
    expect(m).not.toBeNull();
    const etapas = m![1].split(",").map((x) => x.trim().replace(/'/g, "")).sort();
    expect(etapas).toEqual([...ETAPAS_SIN_FACTURA].sort());
  });

  it("las viejas sin factura pasan si la escritura no cambia etapa ni tipo (la misma excepción que la pantalla)", () => {
    expect(codigo(funcion)).toContain(
      "if TG_OP = 'UPDATE' and NEW.stage is not distinct from OLD.stage and coalesce(btrim(NEW.order_type), '') = coalesce(btrim(OLD.order_type), '') and coalesce(btrim(OLD.invoice_num), '') = '' then return NEW; end if;",
    );
  });

  it("lee la regla del tipo, con `invoice` por defecto si la regla existe sin docRef (como `docRef ?? \"invoice\"`)", () => {
    const c = codigo(funcion);
    expect(c).toContain("select s.order_type_rules -> btrim(NEW.order_type) into regla from public.settings s where s.id = 1;");
    expect(c).toContain("doc := coalesce(regla ->> 'docRef', 'invoice');");
    expect(c).toContain("if doc = 'invoice' then raise exception 'INVOICE_REQUIRED");
    // No clava el nombre del tipo en la regla.
    expect(c).not.toContain("'Customer'");
  });

  it("sin salida de admin ni mirada al rol; solo sale sin sesión", () => {
    const c = codigo(funcion);
    expect(c).not.toMatch(/admin|current_user_role/);
    expect(c).toContain("if auth.uid() is null then return NEW; end if;");
  });

  it("la autocomprobación busca cadenas que están en el código sin comentarios", () => {
    const chk = sql.slice(sql.indexOf("do $chk$"), sql.indexOf("end $chk$;"));
    const buscadas = [...chk.matchAll(/position\('((?:[^']|'')*)' in codigo\)/g)].map((m) => m[1].replace(/''/g, "'"));
    // Las cinco de la función (admin y current_user_role se buscan para que NO estén).
    const deLaFuncion = buscadas.filter((b) => b !== "admin" && b !== "current_user_role");
    expect(deLaFuncion.length).toBe(5);
    for (const b of deLaFuncion) expect(codigo(funcion), b).toContain(b);
    // Y la del guard de la 145, en el guard de la 145.
    const g145 = leer("supabase/migrations/145_gerente_hace_bodega.sql");
    const guard = g145.slice(g145.indexOf("create or replace function public.guard_delivery_stage()"), g145.indexOf("end $function$"));
    expect(codigo(guard)).toContain("if r = 'manager' and ((old_stage = 'approved' and new_stage = 'fulfilling')");
    expect(chk).toContain("if r = ''manager'' and ((old_stage = ''approved'' and new_stage = ''fulfilling'')");
  });

  it("no redefine el guard de etapas (la 145 sigue siendo su última definición)", () => {
    expect(sql).not.toContain("function public.guard_delivery_stage()\n");
    expect(codigo(sql)).not.toContain("create or replace function public.guard_delivery_stage");
  });

  it("sin begin/commit propios, con reversión escrita y con su fila del registro", () => {
    expect(sinComentarios(sql)).not.toMatch(/^\s*(begin|commit|rollback)\s*;/im);
    expect(sql).toContain("-- Reversion (para pegar A MANO");
    expect(sql).toContain("--   drop trigger if exists deliveries_guard_invoice on public.deliveries;");
    expect(sql).toMatch(/-- @ledger-below\ninsert into public\.schema_migrations \(name, checksum\) values \('146_customer_siempre_con_factura\.sql', '[0-9a-f]{64}'\)/);
  });
});
