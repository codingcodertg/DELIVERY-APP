import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { PASOS, pasoCompleto, pasosVisibles, primerHueco, respuestasParaGuardar } from "./pasos";
import { cuentaComoPerdida, perdidaDeMerma, repartoDeReporte, tieneCrma, totalesPorTienda } from "./perdida";
import { DEMO_REPORTES, mermaParaEnviar } from "./datos";

/**
 * Corrección del pedido 714584e6. Roberto pidió quitar «¿de dónde viene?» y el CRMA del formulario de merma y 18 minutos
 * después escribió en el mismo hilo: «Disregard this request. It does apply BUT the CRMA is optional and if CRMA is
 * filled then it sums the loss, if no CRMA then no loss». Warehouse Ops 0.4.0 salió sin las dos preguntas; esto las
 * devuelve, con el CRMA opcional y la regla de pérdida de esa frase leída al pie de la letra (migración 263).
 */
const lee = (ruta: string) => readFileSync(join(process.cwd(), ruta), "utf8").replace(/\r\n/g, "\n");
const SQL = lee("supabase/migrations/263_merma_crma_opcional.sql");
const SQL_259 = lee("supabase/migrations/259_merma_perdida_solo_danadas.sql");
const ASISTENTE = lee("src/app/operaciones/Asistente.tsx");
const LISTA = lee("src/app/operaciones/ListaDeReportes.tsx");

const producto = { id: 7, sku: "S", name: "N", cost: 1, pieces_per_box: 10 };
const qty = { boxes: 3, piecesPerBox: 10, loosePieces: 0 }; // 30 piezas
const split = { damaged: 27, sample: 3 };
const interno = { product: producto, qty, split, return_type: "internal", reason: "forklift", broken_on: "2020-01-01", photo: ["data:image/jpeg;base64,/9j/"] }; // 266: la fecha del daño es obligatoria; 268: y la foto
const devolucion = { ...interno, return_type: "customer_return" };
const DAN = "coalesce(damaged_pieces, case when scrap_type = 'sample' then 0 else total_pieces end)";

describe("las dos preguntas vuelven a su sitio en el formulario de merma", () => {
  it("el orden de D-893 / D-894, reordenado por Roberto (D-919): origen después de la cantidad; CRMA justo después del origen", () => {
    expect(PASOS.scrap.map((p) => p.id)).toEqual(["product", "photo", "qty", "return_type", "crma", "reason", "comments", "when_and_who"]);
    const origen = PASOS.scrap.find((p) => p.id === "return_type")!;
    expect(origen.en).toBe("Where did it come from?");
    expect(origen.tipo === "opcion" && origen.opciones.map((o) => [o.v, o.en])).toEqual([["internal", "Internal"], ["customer_return", "Customer return"]]);
  });
  it("el CRMA solo sale en «Customer return»", () => {
    expect(pasosVisibles("scrap", interno).map((p) => p.id)).toEqual(["product", "photo", "qty", "return_type", "reason", "comments", "when_and_who"]);
    expect(pasosVisibles("scrap", devolucion).map((p) => p.id)).toEqual(["product", "photo", "qty", "return_type", "crma", "reason", "comments", "when_and_who"]);
    expect(pasosVisibles("scrap", {}).some((p) => p.id === "crma")).toBe(false);
  });
  it("el origen sí es obligatorio (como antes de la 0.4.0)", () => {
    const sinOrigen = { product: producto, qty, split, reason: "forklift", broken_on: "2020-01-01", photo: ["data:image/jpeg;base64,/9j/"] }; // 268: la merma ya no se envía sin foto
    expect(pasosVisibles("scrap", sinOrigen)[primerHueco("scrap", sinOrigen)].id).toBe("return_type");
    expect(primerHueco("scrap", interno)).toBe(-1);
  });
});

