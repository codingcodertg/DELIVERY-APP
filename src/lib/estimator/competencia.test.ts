import { describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { HojaCliente } from "@/app/estimator/HojaCliente";
import { AvisoDeCompetencia, ListaDeCompetencia } from "@/app/estimator/Competencia";
import {
  ACCEPT_DE_COMPETENCIA, CUBO_DE_COMPETENCIA, LIMITES_DE_COMPETENCIA, VALIDEZ_AL_ABRIR, almacenDeCompetenciaDeLaBase,
  estadoDeCompetencia, faltaLaBaseDeCompetencia, filaDeCompetencia, metaVacia, puedeQuitar, rutaDeCompetencia,
  tamanoLegible, tipoDeArchivo, validaArchivos, type ArchivoDeCompetencia,
} from "./competencia";
import { almacenDeCompetenciaDemo } from "./demo";
import { filaDeBorrador } from "./almacen";
import { hojaDelCliente } from "./hoja";
import { borradorVacio, lineaSfVacia, type QuoteDraft } from "./modelo";

const leer = (r: string) => readFileSync(r, "utf8").split("\r\n").join("\n");
const MB = 1024 * 1024;
const t = (en: string) => en;

describe("qué se acepta", () => {
  it("PDF y fotos; un Word no", () => {
    expect(validaArchivos([{ name: "a.pdf", size: 1000, type: "application/pdf" }], 0)).toBeNull();
    expect(validaArchivos([{ name: "a.png", size: 1000, type: "image/png" }, { name: "b.webp", size: 1, type: "image/webp" }], 0)).toBeNull();
    expect(validaArchivos([{ name: "a.docx", size: 1000, type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" }], 0))
      .toEqual({ motivo: "tipo", fichero: "a.docx" });
  });
  it("10 MB justos pasan; un byte más, no", () => {
    expect(validaArchivos([{ name: "a.pdf", size: 10 * MB, type: "application/pdf" }], 0)).toBeNull();
    expect(validaArchivos([{ name: "a.pdf", size: 10 * MB + 1, type: "application/pdf" }], 0)).toEqual({ motivo: "tamano", fichero: "a.pdf" });
  });
  it("cinco por cotización, contando los que ya hay", () => {
    const f = { name: "a.pdf", size: 10, type: "application/pdf" };
    expect(validaArchivos([f, f], 3)).toBeNull();
    expect(validaArchivos([f, f], 4)).toEqual({ motivo: "cuantos" });
    expect(LIMITES_DE_COMPETENCIA.maxPorCotizacion).toBe(5);
  });
  it("un archivo vacío no se sube", () => {
    expect(validaArchivos([{ name: "a.pdf", size: 0, type: "application/pdf" }], 0)).toEqual({ motivo: "vacio", fichero: "a.pdf" });
  });
  it("un .heic sin tipo (Windows) se reconoce por la extensión, y image/jpg es image/jpeg", () => {
    expect(tipoDeArchivo("foto.HEIC", "")).toBe("image/heic");
    expect(tipoDeArchivo("x.jpg", "image/jpg")).toBe("image/jpeg");
    expect(tipoDeArchivo("x.bin", "")).toBe("");
    expect(validaArchivos([{ name: "foto.heic", size: 10, type: "" }], 0)).toBeNull();
    expect(ACCEPT_DE_COMPETENCIA).toContain(".heic");
  });
  it("tamaños legibles", () => {
    expect(tamanoLegible(512)).toBe("512 B");
    expect(tamanoLegible(2048)).toBe("2 KB");
    expect(tamanoLegible(3.5 * MB)).toBe("3.5 MB");
  });
});

describe("dónde se guarda y quién quita", () => {
  it("la ruta empieza por la cotización y el nombre no trae carpetas", () => {
    const r = rutaDeCompetencia("q-1", "../../otra/Estimado Home Depot.pdf", new Date("2026-09-27T10:00:00Z"), "abc");
    expect(r.startsWith("q-1/")).toBe(true);
    expect(r.split("/")).toHaveLength(2);
    expect(r).toContain("Estimado-Home-Depot.pdf");
  });
  it("quita quien lo subió o el admin; nadie más", () => {
    expect(puedeQuitar({ uploaded_by: "u1" }, { id: "u1", admin: false })).toBe(true);
    expect(puedeQuitar({ uploaded_by: "u1" }, { id: "u2", admin: false })).toBe(false);
    expect(puedeQuitar({ uploaded_by: "u1" }, { id: "u2", admin: true })).toBe(true);
    expect(puedeQuitar({ uploaded_by: null }, { id: "", admin: false })).toBe(false);
  });
  it("la fila que se manda no trae quién ni cuándo (los pone el disparador) y limpia lo opcional", () => {
    const f = filaDeCompetencia("q", "q/x.pdf", { name: "x.pdf", size: 10, type: "application/pdf" },
      { competitor: "  Floor Depot ", competitor_total: 2199.999, note: " " });
    expect(Object.keys(f).sort()).toEqual(["competitor", "competitor_total", "file_name", "mime_type", "note", "path", "quote_id", "size_bytes"]);
    expect(f.competitor).toBe("Floor Depot");
    expect(f.competitor_total).toBe(2200);
    expect(f.note).toBeNull();
    expect(filaDeCompetencia("q", "q/x", { name: "x.pdf", size: 1, type: "" }, { ...metaVacia(), competitor_total: -5 }).competitor_total).toBeNull();
  });
});

describe("sin la 153 o sin cotización, la sección lo dice", () => {
  it("el estado de la sección", () => {
    expect(estadoDeCompetencia({ baseCotizaciones: false, baseArchivos: true, quoteId: "q" })).toBe("sin-base");
    expect(estadoDeCompetencia({ baseCotizaciones: true, baseArchivos: false, quoteId: "q" })).toBe("sin-base");
    expect(estadoDeCompetencia({ baseCotizaciones: true, baseArchivos: true, quoteId: null })).toBe("sin-cotizacion");
    expect(estadoDeCompetencia({ baseCotizaciones: null, baseArchivos: null, quoteId: null })).toBe("sin-cotizacion");
    expect(estadoDeCompetencia({ baseCotizaciones: true, baseArchivos: true, quoteId: "q" })).toBe("lista");
  });
  it("«falta la 153» es la tabla o el cubo que no existen; un permiso no", () => {
    expect(faltaLaBaseDeCompetencia({ code: "PGRST205" })).toBe(true);
    expect(faltaLaBaseDeCompetencia({ message: "Bucket not found" })).toBe(true);
    expect(faltaLaBaseDeCompetencia({ code: "42501", message: "new row violates row-level security policy" })).toBe(false);
    expect(faltaLaBaseDeCompetencia(null)).toBe(false);
  });
  it("los avisos, pintados", () => {
    const sinBase = renderToStaticMarkup(createElement(AvisoDeCompetencia, { estado: "sin-base", t }));
    expect(sinBase).toContain("data-competencia-sin-base");
    expect(sinBase).toContain("migration 153");
    const sinCot = renderToStaticMarkup(createElement(AvisoDeCompetencia, { estado: "sin-cotizacion", t }));
    expect(sinCot).toContain("data-competencia-sin-cotizacion");
    // D-432: sin «Search and» delante (la búsqueda ya es automática), así que empieza en mayúscula.
    expect(sinCot).toContain("Save this estimate");
    expect(renderToStaticMarkup(createElement(AvisoDeCompetencia, { estado: "lista", t }))).toBe("");
  });
});

const archivo = (p: Partial<ArchivoDeCompetencia> = {}): ArchivoDeCompetencia => ({
  id: "c1", quote_id: "q", path: "q/x.pdf", file_name: "Estimado-Rival.pdf", mime_type: "application/pdf", size_bytes: 2048,
  competitor: "Floor Rival", competitor_total: 1999.5, note: "dijo que baja", uploaded_by: "u1", uploaded_by_name: "Ana Ventas",
  uploaded_at: "2026-09-27T15:00:00Z", ...p,
});

describe("la lista", () => {
  const pinta = (me: { id: string; name: string; admin: boolean }, archivos = [archivo(), archivo({ id: "c2", file_name: "foto.jpg", mime_type: "image/jpeg", uploaded_by: "u9", uploaded_by_name: "Otro", competitor: null, competitor_total: null, note: null })]) =>
    renderToStaticMarkup(createElement(ListaDeCompetencia, {
      archivos, me, t, lang: "en", confirmando: null, ocupado: false, onAbrir: () => {}, onQuitar: () => {}, onConfirmar: () => {},
    }));
  it("nombre, tamaño, quién, y lo opcional", () => {
    const html = pinta({ id: "u1", name: "Ana", admin: false });
    expect(html).toContain("Estimado-Rival.pdf");
    expect(html).toContain("2 KB");
    expect(html).toContain("Ana Ventas");
    expect(html).toContain("Floor Rival");
    expect(html).toContain("$1,999.50");
    expect(html).toContain("dijo que baja");
    expect(html.match(/data-competencia-abrir/g) ?? []).toHaveLength(2);
  });
  it("«Quitar» solo en lo mío; el admin, en todos", () => {
    expect(pinta({ id: "u1", name: "Ana", admin: false }).match(/data-competencia-quitar/g) ?? []).toHaveLength(1);
    expect(pinta({ id: "u5", name: "X", admin: false }).match(/data-competencia-quitar/g) ?? []).toHaveLength(0);
    expect(pinta({ id: "u5", name: "Admin", admin: true }).match(/data-competencia-quitar/g) ?? []).toHaveLength(2);
  });
});

describe("el demo, en memoria", () => {
  const pdf = () => new File([new Uint8Array([37, 80, 68, 70])], "rival.pdf", { type: "application/pdf" });
  it("sube, lista con quién, abre y quita; el sexto no entra", async () => {
    const me = { id: "u1", name: "Ana", admin: false };
    const d = almacenDeCompetenciaDemo(() => me, false);
    expect((await d.disponible()).ok).toBe(true);
    for (let i = 0; i < 5; i += 1) expect((await d.subir("q", pdf(), metaVacia())).ok).toBe(true);
    expect((await d.subir("q", pdf(), metaVacia())).ok).toBe(false);
    const l = await d.listar("q");
    expect(l.ok && l.valor.length).toBe(5);
    expect(l.ok && l.valor[0].uploaded_by_name).toBe("Ana");
    expect((await d.listar("otra")).ok && (await d.listar("otra"))).toMatchObject({ valor: [] });
    const a = l.ok ? l.valor[0] : archivo();
    const url = await d.abrir(a);
    expect(url.ok && url.valor.startsWith("blob:")).toBe(true);
    expect((await d.quitar(a)).ok).toBe(true);
    const l2 = await d.listar("q");
    expect(l2.ok && l2.valor.length).toBe(4);
  });
  it("otro vendedor no quita lo mío; el admin sí", async () => {
    let me = { id: "u1", name: "Ana", admin: false };
    const d = almacenDeCompetenciaDemo(() => me, false);
    const s = await d.subir("q", pdf(), metaVacia());
    const a = s.ok ? s.valor : archivo();
    me = { id: "u2", name: "Beto", admin: false };
    expect((await d.quitar(a)).ok).toBe(false);
    me = { id: "u3", name: "Admin", admin: true };
    expect((await d.quitar(a)).ok).toBe(true);
  });
  it("con ?sinTabla=1 se comporta como la base sin la 153", async () => {
    const d = almacenDeCompetenciaDemo(() => ({ id: "u1", name: "A", admin: false }), true);
    const r = await d.disponible();
    expect(r.ok === false && r.sinTabla).toBe(true);
    const s = await d.subir("q", pdf(), metaVacia());
    expect(s.ok === false && s.sinTabla).toBe(true);
  });
});

/** Un cliente de Supabase de mentira: lo justo para ver qué llama el almacén y en qué orden. */
function falsoSupabase(o: { removeData?: unknown[]; insertError?: { message: string } | null; selectError?: { code: string; message: string } | null }) {
  const llamadas: string[] = [];
  const cubo = {
    upload: vi.fn(async () => { llamadas.push("upload"); return { data: {}, error: null }; }),
    remove: vi.fn(async () => { llamadas.push("remove"); return { data: o.removeData ?? [{}], error: null }; }),
    createSignedUrl: vi.fn(async (_p: string, s: number) => { llamadas.push(`firmar:${s}`); return { data: { signedUrl: "https://firmado" }, error: null }; }),
  };
  const tabla = {
    select: vi.fn(() => tabla), eq: vi.fn(() => tabla), order: vi.fn(async () => ({ data: [], error: o.selectError ?? null })),
    limit: vi.fn(async () => ({ data: [], error: o.selectError ?? null })),
    insert: vi.fn(() => ({ select: async () => { llamadas.push("insert"); return { data: o.insertError ? null : [archivo()], error: o.insertError ?? null }; } })),
    delete: vi.fn(() => ({ eq: () => ({ select: async () => { llamadas.push("delete"); return { data: [{ id: "c1" }], error: null }; } }) })),
  };
  const sb = { storage: { from: vi.fn(() => cubo) }, from: vi.fn(() => tabla) } as unknown as SupabaseClient;
  return { sb, llamadas, cubo };
}

describe("el almacén de la base", () => {
  const f = () => new File([new Uint8Array([1])], "r.pdf", { type: "application/pdf" });
  it("si la fila no entra, el archivo recién subido se retira (no gasta cuota invisible)", async () => {
    const { sb, llamadas } = falsoSupabase({ insertError: { message: "new row violates row-level security policy" } });
    const r = await almacenDeCompetenciaDeLaBase(sb).subir("q", f(), metaVacia());
    expect(r.ok).toBe(false);
    expect(llamadas).toEqual(["upload", "insert", "remove"]);
  });
  it("quitar: un remove que la política no deja pasar vuelve vacío y NO es quitado; la fila no se toca", async () => {
    const { sb, llamadas } = falsoSupabase({ removeData: [] });
    const r = await almacenDeCompetenciaDeLaBase(sb).quitar(archivo());
    expect(r.ok).toBe(false);
    expect(llamadas).toEqual(["remove"]);
  });
  it("quitar: primero el archivo, luego la fila", async () => {
    const { sb, llamadas } = falsoSupabase({});
    expect((await almacenDeCompetenciaDeLaBase(sb).quitar(archivo())).ok).toBe(true);
    expect(llamadas).toEqual(["remove", "delete"]);
  });
  it("abrir firma un enlace de un minuto en el cubo de la 153", async () => {
    const { sb, llamadas } = falsoSupabase({});
    const r = await almacenDeCompetenciaDeLaBase(sb).abrir(archivo());
    expect(r).toEqual({ ok: true, valor: "https://firmado" });
    expect(llamadas).toEqual([`firmar:${VALIDEZ_AL_ABRIR}`]);
    expect(VALIDEZ_AL_ABRIR).toBe(60);
    expect((sb.storage.from as unknown as { mock: { calls: unknown[][] } }).mock.calls[0][0]).toBe(CUBO_DE_COMPETENCIA);
  });
  it("sin la tabla, disponible() dice sinTabla", async () => {
    const { sb } = falsoSupabase({ selectError: { code: "PGRST205", message: "Could not find the table" } });
    const r = await almacenDeCompetenciaDeLaBase(sb).disponible();
    expect(r.ok === false && r.sinTabla).toBe(true);
  });
});

describe("ES INTERNO: la hoja del cliente no lo lleva nunca", () => {
  const COMPETIDOR = "Rival Tiles Secreto";
  const ARCHIVO = "estimado-rival-9931.pdf";
  const borrador = (): QuoteDraft => ({
    ...borradorVacio("2026-09-30"), estimate_num: "E-77", sales_ext: "214",
    customer: { salutation: "Ms.", full_name: "Ana Prueba", company: "", phone: "" },
    lines: [{ ...lineaSfVacia(), customer_category: "24x48 Tile", requested_sf: 100, sf_per_box: 10, price_per_sf: 2 }],
  });

  it("aunque el borrador llegue con los archivos colgando, la hoja y lo que se pinta no los mencionan", () => {
    const conAdjuntos = { ...borrador(), competitor_files: [archivo({ file_name: ARCHIVO, competitor: COMPETIDOR, competitor_total: 4321.09 })] } as QuoteDraft;
    const hoja = hojaDelCliente(conAdjuntos);
    const html = renderToStaticMarkup(createElement(HojaCliente, { hoja }));
    for (const s of [JSON.stringify(hoja), html]) {
      for (const p of [COMPETIDOR, ARCHIVO, "4,321.09", "4321.09", "competitor", "Competitor"]) expect(s, p).not.toContain(p);
    }
  });
  it("la cotización guardada tampoco los lleva: no son parte del borrador", () => {
    const fila = filaDeBorrador({ ...borrador(), competitor_files: [archivo()] } as QuoteDraft);
    expect(JSON.stringify(fila)).not.toContain("Floor Rival");
    expect(Object.keys(fila)).not.toContain("competitor_files");
  });
  it("ni hoja.ts ni HojaCliente.tsx conocen la competencia", () => {
    for (const r of ["src/lib/estimator/hoja.ts", "src/app/estimator/HojaCliente.tsx"]) {
      expect(leer(r), r).not.toMatch(/competencia|competitor|Competencia/i);
    }
  });
  it("la pantalla pinta la sección una vez, FUERA de la vista previa que se imprime", () => {
    const pantalla = leer("src/app/estimator/Estimador.tsx");
    expect(pantalla.match(/<SeccionCompetencia /g) ?? []).toHaveLength(1);
    const seccion = pantalla.indexOf("<SeccionCompetencia ");
    const vista = pantalla.indexOf("data-vista-previa");
    expect(seccion).toBeGreaterThan(0);
    expect(vista).toBeGreaterThan(0);
    expect(seccion).toBeLessThan(vista);
    // Y no está dentro de ningún otro bloque que se imprima: la hoja es lo único visible al imprimir.
    expect(pantalla.slice(vista)).not.toContain("Competencia");
  });
  it("al imprimir, la sección se quita además del todo", () => {
    const css = leer("src/app/estimator/estimator.css");
    const print = css.slice(css.indexOf("@media print"));
    expect(print).toContain(".est-competencia, .est-competencia * { display: none !important; }");
    expect(leer("src/app/estimator/Competencia.tsx")).toContain("className={`card est-competencia");
  });
});

describe("la pantalla usa estas piezas", () => {
  const pantalla = leer("src/app/estimator/Estimador.tsx");
  const seccion = leer("src/app/estimator/Competencia.tsx");
  it("la sección recibe la cotización abierta y si hay base de cotizaciones", () => {
    // D-466 añadió las lecturas y las líneas propias en la línea siguiente; lo de D-425 sigue igual.
    expect(pantalla).toContain("<SeccionCompetencia almacen={almacenCompetencia} quoteId={quoteId} me={me} baseCotizaciones={baseDisponible} t={t} lang={lang}\n");
    expect(pantalla).toContain("demo ? almacenDeCompetenciaDemo(() => meRef.current, sinTablaDemo, sin156Demo) : almacenDeCompetenciaDeLaBase(createClient())");
  });
  it("decide su estado, valida antes de subir y solo deja quitar a quien puede", () => {
    expect(seccion).toContain("const estado = estadoDeCompetencia({ baseCotizaciones, baseArchivos, quoteId });");
    expect(seccion).toContain("if (!quoteId || !pendientes.length || estado !== \"lista\") return;");
    expect(seccion).toContain("const fallo = validaArchivos(juntos, archivos.length);");
    expect(seccion).toContain("{puedeQuitar(a, me) && (confirmando === a.id ? (");
    expect(seccion).toContain("if (r.sinTabla) { setBaseArchivos(false); setOcupado(false); return; }");
    expect(seccion).toContain("<CampoDecimal value={p.meta.competitor_total}");
  });
});

describe("la migración 153", () => {
  const SQL = leer("supabase/migrations/153_estimados_competencia.sql");
  const cuerpo = SQL.split("\n").filter((l) => !l.trim().startsWith("--")).join("\n");
  it("cubo privado de 10 MB con los mismos tipos que la pantalla", () => {
    expect(cuerpo).toContain("'estimator-competitor-files', 'estimator-competitor-files', false, 10485760,");
    expect(10485760).toBe(LIMITES_DE_COMPETENCIA.maxBytes);
    const lista = cuerpo.match(/array\[('application\/pdf'[^\]]*)\]\n\)/)?.[1] ?? "";
    expect(lista.split(",").map((s) => s.trim().replace(/'/g, "")).sort()).toEqual([...LIMITES_DE_COMPETENCIA.tipos].sort());
    expect(CUBO_DE_COMPETENCIA).toBe("estimator-competitor-files");
  });
  it("el techo de cinco, en la tabla y en el cubo, igual que la pantalla", () => {
    expect(cuerpo).toContain("if n >= 5 then");
    // Con el cierre detrás: «< 50» también contiene «< 5» (lo cazó el mutante M25).
    expect(cuerpo).toContain("public.estimator_competitor_object_count((storage.foldername(name))[1]) < 5\n  );");
    expect(LIMITES_DE_COMPETENCIA.maxPorCotizacion).toBe(5);
  });
  it("ve quien ve la cotización; sube quien la edita; quita quien subió o el admin", () => {
    // La política entera, no «algo después del nombre»: la de DELETE lleva la misma subconsulta (M30).
    expect(cuerpo).toContain([
      'create policy "estimator_competitor_files select" on public.estimator_competitor_files for select to authenticated',
      "  using (",
      "    (select public.has_estimator_access())",
      "    and exists (select 1 from public.estimator_quotes q where q.id = quote_id)",
      "  );",
    ].join("\n"));
    expect(cuerpo).toMatch(/"estimator_competitor_files insert"[\s\S]*?public\.estimator_can_attach\(quote_id::text\)/);
    // Subir es EDITAR (148): dueño, aprobado o admin, y nada más; la tienda que ve no basta.
    expect(cuerpo).toContain("and (public.is_admin() or q.owner_id = auth.uid() or public.estimator_has_approval(q.id))\n     );");
    expect(cuerpo).not.toMatch(/estimator_my_store/);
    expect(cuerpo).toMatch(/"estimator_competitor_files delete"[\s\S]*?\(\(select public\.is_admin\(\)\) or uploaded_by = \(select auth\.uid\(\)\)\)/);
    expect(cuerpo).toMatch(/"estimator competitor files delete"[\s\S]*?\(\(select public\.is_admin\(\)\) or owner_id = \(select auth\.uid\(\)\)::text\)/);
    expect(cuerpo).not.toMatch(/for (all|update)\b/i);
    expect(cuerpo).toContain("grant select, insert, delete on public.estimator_competitor_files to authenticated;");
  });
  it("sin begin/commit propios, y el registro con el checksum del cuerpo", () => {
    expect(cuerpo).not.toMatch(/^\s*(begin|commit)\s*;/im);
    const [antes] = readFileSync("supabase/migrations/153_estimados_competencia.sql", "utf8").replace(/\r\n/g, "\n").split("-- @ledger-below");
    const sha = createHash("sha256").update(antes).digest("hex");
    expect(SQL).toContain(`values ('153_estimados_competencia.sql', '${sha}')`);
  });
});
