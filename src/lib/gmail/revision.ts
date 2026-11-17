/**
 * La revisión del Gmail: conectar, «Revisar ahora» (y el cron cada 15 minutos) e «Importar anteriores». SOLO SERVIDOR.
 *
 * Una corrida:
 *   1. Lee la conexión (`recruiting.gmail_connection`) y descifra la contraseña de aplicación con OUTLOOK_TOKEN_KEY.
 *      Sin conexión → «no conectado» y no hace nada más (el cron sale temprano).
 *   2. Abre la INBOX en solo lectura (IMAP) y busca los UID de correos de Indeed (`BUSQUEDA_INDEED`).
 *   3. Revisión: procesa como mucho 50 UID mayores que el cursor, del más viejo al más nuevo. «Importar anteriores»: procesa
 *      un lote de 50 de la lista completa (desde `saltar`) y NO toca el cursor; el cliente repite hasta terminar.
 *   4. Por cada correo: extrae los correos de Indeed (redirigido o reenviado en lote), verifica, y los pasa al MISMO
 *      pipeline que Outlook (`procesaSeguro` de `src/lib/outlook/sincronizar.ts`): reclamo por clave, alta, notas.
 *   5. Avanza el cursor solo hacia adelante y guarda la última revisión, el último error y los contadores.
 *
 * Dedupe: `outlook_processed.message_id` = `gmail:<Message-ID>`. El reclamo es un insert con clave primaria, así que el
 * mismo correo (cron y «Importar anteriores» a la vez, o la misma carta llegada por redirección y por reenvío) se procesa
 * una sola vez. Repetir una corrida no crea nada dos veces.
 *
 * Nunca se loguea la contraseña ni el cuerpo: solo contadores y motivos cortos.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { cifrar, claveDesdeTexto, descifrar } from "@/lib/outlook/cifrado";
import { clasificaCorreoIndeed, type CorreoDeIndeed } from "@/lib/outlook/indeed";
import { enFase, procesaSeguro, type FaseBackfill, type ResultadoFila } from "@/lib/outlook/sincronizar";
import type { MensajeIndeed } from "@/lib/outlook/sincronizar";
import { abreInbox, codigoDeErrorGmail, descargaCorreo, uidsDeIndeed, type SesionGmail } from "./imap";
import { correosDeIndeedEnMensaje } from "./extraer";
import { cursorInicial, nuevoUidCursor, uidsPendientes } from "./cursor";

/** Como mucho este número de correos (UID) por corrida. El resto se queda para la siguiente. */
export const MAX_CORREOS_GMAIL_POR_CORRIDA = 50;
/** Tiempo máximo de procesamiento por corrida (la función de Vercel tiene 60 s). Pasado este tiempo, se corta limpio. */
const PRESUPUESTO_MS = 45_000;
/** Contexto de cifrado de la contraseña: un texto cifrado para otro uso no descifra aquí. */
export const AAD_CONTRASENA_GMAIL = "gmail:app-password";
/** El dominio de la empresa: sus direcciones no son de los candidatos (igual que el dominio del buzón en Outlook). */
const DOMINIO_EMPRESA = "rdztilegroup.net";

export interface DepsGmail {
  db: SupabaseClient;
  env: Record<string, string | undefined>;
  ahora: Date;
}

export interface ResumenGmail {
  ok: boolean;
  /** Motivo corto si no se pudo revisar (para la tarjeta y el log). */
  motivo?: string;
  revisados: number;
  creados: number;
  duplicados: number;
  notas: number;
  omitidos: number;
  fallidos: number;
  /** Solo en «Importar anteriores»: cuántos correos de Indeed hay en la bandeja en total. */
  total: number | null;
  /** Solo en «Importar anteriores»: dónde sigue; null = terminó. */
  siguiente: { fase: FaseBackfill; saltar: number } | null;
}

const vacio = (motivo?: string): ResumenGmail => ({
  ok: false,
  motivo,
  revisados: 0,
  creados: 0,
  duplicados: 0,
  notas: 0,
  omitidos: 0,
  fallidos: 0,
  total: null,
  siguiente: null,
});

function contaFila(res: ResumenGmail, fila: ResultadoFila | "ya-reclamado"): void {
  if (fila === "ya-reclamado") res.revisados--;
  else if (fila === "created") res.creados++;
  else if (fila === "duplicate") res.duplicados++;
  else if (fila === "noted") res.notas++;
  else if (fila === "skipped") res.omitidos++;
  else res.fallidos++;
}

