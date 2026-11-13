import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  CLAVE_HASHES, HORAS_PARA_PENDIENTE, avisoDeRepetida, bytesDeDataUrl, duplicadosPorHuella, etiquetaSinFoto, exigeFoto, faltaFoto,
  fotoPendienteVencida, fotosDe, fotosSinHuella, hashDeDataUrl, hashesDe, iconoDeFotos, motivoDeBloqueo, puedeEnviar, puedeGuardarSinFoto,
  sha256Hex, sinFoto,
} from "./fotos";
import { FOTO_DE_MERMA, PASOS, pasoCompleto, pasosVisibles, primerHueco, primerHuecoSalvoFoto, respuestasParaGuardar } from "./pasos";
import { DEMO_REPORTES } from "./datos";

/**
 * D-914 (migración 268): la foto de la merma es obligatoria y va primero; «papel primero» se guarda sin foto y queda
 * incompleto; icono de cámara con la cuenta; y aviso de foto repetida por huella SHA-256.
 */
const leer = (r: string) => readFileSync(join(process.cwd(), r), "utf8").replace(/\r\n/g, "\n");
const SQL = leer("supabase/migrations/268_merma_foto_obligatoria.sql");
const HOY = "2026-11-06";
const FOTO = "data:image/jpeg;base64,/9j/4AAQSkZJRg==";
const completoSinFoto = {
  product: { id: 7, sku: "S", name: "N", cost: 1, pieces_per_box: 8 }, split: { damaged: 8, sample: 0 },
  qty: { boxes: 1, piecesPerBox: 8, loosePieces: 0 }, return_type: "internal", reason: "fell", broken_on: HOY,
};
const completo = { ...completoSinFoto, photo: [FOTO] };

describe("1. la foto va primero y es obligatoria en la merma", () => {
  it("el paso de la foto va justo después del producto y antes de las cantidades; y ya no está al final", () => {
    const ids = PASOS.scrap.map((p) => p.id);
    expect(ids.indexOf("photo")).toBe(ids.indexOf("product") + 1);
    expect(ids.indexOf("photo")).toBeLessThan(ids.indexOf("qty"));
    expect(ids.filter((x) => x === "photo")).toHaveLength(1);
    expect(FOTO_DE_MERMA.tipo === "foto" && FOTO_DE_MERMA.obligatoria).toBe(true);
    expect(FOTO_DE_MERMA.en).toMatch(/photo of the pieces first/i);
    expect(FOTO_DE_MERMA.es).toMatch(/foto de las piezas/i);
  });
  it("solo la merma exige foto; en los demás tipos la foto sigue opcional", () => {
    expect(exigeFoto("scrap")).toBe(true);
    for (const k of ["incident", "zone", "insubordination", "safety", "maintenance", "positive"] as const) {
      expect(exigeFoto(k)).toBe(false);
      const f = PASOS[k].find((p) => p.tipo === "foto");
      if (f) expect(pasoCompleto(f, {}, HOY)).toBe(true);
    }
  });
  it("sin foto, el paso de la merma no está completo y el resumen lo marca como hueco", () => {
    expect(pasoCompleto(FOTO_DE_MERMA, {}, HOY)).toBe(false);
    expect(pasoCompleto(FOTO_DE_MERMA, { photo: [] }, HOY)).toBe(false);
    expect(pasoCompleto(FOTO_DE_MERMA, { photo: [FOTO] }, HOY)).toBe(true);
    const huecoEnFoto = pasosVisibles("scrap", completoSinFoto).findIndex((p) => p.id === "photo");
    expect(primerHueco("scrap", completoSinFoto, HOY)).toBe(huecoEnFoto);
    expect(primerHueco("scrap", completo, HOY)).toBe(-1);
  });
  it("ENVIAR queda bloqueado sin foto, con el motivo; con foto se envía", () => {
    expect(faltaFoto("scrap", completoSinFoto)).toBe(true);
    expect(faltaFoto("scrap", completo)).toBe(false);
    expect(faltaFoto("incident", {})).toBe(false);
    // El hueco que da primerHueco es el de la foto: el motivo que se le dice a la persona es «foto», no «faltan respuestas».
    const sinFotoHueco = primerHueco("scrap", completoSinFoto, HOY);
    expect(puedeEnviar("scrap", completoSinFoto, "McAllen", primerHuecoSalvoFoto("scrap", completoSinFoto, HOY))).toEqual({ ok: false, motivo: "foto" });
    expect(sinFotoHueco).toBeGreaterThanOrEqual(0);
    expect(puedeEnviar("scrap", completo, "McAllen", primerHueco("scrap", completo, HOY))).toEqual({ ok: true });
    expect(puedeEnviar("scrap", completo, "", -1)).toEqual({ ok: false, motivo: "tienda" });
    expect(puedeEnviar("scrap", { ...completo, reason: undefined }, "McAllen", primerHueco("scrap", { ...completo, reason: undefined }, HOY))).toEqual({ ok: false, motivo: "hueco" });
    expect(motivoDeBloqueo("foto", "en")).toMatch(/photo/i);
    expect(motivoDeBloqueo("foto", "es")).toMatch(/foto/i);
  });
  it("las huellas no viajan como respuesta normal: van aparte dentro de answers al enviar", () => {
    const r = { ...completo, [CLAVE_HASHES]: ["a".repeat(64)] };
    expect(respuestasParaGuardar("scrap", r)).not.toHaveProperty(CLAVE_HASHES);
    expect(respuestasParaGuardar("scrap", r)).not.toHaveProperty("photo");
  });
});

