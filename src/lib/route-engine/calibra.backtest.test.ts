import { describe, it } from "vitest";
import { readFileSync, existsSync, appendFileSync } from "node:fs";
import { planifica } from "./planifica";
import { aprendeAfinidad, claveDeChofer, type Antecedente, type OpcionesDeAfinidad } from "./afinidad";
import type { Entrada, Parametros } from "./types";

// Calibración (D-834), no una prueba: vuelve a correr el motor sobre las entradas guardadas de los días reales con y sin
// lo aprendido, y mide cuánto se parece a lo que el equipo publicó. Solo corre si existe el volcado.
const RUTA = process.env.RUTAS_DATOS ?? "";
type Dia = { d: string; params: Parametros; input: { entrada: Entrada; puntos: Record<string, { lat: number; lng: number }> }; final: { id: string; assigned_driver: string | null; route_seq: number | null }[] };

describe.skipIf(!RUTA || !existsSync(RUTA))("calibración contra lo publicado", () => {
  it("mide variantes", () => {
    const { dias, historia } = JSON.parse(readFileSync(RUTA, "utf8")) as { dias: Dia[]; historia: { id: string; d: string; assigned_driver: string; store: string; account: string | null; lat: number | null; lng: number | null }[] };
    const ant: Antecedente[] = historia.map((h) => ({ chofer: h.assigned_driver, fecha: h.d, tienda: h.store, cuenta: h.account, lat: h.lat, lng: h.lng }));
    const info = new Map(historia.map((h) => [h.id, h]));
    const tau = (a: string[], b: string[]) => { let c = 0, n = 0; for (let i = 0; i < a.length; i++) for (let j = i + 1; j < a.length; j++) { const x = b.indexOf(a[i]), y = b.indexOf(a[j]); if (x < 0 || y < 0) continue; n++; if (x < y) c++; } return [c, n]; };

    const corre = (nombre: string, historiaPeso: number, zona: number | null, op: Partial<OpcionesDeAfinidad> = {}) => {
      let ok = 0, tot = 0, conc = 0, pares = 0, fuera = 0;
      for (const dia of dias) {
        const e = dia.input.entrada;
        const nombres = e.choferes.map((c) => c.nombre);
        const af = historiaPeso > 0 ? aprendeAfinidad(ant, nombres, dia.d, op) : null;
        const ordenes = e.ordenes.map((o) => {
          if (!af) return o;
          const base = String(o.id).split("#")[0];
          const h = info.get(base);
          const p = dia.input.puntos[String(o.destino)];
          const tienda = String(o.origen ?? "").startsWith("tienda:") ? String(o.origen).slice(7) : h?.store;
          return { ...o, afinidad: af({ tienda, cuenta: h?.account ?? null, lat: p?.lat ?? h?.lat, lng: p?.lng ?? h?.lng }) };
        });
        const pesos = { ...dia.params.pesos, historia: historiaPeso, ...(zona != null ? { zona } : {}) };
        const plan = planifica({ ...e, ordenes }, { ...dia.params, pesos });
        fuera += plan.sinAsignar.length;
        const nombreDe = new Map(e.choferes.map((c) => [c.id, c.nombre]));
        const choferDe = new Map<string, string>(); const ordenDe = new Map<string, string[]>();
        for (const r of plan.rutas) { const n = nombreDe.get(r.chofer) ?? ""; const lista: string[] = []; for (const p of r.paradas) if (p.tipo === "D") { const b = p.orden.split("#")[0]; choferDe.set(b, n); if (!lista.includes(b)) lista.push(b); } ordenDe.set(n, lista); }
        const set = new Set(nombres.map(claveDeChofer));
        for (const f of dia.final) {
          if (!f.assigned_driver || !set.has(claveDeChofer(f.assigned_driver)) || !choferDe.has(f.id)) continue;
          tot++; if (claveDeChofer(choferDe.get(f.id)) === claveDeChofer(f.assigned_driver)) ok++;
        }
        for (const n of nombres) {
          const fin = dia.final.filter((f) => claveDeChofer(f.assigned_driver) === claveDeChofer(n) && f.route_seq != null).sort((a, b) => a.route_seq! - b.route_seq!).map((f) => f.id);
          const [c, m] = tau(ordenDe.get(n) ?? [], fin); conc += c; pares += m;
        }
      }
      appendFileSync(process.env.RUTAS_SALIDA ?? "calibra.txt", `${nombre.padEnd(44)} chofer igual ${(100 * ok / tot).toFixed(1)}% (${ok}/${tot})  orden ${(100 * conc / Math.max(1, pares)).toFixed(1)}%  fuera ${fuera}
`);
    };
    const fase = process.env.RUTAS_FASE ?? "1";
    if (fase === "3") {
      corre("motor actual (zonas a mano)", 0, null);
      corre("motor-10: solo tienda, historia 240", 240, null, { pesoSitio: 0, pesoCuenta: 0 });
    } else if (fase === "2") {
      for (const h of [120, 240, 360, 600]) corre(`tienda+cuenta, historia ${h}`, h, null, { pesoSitio: 0 });
      for (const h of [240, 360]) corre(`solo tienda, historia ${h}`, h, null, { pesoSitio: 0, pesoCuenta: 0 });
      for (const m of [20, 90]) corre(`tienda+cuenta 360, media vida ${m}`, 360, null, { pesoSitio: 0, mediaVidaDias: m });
      corre("tienda+cuenta 360, sitio débil 0.3", 360, null, { pesoSitio: 0.3 });
    } else {
      corre("motor actual (zonas a mano)", 0, null);
      for (const h of [30, 60, 120, 240, 480]) corre(`+ historia ${h}`, h, null);
    }
  }, 3_000_000);
});
