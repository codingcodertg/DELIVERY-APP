import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";
import {
  ETAPAS, EMPRESA, RECORDATORIO_ES, RECORDATORIO_EN, RUTA_DE_HOJA, MAX_EN_HOJA, actorDeEtapa, etapaDe, etapaDerivada, fechaDeEtapa, fechaDeLaEtapaActual,
  filasDeHoja, folioCorto, idsDeConsulta, mensajeDeTransicion, perdidaPorEtapa, puedeCambiarEtapa, puedeDeshacerEtapa, puedeImprimirHoja,
  seleccionableParaHoja, siguienteEtapa, tieneEtapas, tiendasDeHoja, totalDeHoja, transicion, urlDeHoja, type Etapa,
} from "./etapas";
import { DEMO_REPORTES, type Reporte } from "./datos";
import type { Quien } from "./visibilidad";

/**
 * D-921 (migración 270): las etapas de la merma. Roberto (1aeba1e3): «Documented → Photographed → Approved → Dumped»,
 * y «Last step will be 'Adjusted'». La regla vive dos veces (aquí para pintar; en la base para hacerla cumplir): estas
 * pruebas leen el SQL y las pantallas para que no se separen.
 */
const lee = (ruta: string) => readFileSync(join(process.cwd(), ruta), "utf8").replace(/\r\n/g, "\n");
const SQL = lee("supabase/migrations/270_merma_etapas_de_aprobacion.sql");
const LISTA = lee("src/app/operaciones/ListaDeReportes.tsx");
const ETAPAS_TSX = lee("src/app/operaciones/EtapasDeMerma.tsx");
const HOJA = lee("src/app/operaciones/reportes/hoja-de-aprobacion/page.tsx");
const CSS_HOJA = lee("src/app/operaciones/reportes/hoja-de-aprobacion/hoja.css");

const base: Reporte = { ...DEMO_REPORTES[0], id: "11111111-2222-3333-4444-555555555555", photos: [], photo_hashes: null, stage: null, photographed_at: null, approved_at: null, approved_by: null, approval_sheet: null, dumped_at: null, dumped_by: null, adjusted_at: null, adjusted_by: null, adjustment_proof: null };
const conFoto: Reporte = { ...base, photos: ["u/1.jpg"], photographed_at: "2026-11-07T10:00:00Z", stage: "photographed" };
const aprobada: Reporte = { ...conFoto, stage: "approved", approved_at: "2026-11-07T12:00:00Z", approved_by: "g", approval_sheet: "g/hoja-1.jpg" };
const desechada: Reporte = { ...aprobada, stage: "dumped", dumped_at: "2026-11-07T13:00:00Z", dumped_by: "g" };
const ajustada: Reporte = { ...desechada, stage: "adjusted", adjusted_at: "2026-11-07T14:00:00Z", adjusted_by: "g", adjustment_proof: "g/ajuste-1.png" };

const admin: Quien = { id: "a", role: "admin", module_access: [] };
const francis: Quien = { id: "f", role: "manager", store: "McAllen", module_access: ["warehouse_ops"], warehouse_ops_role: "store_admin" };
const gerente: Quien = { id: "g", role: "manager", store: "McAllen", module_access: ["warehouse_ops"] };
const gerenteOtraTienda: Quien = { ...gerente, id: "g2", store: "Harlingen" };
const almacen: Quien = { id: "w", role: "warehouse", store: "McAllen", module_access: ["warehouse_ops"], warehouse_ops_role: "scrap_only" };
const ventas: Quien = { id: "v", role: "sales", store: "McAllen", module_access: ["warehouse_ops"] };

