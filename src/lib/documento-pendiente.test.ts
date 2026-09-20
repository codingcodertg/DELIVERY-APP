import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  campoCapturableEnFila, documentoPendiente, etiquetaDePendiente, falloAlGuardarDocumento, gruposPorTienda,
  ordenPorTienda, otraConLaMismaFactura, PESTANA_DOCUMENTO_PENDIENTE, valorDeDocumento,
} from "./documento-pendiente";
import { STAGES } from "./constants";
import type { OrderTypeRules } from "./required";
import type { Delivery, Stage, UserRole } from "./types";

const leer = (r: string) => readFileSync(join(process.cwd(), r), "utf8").split("\r\n").join("\n");
const plano = (s: string) => s.replace(/\s+/g, " ");
const sinComentarios = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").split("\n").map((l) => l.replace(/^\s*\/\/.*$/, "")).join("\n");

// Tipos inventados a propósito: qué documento pide cada tipo es dato del dueño (Ajustes) y no se
// afirma aquí. Lo que se prueba es que la regla obedece a `docRef`, sea cual sea el nombre.
const reglas: OrderTypeRules = {
  ConFactura: { docRef: "invoice" }, ConPO: { docRef: "po" }, ConEstimacion: { docRef: "estimate" },
  Cualquiera: { docRef: "any" }, SinDocumento: { docRef: "none" },
} as OrderTypeRules;

type Orden = Pick<Delivery, "id" | "stage" | "order_type" | "invoice_num" | "po2" | "estimate_num" | "so_num" | "created_by" | "assigned_sales_rep" | "store" | "delivery_date">;
const orden = (extra: Partial<Orden> = {}): Orden => ({
  id: "o1", stage: "approved", order_type: "ConFactura", invoice_num: null, po2: null, estimate_num: null, so_num: null,
  created_by: "vendedor-1", assigned_sales_rep: null, store: null, delivery_date: null, ...extra,
});

describe("documentoPendiente: el documento que exige el TIPO, no «la factura» a secas", () => {
  it("a cada tipo le falta el suyo", () => {
    expect(documentoPendiente(orden({ order_type: "ConFactura" }), reglas)?.campo).toBe("invoice_num");
    expect(documentoPendiente(orden({ order_type: "ConPO" }), reglas)?.campo).toBe("po2");
    expect(documentoPendiente(orden({ order_type: "ConEstimacion" }), reglas)?.campo).toBe("estimate_num");
  });

  it("una de PO sin factura NO está pendiente, y con factura pero sin PO SÍ", () => {
    // El conteo que no había que hacer: 35 «sin invoice_num», de las que 31 eran Intertiendas.
    expect(documentoPendiente(orden({ order_type: "ConPO", po2: "PO-9" }), reglas)).toBeNull();
    expect(documentoPendiente(orden({ order_type: "ConPO", invoice_num: "123" }), reglas)?.campo).toBe("po2");
  });

  it("puesto el documento, deja de estarlo; espacios solos no cuentan como puesto", () => {
    expect(documentoPendiente(orden({ invoice_num: "178137" }), reglas)).toBeNull();
    expect(documentoPendiente(orden({ invoice_num: "   " }), reglas)?.campo).toBe("invoice_num");
  });

  it("`any` solo si no tiene NINGUNO; `none` nunca", () => {
    expect(documentoPendiente(orden({ order_type: "Cualquiera" }), reglas)).not.toBeNull();
    for (const campo of ["po2", "invoice_num", "so_num"] as const) {
      expect(documentoPendiente(orden({ order_type: "Cualquiera", [campo]: "X1" }), reglas), campo).toBeNull();
    }
    expect(documentoPendiente(orden({ order_type: "SinDocumento" }), reglas)).toBeNull();
  });

  it("en borrador, rechazada y anulada no se espera; en todas las demás etapas sí", () => {
    const sin: Stage[] = ["draft", "rejected", "canceled"];
    for (const { key } of STAGES) {
      const r = documentoPendiente(orden({ stage: key }), reglas);
      if (sin.includes(key)) expect(r, key).toBeNull(); else expect(r?.campo, key).toBe("invoice_num");
    }
  });

  it("la pastilla dice qué falta, en los dos idiomas y sin el «#»", () => {
    const de = (tipo: string, lang: "en" | "es") => etiquetaDePendiente(documentoPendiente(orden({ order_type: tipo }), reglas)!, lang);
    expect(de("ConFactura", "en")).toBe("Invoice pending");
    expect(de("ConPO", "en")).toBe("PO pending");
    expect(de("ConEstimacion", "en")).toBe("Estimate pending");
    expect(de("ConFactura", "es")).toBe("Factura pendiente");
    expect(de("ConEstimacion", "es")).toBe("Estimación pendiente");
  });
});

