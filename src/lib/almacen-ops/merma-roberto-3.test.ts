import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { ORIGENES_DE_MERMA, PASOS, etiquetaDeOpcion, pasosVisibles, primerHueco } from "./pasos";
import { perdida, perdidaDeMerma, repartoDeReporte, totalesPorTienda } from "./perdida";
import { DEMO_REPORTES, mermaParaEnviar } from "./datos";
import { TIPOS } from "./tipos";

const lee = (ruta: string) => readFileSync(join(process.cwd(), ruta), "utf8").replace(/\r\n/g, "\n");
const SQL = lee("supabase/migrations/259_merma_perdida_solo_danadas.sql");
const ASISTENTE = lee("src/app/operaciones/Asistente.tsx");
const LISTA = lee("src/app/operaciones/ListaDeReportes.tsx");
const CSS = lee("src/app/operaciones/operaciones.css");

const producto = { id: 7, sku: "S", name: "N", cost: 1, pieces_per_box: 10 };
const qty = { boxes: 3, piecesPerBox: 10, loosePieces: 0 }; // 30 piezas, como en la captura de Roberto
const base = { product: producto, qty, split: { damaged: 27, sample: 3 }, reason: "forklift", broken_on: "2020-01-01", photo: ["data:image/jpeg;base64,/9j/"] }; // 266: la fecha del daño es obligatoria; 268: y la foto

