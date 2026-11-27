// ============================================================
// Guardar una orden sin pisar a otra persona (auditoría lote 2, guardar).
//
// Dos problemas que esto cierra:
//  1. Un UPDATE que la RLS deja en cero filas vuelve SIN error: la pantalla decía «guardado» y no lo estaba.
//     Aquí 0 filas es un fallo (`sin_filas`) y nunca se avisa como guardado.
//  2. Dos personas con la misma orden abierta: gana el último que guarda, y las fotos se reescribían enteras
//     (se perdían las del otro). Con `versionEsperada` (el `updated_at` que tenía la orden al abrirla) el
//     UPDATE solo pasa si nadie la cambió desde entonces; si no, es un `conflicto` y no se pisa nada.
//     Para las fotos no hace falta preguntar: se leen de la base justo antes, se unen con las nuevas y se
//     quitan solo las que quien guarda quitó; si el candado falla, se reintenta UNA vez releyendo.
//
// Lo que NO usa candado (guardados automáticos: route_seq, cambios de etapa del chofer) no pasa
// `versionEsperada`: se escribe como antes, pero 0 filas ya cuenta como fallo.
// ============================================================
import { autoresDeFotos, type AutoresDeFotos } from "@/lib/fotos-de-entrega";

export const AVISO_SIN_GUARDAR = {
  es: "No se guardó: no tienes permiso o la orden cambió",
  en: "Not saved: no permission or the order changed",
} as const;

export const AVISO_CONFLICTO = {
  es: "Otra persona cambió esta orden mientras la editabas. Revisa los cambios y vuelve a guardar.",
  en: "Someone else changed this order while you were editing it. Review the changes and save again.",
} as const;

/**
 * Une las fotos que hay en la base con las de la pantalla, sin duplicar:
 *  - se quitan SOLO las que la pantalla tenía (`antes`) y ya no tiene (`nuevas`): las quitó quien guarda;
 *  - se añaden las que la pantalla trae y no tenía: las subió quien guarda;
 *  - lo demás de la base (lo que subió o quitó otra persona) se queda como está.
 */
export function uneFotos(enBase: readonly string[] | null | undefined, antes: readonly string[], nuevas: readonly string[]): string[] {
  const quitadas = antes.filter((f) => !nuevas.includes(f));
  const anadidas = nuevas.filter((f) => !antes.includes(f));
  const base = (enBase ?? []).filter((f) => !quitadas.includes(f));
  return [...new Set([...base, ...anadidas])];
}

/** Lo que hace falta de la base para escribir: se lee el `updated_at` y las fotos en la misma fila. */
export type FilaDeOrden = { id: string; updated_at: string | null; photos: string[] | null; photo_meta: AutoresDeFotos | null };

/** Lo mínimo para escribir una orden. El cliente real lo cumple con `escritorDeOrdenes`; las pruebas, con un falso. */
export type Escritor = {
  /** Lee la fila (fotos, sus autores y `updated_at`). `null` si no se pudo leer o no existe. */
  leer: (id: string) => Promise<FilaDeOrden | null>;
  /**
   * UPDATE de `patch` en la orden. `version`: `undefined` = sin candado; `null` = solo si `updated_at` es nulo;
   * texto = solo si `updated_at` sigue igual. Devuelve las filas que el UPDATE tocó (con su nuevo `updated_at`).
   */
  escribir: (id: string, patch: Record<string, unknown>, version: string | null | undefined) =>
    Promise<{ error: { message: string } | null; filas: { id: string; updated_at: string | null }[] }>;
  /** ¿Sigue existiendo la orden? Para distinguir «la cambiaron» de «no tienes permiso / no existe». */
  existe: (id: string) => Promise<boolean>;
};

export type ResultadoDeGuardar =
  | { ok: true; updated_at: string | null; patch: Record<string, unknown> }
  | { ok: false; motivo: "sin_filas" }
  | { ok: false; motivo: "conflicto"; updated_at: string | null }
  | { ok: false; motivo: "no_leida" }
  | { ok: false; motivo: "error"; mensaje: string };