describe("la etapa se deriva igual que el trigger (y así se rellenan las de antes)", () => {
  it("sin foto = documentada; con foto = fotografiada; la fecha más avanzada manda", () => {
    expect(etapaDerivada(base)).toBe("documented");
    expect(etapaDerivada({ ...base, photos: ["u/1.jpg"] })).toBe("photographed");
    expect(etapaDerivada({ ...conFoto, approved_at: "x" })).toBe("approved");
    expect(etapaDerivada({ ...conFoto, approved_at: "x", dumped_at: "y" })).toBe("dumped");
    expect(etapaDerivada({ ...conFoto, dumped_at: "y", adjusted_at: "z" })).toBe("adjusted");
  });
  it("lo que guarda la base gana; sin la 270 (sin columna) se deriva y la fila no tiene etapas", () => {
    expect(etapaDe(aprobada)).toBe("approved");
    const sin270 = { kind: "scrap", created_at: "2026-11-01T00:00:00Z", photos: ["u/1.jpg"] };
    expect(tieneEtapas(sin270)).toBe(false);
    expect(etapaDe(sin270)).toBe("photographed");
    expect(tieneEtapas(base)).toBe(true);
    expect(tieneEtapas({ ...base, stage: undefined })).toBe(false);
  });
  it("las fechas y los actores de cada etapa", () => {
    expect(fechaDeEtapa(base, "documented")).toBe(base.created_at);
    expect(fechaDeEtapa(base, "photographed")).toBeNull();
    expect(fechaDeEtapa(conFoto, "photographed")).toBe("2026-11-07T10:00:00Z");
    expect(fechaDeEtapa({ ...conFoto, photographed_at: null }, "photographed")).toBe(conFoto.created_at);
    expect(fechaDeLaEtapaActual(ajustada)).toBe("2026-11-07T14:00:00Z");
    expect(actorDeEtapa(ajustada, "approved")).toBe("g");
    expect(actorDeEtapa(ajustada, "documented")).toBeNull();
  });
  it("el SQL: el trigger, el orden de la derivación y el relleno de lo existente", () => {
    expect(SQL).toMatch(/create trigger warehouse_reports_stage_guard before insert or update on public\.warehouse_reports/);
    const caso = SQL.indexOf("NEW.stage := case");
    expect(caso).toBeGreaterThan(0);
    const cuerpo = SQL.slice(caso, SQL.indexOf("end;", caso));
    expect(cuerpo.indexOf("'adjusted'")).toBeLessThan(cuerpo.indexOf("'dumped'"));
    expect(cuerpo.indexOf("'dumped'")).toBeLessThan(cuerpo.indexOf("'approved'"));
    expect(cuerpo.indexOf("'approved'")).toBeLessThan(cuerpo.indexOf("'photographed'"));
    expect(cuerpo.indexOf("'photographed'")).toBeLessThan(cuerpo.indexOf("'documented'"));
    // Relleno: tocar las mermas sin etapa para que el trigger las calcule; con fotos, photographed_at = created_at.
    expect(SQL).toMatch(/update public\.warehouse_reports\s+set photographed_at = case when cardinality\(coalesce\(photos, '\{\}'\)\) > 0 then coalesce\(photographed_at, created_at\) end\s+where kind = 'scrap' and stage is null;/);
    expect(SQL).toContain("if NEW.kind <> 'scrap' then\n    NEW.stage := null;");
    expect(SQL).toContain("quedo merma sin etapa");
  });
  it("la migración está completa: idempotente, deshacer en la cabecera, autocomprobación, línea de registro con su checksum", () => {
    expect(SQL).toContain("add column if not exists stage text");
    expect(SQL).toContain("Para deshacer:");
    expect(SQL).toContain("drop function if exists public.warehouse_ops_set_scrap_stage(uuid, text, text);");
    expect(SQL).toContain("-- @ledger-below");
    const sum = createHash("sha256").update(SQL.split("-- @ledger-below")[0], "utf8").digest("hex");
    expect(SQL).toMatch(new RegExp(`insert into public\\.schema_migrations \\(name, checksum\\) values \\('270_merma_etapas_de_aprobacion\\.sql', '${sum}'\\) on conflict \\(name\\) do nothing;\\r?\\n?$`));
    expect(SQL).not.toMatch(/D-921/);
    expect(SQL).not.toMatch(/^\s*begin;\s*$/m);
  });
});

