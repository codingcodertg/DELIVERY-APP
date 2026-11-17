import "server-only";
import { clienteDeServicio, ipSegura, type ClienteSec } from "@/lib/seguridad/registro";
import {
  decideBloqueoIp, detectaLecturaTruncada, ejecutaDetectores, sinDuplicar, UMBRALES,
  type CambioDeRol, type EventoLeido, type Hallazgo, type LecturaRevisada,
} from "@/lib/seguridad/detectores";
import {
  cuotaDeLaHora, decideAviso, marcaPorIp, necesitaResumen, origenDe, ordenaPorGravedad,
  TOPE_IDENTIFICADORES_POR_IP_HORA, TOPE_SMS_POR_CORRIDA, type CuotaHora, type DecisionAviso,
} from "@/lib/seguridad/topes";
import { emailConfigured } from "@/lib/email";
import { proveedorReal } from "@/lib/mensajeria";
import { ringcentralConfigured, ringcentralSms } from "@/lib/ringcentral";
import { telefonoUSaE164 } from "@/lib/telefono-correo";

// ============================================================
// Una corrida del monitoreo (lo llama `GET /api/cron/seguridad` cada 5 min): lee el rastro, pasa los detectores, quita lo
// que ya tiene alerta abierta de la última hora, GUARDA cada alerta nueva y decide los avisos con sus topes (por gravedad).
// Bloquea una IP solo con señales verificadas por el servidor (límite de peticiones), sin tocar admins ni redes compartidas.
//
// Falla cerrado para el LECTOR (si no puede leer el rastro, lanza y la ruta contesta 502) y abierto para la APP (nada de
// esto corre en una petición de persona). Nunca bloquea una cuenta: solo IPs.
// ============================================================

const MIN = 60_000;
const LIMITE_FILAS = 20_000;
const LIMITE_CAMBIOS = 5_000;
/** Categorías de la lectura compartida. Los cambios de privilegio tienen su propia lectura (ver abajo). */
const CATEGORIAS_LEIDAS = ["auth", "api_denied", "export", "impersonation", "ratelimit", "cron"];
const COLUMNAS = "ts, categoria, severidad, usuario_id, rol, ip, ip_pais, metodo, ruta, estado, objetivo_tipo, objetivo_id, filas, meta";

export interface ResumenMonitor {
  eventos: number;
  truncado: boolean;
  hallazgos: number;
  nuevas: number;
  /** Alertas de fallos de login guardadas como agrupadas por IP (sin aviso). */
  agrupadas: number;
  bloqueos: number;
  /** Mensajes de aviso salidos en esta corrida (correos por alerta + SMS). */
  avisos: number;
  /** Alertas de esta corrida cuyo aviso se omitió por el tope. */
  omitidos: number;
  /** ¿Se mandó el correo-resumen de la hora en esta corrida? */
  resumen: boolean;
}

type FilaAlerta = { detector: string; sujeto: string | null };
type Item = { h: Hallazgo; agrupada: boolean; extra: Record<string, unknown> };

/** Destinatarios de un aviso: `SEGURIDAD_ALERTA_EMAILS` (separados por coma) o, si no hay, los admins activos. */
async function destinatariosDeCorreo(cliente: ClienteSec): Promise<string[]> {
  const puestos = (process.env.SEGURIDAD_ALERTA_EMAILS ?? "").split(",").map((s) => s.trim()).filter((s) => s.includes("@"));
  if (puestos.length) return [...new Set(puestos)];
  const { data: admins } = (await cliente.from("profiles").select("id").eq("role", "admin").is("left_at", null)) as { data: { id: string }[] | null };
  const correos: string[] = [];
  for (const a of admins ?? []) {
    const { data } = await cliente.auth.admin.getUserById(a.id);
    const correo = data?.user?.email;
    if (correo) correos.push(correo);
  }
  return [...new Set(correos)];
}

