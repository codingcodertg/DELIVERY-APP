/**
 * Una base en memoria con lo poco de la API de supabase-js que usan los avisos al cliente (D-NEXT): select con eq/in,
 * maybeSingle, upsert con onConflict + ignoreDuplicates (el reclamo idempotente), update().eq(). SOLO para pruebas:
 * nada sale de la máquina. Las restricciones únicas se imitan con `unicas`.
 */
type Fila = Record<string, unknown>;

export function baseFalsa(inicial: Record<string, Fila[]> = {}, unicas: Record<string, string[][]> = {}) {
  const tablas: Record<string, Fila[]> = {};
  for (const [k, v] of Object.entries(inicial)) tablas[k] = v.map((f) => ({ ...f }));
  const lecturas: string[] = [];
  let seq = 0;

  const from = (tabla: string) => {
    const filtros: ((f: Fila) => boolean)[] = [];
    let op: "select" | "upsert" | "update" = "select";
    let valor: Fila | Fila[] | null = null;
    let opciones: { onConflict?: string; ignoreDuplicates?: boolean } = {};

    const ejecutar = (): { data: unknown; error: { message: string } | null } => {
      const filas = (tablas[tabla] ??= []);
      if (op === "select") {
        lecturas.push(tabla);
        return { data: filas.filter((f) => filtros.every((p) => p(f))).map((f) => ({ ...f })), error: null };
      }
      if (op === "update") {
        const tocadas = filas.filter((f) => filtros.every((p) => p(f)));
        for (const f of tocadas) Object.assign(f, valor);
        return { data: tocadas, error: null };
      }
      const nuevas = (Array.isArray(valor) ? valor : [valor!]);
      const insertadas: Fila[] = [];
      const claves = (opciones.onConflict ?? "").split(",").map((s) => s.trim()).filter(Boolean);
      for (const n of nuevas) {
        const choca = claves.length && filas.some((f) => claves.every((k) => f[k] === n[k]));
        if (choca) { if (opciones.ignoreDuplicates) continue; return { data: null, error: { message: "duplicate key" } }; }
        for (const u of unicas[tabla] ?? []) {
          if (filas.some((f) => u.every((k) => f[k] === n[k]))) return { data: null, error: { message: `duplicate key ${u.join(",")}` } };
        }
        const fila = { id: `f${++seq}`, ...n };
        filas.push(fila);
        insertadas.push({ ...fila });
      }
      return { data: insertadas, error: null };
    };

    const q: Record<string, unknown> = {};
    q.select = () => q;
    q.eq = (k: string, v: unknown) => { filtros.push((f) => f[k] === v); return q; };
    q.in = (k: string, vs: unknown[]) => { filtros.push((f) => vs.includes(f[k])); return q; };
    q.upsert = (v: Fila | Fila[], o: typeof opciones = {}) => { op = "upsert"; valor = v; opciones = o; return q; };
    q.update = (v: Fila) => { op = "update"; valor = v; return q; };
    q.maybeSingle = async () => {
      const r = ejecutar();
      const arr = (r.data as Fila[] | null) ?? [];
      return { data: arr[0] ?? null, error: r.error };
    };
    q.then = (ok: (v: unknown) => unknown, ko?: (e: unknown) => unknown) => Promise.resolve(ejecutar()).then(ok, ko);
    return q;
  };

  return { from, tablas, lecturas };
}