describe("las transiciones: de una en una, hacia adelante, con su adjunto; atrás solo el admin", () => {
  const ok = { ok: true };
  it("el camino feliz del gerente", () => {
    expect(transicion("photographed", "approved", { adjunto: true, admin: false })).toEqual(ok);
    expect(transicion("approved", "dumped", { adjunto: false, admin: false })).toEqual(ok);
    expect(transicion("dumped", "adjusted", { adjunto: true, admin: false })).toEqual(ok);
  });
  it("de documentada no se sale a mano: primero la foto", () => {
    expect(transicion("documented", "photographed", { adjunto: false, admin: true })).toEqual({ ok: false, motivo: "sin-foto" });
    expect(transicion("documented", "approved", { adjunto: true, admin: true })).toEqual({ ok: false, motivo: "sin-foto" });
  });
  it("sin saltos, sin repetir, y aprobada / ajustada exigen el adjunto", () => {
    expect(transicion("photographed", "dumped", { adjunto: true, admin: true })).toEqual({ ok: false, motivo: "salto" });
    expect(transicion("photographed", "approved", { adjunto: false, admin: true })).toEqual({ ok: false, motivo: "falta-adjunto" });
    expect(transicion("dumped", "adjusted", { adjunto: false, admin: true })).toEqual({ ok: false, motivo: "falta-adjunto" });
    expect(transicion("approved", "approved", { adjunto: true, admin: true })).toEqual({ ok: false, motivo: "misma" });
    expect(transicion("approved", "dumped", { adjunto: false, admin: false, esMerma: false })).toEqual({ ok: false, motivo: "no-es-merma" });
  });
  it("hacia atrás: solo el admin, un paso, nunca hasta documentada", () => {
    expect(transicion("approved", "photographed", { adjunto: false, admin: false })).toEqual({ ok: false, motivo: "atras" });
    expect(transicion("approved", "photographed", { adjunto: false, admin: true })).toEqual(ok);
    expect(transicion("adjusted", "approved", { adjunto: false, admin: true })).toEqual({ ok: false, motivo: "atras" });
    expect(transicion("photographed", "documented", { adjunto: false, admin: true })).toEqual({ ok: false, motivo: "atras" });
  });
  it("cada motivo tiene su texto en los dos idiomas", () => {
    for (const m of ["no-es-merma", "sin-foto", "salto", "atras", "falta-adjunto", "misma"] as const) {
      expect(mensajeDeTransicion(m, "en")).not.toBe(mensajeDeTransicion(m, "es"));
    }
  });
  it("la siguiente etapa que se ofrece", () => {
    expect(siguienteEtapa(base)).toBeNull();
    expect(siguienteEtapa(conFoto)).toBe("approved");
    expect(siguienteEtapa(aprobada)).toBe("dumped");
    expect(siguienteEtapa(desechada)).toBe("adjusted");
    expect(siguienteEtapa(ajustada)).toBeNull();
  });
  it("el SQL hace cumplir la misma regla", () => {
    const f = SQL.slice(SQL.indexOf("create or replace function public.warehouse_ops_set_scrap_stage"));
    expect(f).toContain("warehouse_ops_can_see(r.kind, r.store, r.author_id)");
    expect(f).toContain("warehouse_ops_can_manage(r.store)");
    expect(f).toContain("if r.kind <> 'scrap' then");
    expect(f).toContain("in ('admin', 'store_admin')");
    expect(f).toContain("if not admin or de - a <> 1 or p_stage = 'documented' then");
    expect(f).toContain("if r.stage = 'documented' or cardinality(coalesce(r.photos, '{}')) = 0 then");
    expect(f).toContain("if a - de <> 1 then");
    expect(f).toContain("if p_stage in ('approved', 'adjusted') then\n    if p_proof is null or btrim(p_proof) = '' then");
    expect(f).toContain("split_part(p_proof, '/', 1) <> yo::text");
    // Cada transición deja fecha y actor (la bitácora).
    expect(f).toContain("set approved_at = now(), approved_by = yo, approval_sheet = p_proof");
    expect(f).toContain("set dumped_at = now(), dumped_by = yo");
    expect(f).toContain("set adjusted_at = now(), adjusted_by = yo, adjustment_proof = p_proof");
    expect(f).toMatch(/revoke all on function public\.warehouse_ops_set_scrap_stage\(uuid, text, text\) from public, anon;/);
    expect(f).toMatch(/grant execute on function public\.warehouse_ops_set_scrap_stage\(uuid, text, text\) to authenticated;/);
  });
});