/** Lo que el pipeline de Indeed necesita para clasificar (mismo criterio que en Outlook). */
function aCorreo(m: MensajeIndeed): CorreoDeIndeed {
  return { subject: m.subject, from: m.from, replyTo: m.replyTo, cuerpo: m.bodyText, recibido: m.receivedDateTime };
}

/** El código seguro de un error de `abreInbox` («gmail:credenciales» o «gmail:conexion»). */
function codigoDe(e: unknown): "credenciales" | "conexion" {
  return e instanceof Error && e.message === "gmail:credenciales" ? "credenciales" : codigoDeErrorGmail(e);
}

type Modo = { tipo: "revision" } | { tipo: "anteriores"; fase: FaseBackfill; saltar: number };

/** Lo que hace una corrida (revisión o un lote de «Importar anteriores»). */
async function corrida(deps: DepsGmail, modo: Modo): Promise<ResumenGmail> {
  const { db, env, ahora } = deps;
  const rec = db.schema("recruiting");

  const clave = claveDesdeTexto(env.OUTLOOK_TOKEN_KEY);
  if (!clave) return vacio("falta la variable OUTLOOK_TOKEN_KEY");

  const { data: conn, error: eConn } = await rec.from("gmail_connection").select("*").eq("id", 1).maybeSingle();
  if (eConn) return vacio("no se pudo leer la conexión");
  if (!conn?.app_password_enc) return vacio("no conectado");

  const registrarError = async (texto: string | null) => {
    await rec.from("gmail_connection").update({ last_run_at: ahora.toISOString(), last_error: texto }).eq("id", 1);
  };

  let contrasena: string;
  try {
    contrasena = descifrar(conn.app_password_enc as string, clave, AAD_CONTRASENA_GMAIL);
  } catch {
    await registrarError("No se pudo leer la contraseña guardada: vuelve a conectar Gmail.");
    return vacio("contraseña ilegible");
  }

  let sesion: SesionGmail;
  try {
    sesion = await abreInbox(conn.gmail_address as string, contrasena);
  } catch (e) {
    const cod = codigoDe(e);
    await registrarError(
      cod === "credenciales"
        ? "Gmail no aceptó la contraseña de aplicación: créala de nuevo y vuelve a conectar."
        : "No se pudo entrar a Gmail. Se reintenta en la siguiente revisión.",
    );
    return vacio(cod === "credenciales" ? "Gmail no aceptó la contraseña" : "no se pudo conectar con Gmail");
  }

  const res = vacio();
  res.ok = true;
  res.motivo = undefined;
  try {
    const cur = cursorInicial({ uidvalidity: conn.uidvalidity as number | null, ultimoUid: Number(conn.last_uid ?? 0) }, sesion.uidvalidity);
    if (cur.reinicio) console.log("[gmail-indeed] el UIDVALIDITY de la bandeja cambió: el cursor empieza de cero (la dedupe evita duplicados)");

    const todos = await uidsDeIndeed(sesion.client);
    let lista: number[];
    if (modo.tipo === "revision") {
      lista = uidsPendientes(todos, cur.ultimoUid, MAX_CORREOS_GMAIL_POR_CORRIDA);
    } else {
      res.total = todos.length;
      lista = todos.slice(modo.saltar, modo.saltar + MAX_CORREOS_GMAIL_POR_CORRIDA);
    }

    const limite = Date.now() + PRESUPUESTO_MS;
    const procesados: number[] = [];
    let fallo: string | null = null;
    for (const uid of lista) {
      // Se corta limpio: lo que no se procesó queda para la siguiente corrida (el cursor solo cubre lo procesado).
      if (Date.now() > limite) break;

      let descarga: Awaited<ReturnType<typeof descargaCorreo>>;
      try {
        descarga = await descargaCorreo(sesion.client, uid);
      } catch {
        fallo = "No se pudo leer un correo de Gmail. Se reintenta en la siguiente revisión.";
        break;
      }
      if (!descarga) {
        procesados.push(uid);
        continue;
      }

      let items;
      try {
        items = await correosDeIndeedEnMensaje(descarga.fuente, { uidvalidity: cur.uidvalidity, uid, fechaRespaldo: descarga.fecha });
      } catch (e) {
        res.omitidos++;
        console.log(`[gmail-indeed] correo ${uid} omitido: no se pudo leer (${e instanceof Error ? e.name : "error"})`);
        procesados.push(uid);
        continue;
      }

      for (const it of items) {
        if (!it.ok) {
          res.omitidos++;
          console.log(`[gmail-indeed] correo ${uid} omitido: ${it.motivo}`);
          continue;
        }
        if (modo.tipo === "anteriores" && !enFase(clasificaCorreoIndeed(aCorreo(it.mensaje)), modo.fase)) continue;
        res.revisados++;
        const fila = await procesaSeguro(db, it.mensaje, { dominioBuzon: DOMINIO_EMPRESA, ahora });
        contaFila(res, fila);
      }
      procesados.push(uid);
    }

    if (fallo) {
      res.ok = false;
      res.motivo = fallo;
    }

    const errorTexto = fallo ?? (res.fallidos ? `${res.fallidos} correo(s) no se pudieron procesar: revisa la lista.` : null);
    const actualizar: Record<string, unknown> = {
      last_run_at: ahora.toISOString(),
      last_error: errorTexto,
      uidvalidity: sesion.uidvalidity,
      total_revisados: Number(conn.total_revisados ?? 0) + res.revisados,
      total_creados: Number(conn.total_creados ?? 0) + res.creados,
      total_notas: Number(conn.total_notas ?? 0) + res.notas,
      total_omitidos: Number(conn.total_omitidos ?? 0) + res.omitidos,
      total_fallidos: Number(conn.total_fallidos ?? 0) + res.fallidos,
    };
    if (modo.tipo === "revision") actualizar.last_uid = nuevoUidCursor(cur.ultimoUid, procesados);
    const { error: eUp } = await rec.from("gmail_connection").update(actualizar).eq("id", 1);
    if (eUp) console.error("[gmail-indeed] no se pudo guardar el estado de la revisión");

    if (modo.tipo === "anteriores" && !fallo) {
      if (procesados.length < lista.length) res.siguiente = { fase: modo.fase, saltar: modo.saltar + procesados.length };
      else if (lista.length === MAX_CORREOS_GMAIL_POR_CORRIDA) res.siguiente = { fase: modo.fase, saltar: modo.saltar + lista.length };
      else if (modo.fase === "solicitud") res.siguiente = { fase: "mensaje", saltar: 0 };
    }
    console.log(
      `[gmail-indeed] ok=${res.ok} revisados=${res.revisados} creados=${res.creados} duplicados=${res.duplicados} ` +
        `notas=${res.notas} omitidos=${res.omitidos} fallidos=${res.fallidos}`,
    );
    return res;
  } catch (e) {
    console.error(`[gmail-indeed] la revisión falló (${e instanceof Error ? e.name : "error"})`);
    await registrarError("La revisión de Gmail falló. Se reintenta en la siguiente revisión.").catch(() => undefined);
    return { ...vacio("la revisión falló"), ok: false };
  } finally {
    await sesion.client.logout().catch(() => undefined);
  }
}