describe("campoCapturableEnFila: quién escribe el número sin abrir la orden", () => {
  const yo = (role: UserRole, id = "vendedor-1") => ({ id, role });

  it("ventas: la factura de SU orden, en las etapas en que ya no edita", () => {
    for (const stage of ["approved", "fulfilling", "ready", "picked_up", "delivered"] as Stage[]) {
      expect(campoCapturableEnFila(yo("sales"), orden({ stage }), reglas), stage).toBe("invoice_num");
    }
  });

  it("ventas: suya también es la que le asignaron; la de otro, no", () => {
    expect(campoCapturableEnFila(yo("sales"), orden({ created_by: "office-1", assigned_sales_rep: "vendedor-1" }), reglas)).toBe("invoice_num");
    expect(campoCapturableEnFila(yo("sales"), orden({ created_by: "vendedor-2" }), reglas)).toBeNull();
    expect(campoCapturableEnFila(yo("sales"), orden({ created_by: "vendedor-1", assigned_sales_rep: "vendedor-2" }), reglas)).toBeNull();
  });

  it("ventas: el PO o la estimación que falte los VE y no los escribe (la 125 solo abre invoice_num)", () => {
    expect(campoCapturableEnFila(yo("sales"), orden({ order_type: "ConPO" }), reglas)).toBeNull();
    expect(campoCapturableEnFila(yo("sales"), orden({ order_type: "ConEstimacion" }), reglas)).toBeNull();
  });

  it("ventas en pendiente ya edita la orden entera: ahí, el documento que sea", () => {
    expect(campoCapturableEnFila(yo("sales"), orden({ stage: "pending", order_type: "ConPO" }), reglas)).toBe("po2");
  });

  it("quien ya edita (admin, gerente, office): el documento que falte, en cualquier orden", () => {
    for (const role of ["admin", "manager", "accounting"] as UserRole[]) {
      expect(campoCapturableEnFila(yo(role, "otro"), orden({ stage: "delivered", order_type: "ConPO" }), reglas), role).toBe("po2");
      expect(campoCapturableEnFila(yo(role, "otro"), orden({ stage: "delivered" }), reglas), role).toBe("invoice_num");
    }
  });

  it("chofer y almacén nunca, ni en las etapas en que almacén edita campos; logística tampoco", () => {
    for (const role of ["driver", "warehouse", "logistics"] as UserRole[]) {
      for (const stage of ["pending", "approved", "ready", "delivered"] as Stage[]) {
        expect(campoCapturableEnFila(yo(role), orden({ stage }), reglas), `${role} ${stage}`).toBeNull();
      }
    }
  });

  it("sin nada pendiente, o sin sesión, no hay nada que capturar", () => {
    expect(campoCapturableEnFila(yo("admin"), orden({ invoice_num: "1" }), reglas)).toBeNull();
    expect(campoCapturableEnFila(null, orden(), reglas)).toBeNull();
  });
});