describe("el CRMA es opcional", () => {
  const crma = PASOS.scrap.find((p) => p.id === "crma")!;
  it("lo dice la pregunta y el paso se deja pasar vacío", () => {
    expect(crma.en).toBe("CRMA / claim # (optional)");
    expect(crma.es).toBe("CRMA / n.º de reclamo (opcional)");
    expect("opcional" in crma && crma.opcional).toBe(true);
    expect(pasoCompleto(crma, devolucion)).toBe(true);
    expect(pasoCompleto(crma, { ...devolucion, crma: "" })).toBe(true);
    expect(pasoCompleto(crma, { ...devolucion, crma: "CR-2291" })).toBe(true);
  });
  it("una devolución de cliente se envía con o sin CRMA", () => {
    expect(primerHueco("scrap", devolucion)).toBe(-1);
    expect(primerHueco("scrap", { ...devolucion, crma: "   " })).toBe(-1);
    expect(primerHueco("scrap", { ...devolucion, crma: "7" })).toBe(-1);
  });
  it("lo que se envía: el origen elegido y el CRMA recortado, o null si no hay", () => {
    expect(mermaParaEnviar(devolucion)).toEqual({
      scrap_type: "mixed", damaged_pieces: 27, sample_pieces: 3, boxes: 3, pieces_per_box: 10, loose_pieces: 0,
      return_type: "customer_return", reason: "forklift", broken_by: [], crma: null,
    });
    expect(mermaParaEnviar({ ...devolucion, crma: "  CR-2291 " }).crma).toBe("CR-2291");
    expect(mermaParaEnviar({ ...devolucion, crma: "   " }).crma).toBeNull();
    // Escrito y luego cambiado a interno: no viaja.
    expect(mermaParaEnviar({ ...interno, crma: "CR-1" })).toMatchObject({ return_type: "internal", crma: null });
    expect(respuestasParaGuardar("scrap", { ...interno, crma: "CR-1" }).crma).toBeUndefined();
  });
  it("la base ya no lo exige (la 254 y la 259 sí)", () => {
    expect(SQL_259).toContain("raise exception 'warehouse_ops: falta el CRMA de la devolucion'");
    expect(SQL).not.toMatch(/raise exception 'warehouse_ops: falta el CRMA/);
    expect(SQL).not.toContain("if v_origen = 'customer_return' and v_crma is null then");
    expect(SQL).toContain("raise exception '263: warehouse_ops_file_report sigue exigiendo el CRMA'");
  });
});

describe("la pérdida: los tres casos de Roberto (sobre las piezas dañadas, pedido 0c2fb392)", () => {
  it("merma interna: costo × piezas dañadas, igual que antes", () => {
    expect(perdidaDeMerma(1, split, { return_type: "internal", crma: null })).toBe(27);
    expect(perdidaDeMerma(1, split)).toBe(27); // sin origen (llamadas viejas): cuenta
    expect(perdidaDeMerma(1, split, { return_type: null, crma: null })).toBe(27); // reporte viejo sin origen
    expect(perdidaDeMerma(null, split, { return_type: "internal" })).toBeNull(); // sin costo sigue sin monto
  });
  it("devolución de cliente CON CRMA: costo × piezas dañadas", () => {
    expect(perdidaDeMerma(1, split, { return_type: "customer_return", crma: "CR-2291" })).toBe(27);
    expect(perdidaDeMerma(2.5, { damaged: 6, sample: 2 }, { return_type: "customer_return", crma: "7" })).toBe(15);
    expect(perdidaDeMerma(null, split, { return_type: "customer_return", crma: "CR-1" })).toBeNull();
  });
  it("devolución de cliente SIN CRMA: $0", () => {
    expect(perdidaDeMerma(1, split, { return_type: "customer_return", crma: null })).toBe(0);
    expect(perdidaDeMerma(1, split, { return_type: "customer_return" })).toBe(0);
    expect(perdidaDeMerma(1, split, { return_type: "customer_return", crma: "   " })).toBe(0); // solo espacios no es un CRMA
    expect(perdidaDeMerma(null, split, { return_type: "customer_return", crma: "" })).toBe(0); // tampoco con producto sin costo
  });
  it("qué cuenta y qué no", () => {
    expect(cuentaComoPerdida({ return_type: "internal", crma: null })).toBe(true);
    expect(cuentaComoPerdida({ return_type: "customer_return", crma: "CR-1" })).toBe(true);
    expect(cuentaComoPerdida({ return_type: "customer_return", crma: null })).toBe(false);
    expect(cuentaComoPerdida(null)).toBe(true);
    expect(cuentaComoPerdida({})).toBe(true);
    expect(tieneCrma(" x ")).toBe(true);
    expect(tieneCrma("  ")).toBe(false);
    expect(tieneCrma(null)).toBe(false);
  });
  it("las respuestas del formulario sirven tal cual de origen (paso, resumen)", () => {
    expect(perdidaDeMerma(producto.cost, split, interno)).toBe(27);
    expect(perdidaDeMerma(producto.cost, split, devolucion)).toBe(0);
    expect(perdidaDeMerma(producto.cost, split, { ...devolucion, crma: "CR-2291" })).toBe(27);
    // Antes de contestar el origen (el paso de la cantidad va primero) se enseña la cuenta normal.
    expect(perdidaDeMerma(producto.cost, split, { product: producto, qty, split } as Record<string, unknown>)).toBe(27);
  });
});

describe("la regla sale en todos los sitios donde se calcula o se enseña la pérdida", () => {
  it("el formulario (paso de la cantidad, paso del CRMA y resumen) dice por qué es $0", () => {
    expect(ASISTENTE).toContain("const cuenta = cuentaComoPerdida(r);");
    expect(ASISTENTE).toContain("const total = perdidaDeMerma(p.cost, s, r);");
    expect(ASISTENTE).toContain('t("No CRMA: not counted as loss. A manager can add the CRMA later and it will count."');
    expect(ASISTENTE).toContain('{paso.id === "crma" && <Perdida r={r} />}');
    expect(ASISTENTE).toContain('{tipo === "scrap" && <Perdida r={r} grande />}');
  });
  it("la tarjeta del reporte: origen, CRMA (o «todavía no») y el porqué del $0", () => {
    expect(LISTA).toContain('t("No CRMA: not counted as loss", "Sin CRMA: no cuenta como pérdida")');
    expect(LISTA).toContain('data-cuenta-como-perdida={cuentaComoPerdida(r) ? "si" : "no"}');
    expect(LISTA).toContain('{r.crma || t("Not yet", "Todavía no")}');
    expect(LISTA).toContain('<dt>{t("Where from", "De dónde")}</dt><dd data-origen-reporte={r.return_type ?? ""}>');
  });
  it("la fila de la lista y la explicación de los totales", () => {
    expect(LISTA).toContain('${fmtMoney(r.total_loss)}${cuentaComoPerdida(r) ? "" : ` (${t("no CRMA", "sin CRMA")})`}');
    // (La explicación de los totales se quitó de la pantalla: dueño, 10 nov. La regla sigue en la fila: «sin CRMA».)
  });
  it("la corrección de producto del gerente recalcula con el origen y el CRMA del reporte", () => {
    expect(LISTA).toContain("const total = (c: number | null) => perdidaDeMerma(c, repartoDeReporte(r), r);");
  });
  it("los totales por tienda: una devolución sin CRMA suma $0; con CRMA, suma", () => {
    const r7 = DEMO_REPORTES.find((r) => r.id === "r7")!; // devolución de cliente sin CRMA, 4 dañadas a $6.25
    expect(r7.return_type).toBe("customer_return");
    expect(r7.crma).toBeNull();
    expect(r7.total_loss).toBe(0);
    for (const r of DEMO_REPORTES.filter((x) => x.kind === "scrap")) {
      expect(r.total_loss).toBe(perdidaDeMerma(r.unit_cost, repartoDeReporte(r), r));
    }
    const mermas = DEMO_REPORTES.filter((r) => r.kind === "scrap");
    const ahora = new Date();
    expect(totalesPorTienda(mermas, ahora).Harlingen.todo).toBe(0);
    const conCrma = mermas.map((r) => (r.id === "r7" ? { ...r, crma: "CR-9", total_loss: perdidaDeMerma(r.unit_cost, repartoDeReporte(r), { ...r, crma: "CR-9" }) } : r));
    expect(totalesPorTienda(conCrma, ahora).Harlingen.todo).toBe(25);
    expect(totalesPorTienda(conCrma, ahora)["*"].todo).toBe(72); // 47 + 25
  });
});

describe("el CRMA suele llegar después: el gerente lo pone desde «Link / edit» y la pérdida lo sigue", () => {
  it("la corrección trae el origen y el CRMA, junto a la de producto y con el mismo botón", () => {
    expect(LISTA).toContain("{corrigiendo && <CorregirOrigen r={r} ctx={ctx} onListo={(n) => { setCorrigiendo(false); if (n) onCambio(n); }} />}");
    expect(LISTA).toContain('data-campo="corregir-origen"');
    expect(LISTA).toContain('data-campo="corregir-crma"');
    expect(LISTA).toContain('t("CRMA / claim # (optional)", "CRMA / n.º de reclamo (opcional)")');
    expect(LISTA).toContain('{r.product_not_in_catalog ? t("Link / edit", "Vincular / editar") : t("Edit", "Editar")}');
  });
  it("al guardar, la tarjeta y la lista quedan con la pérdida nueva, la misma que calcula la base", () => {
    expect(LISTA).toContain("const total = perdidaDeMerma(r.unit_cost, repartoDeReporte(r), nuevo);");
    expect(LISTA).toContain("onListo({ ...r, ...nuevo, total_loss: total });");
    expect(LISTA).toContain("await corregirOrigenDeMerma(createClient(), r.id, { origen, crma: nuevo.crma });");
    const r7 = DEMO_REPORTES.find((r) => r.id === "r7")!;
    expect(perdidaDeMerma(r7.unit_cost, repartoDeReporte(r7), { return_type: "customer_return", crma: "CR-9" })).toBe(25); // se pone
    expect(perdidaDeMerma(r7.unit_cost, repartoDeReporte(r7), { return_type: "customer_return", crma: null })).toBe(0);    // se quita
    expect(perdidaDeMerma(r7.unit_cost, repartoDeReporte(r7), { return_type: "internal", crma: null })).toBe(25);          // era interna
  });
  it("la 263 trae la función, con el permiso de corregir producto y la misma cuenta", () => {
    const f = SQL.slice(SQL.indexOf("create or replace function public.warehouse_ops_edit_scrap_origin("), SQL.indexOf("revoke all on function"));
    expect(f).toContain("p_report uuid, p_return_type text, p_crma text\n) returns void");
    expect(f).toContain("security definer set search_path = public");
    expect(f).toContain("raise exception 'warehouse_ops: solo el gerente de la tienda corrige la merma' using errcode = '42501';");
    expect(f).toContain("(p.store = r.store or r.store = any(coalesce(p.visible_stores, '{}')))");
    expect(f).toContain("if v_origen not in ('internal', 'customer_return') then");
    expect(f).toContain("if v_origen <> 'customer_return' then v_crma := null; end if;");
    expect(f).toContain(`total_loss = public.warehouse_ops_scrap_loss(unit_cost, ${DAN}, v_origen, v_crma),`);
    expect(f).toContain("edited_by = yo, edited_at = now()");
    expect(SQL).toContain("revoke all on function public.warehouse_ops_edit_scrap_origin(uuid, text, text) from public, anon;");
    expect(SQL).toContain("grant execute on function public.warehouse_ops_edit_scrap_origin(uuid, text, text) to authenticated;");
  });
});

describe("la 263: la misma cuenta en la base", () => {
  it("una sola función hace la cuenta, con los tres casos", () => {
    expect(SQL).toContain(
      "  select case\n"
      + "    when p_return_type = 'customer_return' and nullif(btrim(coalesce(p_crma, '')), '') is null then 0.00\n"
      + "    when p_cost is null or p_damaged is null then null\n"
      + "    else round(p_cost * p_damaged, 2)\n"
      + "  end");
    expect(SQL).toContain("revoke all on function public.warehouse_ops_scrap_loss(numeric, integer, text, text) from public, anon, authenticated;");
    // La propia migración se comprueba al aplicarse con los mismos casos.
    expect(SQL).toContain("public.warehouse_ops_scrap_loss(1.00, 27, 'internal', null) is distinct from 27.00");
    expect(SQL).toContain("public.warehouse_ops_scrap_loss(1.00, 27, 'customer_return', 'CR-1') is distinct from 27.00");
    expect(SQL).toContain("public.warehouse_ops_scrap_loss(1.00, 27, 'customer_return', null) is distinct from 0");
  });
  it("las tres funciones que escriben total_loss la usan; ninguna hace la cuenta por su lado", () => {
    expect(SQL).toContain("prod.cost, public.warehouse_ops_scrap_loss(prod.cost, v_dan, v_origen, v_crma),");
    expect(SQL).toContain(`total_loss = public.warehouse_ops_scrap_loss(prod.cost, ${DAN}, return_type, crma),`);
    expect(SQL).toContain(`total_loss = public.warehouse_ops_scrap_loss(round(p_cost, 2), ${DAN}, return_type, crma),`);
    const sinComentarios = SQL.split("\n").filter((l) => !l.trimStart().startsWith("--")).join("\n");
    expect(sinComentarios.match(/total_loss = /g)).toHaveLength(4); // las tres funciones (producto: 2 ramas) + el update
    expect(sinComentarios.match(/round\([^;]*\* /g)).toHaveLength(1); // la única multiplicación está en la función de la cuenta
  });
  it("las filas que ya hay se recalculan con esa función (solo cambian las devoluciones sin CRMA)", () => {
    expect(SQL).toContain(`update public.warehouse_reports\n   set total_loss = public.warehouse_ops_scrap_loss(unit_cost, ${DAN}, return_type, crma)\n where kind = 'scrap' and total_pieces is not null\n   and total_loss is distinct from`);
    expect(SQL).toContain("raise exception '263: quedan mermas con la perdida de antes'");
    expect(SQL).toContain("raise exception '263: quedan devoluciones de cliente sin CRMA que cuentan como perdida'");
  });
  it("filas viejas, con la cuenta de la base rehecha aquí", () => {
    // La misma expresión que la función SQL, para comprobar fila por fila lo que hará el update.
    const sql = (f: { unit_cost: number | null; scrap_type: string; total_pieces: number; damaged_pieces?: number | null; sample_pieces?: number | null; return_type: string | null; crma: string | null }) =>
      perdidaDeMerma(f.unit_cost, repartoDeReporte(f), f);
    // De antes de la 254: sin reparto, una sola opción.
    expect(sql({ unit_cost: 2, scrap_type: "damaged", total_pieces: 7, return_type: "internal", crma: null })).toBe(14);
    expect(sql({ unit_cost: 2, scrap_type: "sample", total_pieces: 7, return_type: "internal", crma: null })).toBe(0);
    // De antes de la 254: devolución de cliente, cuando el CRMA era opcional: con y sin.
    expect(sql({ unit_cost: 2, scrap_type: "damaged", total_pieces: 7, return_type: "customer_return", crma: "CR-1" })).toBe(14);
    expect(sql({ unit_cost: 2, scrap_type: "damaged", total_pieces: 7, return_type: "customer_return", crma: null })).toBe(0);
    // De la 254 a la 259: con reparto y CRMA obligatorio; de la 0.4.0: siempre internas.
    expect(sql({ unit_cost: 9.4, scrap_type: "mixed", total_pieces: 7, damaged_pieces: 5, sample_pieces: 2, return_type: "customer_return", crma: "CR-2" })).toBe(47);
    expect(sql({ unit_cost: 9.4, scrap_type: "mixed", total_pieces: 7, damaged_pieces: 5, sample_pieces: 2, return_type: "internal", crma: null })).toBe(47);
    // Sin costo: sigue sin monto, salvo la devolución sin CRMA, que es 0.
    expect(sql({ unit_cost: null, scrap_type: "damaged", total_pieces: 7, return_type: "internal", crma: null })).toBeNull();
    expect(sql({ unit_cost: null, scrap_type: "damaged", total_pieces: 7, return_type: "customer_return", crma: null })).toBe(0);
  });
});

describe("la 263 se aplica ANTES de desplegar: Warehouse Ops 0.4.0 sigue funcionando igual", () => {
  // Lo que manda la pantalla desplegada: siempre interno y sin CRMA (era `mermaParaEnviar` de la 0.4.0).
  const de040 = { scrap_type: "mixed", damaged_pieces: 27, sample_pieces: 3, boxes: 3, pieces_per_box: 10, loose_pieces: 0, return_type: "internal", reason: "forklift", broken_by: [], crma: null };
  it("mismo monto para lo que manda la 0.4.0: costo × dañadas", () => {
    expect(perdidaDeMerma(1, { damaged: de040.damaged_pieces, sample: de040.sample_pieces }, de040)).toBe(27);
    // Y sin return_type sigue siendo interno.
    expect(SQL).toContain("v_origen := coalesce(nullif(p_scrap->>'return_type', ''), 'internal');");
  });
  it("mismas firmas: registrar y corregir producto no cambian de argumentos", () => {
    expect(SQL).toContain("p_kind text, p_store text, p_subject_ids uuid[], p_answers jsonb, p_photos text[], p_scrap jsonb\n) returns uuid");
    expect(SQL).toContain("p_report uuid, p_product_id bigint, p_name text, p_cost numeric\n) returns void");
    expect(SQL).not.toMatch(/^\s*(alter table|drop )/im);
  });
  it("nada de lo que entraba deja de entrar: registrar es la de la 259 menos la exigencia del CRMA", () => {
    const cuerpo = (s: string) => s.slice(s.indexOf("create or replace function public.warehouse_ops_file_report("), s.indexOf("create or replace function public.warehouse_ops_edit_scrap_product(")).split("\n").filter((l) => !l.trimStart().startsWith("--"));
    const antes = cuerpo(SQL_259);
    const ahora = cuerpo(SQL);
    const quitadas = antes.filter((l) => !ahora.includes(l)).map((l) => l.trim());
    const puestas = ahora.filter((l) => !antes.includes(l)).map((l) => l.trim());
    expect(quitadas).toEqual([
      "if v_origen = 'customer_return' and v_crma is null then",
      "raise exception 'warehouse_ops: falta el CRMA de la devolucion';",
      "prod.cost, case when prod.cost is null then null else round(prod.cost * v_dan, 2) end,",
    ]);
    expect(puestas).toEqual(["prod.cost, public.warehouse_ops_scrap_loss(prod.cost, v_dan, v_origen, v_crma),"]);
    // Y el `end if;` de esa comprobación (la línea se repite en la función, por eso se cuenta aparte).
    expect(antes.filter((l) => l.trim() === "end if;").length - ahora.filter((l) => l.trim() === "end if;").length).toBe(1);
  });
  it("las pantallas aún más viejas en caché (0.3.0 con CRMA, o solo scrap_type) y el fuera de catálogo también", () => {
    expect(SQL).toContain("if v_origen not in ('internal', 'customer_return') then");
    expect(SQL).toContain("if p_scrap ? 'damaged_pieces' or p_scrap ? 'sample_pieces' then");
    expect(SQL).toContain("elsif p_scrap->>'scrap_type' = 'sample' then");
    expect(SQL).toContain("p_scrap->>'free_name'");
    expect(SQL).toContain("recruiting.hr_history");
  });
  it("permisos: nada para anon ni políticas de escritura; sin begin/commit propios", () => {
    expect(SQL).toContain("revoke all on function public.warehouse_ops_file_report(text, text, uuid[], jsonb, text[], jsonb) from public, anon;");
    expect(SQL).toContain("revoke all on function public.warehouse_ops_edit_scrap_product(uuid, bigint, text, numeric) from public, anon;");
    expect(SQL).not.toMatch(/create policy [^;]*on public\.warehouse_reports/);
    expect(SQL).not.toMatch(/\b(begin|commit);/i);
  });
  it("lleva su registro con el checksum del cuerpo y ningún D- pendiente", () => {
    const [cuerpo, registro] = SQL.split("-- @ledger-below");
    const sha = createHash("sha256").update(cuerpo, "utf8").digest("hex");
    expect(registro).toContain(`values ('263_merma_crma_opcional.sql', '${sha}')`);
    expect(SQL).not.toContain("D-905");
    expect(SQL).not.toMatch(/D-9\d\d/);
  });
});

describe("lo demás de la 0.4.0 se queda", () => {
  it("nada avanza solo, «Guardar borrador» abajo y un solo selector de tienda", () => {
    expect(ASISTENTE).not.toMatch(/setTimeout\(\(\) => setI\(/);
    const botonera = ASISTENTE.slice(ASISTENTE.indexOf('<footer className="ops-botonera">'), ASISTENTE.indexOf("</footer>"));
    expect(botonera).toContain('data-accion="guardar-borrador"');
    expect(ASISTENTE).toContain("{cambiaTienda && ctx.tiendas.length <= 1 && (\n            <label className=\"ops-tienda\">");
  });
  it("la pérdida sigue siendo solo de las piezas dañadas", () => {
    expect(perdidaDeMerma(0.82, { damaged: 0, sample: 6 }, { return_type: "customer_return", crma: "CR-2291" })).toBe(0);
    expect(perdidaDeMerma(1, { damaged: 27, sample: 3 }, { return_type: "internal" })).toBe(27);
  });
});
