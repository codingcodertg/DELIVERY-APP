import { AVISO_DEL_DEMO, PERFIL_ERP_DEMO, rpcsDemoErp, tablasDemoErp, type Fila } from "@/lib/erp/demo-data";

/**
 * El cliente de Supabase de mentira de Inventario en el demo (D-941), calcado del del Hub (D-940): las lecturas contestan
 * con la semilla y las escrituras —tablas, funciones y archivos— con `AVISO_DEL_DEMO`, sin red. Los filtros se aplican de
 * verdad, porque en el manual se busca, se filtra y se ordena: un catálogo que no filtra enseñaría una pantalla falsa.
 */
type Fallo = { message: string; code?: string };
type Respuesta = { data: unknown; error: Fallo | null; count: number | null };

const SIN_ESCRITURA: Respuesta = { data: null, error: { message: AVISO_DEL_DEMO }, count: null };

const igual = (a: unknown, b: unknown) => String(a) === String(b);

function patron(p: string) {
  const cuerpo = [...p].map((c) => (c === "%" ? ".*" : c === "_" ? "." : c.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))).join("");
  return new RegExp(`^${cuerpo}$`, "i");
}
const parecido = (v: unknown, p: string) => v !== null && v !== undefined && patron(p).test(String(v));

/** `name.ilike.%x%,sku.ilike.%x%`: lo único que estas pantallas le piden a `.or()`. */
function cumpleOr(f: Fila, expresion: string) {
  return expresion.split(",").some((parte) => {
    const [c, op, ...resto] = parte.split(".");
    const valor = resto.join(".");
    if (op === "ilike") return parecido(f[c], valor);
    if (op === "eq") return igual(f[c], valor);
    return false;
  });
}

function compara(a: unknown, b: unknown) {
  if (a === b) return 0;
  if (a === null || a === undefined) return 1;
  if (b === null || b === undefined) return -1;
  return typeof a === "number" && typeof b === "number" ? a - b : String(a).localeCompare(String(b));
}

function consulta(filas: Fila[]) {
  let resultado = filas;
  let escribe = false;
  let una: "single" | "maybe" | null = null;
  let contar = false;
  let soloCabecera = false;
  let tope: number | null = null;
  let tramo: [number, number] | null = null;
  const orden: { c: string; signo: number }[] = [];
  const filtra = (f: (x: Fila) => boolean) => { resultado = resultado.filter(f); return q; };

  const fin = (): Respuesta => {
    if (escribe) return SIN_ESCRITURA;
    let salida = resultado;
    if (orden.length) {
      salida = [...salida].sort((a, b) => {
        for (const { c, signo } of orden) { const r = compara(a[c], b[c]); if (r) return signo * r; }
        return 0;
      });
    }
    const count = contar ? salida.length : null;
    if (tramo) salida = salida.slice(tramo[0], tramo[1] + 1);
    if (tope !== null) salida = salida.slice(0, tope);
    if (una === "single" && salida.length === 0) return { data: null, error: { message: "No rows", code: "PGRST116" }, count };
    if (una) return { data: salida[0] ?? null, error: null, count };
    return { data: soloCabecera ? null : salida, error: null, count };
  };

  const q = {
    select: (_columnas?: string, op?: { count?: string; head?: boolean }) => { contar = !!op?.count; soloCabecera = !!op?.head; return q; },
    eq: (c: string, v: unknown) => filtra((f) => igual(f[c], v)),
    neq: (c: string, v: unknown) => filtra((f) => !igual(f[c], v)),
    in: (c: string, v: unknown[]) => filtra((f) => v.some((x) => igual(f[c], x))),
    is: (c: string, v: unknown) => filtra((f) => (v === null ? f[c] === null || f[c] === undefined : f[c] === v)),
    not: (c: string, op: string, v: unknown) => filtra((f) => (op === "is" && v === null ? f[c] !== null && f[c] !== undefined : op === "eq" ? !igual(f[c], v) : true)),
    gt: (c: string, v: unknown) => filtra((f) => compara(f[c], v) > 0),
    gte: (c: string, v: unknown) => filtra((f) => compara(f[c], v) >= 0),
    lt: (c: string, v: unknown) => filtra((f) => compara(f[c], v) < 0),
    lte: (c: string, v: unknown) => filtra((f) => compara(f[c], v) <= 0),
    ilike: (c: string, p: string) => filtra((f) => parecido(f[c], p)),
    or: (e: string) => filtra((f) => cumpleOr(f, e)),
    contains: (c: string, v: unknown[]) => filtra((f) => Array.isArray(f[c]) && v.every((x) => (f[c] as unknown[]).includes(x))),
    order: (c: string, o?: { ascending?: boolean }) => { orden.push({ c, signo: o?.ascending === false ? -1 : 1 }); return q; },
    limit: (n: number) => { tope = n; return q; },
    range: (a: number, b: number) => { tramo = [a, b]; return q; },
    maybeSingle: () => { una = "maybe"; return q; },
    single: () => { una = "single"; return q; },
    insert: () => { escribe = true; return q; },
    update: () => { escribe = true; return q; },
    upsert: () => { escribe = true; return q; },
    delete: () => { escribe = true; return q; },
    then: <T>(ok: (r: Respuesta) => T, ko?: (e: unknown) => T) => Promise.resolve(fin()).then(ok, ko),
  };
  return q;
}

export function clienteDemoDelErp(ahora: Date) {
  const tablas = tablasDemoErp(ahora);
  const rpcs = rpcsDemoErp(ahora);
  const canal = { on: () => canal, subscribe: () => canal };
  const cliente = {
    auth: { getUser: async () => ({ data: { user: { id: PERFIL_ERP_DEMO.id, email: PERFIL_ERP_DEMO.email } }, error: null }) },
    // `profiles` vive en `public` y lo demás en `erp`; en la semilla no chocan.
    schema: () => cliente,
    from: (tabla: string) => consulta(tablas[tabla] ?? []),
    rpc: async (funcion: string, args?: Record<string, unknown>): Promise<Respuesta> => {
      const leer = rpcs[funcion];
      return leer ? { data: leer(args), error: null, count: null } : SIN_ESCRITURA;
    },
    channel: () => canal,
    removeChannel: async () => "ok",
    storage: {
      from: (_cubeta?: string) => ({
        upload: async () => SIN_ESCRITURA,
        download: async () => SIN_ESCRITURA,
        remove: async () => SIN_ESCRITURA,
        createSignedUrl: async () => SIN_ESCRITURA,
      }),
    },
  };
  return cliente;
}