/** Teléfonos de `SEGURIDAD_ALERTA_TELEFONOS`, normalizados. Solo si RingCentral está configurado. */
function telefonosDeAlerta(): string[] {
  if (!(ringcentralConfigured() && process.env.RINGCENTRAL_FROM)) return [];
  return (process.env.SEGURIDAD_ALERTA_TELEFONOS ?? "").split(",").map((s) => telefonoUSaE164(s.trim())).filter((s): s is string => !!s);
}

/**
 * ¿Algún admin USÓ esta IP en las últimas 24 h? Mira los dispositivos de admin (su última IP) y las sesiones de admin
 * desde esa IP. La ventana de 24 h es a propósito: el rastro de sesiones se escribe como mucho una vez por hora y persona.
 * Cualquier fallo de lectura devuelve null, y el bloqueo no se aplica (fail-open).
 */
async function adminVisto24h(cliente: ClienteSec, ip: string, ahoraMs: number, cargaAdmins: () => Promise<Set<string> | null>): Promise<boolean | null> {
  const admins = await cargaAdmins();
  if (!admins) return null;
  const desde = new Date(ahoraMs - 24 * 60 * MIN).toISOString();
  const { data: dispositivos, error: e1 } = (await cliente
    .from("security_devices").select("last_user_id").eq("last_ip", ip).gte("last_seen_at", desde).limit(200)) as
    { data: { last_user_id: string | null }[] | null; error: { message: string } | null };
  if (e1) return null;
  if ((dispositivos ?? []).some((d) => d.last_user_id && admins.has(d.last_user_id))) return true;
  const { data: sesiones, error: e2 } = (await cliente
    .from("sec_events").select("id").eq("ip", ip).eq("categoria", "auth").eq("metodo", "sesion").eq("rol", "admin").gte("ts", desde).limit(1)) as
    { data: { id: number }[] | null; error: { message: string } | null };
  if (e2) return null;
  return (sesiones ?? []).length > 0;
}

/** Bloquea una IP 30 min. Si ya tiene un bloqueo vigente, no duplica. Devuelve lo que quedó, para `sec_alerts.accion`. */
async function bloqueaIpAuto(cliente: ClienteSec, ip: string, ahoraMs: number, detector: string) {
  const { data: vigentes } = (await cliente
    .from("sec_blocks").select("id, hasta").eq("alcance", "ip").eq("valor", ip)
    .gt("hasta", new Date(ahoraMs).toISOString()).limit(1)) as { data: { id: number; hasta: string }[] | null };
  if (vigentes?.length) return { ok: true as const, yaEstaba: true, id: vigentes[0].id, hasta: vigentes[0].hasta };
  const hasta = new Date(ahoraMs + UMBRALES.bloqueoIpMin * MIN).toISOString();
  const { data, error } = (await cliente
    .from("sec_blocks")
    .insert({ alcance: "ip", valor: ip, motivo: `Automático (${detector})`, hasta, origen: "auto" })
    .select("id").single()) as { data: { id: number } | null; error: { message: string } | null };
  if (error || !data) return { ok: false as const, error: error?.message ?? "sin fila" };
  return { ok: true as const, yaEstaba: false, id: data.id, hasta };
}

