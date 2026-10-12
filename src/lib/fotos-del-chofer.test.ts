import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

// ============================================================
// D-NEXT · El chofer guarda las fotos del material y sus marcas de salida / llegada en SU orden (migración 169), y el
// aviso al guardar un borrador dice que NO queda programado.
//
// El dueño, 2026-10-12: «haz el 5, 6 y 7» sobre la lista de pendientes («Fotos del material desde el chofer: (...) el
// guardia de la base rechaza al chofer (...) Lo mismo para arrived_at / departed_at» y «Aviso al guardar borrador que
// diga claro "esta orden NO queda programada"»).
// ============================================================

const leer = (p: string) => readFileSync(p, "utf8").replace(/\r\n/g, "\n");
const m169 = leer("supabase/migrations/169_fotos_del_chofer.sql");
const m168 = leer("supabase/migrations/168_chofer_recoge_sin_listo.sql");
const guard = (sql: string) => {
  const a = sql.indexOf("create or replace function public.guard_delivery_stage()");
  const b = sql.indexOf("end $function$\n;", a) + "end $function$\n;".length;
  return sql.slice(a, b);
};
const sinComentarios = (s: string) => s.split("\n").filter((l) => !/^\s*--/.test(l)).join("\n");

const BLOQUE = `    if r = 'driver' and old_stage in ('approved','fulfilling','ready','picked_up','delivered')
       and OLD.assigned_driver = (select p.full_name from public.profiles p where p.id = auth.uid()) then
      probe := NEW;
      probe.photos      := OLD.photos;
      probe.photo_meta  := OLD.photo_meta;
      probe.departed_at := OLD.departed_at;
      probe.arrived_at  := OLD.arrived_at;
      probe.updated_at  := OLD.updated_at;
      if probe is not distinct from OLD then return NEW; end if;
    end if;
`;

describe("migración 169: el guard es la 168 letra por letra con UN bloque más, en el tramo de misma etapa del chofer", () => {
  it("la 169 trae el bloque, una sola vez, y en el tramo «misma etapa» (antes de que se mire el cambio de etapa)", () => {
    const g = guard(m169);
    expect(g.split(BLOQUE).length - 1).toBe(1);
    const i = g.indexOf(BLOQUE);
    expect(i).toBeGreaterThan(g.indexOf("if new_stage is not distinct from old_stage then"));
    expect(i).toBeLessThan(g.indexOf("raise exception 'You cannot edit an order in the % stage', old_stage;"));
    // Justo después del bloque del chofer de la 142/145 (coordenadas de una parada cerrada).
    expect(g.indexOf("if r = 'driver' and old_stage in ('picked_up','delivered') then")).toBeLessThan(i);
  });
  it("quitando el bloque (y sus comentarios), la 169 es la 168 sin cambiar una letra", () => {
    const sin169 = sinComentarios(guard(m169).replace(BLOQUE, ""));
    expect(sin169).toBe(sinComentarios(guard(m168)));
  });
  it("solo el chofer y solo SU orden: compara `assigned_driver` (nombre, texto) con el full_name de quien escribe, no con auth.uid() a pelo", () => {
    expect(BLOQUE).toContain("OLD.assigned_driver = (select p.full_name from public.profiles p where p.id = auth.uid())");
    expect(BLOQUE).not.toMatch(/assigned_driver\s*=\s*auth\.uid\(\)/);
  });
  it("solo esas columnas: el probe devuelve a OLD photos, photo_meta, departed_at, arrived_at y updated_at, nada más", () => {
    const cols = [...BLOQUE.matchAll(/probe\.(\w+)\s*:= OLD\.\1;/g)].map((m) => m[1]).sort();
    expect(cols).toEqual(["arrived_at", "departed_at", "photo_meta", "photos", "updated_at"]);
  });
  it("no toca draft/pending/rejected/canceled, ni INSERT, ni la lectura", () => {
    expect(BLOQUE).not.toMatch(/'draft'|'pending'|'rejected'|'canceled'/);
    expect(m169).not.toMatch(/create policy|alter policy|drop policy/i);
    expect(m169).not.toMatch(/alter table/i);
  });
  it("la autocomprobación mira el CÓDIGO del guard (sin comentarios) y exige el bloque, lo de la 168, security definer y el disparador", () => {
    const chk = m169.slice(m169.indexOf("do $chk$"), m169.indexOf("end $chk$;"));
    expect(chk).toContain("regexp_replace(regexp_replace(def, '^[ \\t]*--.*$', '', 'gn'), '\\s+', ' ', 'g')");
    expect(chk).toContain("probe.photos := OLD.photos; probe.photo_meta := OLD.photo_meta; probe.departed_at := OLD.departed_at; probe.arrived_at := OLD.arrived_at; probe.updated_at := OLD.updated_at;");
    expect(chk).toContain("or (r = ''driver'' and old_stage in (''approved'',''fulfilling'') and new_stage = ''picked_up''");
    expect(chk).toContain("prosecdef");
    expect(chk).toContain("tgname = 'deliveries_guard_stage'");
  });
  it("lleva su línea de registro (@ledger-below) con el nombre del fichero, y el cuerpo no cita su propio número salvo como marca «169» (D-512)", () => {
    expect(m169).toMatch(/-- @ledger-below\ninsert into public\.schema_migrations \(name, checksum\) values \('169_fotos_del_chofer\.sql', '[0-9a-f]{64}'\) on conflict \(name\) do nothing;\n?$/);
  });
  it("lo que la app escribe cabe en el bloque: la ficha manda SOLO photos, SOLO departed_at o SOLO arrived_at", () => {
    const modal = leer("src/components/OrderModal.tsx");
    expect(modal).toContain("await updateDelivery(existing.id, { photos: next });");
    expect(modal).toContain("await updateDelivery(existing.id, { departed_at: now });");
    expect(modal).toContain("await updateDelivery(existing.id, { arrived_at: now });");
  });
});

describe("el aviso al guardar un borrador dice que NO queda programado y cuánto dura", () => {
  const modal = leer("src/components/OrderModal.tsx");
  it("al crear, si la etapa es draft, el aviso es el del borrador; si no, «Orden creada» como antes", () => {
    const i = modal.indexOf('if ((payload.stage ?? "draft") === "draft") {');
    expect(i).toBeGreaterThan(-1);
    const bloque = modal.slice(i, modal.indexOf("await autoSendTracking(row); onClose();", i));
    expect(bloque).toContain("guardada como BORRADOR: NO queda programada. Ábrela y pulsa Enviar para programarla. Los borradores se conservan ${DIAS_DE_BORRADOR} días.");
    expect(bloque).toContain("saved as a DRAFT: it is NOT scheduled. Open it and press Submit to schedule it. Drafts are kept ${DIAS_DE_BORRADOR} days.");
    expect(bloque).toContain("} else {");
    expect(bloque).toContain("`Orden #${orderLabel(row)} creada`");
  });
  it("los días del aviso son los mismos que corta la ventana de Órdenes (una sola constante)", () => {
    expect(modal).toContain('import { DIAS_DE_BORRADOR } from "@/lib/ordenes-visibles";');
  });
});
