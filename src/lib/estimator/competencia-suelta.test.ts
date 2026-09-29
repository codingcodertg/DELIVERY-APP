import { describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { AvisoSin156, ListaDeEstimados } from "@/app/estimator/EstimadosCompetencia";
import {
  COLUMNAS_156, LIMITES_DE_COMPETENCIA, almacenDeCompetenciaDeLaBase, faltaEnSuelto, faltaLa156, filaSuelta, filtraEstimados,
  masNuevoPrimero, metaSueltaVacia, metaVacia, rutaSuelta, type EstimadoDeCompetencia,
} from "./competencia";
import { almacenDeCompetenciaDemo } from "./demo";

/**
 * D-451: el estimado de la competencia se sube sin cotización, y una pestaña lista TODOS para todo el que tenga el
 * módulo. El dueño, 2026-09-29: «THE COMEPTITORS ESTIMATE YOU CAN UPLOAD IT WITHOUT NEEDE TO CREATE AN ESTIMATE / AND I
 * WANT IT TO SHOW ALL ESTIAMTES IN A TAB AND ALL SALES REP COULD SEE IT».
 */

const leer = (r: string) => readFileSync(r, "utf8").split("\r\n").join("\n");
const t = (en: string) => en;
const pdf = (nombre = "rival.pdf") => new File([new Uint8Array([37, 80, 68, 70])], nombre, { type: "application/pdf" });

function estimado(p: Partial<EstimadoDeCompetencia> = {}): EstimadoDeCompetencia {
  return {
    id: "e1", quote_id: null, path: "general/u1/x.pdf", file_name: "x.pdf", mime_type: "application/pdf", size_bytes: 10,
    competitor: null, competitor_total: null, note: null, uploaded_by: "u1", uploaded_by_name: "Ana",
    uploaded_at: "2026-09-29T10:00:00Z", customer_name: "Ana Garza", store: "RDZ Pharr", estimate_num: null, ...p,
  };
}

describe("subir uno suelto: qué se manda", () => {
  it("la ruta va en general/<id de quien sube>/, como exigen el cubo y el disparador de la 156", () => {
    const r = rutaSuelta("u-123", "Estimado Rival.pdf", new Date("2026-09-29T15:04:05.678Z"), "ab12");
    expect(r.startsWith("general/u-123/2026-09-29T15-04-05-678Z-ab12-")).toBe(true);
    expect(r.endsWith(".pdf")).toBe(true);
    expect(r.split("/")).toHaveLength(3);
  });
  it("el cliente es obligatorio; lo demás no", () => {
    expect(faltaEnSuelto({ customer_name: "   " })).toBe("cliente");
    expect(faltaEnSuelto({ customer_name: "Ana" })).toBeNull();
  });
  it("la fila: sin cotización, recortada, sin quién ni cuándo (los pone la base)", () => {
    const f = filaSuelta("general/u1/a.pdf", { name: "a.pdf", size: 10, type: "application/pdf" }, {
      ...metaSueltaVacia(" RDZ Pharr "), customer_name: "  Ana Garza ", estimate_num: " 104582 ", competitor: "Rival", competitor_total: 1999.5,
    });
    expect(f.quote_id).toBeNull();
    expect(f.path).toBe("general/u1/a.pdf");
    expect(f.customer_name).toBe("Ana Garza");
    expect(f.store).toBe("RDZ Pharr");
    expect(f.estimate_num).toBe("104582");
    expect(f.competitor_total).toBe(1999.5);
    expect(Object.keys(f)).not.toContain("uploaded_by");
    expect(filaSuelta("p", { name: "a.pdf", size: 1, type: "" }, { ...metaSueltaVacia(), customer_name: "X" }).store).toBeNull();
    expect(filaSuelta("p", { name: "a.pdf", size: 1, type: "" }, { ...metaSueltaVacia(), customer_name: "X".repeat(300) }).customer_name).toHaveLength(120);
  });
});

describe("sin la 156", () => {
  it("columna que no existe (42703) o PGRST204 = falta la 156; y sin la 153, también", () => {
    expect(faltaLa156({ code: "42703", message: "column estimator_competitor_files.customer_name does not exist" })).toBe(true);
    expect(faltaLa156({ code: "PGRST204", message: "x" })).toBe(true);
    expect(faltaLa156({ code: "PGRST205", message: "x" })).toBe(true);
    expect(faltaLa156({ code: "23505", message: "duplicate" })).toBe(false);
    expect(faltaLa156({ code: "42501", message: "permission denied" })).toBe(false);
    expect(faltaLa156(null)).toBe(false);
  });
  it("la pestaña lo dice", () => {
    expect(renderToStaticMarkup(createElement(AvisoSin156, { t }))).toContain("migration 156");
  });
});

describe("la lista de todos", () => {
  // Desordenada a propósito: una prueba de orden con datos ya ordenados pasa con cualquier implementación.
  const lista = [
    estimado({ id: "viejo", uploaded_at: "2026-09-01T10:00:00Z", store: "RDZ McAllen", customer_name: "Luis Pena", competitor: "Tiles Co" }),
    estimado({ id: "nuevo", uploaded_at: "2026-09-29T10:00:00Z", store: "RDZ Pharr", customer_name: "Ana Garza" }),
    estimado({ id: "medio", uploaded_at: "2026-09-15T10:00:00Z", store: null, customer_name: null, quote_id: "q1", estimate_num: "104582" }),
  ];
  it("de lo más nuevo a lo más viejo", () => {
    expect(masNuevoPrimero(lista).map((e) => e.id)).toEqual(["nuevo", "medio", "viejo"]);
  });
  it("filtra por tienda y por texto (cliente, competidor, # de estimado)", () => {
    expect(filtraEstimados(lista, { tienda: "", texto: "" }).map((e) => e.id)).toEqual(["viejo", "nuevo", "medio"]);
    expect(filtraEstimados(lista, { tienda: "RDZ Pharr", texto: "" }).map((e) => e.id)).toEqual(["nuevo"]);
    expect(filtraEstimados(lista, { tienda: "", texto: "tiles" }).map((e) => e.id)).toEqual(["viejo"]);
    expect(filtraEstimados(lista, { tienda: "", texto: " 10458 " }).map((e) => e.id)).toEqual(["medio"]);
    expect(filtraEstimados(lista, { tienda: "RDZ McAllen", texto: "garza" })).toEqual([]);
  });
  it("pinta de quién es y de qué tienda; «Quitar» solo en lo mío, y el admin en todo", () => {
    const pinta = (me: { id: string; name: string; admin: boolean }) => renderToStaticMarkup(createElement(ListaDeEstimados, {
      estimados: lista, me, t, lang: "en", confirmando: null, ocupado: false, onAbrir: () => {}, onQuitar: () => {}, onConfirmar: () => {},
    }));
    const h = pinta({ id: "otro", name: "B", admin: false });
    expect(h).toContain("Luis Pena");
    expect(h).toContain("RDZ McAllen");
    expect(h).toContain("Estimate #104582");
    expect(h).toContain("Uploaded on its own");
    expect(h).toContain("Attached to a quote");
    expect(h.match(/data-estimado-quitar/g) ?? []).toHaveLength(0);
    expect(pinta({ id: "u1", name: "Ana", admin: false }).match(/data-estimado-quitar/g) ?? []).toHaveLength(3);
    expect(pinta({ id: "zz", name: "Admin", admin: true }).match(/data-estimado-quitar/g) ?? []).toHaveLength(3);
  });
});

describe("el demo imita la 156", () => {
  it("un vendedor de OTRA tienda ve lo que subió otro, suelto y pegado a una cotización", async () => {
    let me = { id: "u1", name: "Ana", admin: false, store: "RDZ Pharr" };
    const d = almacenDeCompetenciaDemo(() => me, false);
    expect((await d.subirSuelto("u1", pdf(), { ...metaSueltaVacia(), customer_name: "Luis Pena" })).ok).toBe(true);
    expect((await d.subir("q1", pdf("q.pdf"), metaVacia())).ok).toBe(true);
    me = { id: "u2", name: "Beto", admin: false, store: "RDZ McAllen" };
    const r = await d.listarTodos();
    expect(r.ok && r.valor.length).toBe(2);
    expect(r.ok && r.valor.every((e) => e.uploaded_by === "u1" && e.store === "RDZ Pharr")).toBe(true);
    expect(r.ok && r.valor.map((e) => e.quote_id).sort()).toEqual(["q1", null].sort());
    expect(r.ok && r.valor.some((e) => e.quote_id === null && e.customer_name === "Luis Pena" && e.store === "RDZ Pharr")).toBe(true);
    // No quita lo de otro.
    const suelto = r.ok ? r.valor.find((e) => e.quote_id === null)! : estimado();
    expect((await d.quitar(suelto)).ok).toBe(false);
  });
  it("sin cliente no sube; la tienda elegida manda sobre la del perfil", async () => {
    const d = almacenDeCompetenciaDemo(() => ({ id: "u1", name: "Ana", admin: false, store: "RDZ Pharr" }), false);
    expect((await d.subirSuelto("u1", pdf(), metaSueltaVacia())).ok).toBe(false);
    const s = await d.subirSuelto("u1", pdf(), { ...metaSueltaVacia("RDZ Weslaco"), customer_name: "X" });
    expect(s.ok && s.valor.store).toBe("RDZ Weslaco");
  });
  it("el techo de 50 sueltos por persona", async () => {
    const d = almacenDeCompetenciaDemo(() => ({ id: "u1", name: "Ana", admin: false }), false);
    for (let i = 0; i < LIMITES_DE_COMPETENCIA.maxSueltosPorPersona; i += 1) {
      expect((await d.subirSuelto("u1", pdf(), { ...metaSueltaVacia(), customer_name: "X" })).ok).toBe(true);
    }
    expect((await d.subirSuelto("u1", pdf(), { ...metaSueltaVacia(), customer_name: "X" })).ok).toBe(false);
    expect(LIMITES_DE_COMPETENCIA.maxSueltosPorPersona).toBe(50);
  });
  it("con ?sin156=1, la pestaña se apaga y la sección de la cotización (153) sigue", async () => {
    const d = almacenDeCompetenciaDemo(() => ({ id: "u1", name: "Ana", admin: false }), false, true);
    const l = await d.listarTodos();
    expect(l.ok === false && l.sinTabla).toBe(true);
    const s = await d.subirSuelto("u1", pdf(), { ...metaSueltaVacia(), customer_name: "X" });
    expect(s.ok === false && s.sinTabla).toBe(true);
    expect((await d.subir("q1", pdf(), metaVacia())).ok).toBe(true);
  });
});

describe("el almacén de la base", () => {
  function falso(o: { selectError?: { code: string; message: string } | null; insertError?: { code: string; message: string } | null } = {}) {
    const llamadas: string[] = [];
    let insertado: Record<string, unknown> | null = null;
    let columnas = "";
    const cubo = {
      upload: vi.fn(async (p: string) => { llamadas.push(`upload:${p.split("/").slice(0, 2).join("/")}`); return { data: {}, error: null }; }),
      remove: vi.fn(async () => { llamadas.push("remove"); return { data: [{}], error: null }; }),
    };
    const tabla = {
      select: vi.fn((c: string) => { columnas = c; return tabla; }),
      order: vi.fn(() => tabla),
      limit: vi.fn(async () => ({ data: [estimado()], error: o.selectError ?? null })),
      insert: vi.fn((fila: Record<string, unknown>) => {
        insertado = fila;
        return { select: async (c: string) => { columnas = c; llamadas.push("insert"); return { data: o.insertError ? null : [estimado()], error: o.insertError ?? null }; } };
      }),
    };
    const sb = { storage: { from: vi.fn(() => cubo) }, from: vi.fn(() => tabla) } as unknown as SupabaseClient;
    return { sb, llamadas, insertado: () => insertado, columnas: () => columnas };
  }
  it("listarTodos pide las columnas de la 156, de lo más nuevo a lo más viejo", async () => {
    const f = falso();
    const r = await almacenDeCompetenciaDeLaBase(f.sb).listarTodos();
    expect(r.ok).toBe(true);
    expect(f.columnas()).toBe(COLUMNAS_156);
    expect(COLUMNAS_156).toContain("customer_name, store, estimate_num");
  });
  it("sin la 156 (42703) la lista dice sinTabla, no un error", async () => {
    const r = await almacenDeCompetenciaDeLaBase(falso({ selectError: { code: "42703", message: "column does not exist" } }).sb).listarTodos();
    expect(r.ok === false && r.sinTabla).toBe(true);
  });
  it("subirSuelto sube a general/<id>/ y manda la fila sin cotización; si la fila no entra, retira el archivo", async () => {
    const f = falso();
    const r = await almacenDeCompetenciaDeLaBase(f.sb).subirSuelto("u-9", pdf(), { ...metaSueltaVacia(), customer_name: "Ana" });
    expect(r.ok).toBe(true);
    expect(f.llamadas).toEqual(["upload:general/u-9", "insert"]);
    expect(f.insertado()).toMatchObject({ quote_id: null, customer_name: "Ana" });
    expect(String(f.insertado()!.path).startsWith("general/u-9/")).toBe(true);
    const g = falso({ insertError: { code: "42501", message: "rls" } });
    const r2 = await almacenDeCompetenciaDeLaBase(g.sb).subirSuelto("u-9", pdf(), { ...metaSueltaVacia(), customer_name: "Ana" });
    expect(r2.ok).toBe(false);
    expect(g.llamadas).toEqual(["upload:general/u-9", "insert", "remove"]);
  });
});

describe("la pantalla usa estas piezas", () => {
  const pantalla = leer("src/app/estimator/Estimador.tsx");
  const pestana = leer("src/app/estimator/EstimadosCompetencia.tsx");
  it("el Quote Builder tiene la pestaña, con el mismo almacén y las tiendas de Ajustes", () => {
    expect(pantalla).toContain('data-pestana="competencia"');
    expect(pantalla).toContain("{pestana === \"competencia\" && (");
    expect(pantalla).toContain("<EstimadosCompetencia almacen={almacenCompetencia} me={me} t={t} lang={lang}");
    expect(pantalla).toContain("tiendas={ajustes.stores.map((s) => s.name)} tiendaDePartida={tiendaDePartida(me.store, ajustes.stores)} />");
  });
  it("la pestaña lista todos, sube sueltos a nombre de quien la usa, pide el cliente y filtra", () => {
    expect(pestana).toContain("const r = await almacen.listarTodos();");
    expect(pestana).toContain("const r = await almacen.subirSuelto(me.id, f, meta);");
    expect(pestana).toContain("if (faltaEnSuelto(meta)) {");
    expect(pestana).toContain("disabled={ocupado || faltaEnSuelto(meta) !== null}");
    expect(pestana).toContain("const visibles = useMemo(() => filtraEstimados(estimados, filtro), [estimados, filtro]);");
    expect(pestana).toContain("<ListaDeEstimados estimados={visibles}");
    expect(pestana).toContain("if (r.sinTabla) { setEstado(\"sin-156\"); return; }");
    expect(pestana).toContain("{puedeQuitar(e, me) && (confirmando === e.id ? (");
  });
});

describe("la migración 156", () => {
  const SQL = leer("supabase/migrations/156_competencia_suelta.sql");
  const cuerpo = SQL.split("\n").filter((l) => !l.trim().startsWith("--")).join("\n");
  const politica = (nombre: string) => {
    const i = cuerpo.indexOf(`create policy "${nombre}"`);
    expect(i, nombre).toBeGreaterThan(-1);
    return cuerpo.slice(i, cuerpo.indexOf(";", i));
  };
  it("quote_id pasa a opcional, con cliente obligatorio si no hay cotización", () => {
    expect(cuerpo).toContain("alter table public.estimator_competitor_files alter column quote_id drop not null;");
    expect(cuerpo).toContain("check (quote_id is not null or length(btrim(coalesce(customer_name, ''))) > 0)");
  });
  it("VER: toda persona con el módulo, sin mirar la cotización (tabla y cubo)", () => {
    const tabla = politica("estimator_competitor_files select");
    expect(tabla).toContain("using ((select public.has_estimator_access()))");
    expect(tabla).not.toContain("estimator_quotes");
    const cubo = politica("estimator competitor files read");
    expect(cubo).toContain("bucket_id = 'estimator-competitor-files'");
    expect(cubo).toContain("and (select public.has_estimator_access())");
    expect(cubo).not.toContain("estimator_quotes");
  });
  it("SUBIR suelto: solo en SU carpeta general/<uid>/, con el módulo y hasta 50; a una cotización, como en la 153", () => {
    const tabla = politica("estimator_competitor_files insert");
    expect(tabla).toContain("uploaded_by = (select auth.uid())");
    expect(tabla).toContain("(quote_id is not null and public.estimator_can_attach(quote_id::text))");
    expect(tabla).toContain("path like 'general/' || (select auth.uid())::text || '/%'");
    const cubo = politica("estimator competitor files insert");
    expect(cubo).toContain("(storage.foldername(name))[2] = (select auth.uid())::text");
    expect(cubo).toContain(`estimator_competitor_loose_count((select auth.uid())::text) < ${LIMITES_DE_COMPETENCIA.maxSueltosPorPersona})`);
    expect(cubo).toContain(`estimator_competitor_object_count((storage.foldername(name))[1]) < ${LIMITES_DE_COMPETENCIA.maxPorCotizacion})`);
    expect(cuerpo).toContain(`if n >= ${LIMITES_DE_COMPETENCIA.maxSueltosPorPersona} then`);
  });
  it("QUITAR: quien lo subió o el admin, con el módulo; el DELETE del cubo no se toca", () => {
    const tabla = politica("estimator_competitor_files delete");
    expect(tabla).toContain("((select public.is_admin()) or uploaded_by = (select auth.uid()))");
    expect(cuerpo).not.toContain('create policy "estimator competitor files delete"');
    expect(cuerpo).not.toMatch(/for (update|all)\b/i);
  });
  it("el disparador copia el # y la tienda de la cotización, y pone la del perfil si no hay", () => {
    expect(cuerpo).toContain("select estimate_num, store into q from public.estimator_quotes where id = new.quote_id;");
    expect(cuerpo).toContain("new.estimate_num := q.estimate_num;");
    expect(cuerpo).toContain("new.store := coalesce(new.store, (select nullif(btrim(store), '') from public.profiles where id = new.uploaded_by));");
  });
  it("sin begin/commit propios, y el registro con el checksum del cuerpo", () => {
    expect(cuerpo).not.toMatch(/^\s*(begin|commit)\s*;/im);
    const [antes] = SQL.split("-- @ledger-below");
    const sha = createHash("sha256").update(antes).digest("hex");
    expect(SQL).toContain(`values ('156_competencia_suelta.sql', '${sha}')`);
  });
});