describe("quién mueve la etapa", () => {
  it("el gerente / store_admin de la tienda y el admin; nadie más; y nunca sin la 270", () => {
    for (const q of [admin, francis, gerente]) expect(puedeCambiarEtapa(q, conFoto), q.id).toBe(true);
    for (const q of [gerenteOtraTienda, almacen, ventas]) expect(puedeCambiarEtapa(q, conFoto), q.id).toBe(false);
    expect(puedeCambiarEtapa(admin, { ...conFoto, stage: undefined })).toBe(false);
    expect(puedeCambiarEtapa(admin, { ...conFoto, kind: "safety" })).toBe(false);
  });
  it("deshacer: solo admin / store_admin, y solo si hay algo que deshacer", () => {
    expect(puedeDeshacerEtapa(admin, aprobada)).toBe(true);
    expect(puedeDeshacerEtapa(francis, aprobada)).toBe(true);
    expect(puedeDeshacerEtapa(gerente, aprobada)).toBe(false);
    expect(puedeDeshacerEtapa(admin, conFoto)).toBe(false);
    expect(puedeDeshacerEtapa(admin, base)).toBe(false);
  });
  it("para la hoja se marcan las fotografiadas sin aprobar, nada más", () => {
    expect(seleccionableParaHoja(conFoto)).toBe(true);
    expect(seleccionableParaHoja(base)).toBe(false);
    expect(seleccionableParaHoja(aprobada)).toBe(false);
    expect(seleccionableParaHoja({ ...conFoto, kind: "safety" })).toBe(false);
  });
  it("la pantalla: casillas solo para quien gestiona; sin la 270 la tarjeta no ofrece botones", () => {
    // D-963: la selección se amplió a cualquier merma gestionable (para desechar/ajustar en bloque); agrupar filtra a fotografiadas aparte.
    expect(LISTA).toContain('r.kind === "scrap" && puedeCambiarEtapa(ctx.yo, r)');
    expect(LISTA).toContain("seleccionadas.filter((r) => seleccionableParaHoja(r))");
    expect(ETAPAS_TSX).toContain("const gestiona = puedeCambiarEtapa(ctx.yo, r);");
    expect(ETAPAS_TSX).toContain("{gestiona && !accion && (");
    expect(ETAPAS_TSX).not.toMatch(/(?<![\w.`])confirm\(/);
    expect(ETAPAS_TSX).toContain('data-confirmar="dumped"');
  });
});

describe("la lista: columna, filtro por etapa, selección, desglose de la pérdida", () => {
  it("la pestaña de merma lleva la columna «Etapa», el filtro y el botón de imprimir (N)", () => {
    expect(LISTA).toContain("data-filtro-etapas");
    expect(LISTA).toContain("{ETAPAS.map((e) => (");
    expect(LISTA).toContain('data-lista="merma-en-rango" conEtapa');
    expect(LISTA).toContain("Print approval sheet (${paraHoja.length})");
    expect(LISTA).toContain("Attach signed sheet (${paraHoja.length})");
    // Imprimir es ahora un diálogo en la app (no abre otra página): monta <HojaImprimible> con las seleccionadas.
    expect(LISTA).toContain("<HojaImprimible reportes={paraHoja}");
    // «Mis reportes» y la lista general: el chip chico, solo lectura, junto al detalle.
    expect(LISTA).toContain('{!conEtapa && r.kind === "scrap" && <ChipDeEtapa r={r} conFecha={false} />}');
  });
  it("el filtro por etapa deja solo esa etapa", () => {
    const filas = [base, conFoto, aprobada, desechada, ajustada];
    const filtra = (e: Etapa | "") => (e ? filas.filter((r) => etapaDe(r) === e) : filas);
    expect(filtra("")).toHaveLength(5);
    for (const e of ETAPAS) expect(filtra(e).map((r) => etapaDe(r))).toEqual([e]);
  });
  it("la pérdida por etapa: pendiente / aprobada / desechada (ajustada cuenta como desechada), por tienda y total", () => {
    const d = perdidaPorEtapa([
      { ...base, store: "A", total_loss: 10 }, { ...conFoto, store: "A", total_loss: 20 },
      { ...aprobada, store: "B", total_loss: 5 }, { ...desechada, store: "B", total_loss: 7 }, { ...ajustada, store: "A", total_loss: 1 },
      { ...conFoto, kind: "safety", store: "A", total_loss: 99 },
    ]);
    expect(d["*"]).toEqual({ pendiente: 30, aprobada: 5, desechada: 8 });
    expect(d.A).toEqual({ pendiente: 30, aprobada: 0, desechada: 1 });
    expect(d.B).toEqual({ pendiente: 0, aprobada: 5, desechada: 7 });
    expect(LISTA).toContain("data-desglose-etapas");
  });
});

describe("la hoja de aprobación impresa", () => {
  it("los ids de la URL: solo UUID, sin repetidos, hasta el máximo", () => {
    const a = "11111111-2222-3333-4444-555555555555";
    expect(idsDeConsulta(`${a},${a.toUpperCase()},basura,`)).toEqual([a]);
    expect(idsDeConsulta([a, "22222222-2222-3333-4444-555555555555"])).toHaveLength(2);
    expect(idsDeConsulta(undefined)).toEqual([]);
    const muchos = Array.from({ length: MAX_EN_HOJA + 5 }, (_, n) => `${String(n).padStart(8, "0")}-2222-3333-4444-555555555555`);
    expect(idsDeConsulta(muchos.join(","))).toHaveLength(MAX_EN_HOJA);
    expect(urlDeHoja([a, "b"])).toBe(`${RUTA_DE_HOJA}?ids=${encodeURIComponent(`${a},b`)}`);
  });
  it("la puerta: la misma que la vista de gerentes", () => {
    for (const q of [admin, francis, gerente]) expect(puedeImprimirHoja(q), q.id).toBe(true);
    for (const q of [almacen, ventas]) expect(puedeImprimirHoja(q), q.id).toBe(false);
    // La página del servidor la usa antes de pintar, manda al inicio si no pasa, y solo pide merma.
    expect(HOJA).toContain("if (!user) redirect(");
    expect(HOJA).toContain("if (!puedeImprimirHoja({ id: user.id, ...perfil, role: perfil.role ?? \"sales\", warehouse_ops_role: nivel })) redirect(\"/operaciones\");");
    expect(HOJA).toContain('.in("id", ids).eq("kind", "scrap")');
    expect(HOJA).not.toMatch(/service_role|SUPABASE_SERVICE/);
    expect(HOJA).not.toMatch(/^"use client"/m);
  });
  it("lo que va en la hoja: empresa, tienda, fecha, tabla, recordatorio obligatorio y firmas", () => {
    const nombre = (id: string) => ({ p1: "Ana García", p2: "Luis Treviño" }[id] ?? "");
    const filas = filasDeHoja([
      { ...conFoto, id: "aaaaaaaa-0000-0000-0000-000000000001", store: "McAllen", broken_on: "2026-11-05", product_sku: "PORC-1", product_name: "Porcelain", total_loss: 47, reason: "forklift", broken_by: ["p2"], author_id: "p1", author_name: null, scrap_type: "mixed", total_pieces: 7, damaged_pieces: 5, sample_pieces: 2 },
      { ...conFoto, id: "aaaaaaaa-0000-0000-0000-000000000002", store: "Edinburg", broken_on: null, created_at: "2026-11-06T15:00:00Z", product_sku: null, product_name: "Libre", product_not_in_catalog: true, total_loss: null, reason: "x", broken_by: [], author_id: "p1", author_name: "Ana", scrap_type: "damaged", total_pieces: 3, damaged_pieces: null, sample_pieces: null },
      { ...conFoto, id: "aaaaaaaa-0000-0000-0000-000000000003", kind: "safety", store: "McAllen", total_loss: 999 },
    ], nombre, (m) => (m === "forklift" ? "Montacargas" : m ?? ""), (r) => (r.damaged_pieces ?? r.total_pieces ?? 0));
    expect(filas).toHaveLength(2);
    expect(filas[0]).toEqual({ id: "aaaaaaaa-0000-0000-0000-000000000001", folio: "AAAAAAAA", dia: "2026-11-05", producto: "PORC-1 · Porcelain", danadas: 5, perdida: 47, motivo: "Montacargas", rompio: "Luis Treviño", reporto: "Ana García", tienda: "McAllen" });
    expect(filas[1]).toMatchObject({ dia: "2026-11-06", producto: "Libre *", danadas: 3, perdida: null, rompio: "—", reporto: "Ana", tienda: "Edinburg" });
    expect(tiendasDeHoja(filas)).toBe("McAllen / Edinburg");
    expect(totalDeHoja(filas)).toBe(47);
    expect(folioCorto("aaaaaaaa-0000-0000-0000-000000000001")).toBe("AAAAAAAA");

    expect(EMPRESA).toBe("Rodriguez Tile Group");
    expect(RECORDATORIO_ES).toBe("Este formato debe llenarse cada vez que se detecte material dañado. El material no podrá desecharse hasta que se hayan tomado fotografías, guardado la evidencia y obtenido la autorización de Gerencia a través de la aplicación.");
    expect(RECORDATORIO_EN.length).toBeGreaterThan(50);
    expect(HOJA).toContain("<h1>{EMPRESA}</h1>");
    expect(HOJA).toContain("data-hoja-tienda");
    expect(HOJA).toContain("data-hoja-fecha");
    expect(HOJA).toContain("<strong>{RECORDATORIO_ES}</strong>");
    expect(HOJA).toContain("{RECORDATORIO_EN}");
    for (const col of ['t("Folio", "Folio")', '"Date broken", "Fecha del daño"', '"Product", "Producto"', '"Damaged pcs", "Pzas dañadas"', '"Loss", "Pérdida"', '"Reason", "Motivo"', '"Broken by", "Lo rompió"', '"Reported by", "Lo reportó"']) {
      expect(HOJA).toContain(col);
    }
    for (const firma of ['"Warehouse supervisor", "Supervisor de almacén"', '"Manager (approval)", "Gerente (autorización)"']) expect(HOJA).toContain(firma);
    expect(HOJA.match(/className="hoja-firma"/g)).toHaveLength(3);
    // Imprimir con window.print() desde un botón, y el CSS deja solo la hoja.
    expect(lee("src/app/operaciones/reportes/hoja-de-aprobacion/BotonImprimir.tsx")).toContain("window.print()");
    expect(CSS_HOJA).toContain("@media print");
    expect(CSS_HOJA).toContain(".hoja-aprobacion, .hoja-aprobacion * { visibility: visible !important; }");
  });
  it("el cubo admite el PDF de la hoja escaneada y deja ver la hoja y la captura a quien ve el reporte", () => {
    expect(SQL).toContain("'application/pdf'");
    expect(SQL).toContain("name = any(r.photos) or name = r.approval_sheet or name = r.adjustment_proof");
  });
});
