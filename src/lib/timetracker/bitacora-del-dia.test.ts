import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { lineasDeLaBitacora } from "@/components/timetracker/BitacoraDelDia";
import { DICT } from "./i18n";

/** La bitácora del turno bajo cada fila de Nómina (D-NEXT, 2026-10-29). */

const leer = (r: string) => readFileSync(join(process.cwd(), r), "utf8").split("\r\n").join("\n");
const sinComentarios = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
const t = (k: string) => DICT.es[k] ?? k;

const foto = (kind: "in" | "out" | "left" | "back" | "stop", at: string, extra: Record<string, unknown> = {}) =>
  ({ url: "https://x/" + kind + at, who: "Everto", at, kind, offSite: null, note: null, lat: null, lng: null, siteName: null, siteId: null, distanceM: null, ...extra }) as never;

describe("las líneas del turno", () => {
  it("una por foto, más las salidas y paradas sin foto, en orden de hora", () => {
    const r = {
      ok: true as const, entryId: "e",
      photos: [foto("out", "2026-10-29T20:00:00Z"), foto("in", "2026-10-29T14:50:00Z", { siteName: "Pharr" }), foto("stop", "2026-10-29T16:20:00Z", { note: "Casa Mayberry" })],
      salidas: [{ id: "s", reason: "lunch", note: null, leftAt: "2026-10-29T17:00:00Z", returnedAt: "2026-10-29T17:40:00Z" }],
      paradas: [{ label: "Cliente X", address: "1 Calle", note: null, arrivedAt: "2026-10-29T16:20:00Z", departedAt: null, conFoto: true }, { label: "Dal-Tile", address: null, note: null, arrivedAt: "2026-10-29T18:30:00Z", departedAt: null, conFoto: false }],
    };
    const l = lineasDeLaBitacora(r, t as never);
    expect(l.map((x) => x.at.slice(11, 16))).toEqual(["14:50", "16:20", "17:00", "17:40", "18:30", "20:00"]);
    expect(l[0].texto).toBe("Entrada · Pharr");
    expect(l[0].foto).toBeTruthy();
    expect(l[1].texto).toBe("Visita / parada · Casa Mayberry");
    expect(l[2].texto).toBe("Salió · lunch");
    expect(l[2].foto).toBeUndefined();
    expect(l[3].texto).toBe("Volvió");
    expect(l[4].texto).toBe("Visita / parada · Dal-Tile");
    expect(l[5].texto).toBe("Salida");
  });
  it("una salida CON foto no se repite como línea sin foto", () => {
    const r = { ok: true as const, entryId: "e", photos: [foto("left", "2026-10-29T17:00:00Z")], salidas: [{ id: "s", reason: "lunch", note: null, leftAt: "2026-10-29T17:00:00Z", returnedAt: null }], paradas: [] };
    expect(lineasDeLaBitacora(r, t as never)).toHaveLength(1);
  });
});

describe("las pantallas y los textos", () => {
  it("Nómina pinta la bitácora bajo cada fila, plegada", () => {
    const p = sinComentarios(leer("src/components/timetracker/PayrollTimesheets.tsx"));
    expect(p).toContain('import { BitacoraDelDia } from "./BitacoraDelDia";');
    expect(p).toContain("<td colSpan={5}><BitacoraDelDia entryId={e.id} /></td>");
    const c = sinComentarios(leer("src/components/timetracker/BitacoraDelDia.tsx"));
    expect(c).toContain("<details className=\"bitacora-del-dia\"");
    expect(c).toContain("if (datos || estado === \"cargando\") return;");
    expect(c).toContain("<PhotoLightbox photos={urls} index={viendo}");
  });
  it("los textos están en los dos idiomas", () => {
    for (const k of ["title", "loading", "error", "empty", "left", "back", "visit"]) {
      expect(DICT.en["mgr.pay.daylog." + k]).toBeTruthy();
      expect(DICT.es["mgr.pay.daylog." + k]).toBeTruthy();
    }
  });
  it("la acción acota por el fichaje y exige poder gestionar a la persona", () => {
    const a = sinComentarios(leer("src/app/timetracker/clock-in/actions/bitacora.ts"));
    expect(a).toContain('.eq("time_entry_id", entryId)');
    expect(a).toContain("canManageEmployee(supabase, ctx.me, fila.employee_id)");
    expect(a).toContain('createSignedUrls(raw.map((r) => r.path), 3600)');
  });
});