/** La revisión normal: el cron y «Revisar ahora». Desde el cursor, como mucho 50 correos. */
export function revisarGmail(deps: DepsGmail): Promise<ResumenGmail> {
  return corrida(deps, { tipo: "revision" });
}

/** Un lote de «Importar anteriores»: la lista completa de correos de Indeed, desde `saltar`, en la fase dada. */
export function importarLoteGmail(deps: DepsGmail, p: { fase: FaseBackfill; saltar: number }): Promise<ResumenGmail> {
  return corrida(deps, { tipo: "anteriores", fase: p.fase, saltar: p.saltar });
}

/**
 * «Guardar y probar»: entra con la contraseña nueva, cuenta los correos de Indeed que se ven y, si entra, guarda la
 * conexión (contraseña cifrada). El cursor empieza en lo último que hay ahora: lo anterior va por «Importar anteriores».
 */
export async function conectarGmail(
  deps: DepsGmail,
  p: { email: string; password: string; userId: string },
): Promise<{ ok: true; visibles: number } | { ok: false; motivo: string }> {
  const clave = claveDesdeTexto(deps.env.OUTLOOK_TOKEN_KEY);
  if (!clave) return { ok: false, motivo: "Falta la variable OUTLOOK_TOKEN_KEY en el servidor (solo el nombre, no el valor)." };
  const password = p.password.replace(/\s+/g, "");

  let sesion: SesionGmail;
  try {
    sesion = await abreInbox(p.email, password);
  } catch (e) {
    return {
      ok: false,
      motivo:
        codigoDe(e) === "credenciales"
          ? "Gmail no aceptó ese correo o esa contraseña de aplicación. Revísalos (la contraseña de aplicación es de 16 letras, no la normal)."
          : "No se pudo entrar a Gmail. Inténtalo de nuevo en un momento.",
    };
  }
  try {
    const todos = await uidsDeIndeed(sesion.client);
    const { error } = await deps.db
      .schema("recruiting")
      .from("gmail_connection")
      .upsert(
        {
          id: 1,
          gmail_address: p.email.trim().toLowerCase(),
          app_password_enc: cifrar(password, clave, AAD_CONTRASENA_GMAIL),
          connected_by: p.userId,
          connected_at: deps.ahora.toISOString(),
          last_run_at: null,
          last_error: null,
          uidvalidity: sesion.uidvalidity,
          last_uid: Math.max(0, sesion.uidNext - 1),
          total_revisados: 0,
          total_creados: 0,
          total_notas: 0,
          total_omitidos: 0,
          total_fallidos: 0,
        },
        { onConflict: "id" },
      );
    if (error) return { ok: false, motivo: "Gmail entró, pero no se pudo guardar la conexión." };
    return { ok: true, visibles: todos.length };
  } finally {
    await sesion.client.logout().catch(() => undefined);
  }
}