describe("lo que se guarda", () => {
  it("sin espacios alrededor; vacío o solo espacios no se guarda", () => {
    expect(valorDeDocumento("  178137 ")).toBe("178137");
    expect(valorDeDocumento("")).toBeNull();
    expect(valorDeDocumento("   ")).toBeNull();
  });

  it("cero filas ES un fallo, aunque no haya error", () => {
    expect(falloAlGuardarDocumento(null, [{ id: "o1" }])).toBeNull();
    expect(falloAlGuardarDocumento(null, [])).not.toBeNull();
    expect(falloAlGuardarDocumento(null, null)).not.toBeNull();
    expect(falloAlGuardarDocumento({ message: "You cannot edit an order in the ready stage" }, null)).toBe("You cannot edit an order in the ready stage");
  });

  it("factura repetida: otra orden viva, sin mirar mayúsculas ni espacios; ni ella misma ni una anulada", () => {
    const todas = [
      { id: "o1", stage: "approved" as Stage, invoice_num: "A-100" },
      { id: "o2", stage: "delivered" as Stage, invoice_num: " a-100 " },
      { id: "o3", stage: "canceled" as Stage, invoice_num: "B-200" },
    ];
    expect(otraConLaMismaFactura("o1", "A-100", todas)?.id).toBe("o2");
    expect(otraConLaMismaFactura("o2", "A-100", todas)?.id).toBe("o1");
    expect(otraConLaMismaFactura("o1", "B-200", todas)).toBeUndefined();
    expect(otraConLaMismaFactura("o1", "  ", todas)).toBeUndefined();
  });
});

describe("la pestaña entra ordenada por tienda", () => {
  // Datos que CONTRADICEN el orden de llegada en las dos claves: ya ordenados, pasaría cualquier cosa.
  const filas = [
    orden({ id: "a", store: "Tienda Z", delivery_date: "2026-09-01" }),
    orden({ id: "b", store: null, delivery_date: "2026-08-01" }),
    orden({ id: "c", store: "Tienda B", delivery_date: "2026-09-10" }),
    orden({ id: "d", store: "Tienda B", delivery_date: null }),
    orden({ id: "e", store: "tienda b ", delivery_date: "2026-09-02" }),
    orden({ id: "f", store: "Tienda 10", delivery_date: "2026-09-03" }),
    orden({ id: "g", store: "Tienda 9", delivery_date: "2026-09-04" }),
  ];

  it("por tienda y, dentro, por fecha; sin tienda y sin fecha al final; no toca la lista que recibe", () => {
    const antes = filas.map((f) => f.id).join("");
    expect(ordenPorTienda(filas).map((f) => f.id)).toEqual(["g", "f", "e", "c", "d", "a", "b"]);
    expect(filas.map((f) => f.id).join("")).toBe(antes);
  });

  it("un grupo por tienda con su cuenta; la misma tienda escrita distinto es un solo grupo", () => {
    expect(gruposPorTienda(filas).map((g) => [g.tienda.trim().toLowerCase(), g.filas.length])).toEqual([
      ["tienda 9", 1], ["tienda 10", 1], ["tienda b", 3], ["tienda z", 1], ["", 1],
    ]);
  });
});

