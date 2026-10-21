import type { Idioma } from "@/lib/idioma";
import { TABLAS_QUE_SIGUEN, ensenanzaDelNavegador, escrituraBloqueadaEnEnsenanza } from "@/lib/ensenanza-general";
import { cumpleConsulta, ordena, proyecta, tablaDeLaRuta, type Fila } from "@/lib/practica/postgrest";
import { mensajeDeLoQueNoSePractica } from "@/lib/practica/mensajes";

/**
 * La práctica del modo enseñanza en el navegador (D-628, 2026-10-21).
 *
 * El dueño, sobre D-626 (que cortaba toda escritura): «estoy queriendo hacer algo y simplemente no pasa nada […] Yo
 * ocupo […] que yo pueda usar el app normal sin restricciones y cuando le quito el modo de enseñanza, pum, vuelva a
 * como estaba antes […] en HR estoy viendo algo y simplemente no me deja hacer varias cosas y no se registran los
 * cambios». Y luego: «lo único que quiero es que se puedan hacer cambios pero cuando se quite todo vuelva a la
 * normalidad, que esos cambios no se guarden».
 *
 * Medido antes de elegir: Supabase no deja deshacer una petición al terminarla (`Prefer: tx=rollback` no se aplica en
 * este proyecto), así que la práctica no puede vivir en la base. Vive aquí, en el `fetch` de los clientes de Supabase
 * del navegador, como el entorno de Entregas (D-274) pero para cualquier tabla:
 *
 * - **Escribir** en una tabla (insertar, cambiar, borrar, `upsert`) no sale del equipo: se apunta en una libreta del
 *   navegador (`localStorage`, por persona) y se contesta como lo haría PostgREST, con la fila resultante.
 * - **Leer** una tabla trae lo real y le pinta encima lo apuntado: las filas cambiadas salen cambiadas, las borradas no
 *   salen, y las nuevas salen donde sus filtros digan (`practica/postgrest.ts`).
 * - **Apagar** el modo tira la libreta y recarga: todo vuelve a como estaba, porque nada llegó a la base.
 *
 * Lo que no es una tabla no se puede imitar sin la base: las funciones que escriben (`rpc`), subir o borrar archivos,
 * y las cuentas de Usuarios. Eso sigue cortado como en D-626, pero ahora con un aviso visible (`EVENTO_PRACTICA_AVISO`)
 * para que nunca parezca que «no pasa nada». Lo que se hace desde el servidor (acciones del Inventario, fichas de
 * empleados de RR. HH.) lo corta el servidor (`ensenanza-servidor.ts`).
 */

export const EVENTO_PRACTICA_AVISO = "rtg:practica-aviso";
export const PREFIJO_DE_LA_LIBRETA = "rtg_practica:";

/** Por tabla (`esquema.tabla`), por id: la fila como queda en la práctica, o `null` si se borró. */
export type Diario = Record<string, Record<string, Fila | null>>;
export type Libreta = { lee(): Diario; guarda(d: Diario): void };

type FetchReal = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

export type OpcionesDePractica = {
  activa: () => Idioma | null;
  /** La libreta de la persona de la petición (por su token), o `null` sin sesión. */
  libreta: (cabeceras: Headers) => Libreta | null;
  avisa?: (mensaje: string) => void;
  ahora?: () => Date;
  nuevoId?: () => string;
};

const json = (cuerpo: unknown, status: number, extra: Record<string, string> = {}) =>
  new Response(cuerpo === undefined ? null : JSON.stringify(cuerpo), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", ...extra },
  });


const corte = (idioma: Idioma, avisa?: (m: string) => void) => {
  const message = mensajeDeLoQueNoSePractica(idioma);
  avisa?.(message);
  return json({ code: "ENSENANZA", message, details: null, hint: null }, 403);
};

/** El esquema de la petición: `Accept-Profile` al leer, `Content-Profile` al escribir; sin ninguno, `public`. */
const esquemaDe = (h: Headers) => h.get("content-profile") || h.get("accept-profile") || "public";