export type OpcionesDeGuardar = {
  /** `updated_at` que tenía la orden al abrirla. Sin esto, la escritura no mira la versión. */
  versionEsperada?: string | null;
  /** Fotos que tenía la pantalla al abrirla. Con esto (y `patch.photos`) se unen y quitan como arriba. */
  fotosAntes?: readonly string[];
  /** Quién guarda las fotos nuevas y cuándo, para sus autores. */
  autor?: { quien: string; ahora: string };
};

/**
 * Guarda `patch` en la orden `id` con las reglas de arriba. No avisa al usuario: devuelve el motivo y quien
 * llama decide qué decir (en español e inglés, con `AVISO_SIN_GUARDAR` / `AVISO_CONFLICTO`).
 */
export async function guardaOrdenConCandado(
  esc: Escritor,
  id: string,
  patch: Record<string, unknown>,
  opts: OpcionesDeGuardar = {},
): Promise<ResultadoDeGuardar> {
  const porFotos = opts.fotosAntes !== undefined && Array.isArray(patch.photos);
  // Con fotos: hasta dos vueltas (lee, une, escribir con el `updated_at` que leyó). Sin fotos: una.
  for (let intento = 0; intento < (porFotos ? 2 : 1); intento++) {
    let escrito = patch;
    let version: string | null | undefined = opts.versionEsperada;
    if (porFotos) {
      const fila = await esc.leer(id);
      if (!fila) return { ok: false, motivo: "no_leida" };
      const fotos = uneFotos(fila.photos, opts.fotosAntes!, patch.photos as string[]);
      escrito = {
        ...patch,
        photos: fotos,
        photo_meta: opts.autor ? autoresDeFotos(fotos, fila.photo_meta, opts.autor.quien, opts.autor.ahora) : fila.photo_meta,
      };
      version = fila.updated_at;
    }
    const r = await esc.escribir(id, escrito, version);
    if (r.error) return { ok: false, motivo: "error", mensaje: r.error.message };
    const fila = r.filas[0];
    if (fila) return { ok: true, updated_at: fila.updated_at, patch: escrito };
    // 0 filas: o la cambiaron desde que se leyó, o no hay permiso / no existe.
    if (version === undefined) return { ok: false, motivo: "sin_filas" };
    if (!(await esc.existe(id))) return { ok: false, motivo: "sin_filas" };
    if (porFotos && intento === 0) continue;   // las fotos reintentan una vez, releyendo
    const actual = await esc.leer(id);
    return { ok: false, motivo: "conflicto", updated_at: actual?.updated_at ?? null };
  }
  return { ok: false, motivo: "sin_filas" };
}

// ---------- Cliente real de Supabase ----------

type Consulta = PromiseLike<{ data: unknown; error: { message: string } | null }> & {
  eq(columna: string, valor: unknown): Consulta;
  is(columna: string, valor: null): Consulta;
  select(columnas: string): Consulta;
  maybeSingle(): Consulta;
};
/** Forma mínima del cliente de Supabase que usa esto (el cliente real la cumple). */
export type ClienteDeOrdenes = {
  from(tabla: "deliveries"): {
    select(columnas: string): Consulta;
    update(patch: Record<string, unknown>): Consulta;
  };
};

/** Escritor sobre el cliente de Supabase de la app: tabla `deliveries`. */
export function escritorDeOrdenes(cliente: unknown): Escritor {
  const db = cliente as ClienteDeOrdenes;
  return {
    async leer(id) {
      const r = await db.from("deliveries").select("id, photos, photo_meta, updated_at").eq("id", id).maybeSingle();
      if (r.error || !r.data) return null;
      const f = r.data as Partial<FilaDeOrden>;
      return { id, updated_at: f.updated_at ?? null, photos: f.photos ?? null, photo_meta: f.photo_meta ?? null };
    },
    async escribir(id, patch, version) {
      let consulta = db.from("deliveries").update(patch).eq("id", id);
      if (version === null) consulta = consulta.is("updated_at", null);
      else if (version !== undefined) consulta = consulta.eq("updated_at", version);
      const r = await consulta.select("id, updated_at");
      return { error: r.error, filas: (r.data ?? []) as { id: string; updated_at: string | null }[] };
    },
    async existe(id) {
      const r = await db.from("deliveries").select("id").eq("id", id).maybeSingle();
      return !r.error && !!r.data;
    },
  };
}
