// Lo que comparten `migrate-status.mjs` (que dice que falta) y `aplica-migracion.mjs` (que lo
// aplica): el checksum, el entorno, y los guardas que decide si una migracion se puede ejecutar.
//
// Vive aparte por una razon concreta: el checksum es lo que acaba ESCRITO en
// public.schema_migrations, y dos copias de esa regla en dos ficheros se desincronizan. La misma
// funcion la calcula para el "--sum" que se pega en la migracion, para el estado, y para el guarda
// que comprueba que la linea pegada sigue valiendo (D-512).
//
// Sin acentos, como el resto de scripts/db.

import { readFileSync, readdirSync } from "node:fs";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
export const MIG_DIR = join(ROOT, "supabase", "migrations");
export const MARK = "-- @ledger-below";

/** Saltos a LF. Los ficheros del repo vienen mezclados (CRLF en Windows), y el checksum no puede
 *  depender de con que editor se guardo. */
const aLF = (t) => t.replace(/\r\n/g, "\n").replace(/\r/g, "\n");

/** Checksum: sha256 de lo ANTERIOR al marcador, con saltos en LF (identico al backfill de la 102).
 *  Lo de antes del marcador, y no el fichero entero, para que la propia linea de registro -que
 *  lleva el checksum dentro- no cambie el checksum que declara. */
export function checksum(text) {
  return createHash("sha256").update(aLF(text).split(MARK)[0], "utf8").digest("hex");
}

/** El cuerpo y lo que haya tras el marcador, por separado. Sin marcador, `registro` es null. */
export function cuerpoYRegistro(text) {
  const lf = aLF(text);
  const i = lf.indexOf(MARK);
  if (i < 0) return { cuerpo: lf, registro: null };
  return { cuerpo: lf.slice(0, i), registro: lf.slice(i + MARK.length) };
}

/** La linea que auto-inscribe la migracion. Una sola definicion: la imprime `--sum` y la comprueba
 *  el guarda, asi que no pueden discrepar. */
export function lineaDeRegistro(nombre, sum) {
  return `insert into public.schema_migrations (name, checksum) values ('${nombre}', '${sum}') on conflict (name) do nothing;`;
}

/** El sha que la propia migracion declara en su linea de registro, o null si no hay linea. */
export function shaDeclarado(text, nombre) {
  const { registro } = cuerpoYRegistro(text);
  if (registro == null) return null;
  const esc = nombre.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const m = registro.match(new RegExp(`values\\s*\\(\\s*'${esc}'\\s*,\\s*'([0-9a-f]{64})'`, "i"));
  return m ? m[1] : null;
}

/**
 * El SQL sin comentarios de linea ni bloques entre comillas de dolar.
 *
 * Los bloques `$$ ... $$` hay que quitarlos ANTES de buscar transacciones, porque un
 * `do $$ declare ... begin ... end $$;` -que es como se escribe una comprobacion en este repo-
 * lleva un `begin` dentro que NO es una transaccion. Un grep ingenuo rechazaria migraciones
 * perfectamente validas, incluida la 164.
 */
export function sqlDesnudo(text) {
  const sinComentarios = aLF(text).split("\n").filter((l) => !l.trimStart().startsWith("--")).join("\n");
  // Etiquetas de dolar: $$ y $cualquiera$. Se quitan por pares, de la apertura a su cierre igual.
  let fuera = "";
  let i = 0;
  while (i < sinComentarios.length) {
    const abre = sinComentarios.slice(i).match(/\$[A-Za-z_]*\$/);
    if (!abre) { fuera += sinComentarios.slice(i); break; }
    const inicio = i + abre.index;
    fuera += sinComentarios.slice(i, inicio);
    const cierre = sinComentarios.indexOf(abre[0], inicio + abre[0].length);
    if (cierre < 0) { i = sinComentarios.length; break; } // sin cerrar: lo que queda se descarta
    i = cierre + abre[0].length;
  }
  return fuera;
}