/**
 * Lo apuntado, pintado sobre lo real (puro). Las filas reales que la práctica cambió salen con sus valores nuevos (o no
 * salen, si ya no cumplen el filtro o se borraron); las de práctica que cumplen el filtro y no vinieron, se añaden. Una
 * fila que no se sabe si cumple (un filtro que aquí no se lee) se deja como la dio la base y no se añade.
 */
export function aplicaDiario(filas: Fila[], entradas: Record<string, Fila | null> | undefined, params: URLSearchParams): Fila[] {
  if (!entradas || Object.keys(entradas).length === 0) return filas;
  const out: Fila[] = [];
  const vistas = new Set<string>();
  for (const f of filas) {
    const id = f.id === undefined || f.id === null ? null : String(f.id);
    if (id === null || !(id in entradas)) { out.push(f); continue; }
    vistas.add(id);
    const e = entradas[id];
    if (e === null) continue;
    if (cumpleConsulta(e, params) === false) continue;
    const nueva: Fila = { ...f };
    for (const k of Object.keys(f)) if (k in e) nueva[k] = e[k];
    out.push(nueva);
  }
  // Con `offset` no se añade nada: la fila nueva saldría repetida en cada página.
  const desplazado = Number(params.get("offset") ?? "0") > 0;
  if (!desplazado) {
    for (const [id, e] of Object.entries(entradas)) {
      if (e === null || vistas.has(id)) continue;
      if (cumpleConsulta(e, params) === true) out.push(proyecta(e, params.get("select")));
    }
  }
  const ordenadas = ordena(out, params.get("order"));
  const limite = params.get("limit");
  return limite !== null && Number.isFinite(Number(limite)) ? ordenadas.slice(0, Number(limite)) : ordenadas;
}

/** Lo que un valor «vacío» de esa columna sería, mirando una fila de muestra de la tabla. */
function porDefecto(muestra: unknown, columna: string, ahora: string): unknown {
  if (columna === "created_at" || columna === "updated_at") return ahora;
  if (typeof muestra === "boolean") return false;
  if (Array.isArray(muestra)) return [];
  return null;
}

/** Un id que nunca coincide con uno real: uuid, o un entero negativo si la tabla usa números. */
function idNuevo(muestra: unknown, nuevoId: () => string): string | number {
  if (typeof muestra === "number") return -Math.floor(Math.random() * 1e9) - 1;
  return nuevoId();
}