/** Corre el monitoreo una vez. Lanza solo si no puede leer el rastro; lo demás se registra y sigue. */
export async function corrigeMonitor(ahoraMs = Date.now(), cliente: ClienteSec = clienteDeServicio()): Promise<ResumenMonitor> {
  const iso = (ms: number) => new Date(ms).toISOString();
  const lecturas: LecturaRevisada[] = [];

  // 1. Lectura compartida de la última hora (sin cambios de privilegio).
  const { data: compartidos, error: e1 } = (await cliente
    .from("sec_events").select(COLUMNAS)
    .in("categoria", CATEGORIAS_LEIDAS)
    .gte("ts", iso(ahoraMs - 60 * MIN))
    .order("ts", { ascending: false })
    .limit(LIMITE_FILAS)) as { data: EventoLeido[] | null; error: { message: string } | null };
  if (e1) throw new Error(`sec_events: ${e1.message}`);
  const compartidas = compartidos ?? [];
  lecturas.push({ nombre: "eventos", filas: compartidas.length, limite: LIMITE_FILAS });

  // 2. Cambios de privilegio: su PROPIA lectura, con su propio tope. Solo los escribe el trigger de la base (ver 320).
  const { data: privilegios, error: e2 } = (await cliente
    .from("sec_events").select(COLUMNAS)
    .eq("categoria", "admin")
    .gte("ts", iso(ahoraMs - 60 * MIN))
    .order("ts", { ascending: false })
    .limit(LIMITE_CAMBIOS)) as { data: EventoLeido[] | null; error: { message: string } | null };
  if (e2) throw new Error(`sec_events (privilegios): ${e2.message}`);
  const cambios = privilegios ?? [];
  lecturas.push({ nombre: "cambios-de-privilegio", filas: cambios.length, limite: LIMITE_CAMBIOS });
  const truncado = compartidas.length >= LIMITE_FILAS || cambios.length >= LIMITE_CAMBIOS;

  const cambiosDeRol: CambioDeRol[] = cambios
    .filter((e) => e.meta?.campo === "role" && typeof e.meta?.despues === "string")
    .map((e) => ({
      ts: e.ts,
      actor_id: e.usuario_id,
      target_id: e.objetivo_id,
      detail: `${String(e.meta?.antes ?? "—")} → ${String(e.meta?.despues)}`,
    }));

  // 3. Historial de países de las personas que entraron en los últimos 10 min (30 días, sin contar esos 10 min).
  const enSesion = [...new Set(compartidas.filter((e) => e.categoria === "auth" && e.metodo === "sesion" && e.usuario_id && e.ip_pais).map((e) => e.usuario_id as string))];
  const historialPais = new Map<string, Set<string>>();
  if (enSesion.length) {
    const { data: previos, error: e3 } = (await cliente
      .from("sec_events")
      .select("usuario_id, ip_pais")
      .eq("categoria", "auth").eq("metodo", "sesion")
      .in("usuario_id", enSesion)
      .gte("ts", iso(ahoraMs - UMBRALES.diasHistorialPais * 24 * 60 * MIN))
      .lt("ts", iso(ahoraMs - 10 * MIN))
      .not("ip_pais", "is", null)
      .limit(LIMITE_FILAS)) as { data: { usuario_id: string; ip_pais: string }[] | null; error: { message: string } | null };
    if (e3) throw new Error(`historial de países: ${e3.message}`);
    const filas = previos ?? [];
    lecturas.push({ nombre: "historial-paises", filas: filas.length, limite: LIMITE_FILAS });
    for (const p of filas) {
      const s = historialPais.get(p.usuario_id) ?? new Set<string>();
      s.add(p.ip_pais);
      historialPais.set(p.usuario_id, s);
    }
  }

  // 4. Detectar (y avisar si alguna lectura llegó al tope), y quitar lo que ya tiene alerta abierta de la última hora.
  const eventosTodos = [...compartidas, ...cambios];
  const hallazgos = [
    ...ejecutaDetectores({ eventos: eventosTodos, cambiosDeRol, historialPais, ahora: ahoraMs }),
    ...detectaLecturaTruncada(lecturas, ahoraMs),
  ];
  const { data: abiertas, error: e4 } = (await cliente
    .from("sec_alerts").select("detector, sujeto")
    .eq("estado", "abierta").gte("creada_en", iso(ahoraMs - 60 * MIN)).limit(1000)) as { data: FilaAlerta[] | null; error: { message: string } | null };
  if (e4) throw new Error(`sec_alerts: ${e4.message}`);
  const nuevos = sinDuplicar(hallazgos, abiertas ?? []);

  // 5. Fallos de login por IP: se GUARDAN todos; pasado el tope por hora se marcan como agrupados (sin aviso) y se
  //    resumen en una alerta de la IP con sus identificadores.
  const { data: previasIdent, error: e5 } = (await cliente
    .from("sec_alerts").select("ip")
    .eq("detector", "login-fallido-identificador").gte("creada_en", iso(ahoraMs - 60 * MIN)).not("ip", "is", null).limit(1000)) as
    { data: { ip: string }[] | null; error: { message: string } | null };
  if (e5) throw new Error(`sec_alerts (por IP): ${e5.message}`);
  const porIpPrevias = new Map<string, number>();
  for (const f of previasIdent ?? []) porIpPrevias.set(f.ip, (porIpPrevias.get(f.ip) ?? 0) + 1);
  const { marcados, agrupados, hashes } = marcaPorIp(nuevos, porIpPrevias, TOPE_IDENTIFICADORES_POR_IP_HORA);
  const resumenesIp: Hallazgo[] = [...agrupados].map(([ip, n]) => ({
    detector: "login-fallido-ip-agrupado",
    severidad: 3 as const,
    sujeto: `agrupado:${ip}`,
    usuario_id: null,
    ip,
    resumen: `${n} cuentas más contra las que esta IP falló, guardadas agrupadas (tope de ${TOPE_IDENTIFICADORES_POR_IP_HORA} avisos por hora).`,
  }));
  const resumenesNuevos = sinDuplicar(resumenesIp, abiertas ?? []);
  const items: Item[] = [
    ...marcados.map(({ h, agrupada }) => ({ h, agrupada, extra: agrupada ? { agrupada: "ip" } : {} })),
    ...resumenesNuevos.map((h) => ({ h, agrupada: false, extra: { hashes: hashes.get(h.ip ?? "") ?? [] } })),
  ];

  // 6. Por gravedad, de mayor a menor: la cuota le toca primero a lo grave.
  const enOrden = ordenaPorGravedad(items.map((i) => ({ severidad: i.h.severidad, i }))).map((x) => x.i);

  // 7. Cuota de avisos de la última hora, a partir de lo que ya quedó registrado.
  const { data: accionesHora, error: e6 } = (await cliente
    .from("sec_alerts").select("accion").gte("creada_en", iso(ahoraMs - 60 * MIN)).not("accion", "is", null).limit(1000)) as
    { data: { accion: unknown }[] | null; error: { message: string } | null };
  if (e6) throw new Error(`sec_alerts (cuota): ${e6.message}`);
  const cuota: CuotaHora = cuotaDeLaHora((accionesHora ?? []).map((r) => r.accion));

  // 8. Destinatarios y teléfonos, una sola vez por corrida.
  const destinatarios = emailConfigured() ? await destinatariosDeCorreo(cliente) : [];
  const telefonos = telefonosDeAlerta();
  const canCorreo = destinatarios.length > 0;
  let smsRestantesCorrida = TOPE_SMS_POR_CORRIDA;

  // Admins (una carga por corrida) y resultado por IP, para el guardia del bloqueo.
  let admins: Promise<Set<string> | null> | null = null;
  const cargaAdmins = () => (admins ??= (async () => {
    const { data, error } = (await cliente.from("profiles").select("id").eq("role", "admin").is("left_at", null)) as
      { data: { id: string }[] | null; error: { message: string } | null };
    return error ? null : new Set((data ?? []).map((a) => a.id));
  })());
  const guardiaPorIp = new Map<string, boolean | null>();

  // 9. Cada alerta: bloqueo (si procede), avisos (con topes) y la alerta guardada, siempre.
  let bloqueos = 0;
  let avisos = 0;
  let omitidosRun = 0;
  for (const { h, agrupada, extra } of enOrden) {
    const accion: Record<string, unknown> = { ...extra };
    if (!agrupada && h.proponeBloqueoIp && h.ip && ipSegura(h.ip)) {
      if (!guardiaPorIp.has(h.ip)) guardiaPorIp.set(h.ip, await adminVisto24h(cliente, h.ip, ahoraMs, cargaAdmins));
      const guarda = decideBloqueoIp({ ip: h.ip, eventos: eventosTodos, ahora: ahoraMs, adminVisto24h: guardiaPorIp.get(h.ip) ?? null });
      if (guarda.aplica) {
        const r = await bloqueaIpAuto(cliente, h.ip, ahoraMs, h.detector);
        accion.bloqueo = { ip: h.ip, ...r };
        if (r.ok && !r.yaEstaba) {
          bloqueos++;
          await cliente.from("security_events").insert({
            kind: "security_auto_response",
            detail: `Bloqueo automático de la IP ${h.ip} por ${UMBRALES.bloqueoIpMin} min (${h.detector}).`,
          });
        }
      } else {
        accion.bloqueo = { omitido: guarda.motivo };
      }
    }

    const origen = origenDe(h.detector);
    const decision: DecisionAviso = agrupada
      ? { correo: false, sms: 0, omitido: null }
      : decideAviso(h.severidad, cuota, { correo: canCorreo, telefonos: telefonos.length }, smsRestantesCorrida, origen);
    const enviados = { correo: false, origen, sms: 0 };
    if (decision.correo) {
      let algunOk = false;
      for (const para of destinatarios) {
        try {
          const r = await proveedorReal.correo(para, `[RTG Hub · seguridad ${h.severidad}/5] ${h.detector}`,
            `${h.resumen}\n\nDetector: ${h.detector}\nHora: ${iso(ahoraMs)}\n\nRevísalo en Seguridad > Alertas. Qué hacer: docs/SEGURIDAD-RUNBOOK.md.`);
          if (r.ok) algunOk = true;
        } catch {
          /* un correo que falla no detiene a los demás */
        }
      }
      if (algunOk) {
        enviados.correo = true;
        if (origen === "login") cuota.correosLogin += 1;
        else cuota.correos += 1;
      }
    }
    if (decision.sms > 0) {
      smsRestantesCorrida -= decision.sms;
      for (const tel of telefonos.slice(0, decision.sms)) {
        try {
          await ringcentralSms(tel, `RTG Hub seguridad ${h.severidad}/5: ${h.detector}. Revisa Seguridad > Alertas.`);
          enviados.sms += 1;
        } catch {
          /* sin SMS, la alerta sigue en el panel y en el correo */
        }
      }
      cuota.sms += enviados.sms;
    }
    if (enviados.correo || enviados.sms > 0) {
      accion.avisos = enviados;
      avisos += (enviados.correo ? 1 : 0) + enviados.sms;
    }
    if (decision.omitido) {
      accion.omitido = decision.omitido;
      omitidosRun += 1;
    }

    const { error } = await cliente.from("sec_alerts").insert({
      detector: h.detector,
      severidad: h.severidad,
      usuario_id: h.usuario_id,
      ip: ipSegura(h.ip),
      sujeto: h.sujeto,
      resumen: h.resumen,
      accion: Object.keys(accion).length ? accion : null,
    });
    if (error) console.error(`[seguridad] alerta "${h.detector}" no guardada:`, error.message);
  }

  // 10. Correo-resumen, una vez por hora, cuando hubo avisos omitidos por el tope. Queda como alerta de la hora, sin avisos.
  let resumenEnviado = false;
  if (necesitaResumen(cuota, omitidosRun) && canCorreo) {
    const total = cuota.omitidos + omitidosRun;
    let algunOk = false;
    for (const para of destinatarios) {
      try {
        const r = await proveedorReal.correo(para, "[RTG Hub · seguridad] Más alertas de las que se avisan",
          `${total} alertas más en la última hora. Los correos se mandaron solo hasta el tope (${cuota.correos} de alertas del servidor y ${cuota.correosLogin} de fallos de login).\n\nRevísalas en Seguridad > Alertas.`);
        if (r.ok) algunOk = true;
      } catch {
        /* sigue con el siguiente */
      }
    }
    if (algunOk) {
      resumenEnviado = true;
      await cliente.from("sec_alerts").insert({
        detector: "resumen-horario",
        severidad: 3,
        sujeto: `resumen:${iso(ahoraMs).slice(0, 13)}`,
        resumen: `${total} alertas más en la última hora: los avisos se mandaron solo hasta el tope. Revisa el panel.`,
        accion: { resumen_horario: true, omitidas: total },
      });
    }
  }

  return {
    eventos: eventosTodos.length,
    truncado,
    hallazgos: hallazgos.length,
    nuevas: items.length,
    agrupadas: [...agrupados.values()].reduce((a, b) => a + b, 0),
    bloqueos,
    avisos,
    omitidos: omitidosRun,
    resumen: resumenEnviado,
  };
}
