import { beforeEach, describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { useInspecciones } from "./usa-inspecciones";
import type { InspeccionNueva } from "./reglas";

/**
 * El gancho de la inspección pre-viaje (D-518) decide DÓNDE se escribe. En el modo práctica (`teaching`) nada sale del
 * navegador: ni la inspección ni la corrección de un defecto llegan a la base.
 */

const estado = vi.hoisted(() => ({ teaching: false, llamadas: [] as string[] }));

vi.mock("@/lib/data-provider", () => ({
  useData: () => ({ me: { id: "u1", full_name: "Diego" }, teaching: estado.teaching }),
}));
vi.mock("@/lib/supabase/client", () => ({
  createClient: () => {
    const resp = Promise.resolve({ data: null, error: { code: "42501", message: "probe" } });
    return {
      from: (t: string) => ({
        insert: () => { estado.llamadas.push(`insert ${t}`); return { select: () => ({ single: () => resp }) }; },
        select: () => { estado.llamadas.push(`select ${t}`); return resp; },
      }),
      rpc: (fn: string) => { estado.llamadas.push(`rpc ${fn}`); return resp; },
    };
  },
}));

type Gancho = ReturnType<typeof useInspecciones>;
let capturado: Gancho | null = null;
function Sonda() { capturado = useInspecciones("2026-10-11", "u1"); return null; }
const monta = (): Gancho => { capturado = null; renderToStaticMarkup(createElement(Sonda)); return capturado!; };

const nueva: InspeccionNueva = {
  driver_id: "u1", driver_name: "Diego", inspection_date: "2026-10-11", vehicle_id: null, vehicle_label: "Camión 3", odometer: 1,
  answers: {}, safe: true, notes: null, certified: true, checklist_version: "v",
};

beforeEach(() => { estado.teaching = false; estado.llamadas = []; });

describe("dónde escribe el gancho", () => {
  it("de verdad: guardar inserta en vehicle_inspections y corregir llama a la función", async () => {
    const g = monta();
    expect(g.local).toBe(false);
    await g.guarda(nueva);
    await g.corrige("i1", "bocina", true, "");
    expect(estado.llamadas).toEqual(["insert vehicle_inspections", "rpc marca_defecto_corregido"]);
  });

  it("en el modo práctica: nada llega a la base", async () => {
    estado.teaching = true;
    const g = monta();
    expect(g.local).toBe(true);
    await g.guarda(nueva);
    await g.corrige("i1", "bocina", true, "");
    expect(estado.llamadas).toEqual([]);
  });
});