export function fetchDePractica(fetchReal: FetchReal, op: OpcionesDePractica): FetchReal {
  const muestras = new Map<string, Fila | null>();
  const ahoraIso = () => (op.ahora?.() ?? new Date()).toISOString();
  const nuevoId = op.nuevoId ?? (() => crypto.randomUUID());

  return async (input, init) => {
    const idioma = op.activa();
    if (!idioma) return fetchReal(input, init);
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const metodo = (init?.method ?? (typeof input === "object" && "method" in input ? input.method : "GET")).toUpperCase();
    const tabla = tablaDeLaRuta(url);
    if (!tabla) return escrituraBloqueadaEnEnsenanza(metodo, url) ? corte(idioma, op.avisa) : fetchReal(input, init);

    const cabeceras = new Headers(init?.headers ?? (typeof input === "object" && "headers" in input ? input.headers : undefined));
    const esquema = esquemaDe(cabeceras);
    if ((TABLAS_QUE_SIGUEN as readonly string[]).includes(tabla)) return fetchReal(input, init);
    if (metodo === "HEAD" || metodo === "OPTIONS") return fetchReal(input, init);
    const libreta = op.libreta(cabeceras);
    if (!libreta) return metodo === "GET" ? fetchReal(input, init) : corte(idioma, op.avisa);

    const clave = `${esquema}.${tabla}`;
    const u = new URL(url, "http://local");
    const params = u.searchParams;
    const quiereObjeto = (cabeceras.get("accept") ?? "").includes("vnd.pgrst.object");

    /** Lee lo real (siempre como lista) con lo apuntado encima. */
    const lee = async (p: URLSearchParams): Promise<{ ok: true; filas: Fila[]; res: Response } | { ok: false; res: Response }> => {
      const h = new Headers(cabeceras);
      h.set("accept", "application/json");
      h.set("accept-profile", esquema);
      h.delete("content-profile");
      h.delete("content-type");
      h.delete("prefer");
      const destino = new URL(u.href);
      destino.search = p.toString();
      const res = await fetchReal(u.origin === "http://local" ? `${destino.pathname}${destino.search}` : destino.href, { method: "GET", headers: h, signal: init?.signal });
      if (!res.ok) return { ok: false, res };
      const datos = await res.json().catch(() => []);
      const filas = Array.isArray(datos) ? (datos as Fila[]) : datos ? [datos as Fila] : [];
      return { ok: true, filas: aplicaDiario(filas, libreta.lee()[clave], p), res };
    };

    if (metodo === "GET") {
      // Sin nada apuntado en esta tabla, la petición sale tal cual (con su `count`, su `Accept`…).
      const apuntado = libreta.lee()[clave];
      if (!apuntado || Object.keys(apuntado).length === 0) return fetchReal(input, init);
      const r = await lee(params);
      if (!r.ok) return r.res;
      if (quiereObjeto) {
        return r.filas.length === 1
          ? json(r.filas[0], 200)
          : json({ code: "PGRST116", details: `The result contains ${r.filas.length} rows`, hint: null, message: "JSON object requested, multiple (or no) rows returned" }, 406);
      }
      const rango = r.res.headers.get("content-range");
      const extra: Record<string, string> = {};
      if (rango) {
        const [, total] = rango.split("/");
        const n = r.filas.length;
        extra["content-range"] = `${n ? `0-${n - 1}` : "*"}/${total === "*" || total === undefined ? "*" : Math.max(n, Number(total))}`;
      }
      return json(r.filas, 200, extra);
    }

    // ---- Escribir: se apunta y se contesta como PostgREST. ----
    try {
      const prefer = cabeceras.get("prefer") ?? "";
      const representa = /return=representation/.test(prefer);
      const select = params.get("select");
      const filtros = new URLSearchParams(params);
      for (const k of ["select", "columns", "on_conflict"]) filtros.delete(k);
      const diario = libreta.lee();
      const entradas = (diario[clave] ??= {});
      const resultado: Fila[] = [];

      const muestra = async (): Promise<Fila | null> => {
        if (!muestras.has(clave)) {
          const r = await lee(new URLSearchParams({ select: "*", limit: "1" }));
          muestras.set(clave, r.ok ? r.filas[0] ?? null : null);
        }
        return muestras.get(clave) ?? null;
      };

      if (metodo === "POST") {
        const cuerpo = typeof init?.body === "string" && init.body ? JSON.parse(init.body) : {};
        const filas = (Array.isArray(cuerpo) ? cuerpo : [cuerpo]) as Fila[];
        const upsert = /resolution=(merge|ignore)-duplicates/.test(prefer);
        const ignora = /resolution=ignore-duplicates/.test(prefer);
        const conflicto = (params.get("on_conflict") ?? "id").split(",").map((c) => c.trim()).filter(Boolean);
        const m = await muestra();
        for (const f of filas) {
          let existente: Fila | null = null;
          if (upsert && conflicto.every((c) => f[c] !== undefined && f[c] !== null)) {
            const p = new URLSearchParams({ select: "*" });
            for (const c of conflicto) p.set(c, `eq.${String(f[c])}`);
            const r = await lee(p);
            if (r.ok) existente = r.filas[0] ?? null;
          }
          if (existente) {
            const nueva = ignora ? existente : { ...existente, ...f, ...("updated_at" in existente && !("updated_at" in f) ? { updated_at: ahoraIso() } : {}) };
            if (nueva.id === undefined || nueva.id === null) return corte(idioma, op.avisa);
            entradas[String(nueva.id)] = nueva;
            resultado.push(nueva);
            continue;
          }
          const nueva: Fila = {};
          if (m) for (const k of Object.keys(m)) nueva[k] = porDefecto(m[k], k, ahoraIso());
          else nueva.created_at = ahoraIso();
          Object.assign(nueva, f);
          if (nueva.id === undefined || nueva.id === null) nueva.id = idNuevo(m?.id, nuevoId);
          entradas[String(nueva.id)] = nueva;
          resultado.push(nueva);
        }
        libreta.guarda(diario);
        if (!representa) return new Response(null, { status: 201 });
        const salida = resultado.map((f) => proyecta(f, select));
        return quiereObjeto ? json(salida[0] ?? null, 201) : json(salida, 201);
      }

      if (metodo === "PATCH" || metodo === "DELETE" || metodo === "PUT") {
        const p = new URLSearchParams(filtros);
        p.set("select", "*");
        const r = await lee(p);
        if (!r.ok) return r.res;
        if (r.filas.some((f) => f.id === undefined || f.id === null)) return corte(idioma, op.avisa);
        const cambio = metodo === "DELETE" ? null : ((typeof init?.body === "string" && init.body ? JSON.parse(init.body) : {}) as Fila);
        for (const f of r.filas) {
          if (cambio === null) { entradas[String(f.id)] = null; resultado.push(f); continue; }
          const nueva = { ...f, ...cambio, ...("updated_at" in f && !("updated_at" in cambio) ? { updated_at: ahoraIso() } : {}) };
          entradas[String(f.id)] = nueva;
          resultado.push(nueva);
        }
        libreta.guarda(diario);
        if (!representa) return new Response(null, { status: 204 });
        const salida = resultado.map((f) => proyecta(f, select));
        return quiereObjeto ? json(salida[0] ?? null, 200) : json(salida, 200);
      }
      return corte(idioma, op.avisa);
    } catch {
      return corte(idioma, op.avisa);
    }
  };
}

