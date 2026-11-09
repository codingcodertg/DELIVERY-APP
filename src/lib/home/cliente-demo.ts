import { AVISO_DEL_DEMO, directorioDemo, mensajesDemo, PERFIL_DEMO, solicitudesDemo, tutorialesDemo } from "@/lib/home/demo-data";

/**
 * Un cliente de Supabase de mentira para el inicio del Hub en el demo (D-NEXT): contesta las lecturas con la semilla y las
 * escrituras con `AVISO_DEL_DEMO`, sin red. Solo lo que usan las pantallas de `/home/**`; una tabla que no conoce vale como
 * vacía, y las pantallas ya saben pintar eso. Las filas se filtran de verdad: «Mis solicitudes» enseña solo las propias.
 */
type Fila = Record<string, unknown>;
type Respuesta = { data: unknown; error: { message: string } | null };

const SIN_ESCRITURA: Respuesta = { data: null, error: { message: AVISO_DEL_DEMO } };

function tablasDemo(ahora: Date): Record<string, Fila[]> {
  return {
    profiles: [{ ...PERFIL_DEMO }],
    help_requests: solicitudesDemo(ahora),
    help_messages: mensajesDemo(ahora),
  };
}

function consulta(filas: Fila[]) {
  let resultado = filas;
  let escribe = false;
  let unaSola = false;
  const fin = (): Respuesta => {
    if (escribe) return SIN_ESCRITURA;
    return { data: unaSola ? (resultado[0] ?? null) : resultado, error: null };
  };
  const q = {
    select: (_columnas?: string) => q,
    eq: (c: string, v: unknown) => { resultado = resultado.filter((f) => f[c] === v); return q; },
    in: (c: string, v: unknown[]) => { resultado = resultado.filter((f) => v.includes(f[c])); return q; },
    not: (c: string, op: string, v: unknown) => {
      if (op === "is" && v === null) resultado = resultado.filter((f) => f[c] !== null && f[c] !== undefined);
      return q;
    },
    order: (c: string, o?: { ascending?: boolean }) => {
      const signo = o?.ascending === false ? -1 : 1;
      resultado = [...resultado].sort((a, b) => signo * String(a[c]).localeCompare(String(b[c])));
      return q;
    },
    limit: (n: number) => { resultado = resultado.slice(0, n); return q; },
    maybeSingle: () => { unaSola = true; return q; },
    single: () => { unaSola = true; return q; },
    insert: () => { escribe = true; return q; },
    update: () => { escribe = true; return q; },
    upsert: () => { escribe = true; return q; },
    delete: () => { escribe = true; return q; },
    then: <T>(ok: (r: Respuesta) => T, ko?: (e: unknown) => T) => Promise.resolve(fin()).then(ok, ko),
  };
  return q;
}

export function clienteDemoDelHub(ahora: Date) {
  const tablas = tablasDemo(ahora);
  const canal = { on: () => canal, subscribe: () => canal };
  return {
    auth: { getUser: async () => ({ data: { user: { id: PERFIL_DEMO.id, email: "admin@demo.example" } }, error: null }) },
    from: (tabla: string) => consulta(tablas[tabla] ?? []),
    rpc: async (funcion: string): Promise<Respuesta> => {
      if (funcion === "tutorials") return { data: tutorialesDemo(ahora), error: null };
      if (funcion === "phone_book") return { data: directorioDemo(), error: null };
      return SIN_ESCRITURA;
    },
    channel: () => canal,
    removeChannel: async () => "ok",
    storage: {
      from: () => ({
        download: async () => SIN_ESCRITURA,
        upload: async () => SIN_ESCRITURA,
        createSignedUrl: async () => SIN_ESCRITURA,
      }),
    },
  };
}