/** ¿Lleva su propia transaccion? Solo a nivel de sentencia, y sobre el SQL desnudo. */
export function llevaTransaccionPropia(text) {
  return /(^|;)\s*(begin|commit|rollback|start\s+transaction|end)\s*(;|$)/i.test(sqlDesnudo(text));
}

/**
 * Todo lo que impide aplicar esta migracion, como lista de frases. Vacia = se puede.
 *
 * `registradas` es el mapa nombre -> checksum de lo que ya corrio en produccion.
 */
export function problemasParaAplicar({ nombre, texto, registradas, otraVez = false }) {
  const malos = [];
  const sum = checksum(texto);
  const { registro } = cuerpoYRegistro(texto);

  if (registro == null) {
    malos.push(`no lleva el marcador ${MARK}: sin el, la migracion no se inscribe y el estado la dara pendiente para siempre`);
  } else {
    const declarado = shaDeclarado(texto, nombre);
    if (!declarado) {
      malos.push(`tras ${MARK} no hay una linea de registro para '${nombre}'. Deberia ser:\n    ${lineaDeRegistro(nombre, sum)}`);
    } else if (declarado !== sum) {
      // Este es el guarda que paga el modulo entero: numerar un D-NEXT dentro del .sql cambia el
      // cuerpo y con el el checksum, y la linea pegada antes se queda declarando el viejo. Paso
      // dos veces el 2026-10-10.
      malos.push(`el checksum declarado no es el del cuerpo.\n    declara:  ${declarado}\n    deberia:  ${sum}\n    arreglalo con: node scripts/db/migrate-status.mjs --sum ${nombre}`);
    }
  }

  if (llevaTransaccionPropia(texto)) {
    // La 124 se aplico sola en un ensayo con ROLLBACK porque su `commit` cerro la transaccion de
    // fuera. Aqui se para antes de abrirla.
    malos.push("lleva su propia transaccion (begin/commit/rollback a nivel de sentencia). Este script la envuelve en una, y un commit de dentro cierra el de fuera: un ensayo con ROLLBACK se aplicaria de verdad");
  }

  if (registradas.has(nombre) && !otraVez) {
    const ya = registradas.get(nombre);
    malos.push(ya === sum
      ? "ya esta aplicada y su checksum coincide: no hay nada que hacer"
      : `ya esta aplicada pero con OTRO checksum (${ya}): el fichero cambio despues de correr. Decide que paso antes de volver a aplicarla`);
  }

  return malos;
}

export function cargaEntorno() {
  try {
    for (const line of readFileSync(join(ROOT, ".env.local"), "utf8").split("\n")) {
      const t = line.trim();
      if (!t || t.startsWith("#") || !t.includes("=")) continue;
      const i = t.indexOf("=");
      const k = t.slice(0, i).trim();
      const v = t.slice(i + 1).trim().replace(/^["']|["']$/g, "");
      if (!(k in process.env)) process.env[k] = v;
    }
  } catch {
    /* sin .env.local: se usan las env ya presentes */
  }
}

export function migracionesDelRepo() {
  return readdirSync(MIG_DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort()
    .map((f) => ({ name: f, checksum: checksum(readFileSync(join(MIG_DIR, f), "utf8")) }));
}

/** El mapa nombre -> checksum de lo aplicado. Por PostgREST con service-role, que salta la RLS
 *  admin-only de la tabla. */
export async function registradas() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error("Falta NEXT_PUBLIC_SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY (en .env.local o el entorno).");
  }
  const res = await fetch(`${url}/rest/v1/schema_migrations?select=name,checksum`, {
    headers: { apikey: key, Authorization: `Bearer ${key}`, Accept: "application/json" },
  });
  if (!res.ok) throw new Error(`No se pudo leer public.schema_migrations: ${res.status} ${await res.text()}`);
  return new Map((await res.json()).map((r) => [r.name, r.checksum]));
}