describe("1b. la base también lo exige (migración 268)", () => {
  it("un trigger en la tabla rechaza la merma sin fotos salvo que venga como «sin foto»", () => {
    expect(SQL).toMatch(/create trigger warehouse_reports_photos_guard before insert or update on public\.warehouse_reports/);
    expect(SQL).toMatch(/if cambio and n = 0 and not NEW\.photo_pending then\s+raise exception 'warehouse_ops: la merma necesita al menos una foto/);
    // Solo la merma; lo demás nunca queda pendiente.
    expect(SQL).toMatch(/if NEW\.kind <> 'scrap' then\s+NEW\.photo_pending := false;\s+return NEW;/);
    // Corregir una merma vieja sin tocar las fotos no exige foto a destiempo.
    expect(SQL).toMatch(/TG_OP = 'INSERT' or NEW\.photos is distinct from OLD\.photos or NEW\.photo_pending is distinct from OLD\.photo_pending/);
    // Lo que la pantalla manda dentro de answers pasa a sus columnas y se quita de answers (como la 266).
    expect(SQL).toMatch(/NEW\.answers := NEW\.answers - 'photo_pending'/);
    expect(SQL).toMatch(/NEW\.answers := NEW\.answers - 'photo_hashes'/);
  });
  it("warehouse_ops_file_report no cambia de firma: la regla vive en la tabla", () => {
    expect(SQL).not.toMatch(/create or replace function public\.warehouse_ops_file_report/);
  });
  it("agregar la foto después: al menos una, de la carpeta de quien sube, y solo el autor o quien corrige la merma", () => {
    expect(SQL).toMatch(/create or replace function public\.warehouse_ops_add_photos\(p_report uuid, p_photos text\[\], p_hashes text\[\]\)/);
    expect(SQL).toMatch(/r\.author_id = yo or public\.warehouse_ops_can_manage\(r\.store\)/);
    // Endurecido (revisión de seguridad): solo a una merma, solo si está sin foto, y solo quien puede VER el reporte.
    const addPhotos = SQL.slice(SQL.indexOf("function public.warehouse_ops_add_photos"), SQL.indexOf("function public.warehouse_ops_set_photo_hashes"));
    expect(addPhotos).toMatch(/if r\.kind <> 'scrap' then\s+raise exception/);
    expect(addPhotos).toMatch(/if not \(r\.photo_pending or cardinality\(coalesce\(r\.photos, '\{\}'\)\) = 0\) then\s+raise exception/);
    expect(addPhotos).toMatch(/if yo is null or not public\.warehouse_ops_can_see\(r\.kind, r\.store, r\.author_id\) then\s+raise exception/);
    // Y las huellas de antes: solo quien ve el reporte, solo huecos, alineadas con las fotos.
    const setHashes = SQL.slice(SQL.indexOf("function public.warehouse_ops_set_photo_hashes"), SQL.indexOf("-- 5. Indices"));
    expect(setHashes).toMatch(/if yo is null or not public\.warehouse_ops_can_see\(r\.kind, r\.store, r\.author_id\) then\s+raise exception/);
    expect(setHashes).toMatch(/if cardinality\(coalesce\(p_hashes, '\{\}'\)\) <> n then\s+raise exception/);
    expect(setHashes).toMatch(/when \(coalesce\(r\.photo_hashes, '\{\}'\)\)\[i\] ~ '\^\[0-9a-f\]\{64\}\$' then \(coalesce\(r\.photo_hashes, '\{\}'\)\)\[i\]/);
    expect(SQL).toMatch(/if n = 0 then raise exception 'warehouse_ops: falta la foto'/);
    expect(SQL).toMatch(/split_part\(f, '\/', 1\) <> yo::text/);
    expect(SQL).toMatch(/photo_pending = false,/);
    expect(SQL).toMatch(/grant execute on function public\.warehouse_ops_add_photos\(uuid, text\[\], text\[\]\) to authenticated/);
    expect(SQL).toMatch(/revoke all on function public\.warehouse_ops_add_photos\(uuid, text\[\], text\[\]\) from public, anon/);
  });
  it("es idempotente, sin transacción propia, con pasos para deshacer y la línea del ledger", () => {
    expect(SQL).toMatch(/add column if not exists photo_pending boolean not null default false/);
    expect(SQL).toMatch(/add column if not exists photo_hashes text\[\]/);
    expect(SQL).toMatch(/drop trigger if exists warehouse_reports_photos_guard/);
    expect(SQL).toMatch(/Para deshacer:/);
    expect(SQL).not.toMatch(/^\s*(begin|commit);\s*$/m);
    expect(SQL).toMatch(/-- @ledger-below\r?\ninsert into public\.schema_migrations \(name, checksum\) values \('268_merma_foto_obligatoria\.sql', '[0-9a-f]{64}'\)/);
    expect(SQL).not.toMatch(/D-914/);
  });
});

describe("2. papel primero: borrador «sin foto»", () => {
  it("se puede guardar sin foto solo si es merma y lo ÚNICO que falta es la foto", () => {
    const hueco = (r: Record<string, unknown>) => primerHuecoSalvoFoto("scrap", r, HOY);
    expect(puedeGuardarSinFoto("scrap", completoSinFoto, "McAllen", hueco(completoSinFoto))).toBe(true);
    // Con foto no hace falta: se envía.
    expect(puedeGuardarSinFoto("scrap", completo, "McAllen", hueco(completo))).toBe(false);
    // Falta otra cosa (el motivo): no es «papel primero», es un reporte a medias.
    const aMedias = { ...completoSinFoto, reason: undefined };
    expect(hueco(aMedias)).toBeGreaterThanOrEqual(0);
    expect(puedeGuardarSinFoto("scrap", aMedias, "McAllen", hueco(aMedias))).toBe(false);
    expect(puedeGuardarSinFoto("scrap", completoSinFoto, "", hueco(completoSinFoto))).toBe(false);
    expect(puedeGuardarSinFoto("incident", {}, "McAllen", -1)).toBe(false);
  });
  it("primerHuecoSalvoFoto ignora la foto y nada más", () => {
    expect(primerHuecoSalvoFoto("scrap", completoSinFoto, HOY)).toBe(-1);
    expect(primerHuecoSalvoFoto("scrap", { ...completoSinFoto, broken_on: "2027-01-01" }, HOY)).toBeGreaterThanOrEqual(0);
  });
  it("la fila guardada sin foto lo dice; a las 24 h pasa a «foto pendiente» para el gerente; nunca se borra sola", () => {
    const ahora = new Date("2026-11-06T18:00:00Z");
    const hace = (h: number) => new Date(ahora.getTime() - h * 3_600_000).toISOString();
    const fresca = { id: "a", created_at: hace(2), photos: [], photo_pending: true };
    const vieja = { id: "b", created_at: hace(30), photos: [], photo_pending: true };
    const muyVieja = { id: "b2", created_at: hace(24 * 3 + 1), photos: [], photo_pending: true };
    const conFoto = { id: "c", created_at: hace(30), photos: ["u/1.jpg"], photo_pending: false };
    expect(HORAS_PARA_PENDIENTE).toBe(24);
    expect(sinFoto(fresca)).toBe(true);
    expect(sinFoto(conFoto)).toBe(false);
    expect(fotoPendienteVencida(fresca, ahora)).toBe(false);
    expect(fotoPendienteVencida(vieja, ahora)).toBe(true);
    expect(fotoPendienteVencida(conFoto, ahora)).toBe(false);
    expect(etiquetaSinFoto(fresca, "en", ahora)).toBe("Missing photo");
    expect(etiquetaSinFoto(fresca, "es", ahora)).toBe("Falta la foto");
    expect(etiquetaSinFoto(vieja, "en", ahora)).toBe("Pending photo · 30 h");
    expect(etiquetaSinFoto(muyVieja, "es", ahora)).toBe("Foto pendiente · 3 días");
    expect(etiquetaSinFoto(conFoto, "en", ahora)).toBe("");
    // Una fila vieja (sin la columna) no es «sin foto»: solo las guardadas así.
    expect(sinFoto({ id: "d", created_at: hace(100), photos: [] })).toBe(false);
    expect(SQL).not.toMatch(/delete from public\.warehouse_reports/);
  });
  it("el demo trae una merma guardada sin foto, y la pantalla la enseña", () => {
    const r7 = DEMO_REPORTES.find((r) => r.id === "r7")!;
    expect(sinFoto(r7)).toBe(true);
    expect(fotoPendienteVencida(r7)).toBe(true);
  });
});

describe("3. el icono de cámara junto a la fecha", () => {
  it("solo sale si hay fotos, y el título dice cuántas", () => {
    expect(iconoDeFotos(0, "en")).toEqual({ muestra: false, titulo: "" });
    expect(iconoDeFotos(1, "en")).toEqual({ muestra: true, titulo: "1 photo" });
    expect(iconoDeFotos(3, "en")).toEqual({ muestra: true, titulo: "3 photos" });
    expect(iconoDeFotos(1, "es")).toEqual({ muestra: true, titulo: "1 foto" });
    expect(iconoDeFotos(2, "es")).toEqual({ muestra: true, titulo: "2 fotos" });
  });
  it("la lista lo pone en la celda de la fecha y la tarjeta en su cabecera", () => {
    const lista = leer("src/app/operaciones/ListaDeReportes.tsx");
    expect(lista).toMatch(/data-dia=\{diaDelReporte\(r\)\}>[\s\S]{0,200}<IconoDeFotos r=\{r\} repetida=\{repetidas\.has\(r\.id\)\} \/>/);
    // Reunión 12 nov: la foto repetida es la cámara ROJA (ya no un letrero), con la explicación en el título.
    expect(lista).toContain("ops-camara-repetida");
    expect(lista).not.toContain("ops-insignia-repetida");
    expect(lista).toMatch(/<h3>\{info\.emoji\} \{lang === "es" \? info\.es : info\.en\}<IconoDeFotos r=\{r\} \/><\/h3>/);
  });
});

describe("4. foto repetida: la huella SHA-256", () => {
  it("la huella es el SHA-256 hexadecimal de los bytes que se suben (igual en el navegador y en Node)", async () => {
    expect(await sha256Hex(new TextEncoder().encode("abc"))).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
    const bytes = bytesDeDataUrl("data:text/plain;base64,YWJj");
    expect(new TextDecoder().decode(bytes)).toBe("abc");
    expect(await hashDeDataUrl("data:text/plain;base64,YWJj")).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
    // La misma foto da la misma huella; otra, otra.
    expect(await hashDeDataUrl(FOTO)).toBe(await hashDeDataUrl(FOTO));
    expect(await hashDeDataUrl(FOTO)).not.toBe(await hashDeDataUrl("data:image/jpeg;base64,/9j/4AAQSkZJRgAB"));
  });
  it("en el asistente las huellas van alineadas con las fotos; un hueco va como «»", () => {
    expect(fotosDe({})).toEqual([]);
    expect(fotosDe({ photo: [FOTO, 3, FOTO] })).toEqual([FOTO, FOTO]);
    expect(hashesDe({ photo: [FOTO, FOTO], [CLAVE_HASHES]: ["a".repeat(64)] })).toEqual(["a".repeat(64), ""]);
    expect(hashesDe({ photo: [FOTO], [CLAVE_HASHES]: ["no es hash"] })).toEqual([""]);
  });
  it("entre las filas que se ven, marca a AMBOS reportes que comparten una foto; los huecos no cuentan", () => {
    const H1 = "1".repeat(64), H2 = "2".repeat(64);
    const filas = [
      { id: "a", created_at: "", photos: ["x", "y"], photo_hashes: [H1, H2] },
      { id: "b", created_at: "", photos: ["z"], photo_hashes: [H1] },
      { id: "c", created_at: "", photos: ["w"], photo_hashes: [null] },
      { id: "d", created_at: "", photos: ["v"], photo_hashes: [null] },
      { id: "e", created_at: "", photos: [] },
    ];
    const dup = duplicadosPorHuella(filas);
    expect(dup.get("a")).toEqual(["b"]);
    expect(dup.get("b")).toEqual(["a"]);
    expect(dup.has("c")).toBe(false);
    expect(dup.has("d")).toBe(false);
    expect(dup.has("e")).toBe(false);
  });
  it("el demo trae dos mermas con la misma foto (r1 y r4)", () => {
    const dup = duplicadosPorHuella(DEMO_REPORTES);
    expect(dup.get("r1")).toEqual(["r4"]);
    expect(dup.get("r4")).toEqual(["r1"]);
  });
  it("las fotos de antes de la 268 no tienen huella: se cuenta cuántas faltan para calcularlas al abrir la tarjeta", () => {
    expect(fotosSinHuella({ id: "a", created_at: "", photos: ["x", "y"] })).toBe(2);
    expect(fotosSinHuella({ id: "a", created_at: "", photos: ["x", "y"], photo_hashes: ["1".repeat(64), null] })).toBe(1);
    expect(fotosSinHuella({ id: "a", created_at: "", photos: [] })).toBe(0);
    // SQL no puede leer los bytes de storage: la migración lo dice y deja la función para rellenar huecos.
    expect(SQL).toMatch(/SQL no puede\s+--\s+leer los bytes de storage/);
    expect(SQL).toMatch(/create or replace function public\.warehouse_ops_set_photo_hashes\(p_report uuid, p_hashes text\[\]\)/);
    expect(SQL).toMatch(/Solo rellena huecos/);
    expect(SQL).toMatch(/using gin \(photo_hashes\)/);
  });
  it("el aviso dice en qué reporte y de qué día; solo avisa, no bloquea", () => {
    const fmt = (iso: string) => `[${iso}]`;
    expect(avisoDeRepetida({ reporteId: "x", created_at: "2026-11-01T10:00:00Z", broken_on: "2026-10-30", product_name: "Porcelain" }, "en", fmt))
      .toBe("This photo was already used in the report from [2026-10-30] (Porcelain).");
    expect(avisoDeRepetida({ reporteId: "x", created_at: "2026-11-01T10:00:00Z" }, "es", fmt))
      .toBe("Esta foto ya se usó en el reporte del [2026-11-01T10:00:00Z].");
    const asistente = leer("src/app/operaciones/Asistente.tsx");
    expect(asistente).toMatch(/data-accion="confirmar-repetida"/);
    expect(asistente).toMatch(/data-accion="ver-repetida"/);
    expect(asistente).toMatch(/data-accion="quitar-repetida"/);
    // La base no rechaza huellas repetidas.
    expect(SQL).not.toMatch(/unique.*photo_hashes/i);
  });
  it("en la lista, la insignia de foto (repetida / sin foto) sale en las filas y se puede agregar la foto", () => {
    const lista = leer("src/app/operaciones/ListaDeReportes.tsx");
    expect(lista).toMatch(/data-foto-repetida/);
    expect(lista).toMatch(/data-agregar-foto/);
  });
});

describe("una ruta del servidor puede importar fotos.ts: no trae React", () => {
  it("sin hooks", () => {
    const src = leer("src/lib/almacen-ops/fotos.ts");
    expect(src).not.toMatch(/from "react"|useState|useEffect/);
  });
});