describe("la pantalla usa la regla, no una copia", () => {
  const pagina = sinComentarios(leer("src/app/(app)/page.tsx"));
  const tabla = sinComentarios(leer("src/components/OrdersTable.tsx"));
  const pastilla = sinComentarios(leer("src/components/DocumentoPendiente.tsx"));
  const proveedor = sinComentarios(leer("src/lib/data-provider.tsx"));

  it("la pestaña no se llama como ninguna etapa", () => {
    expect(STAGES.map((s) => s.key as string)).not.toContain(PESTANA_DOCUMENTO_PENDIENTE);
  });

  it("la cuenta y el filtro de la pestaña salen de documentoPendiente, sobre lo que la persona ve", () => {
    // Desde D-313 cuenta sobre `conPendientes`, no sobre `visible`: sobre la lista normal daba 0
    // para office —sus pendientes están todas entregadas, fuera de la ventana de D-239— y por eso la
    // pestaña no le aparecía. Lo que D-310 fija sigue igual: la cuenta sale de `documentoPendiente`.
    expect(plano(pagina)).toContain("c[PESTANA_DOCUMENTO_PENDIENTE] = conPendientes.filter((d) => facturaPendiente(d, settings.order_type_rules ?? {})).length;");
    expect(plano(pagina)).toContain("if (activeFilter === PESTANA_DOCUMENTO_PENDIENTE) { if (!facturaPendiente(d, settings.order_type_rules ?? {})) return false; }");
    // Desde D-338 la pestaña es solo de FACTURAS: `facturaPendiente` es `documentoPendiente` con el campo mirado.
    expect(plano(pagina)).toContain("porTienda={filter === PESTANA_DOCUMENTO_PENDIENTE}");
  });

  it("la tabla agrupa solo mientras la persona no haya elegido su orden", () => {
    expect(plano(tabla)).toContain("const agrupada = porTienda && !sortKey;");
    expect(plano(tabla)).toContain("agrupada ? gruposPorTienda(sortedRows, tiendasPrimero)");
    expect(plano(tabla)).toContain("<DocumentoPendiente d={d}");
  });

  it("la pastilla decide con las dos funciones y no abre la orden al pulsarla", () => {
    expect(pastilla).toContain("documentoPendiente(d, reglas)");
    expect(pastilla).toContain("campoCapturableEnFila(me, d, reglas)");
    expect(pastilla).not.toMatch(/\.role\b/);
    // El botón que abre el input, el formulario entero y las teclas: los tres paran el clic.
    expect(pastilla.match(/stopPropagation\(\)/g)?.length).toBe(3);
    expect(plano(pastilla)).toContain('if (e.key === "Enter") { e.preventDefault(); void guardar(); }');
    expect(plano(pastilla)).toContain('if (e.key === "Escape") { e.preventDefault(); cerrar(); }');
    expect(plano(pastilla)).toContain('campo === "invoice_num" ? otraConLaMismaFactura(d.id, valor, deliveries)');
  });

  it("el guardado escribe UN campo, pide las filas y mira si entró", () => {
    const i = proveedor.indexOf('const ponerDocumento = useCallback');
    const tramo = plano(proveedor.slice(i, proveedor.indexOf("[supabase, notify, logEvent, teaching, deliveries, updateDelivery]", i)));
    expect(i).toBeGreaterThan(0);
    expect(tramo).toContain('.from("deliveries").update({ [campo]: valor }).eq("id", id).select("id")');
    expect(tramo).toContain("const fallo = falloAlGuardarDocumento(error, data);");
    expect(tramo).toContain('if (fallo) { notify("Error: " + fallo); return false; }');
    expect(tramo).toContain("const valor = valorDeDocumento(escrito); if (!valor) return false;");
  });
});