// ---------------------------------------------------------------------------------------------------------------------
// En el navegador.
// ---------------------------------------------------------------------------------------------------------------------

type Almacen = { getItem(k: string): string | null; setItem(k: string, v: string): void; removeItem(k: string): void };
type AlmacenConClaves = { removeItem(k: string): void; key?(i: number): string | null; readonly length?: number };

/** El `sub` del token de la petición: de quién es la libreta. */
export function quienEs(cabeceras: Headers): string | null {
  const auth = cabeceras.get("authorization") ?? "";
  const token = auth.replace(/^Bearer\s+/i, "");
  const cuerpo = token.split(".")[1];
  if (!cuerpo) return null;
  try {
    const texto = typeof atob === "function"
      ? atob(cuerpo.replace(/-/g, "+").replace(/_/g, "/"))
      : Buffer.from(cuerpo, "base64url").toString("utf8");
    const sub = (JSON.parse(texto) as { sub?: unknown }).sub;
    return typeof sub === "string" && sub ? sub : null;
  } catch {
    return null;
  }
}

export function libretaEn(almacen: Almacen | null | undefined, uid: string): Libreta {
  const k = PREFIJO_DE_LA_LIBRETA + uid;
  return {
    lee: () => {
      try {
        const o = JSON.parse(almacen?.getItem(k) ?? "{}") as unknown;
        return o && typeof o === "object" && !Array.isArray(o) ? (o as Diario) : {};
      } catch {
        return {};
      }
    },
    guarda: (d) => { try { almacen?.setItem(k, JSON.stringify(d)); } catch { /* lleno o bloqueado: la práctica no persiste */ } },
  };
}

/** Tira toda libreta de práctica de este navegador: apagar el modo vuelve todo a como estaba. */
export function olvidaPractica(almacen: AlmacenConClaves | null | undefined): void {
  if (!almacen || typeof almacen.key !== "function") return;
  try {
    const claves: string[] = [];
    for (let i = 0; i < (almacen.length ?? 0); i++) { const k = almacen.key(i); if (k?.startsWith(PREFIJO_DE_LA_LIBRETA)) claves.push(k); }
    for (const k of claves) almacen.removeItem(k);
  } catch { /* nada que borrar */ }
}

/** El `fetch` de los clientes de Supabase del navegador. */
export function fetchDePracticaDelNavegador(): FetchReal {
  return fetchDePractica((i, o) => fetch(i, o), {
    activa: ensenanzaDelNavegador,
    libreta: (h) => {
      const uid = quienEs(h);
      return uid && typeof localStorage !== "undefined" ? libretaEn(localStorage, uid) : null;
    },
    avisa: (mensaje) => { if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent(EVENTO_PRACTICA_AVISO, { detail: mensaje })); },
  });
}

