import type { Fix } from "./track-history";

// D-835: cómo se dibuja el recorrido de un chofer sin inventar carreteras. El dueño, 2026-11-04, con el mapa de Ernesto:
// «mira esos brincos» — líneas rectas de 2 millas cruzando la ciudad donde el teléfono no mandó nada.

const millasEntre = (a: Fix, b: Fix) => {
  const R = 3958.8, r = Math.PI / 180, dl = (b.lat - a.lat) * r, dg = (b.lng - a.lng) * r;
  const s = Math.sin(dl / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(dg / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
};
const ms = (f: Fix) => new Date(f.at).getTime();

/** Fuera las posiciones imposibles: un salto que pide más de 150 mph es una posición falsa (la vieja del turno anterior,
 *  una de antena). De las dos, se queda la más precisa. */
export function limpiaSaltos(fixes: readonly Fix[]): Fix[] {
  const out: Fix[] = [];
  for (const f of fixes) {
    const prev = out[out.length - 1];
    if (prev) {
      const d = millasEntre(prev, f), h = (ms(f) - ms(prev)) / 3_600_000;
      const mph = h > 0 ? d / h : Infinity;
      if (mph > 150 && d > 0.2) {
        if ((prev.accuracy_m ?? 0) > (f.accuracy_m ?? 0)) { out.pop(); out.push(f); }
        continue;
      }
    }
    out.push(f);
  }
  return out;
}

/** El trazo: donde el teléfono calló (más de 2 minutos y un cuarto de milla sin nada en medio) la línea se corta y ese
 *  tramo va PUNTEADO: «no sabemos por qué calle», en vez de una calle recta que el camión nunca tomó. */
export function tramos(fixes: readonly Fix[]): { positions: [number, number][]; hueco: boolean }[] {
  const out: { positions: [number, number][]; hueco: boolean }[] = [];
  let cur: [number, number][] = [];
  const limpias = limpiaSaltos(fixes);
  for (let i = 0; i < limpias.length; i++) {
    const f = limpias[i], prev = limpias[i - 1];
    if (prev && (ms(f) - ms(prev)) / 60_000 > 2 && millasEntre(prev, f) > 0.25) {
      if (cur.length > 1) out.push({ positions: cur, hueco: false });
      out.push({ positions: [[prev.lat, prev.lng], [f.lat, f.lng]], hueco: true });
      cur = [];
    }
    cur.push([f.lat, f.lng]);
  }
  if (cur.length > 1) out.push({ positions: cur, hueco: false });
  return out;
}