export async function desconectarGmail(db: SupabaseClient): Promise<boolean> {
  const { error } = await db.schema("recruiting").from("gmail_connection").delete().eq("id", 1);
  return !error;
}

/** Lo que muestra la tarjeta: sin contraseña (ni cifrada), con el correo, fechas, contadores y los últimos 20 correos. */
export async function estadoGmail(db: SupabaseClient, env: Record<string, string | undefined>, ahora: Date) {
  const rec = db.schema("recruiting");
  const configurada = claveDesdeTexto(env.OUTLOOK_TOKEN_KEY) !== null;
  const { data: conn } = await rec
    .from("gmail_connection")
    .select("gmail_address, app_password_enc, connected_at, last_run_at, last_error, total_revisados, total_creados, total_notas, total_omitidos, total_fallidos")
    .eq("id", 1)
    .maybeSingle();
  const hace7 = new Date(ahora.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const [{ count: creados7 }, { data: ultimos }] = await Promise.all([
    rec.from("outlook_processed").select("message_id", { count: "exact", head: true }).like("message_id", "gmail:%").eq("result", "created").gte("processed_at", hace7),
    rec
      .from("outlook_processed")
      .select("message_id, received_at, subject, from_address, result, error, candidate_id, scheduled_at, detail, processed_at")
      .like("message_id", "gmail:%")
      .order("processed_at", { ascending: false })
      .limit(20),
  ]);
  const filas = (ultimos ?? []) as Array<Record<string, unknown>>;
  const ids = [...new Set(filas.map((f) => f.candidate_id as string | null).filter((x): x is string => !!x))];
  const nombres = new Map<string, string>();
  if (ids.length) {
    const { data: cs } = await rec.from("candidates").select("id, name").in("id", ids);
    for (const c of (cs ?? []) as Array<{ id: string; name: string }>) nombres.set(c.id, c.name);
  }
  return {
    configurada,
    conectada: Boolean(conn?.app_password_enc),
    correo: (conn?.gmail_address as string | null) ?? null,
    conectadaEl: (conn?.connected_at as string | null) ?? null,
    ultimaRevision: (conn?.last_run_at as string | null) ?? null,
    ultimoError: (conn?.last_error as string | null) ?? null,
    totales: {
      revisados: Number(conn?.total_revisados ?? 0),
      creados: Number(conn?.total_creados ?? 0),
      notas: Number(conn?.total_notas ?? 0),
      omitidos: Number(conn?.total_omitidos ?? 0),
      fallidos: Number(conn?.total_fallidos ?? 0),
    },
    creadosUltimos7Dias: creados7 ?? 0,
    ultimos: filas.map((f) => ({ ...f, candidato: f.candidate_id ? (nombres.get(f.candidate_id as string) ?? null) : null })),
  };
}