describe("0c2fb392: la pérdida solo suma las piezas dañadas", () => {
  it("27 dañadas y 3 de muestra a $1.00 son $27.00, no $30.00", () => {
    expect(perdidaDeMerma(1, { damaged: 27, sample: 3 })).toBe(27);
    expect(perdidaDeMerma(2.5, { damaged: 6, sample: 2 })).toBe(15);
    expect(perdidaDeMerma(0.82, { damaged: 0, sample: 6 })).toBe(0); // todo muestra: nada se pierde
    expect(perdidaDeMerma(null, { damaged: 27, sample: 3 })).toBeNull(); // sin costo sigue sin monto
    expect(perdidaDeMerma(0.335, { damaged: 3, sample: 0 })).toBe(1.01); // a centavos
  });
  it("el formulario (paso y resumen) usa esa cuenta y dice qué piezas contó", () => {
    expect(ASISTENTE).toContain("const total = perdidaDeMerma(p.cost, s, r);"); // 263: además mira el origen y el CRMA
    expect(ASISTENTE).toContain("damaged pieces × ${fmtMoney(p.cost)} per piece");
    expect(ASISTENTE).toContain("sample not counted");
    expect(ASISTENTE).not.toMatch(/perdida\(p\.cost, piezas\)/);
  });
  it("la tarjeta del reporte y la corrección del gerente también", () => {
    expect(LISTA).toContain('t("Loss (damaged pieces only)", "Pérdida (solo piezas dañadas)")');
    expect(LISTA).toContain("perdidaDeMerma(c, repartoDeReporte(r), r)"); // 263: además mira el origen y el CRMA
    expect(LISTA).not.toMatch(/perdida\(c, r\.total_pieces/);
    expect(LISTA).toContain("Loss = damaged pieces × the product's sales price per piece");
  });
  it("los reportes del demo y los totales por tienda cuadran con la regla", () => {
    for (const r of DEMO_REPORTES.filter((x) => x.kind === "scrap")) {
      expect(r.total_loss).toBe(perdidaDeMerma(r.unit_cost, repartoDeReporte(r), r));
    }
    const ahora = new Date();
    const tot = totalesPorTienda(DEMO_REPORTES.filter((r) => r.kind === "scrap"), ahora);
    expect(tot["*"].todo).toBe(47); // 5 dañadas × 9.40 + 0 de las 6 de muestra
    expect(tot.Edinburg.todo).toBe(0);
  });
  it("la 259 recalcula las filas que ya había con su costo congelado y su reparto", () => {
    expect(SQL).toContain("update public.warehouse_reports\n   set total_loss = round(unit_cost * coalesce(damaged_pieces, case when scrap_type = 'sample' then 0 else total_pieces end), 2)");
    expect(SQL).toContain("where kind = 'scrap' and unit_cost is not null and total_pieces is not null");
    expect(SQL).toContain("raise exception '259: quedan mermas con la perdida de todas las piezas'");
  });
  it("la 259 guarda los reportes nuevos y las correcciones con la misma cuenta", () => {
    expect(SQL).toContain("prod.cost, case when prod.cost is null then null else round(prod.cost * v_dan, 2) end,");
    expect(SQL).not.toContain("round(prod.cost * v_total, 2)");
    expect(SQL).toContain("create or replace function public.warehouse_ops_edit_scrap_product(");
    expect(SQL).not.toMatch(/(prod\.cost|p_cost, 2\)) \* total_pieces/);
    expect(SQL.match(/round\((prod\.cost|round\(p_cost, 2\)) \* coalesce\(damaged_pieces, /g)).toHaveLength(2);
  });
  it("la cuenta de siempre (costo × piezas) sigue siendo la base", () => {
    expect(perdida(9.4, 5)).toBe(47);
  });
});

// El pedido 714584e6 quitó «¿de dónde viene?» y el CRMA (Warehouse Ops 0.4.0), pero Roberto lo había retirado en el
// mismo hilo. Las dos preguntas volvieron: ver merma-roberto-4.test.ts. Aquí queda lo que sigue valiendo de la 259.
describe("714584e6 (retirado por Roberto): la 259 y los reportes que se llenaron con Warehouse Ops 0.4.0", () => {
  it("un borrador de la 0.4.0 (sin origen) se abre y lo que lleva se manda como interno", () => {
    expect(mermaParaEnviar(base)).toEqual({
      scrap_type: "mixed", damaged_pieces: 27, sample_pieces: 3, boxes: 3, pieces_per_box: 10, loose_pieces: 0,
      return_type: "internal", reason: "forklift", broken_by: [], crma: null,
    });
    // El resumen le pide el origen antes de enviar (es el único hueco).
    expect(pasosVisibles("scrap", base)[primerHueco("scrap", base)].id).toBe("return_type");
  });
  it("los reportes con devolución de cliente o CRMA se siguen enseñando", () => {
    expect(ORIGENES_DE_MERMA.map((o) => o.v)).toEqual(["internal", "customer_return"]);
    expect(etiquetaDeOpcion("scrap", "return_type", "customer_return", "en")).toBe("Customer return");
    expect(etiquetaDeOpcion("scrap", "return_type", "customer_return", "es")).toBe("Devolución de cliente");
    expect(etiquetaDeOpcion("scrap", "return_type", "internal", "en")).toBe("Internal");
    expect(LISTA).toContain('<dt>{t("Where from", "De dónde")}</dt><dd data-origen-reporte={r.return_type ?? ""}>');
    expect(LISTA).toContain('{(r.crma || r.return_type === "customer_return") && <><dt>CRMA</dt>');
    const r4 = DEMO_REPORTES.find((r) => r.id === "r4")!;
    expect(r4.return_type).toBe("customer_return");
    expect(r4.crma).toBe("CR-2291");
  });
  it("la 259 no exige el origen (sin él es interno) y no borra las columnas", () => {
    expect(SQL).toContain("v_origen := coalesce(nullif(p_scrap->>'return_type', ''), 'internal');");
    expect(SQL).not.toContain("falta de donde viene la merma");
    expect(SQL).not.toMatch(/drop column/i);
  });
});

describe("la 259 se aplica antes de desplegar: sigue aceptando lo que manda Warehouse Ops 0.3.0", () => {
  it("la devolución de cliente con CRMA obligatorio sigue entrando", () => {
    expect(SQL).toContain("if v_origen not in ('internal', 'customer_return') then");
    expect(SQL).toContain("if v_origen = 'customer_return' and v_crma is null then");
    expect(SQL).toContain("if v_origen <> 'customer_return' then v_crma := null; end if;");
  });
  it("el reparto, la pantalla aún más vieja (solo scrap_type) y el fuera de catálogo siguen igual", () => {
    expect(SQL).toContain("if p_scrap ? 'damaged_pieces' or p_scrap ? 'sample_pieces' then");
    expect(SQL).toContain("elsif p_scrap->>'scrap_type' = 'sample' then");
    expect(SQL).toContain("if v_dan < 0 or v_mue < 0 or v_dan + v_mue <> v_total then");
    expect(SQL).toContain("p_scrap->>'free_name'");
    expect(SQL).toContain("recruiting.hr_history");
  });
  it("misma firma y permisos: nada nuevo para anon ni políticas de escritura", () => {
    expect(SQL).toContain("p_kind text, p_store text, p_subject_ids uuid[], p_answers jsonb, p_photos text[], p_scrap jsonb\n) returns uuid");
    expect(SQL).toContain("p_report uuid, p_product_id bigint, p_name text, p_cost numeric\n) returns void");
    expect(SQL).toContain("revoke all on function public.warehouse_ops_edit_scrap_product(uuid, bigint, text, numeric) from public, anon;");
    expect(SQL).toContain("solo el gerente de la tienda corrige la merma");
    expect(SQL).not.toMatch(/create policy [^;]*on public\.warehouse_reports/);
    expect(SQL).not.toMatch(/\b(begin|commit);/i);
  });
  it("lleva su registro con el checksum del cuerpo y ningún D- pendiente", () => {
    const [cuerpo, registro] = SQL.split("-- @ledger-below");
    const sha = createHash("sha256").update(cuerpo, "utf8").digest("hex");
    expect(registro).toContain(`values ('259_merma_perdida_solo_danadas.sql', '${sha}')`);
    expect(SQL).not.toContain("D-902");
  });
});

describe("6f14b2b3: ningún paso avanza solo; siempre se toca Siguiente", () => {
  it("elegir una opción ya no cambia de paso con un temporizador", () => {
    expect(ASISTENTE).not.toMatch(/setTimeout\(\(\) => setI\(/);
    expect(ASISTENTE).toContain("const alElegirUno = () => { setTimeout(() => botonSiguiente.current?.focus(), 0); };");
    expect(ASISTENTE).toContain("onElegirUno={alElegirUno}");
  });
  it("el paso solo cambia en Siguiente, Atrás, el resumen o al empezar otro", () => {
    const cambios = ASISTENTE.match(/setI\(.*?\);/g) ?? [];
    expect([...cambios].sort()).toEqual([
      "setI((n) => n + 1);", // siguiente()
      "setI((n) => n - 1);", // Atrás
      "setI(0);",            // «Llenar otro»
      "setI(n);",            // tocar una fila del resumen
      "setI(pasos.length);", // volver al resumen
    ].sort());
    // Y el único «+ 1» está dentro de siguiente(), que solo llaman el botón y Enter.
    expect(ASISTENTE).toContain("const siguiente = () => {\n    if (volverAlResumen) { setVolverAlResumen(false); setI(pasos.length); return; }\n    setI((n) => n + 1);\n  };");
    expect(ASISTENTE.match(/siguiente\(\)/g)).toHaveLength(1);
    // 268: dos botones avanzan a mano: «Siguiente» y «Lo apunté en papel» (la foto obligatoria se puede dejar para después).
    expect(ASISTENTE.match(/onClick=\{siguiente\}/g)).toHaveLength(2);
  });
  it("vale para los 7 tipos: todos usan el mismo asistente y sus pasos de una opción no saltan", () => {
    expect(TIPOS).toHaveLength(7);
    for (const tipo of TIPOS) {
      expect(PASOS[tipo].length).toBeGreaterThan(0);
    }
    const deUnaOpcion = TIPOS.flatMap((tipo) => PASOS[tipo].filter((p) => p.tipo === "opcion" || p.tipo === "sino" || p.tipo === "persona" || p.tipo === "producto"));
    expect(deUnaOpcion.length).toBeGreaterThan(10);
    // Los cuatro tipos de paso que antes saltaban llaman a onElegirUno, que ahora solo mueve el foco.
    expect(ASISTENTE.match(/onElegirUno\(\)/g)).toHaveLength(4);
  });
  it("Siguiente queda a un toque: el foco va al botón y Enter en un campo corto avanza", () => {
    expect(ASISTENTE).toContain('ref={botonSiguiente} className="ops-boton ops-boton-primario" onClick={siguiente}');
    expect(ASISTENTE).toContain('<div className="ops-pregunta" data-paso={paso.id} onKeyDown={enterAvanza}>');
    expect(ASISTENTE).toContain('if (e.key !== "Enter" || !listo || !(el instanceof HTMLInputElement) || el.type === "search" || el.type === "file") return;');
  });
});

describe("c10078f9: la tienda no se repite abajo del resumen", () => {
  it("con varias tiendas solo sale el selector de arriba; con una sola, el del resumen", () => {
    expect(ASISTENTE).toContain("{cambiaTienda && ctx.tiendas.length > 1 && (\n          <label className=\"ops-tienda ops-tienda-arriba\">");
    expect(ASISTENTE).toContain("{cambiaTienda && ctx.tiendas.length <= 1 && (\n            <label className=\"ops-tienda\">");
    expect(ASISTENTE.match(/data-campo="tienda(-arriba)?"/g)).toHaveLength(2);
  });
});

describe("78b2e1fc: «Guardar borrador» va abajo, con Atrás / Siguiente", () => {
  it("está en la botonera y ya no en la barra de arriba; Cerrar sigue arriba", () => {
    const barra = ASISTENTE.slice(ASISTENTE.indexOf('<span className="ops-asistente-acciones">'), ASISTENTE.indexOf("</header>"));
    const botonera = ASISTENTE.slice(ASISTENTE.indexOf('<footer className="ops-botonera">'), ASISTENTE.indexOf("</footer>"));
    expect(barra).not.toContain('data-accion="guardar-borrador"');
    expect(barra).toContain('data-accion="cerrar"');
    expect(botonera).toContain('data-accion="guardar-borrador"');
    expect(botonera).not.toContain('data-accion="cerrar"');
    expect(ASISTENTE.match(/data-accion="guardar-borrador"/g)).toHaveLength(1);
    // Después de Atrás y Siguiente / Enviar, y con su aviso al lado.
    expect(botonera.indexOf('data-accion="guardar-borrador"')).toBeGreaterThan(botonera.indexOf('data-accion="siguiente"'));
    expect(botonera).toContain('data-aviso="borrador"');
  });
  it("ocupa una fila entera y el teléfono deja hueco para la botonera más alta", () => {
    expect(CSS).toContain(".ops-botonera-entera { grid-column: 1 / -1; margin: 0; }");
    expect(CSS).toContain("@media (max-width: 719.98px) { .ops-asistente { padding-bottom: 64px; } }");
  });
});