describe("125: lo que la base le abre a ventas es lo mismo que la pantalla le ofrece", () => {
  const dir = "supabase/migrations";
  const nombre = "125_ventas_pone_la_factura.sql";
  const sql = leer(`${dir}/${nombre}`);
  const ejecutable = sql.split("\n").map((l) => l.replace(/--.*$/, "")).join("\n");
  const guard = (texto: string) => {
    const i = texto.search(/create or replace function public\.guard_delivery_stage\(\)/i);
    const j = texto.search(/\bend \$function\$\s*;/i);
    if (i < 0 || j < 0) throw new Error("no encuentro el guard");
    return texto.slice(i, j);
  };
  const conGuard = readdirSync(join(process.cwd(), dir))
    .filter((f) => f.endsWith(".sql") && leer(`${dir}/${f}`).includes("function public.guard_delivery_stage"))
    .sort();
  const yo = conGuard.indexOf(nombre);
  /** El bloque nuevo, sin comentarios: desde su `if r = 'sales' and old_stage not in` hasta su `end if;`. */
  const bloque = (() => {
    const g = plano(guard(ejecutable));
    const i = g.indexOf("if r = 'sales' and old_stage not in");
    const fin = "if probe is not distinct from OLD then return NEW; end if; end if;";
    return i < 0 ? "" : g.slice(i, g.indexOf(fin, i) + fin.length);
  })();
  /** Las condiciones como conjunto: el orden de los `and` no cambia lo que deciden. */
  const condiciones = bloque.slice(3, bloque.indexOf(" then ")).split(/\s+and\s+(?![^()]*\))/).map((c) => c.trim()).sort();

  it("parte de la definición vigente: la inmediatamente anterior que define el guard", () => {
    expect(yo).toBeGreaterThanOrEqual(1);
    expect(conGuard[yo - 1]).toBe("123_cuentas_con_aprobacion.sql");
  });

  it("es la ANTERIOR con un solo cambio: quitado el bloque, queda idéntica", () => {
    expect(bloque).not.toBe("");
    const anterior = plano(guard(leer(`${dir}/${conGuard[yo - 1]}`).split("\n").map((l) => l.replace(/--.*$/, "")).join("\n")));
    expect(plano(plano(guard(ejecutable)).replace(bloque, ""))).toBe(anterior);
  });

  it("las cinco condiciones, como conjunto", () => {
    expect(condiciones).toEqual([
      "(OLD.created_by = auth.uid() or OLD.assigned_sales_rep = auth.uid())",
      "coalesce(btrim(NEW.invoice_num), '') <> ''",
      "coalesce(btrim(OLD.invoice_num), '') = ''",
      "old_stage not in ('draft','rejected','canceled')",
      "r = 'sales'",
    ]);
  });

  it("solo cambia la factura: a la copia se le devuelven dos columnas y nada más", () => {
    const cuerpo = bloque.slice(bloque.indexOf(" then ") + 6);
    const devueltas = [...cuerpo.matchAll(/probe\.(\w+)\s*:=\s*OLD\.(\w+);/g)].map((m) => [m[1], m[2]]);
    expect(devueltas.sort()).toEqual([["invoice_num", "invoice_num"], ["updated_at", "updated_at"]]);
    expect(cuerpo.startsWith("probe := NEW;")).toBe(true);
    expect(cuerpo).toContain("if probe is not distinct from OLD then return NEW; end if;");
  });

  it("va dentro de «misma etapa» y ANTES del rechazo por etapa", () => {
    const g = plano(guard(ejecutable));
    const misma = g.indexOf("if new_stage is not distinct from old_stage then");
    const rechazo = g.indexOf("raise exception 'You cannot edit an order in the % stage'");
    expect(misma).toBeGreaterThan(0);
    expect(g.indexOf(bloque)).toBeGreaterThan(misma);
    expect(g.indexOf(bloque)).toBeLessThan(rechazo);
  });

  it("las etapas que la base excluye son las que la regla de la pantalla no marca", () => {
    const enSql = /old_stage not in \(([^)]*)\)/.exec(bloque)![1].split(",").map((s) => s.trim().replace(/'/g, "")).sort();
    const enApp = STAGES.map((s) => s.key).filter((k) => !documentoPendiente(orden({ stage: k }), reglas)).sort();
    expect(enSql).toEqual(enApp);
  });

  it("no lleva transacción propia, no escribe datos, no toca trigger ni políticas", () => {
    expect(ejecutable).not.toMatch(/^\s*(begin|commit|rollback)\s*;/im);
    expect(ejecutable).not.toMatch(/\bupdate\s+public\.|\bdelete\s+from|drop\s+(function|trigger|policy)|create\s+(trigger|policy)|alter\s+policy|\bgrant\b|\brevoke\b/i);
  });

  it("se comprueba a sí misma tras aplicarse: lo nuevo y lo heredado de la 118, 122 y 123", () => {
    const auto = plano(ejecutable.slice(ejecutable.indexOf("do $comprueba$")));
    for (const pieza of [
      "probe.invoice_num := OLD.invoice_num;",
      "OLD.created_by = auth.uid() or OLD.assigned_sales_rep = auth.uid()",
      "account_requires_approval(NEW.account)",
      "A delivered order is not canceled",
      "A cancellation reason is history",
      "tgname = 'deliveries_guard_stage'",
    ]) {
      expect(auto, pieza).toContain(pieza);
      // Y lo que busca ESTÁ en el guard que acaba de definir: si no, reventaría al aplicarse.
      if (!pieza.startsWith("tgname")) expect(plano(guard(ejecutable)), pieza).toContain(pieza);
    }
  });

  it("el ensayo se hace pasar por los tres roles y dice qué se espera antes y después", () => {
    for (const rol of ["vendedor", "chofer", "office"]) expect(sql).toContain(`{"sub":"<uuid-${rol}>","role":"authenticated"}`);
    expect(sql).toContain("-- ANTES:   BLOQUEADO en los siete");
    expect(sql).toContain("-- DESPUES: 1 PERMITIDO · 2 BLOQUEADO · 3 BLOQUEADO · 4 BLOQUEADO");
    expect(sql).toContain("--   rollback;");
  });

  it("se auto-registra y no lleva el marcador sin numerar", () => {
    const [, despues] = sql.split("-- @ledger-below");
    expect(despues).toContain(nombre);
    expect(sql).not.toContain("D-" + "NEXT");
  });
});
