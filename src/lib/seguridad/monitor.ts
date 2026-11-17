import "server-only";
import { clienteDeServicio, ipSegura, type ClienteSec } from "@/lib/seguridad/registro";
import {
  decideBloqueoIp, ejecutaDetectores, sinDuplicar, UMBRALES,
  type CambioDeRol, type EventoLeido, type Hallazgo,
} from "@/lib/seguridad/detectores";
import { emailConfigured } from "@/lib/email";
import { proveedorReal } from "@/lib/mensajeria";
import { ringcentralConfigured, ringcentralSms } from "@/lib/ringcentral";
import { telefonoUSaE164 } from "@/lib/telefono-correo";

// ============================================================
// Una corrida del monitoreo (lo llama `GET /api/cron/seguridad` cada 5 min): lee el rastro, pasa los detectores, quita
// lo que ya tiene alerta abierta de la última hora, bloquea la IP cuando la guarda lo permite, guarda la alerta y avisa.
//
// Falla cerrado para el LECTOR (si no puede leer `sec_events`, lanza y la ruta contesta 502) y abierto para la APP (nada
// de esto corre en una petición de persona). Nunca bloquea una cuenta: solo IPs, y no las de un admin ni las de una red
// compartida (ver `decideBloqueoIp`).
// ============================================================

const MIN = 60_000;
const LIMITE_FILAS = 20_000;
/** Categorías que los detectores leen. `admin` y `device` no hacen falta: los cambios de rol salen de `security_events`. */
const CATEGORIAS_LEIDAS = ["auth", "api_denied", "export", "impersonation", "ratelimit", "cron"];

export interface ResumenMonitor {
  eventos: number;
  truncado: boolean;
  hallazgos: number;
  nuevas: number;
  bloqueos: number;
  avisos: number;
}

type FilaAlerta = { detector: string; sujeto: string | null };

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

/** Avisos de una alerta: correo a severidad ≥4 y SMS (RingCentral) a severidad 5. Sin configurar, no hace nada. */
async function avisa(cliente: ClienteSec, h: Hallazgo): Promise<{ correo: number; sms: number }> {
  const out = { correo: 0, sms: 0 };
  if (h.severidad < 4) return out;
  const asunto = `[RTG Hub · seguridad ${h.severidad}/5] ${h.detector}`;
  const texto =
    `${h.resumen}\n\nDetector: ${h.detector}\nHora: ${new Date().toISOString()}\n\n` +
    "Revísalo en Seguridad > Alertas. Qué hacer: docs/SEGURIDAD-RUNBOOK.md.";
  if (emailConfigured()) {
    for (const para of await destinatariosDeCorreo(cliente)) {
      try {
        const r = await proveedorReal.correo(para, asunto, texto);
        if (r.ok) out.correo++;
      } catch {
        /* un correo que falla no detiene a los demás */
      }
    }
  }
  if (h.severidad >= 5 && ringcentralConfigured() && process.env.RINGCENTRAL_FROM) {
    const telefonos = (process.env.SEGURIDAD_ALERTA_TELEFONOS ?? "").split(",").map((s) => telefonoUSaE164(s.trim())).filter((s): s is string => !!s);
    for (const tel of telefonos) {
      try {
        await ringcentralSms(tel, `RTG Hub seguridad ${h.severidad}/5: ${h.detector}. Revisa Seguridad > Alertas.`);
        out.sms++;
      } catch {
        /* sin SMS, la alerta sigue en el panel y en el correo */
      }
    }
  }
  return out;
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
    .insert({ alcance: "ip", valor: ip, motivo: `Automático: fallos de inicio de sesión (${detector})`, hasta, origen: "auto" })
    .select("id").single()) as { data: { id: number } | null; error: { message: string } | null };
  if (error || !data) return { ok: false as const, error: error?.message ?? "sin fila" };
  return { ok: true as const, yaEstaba: false, id: data.id, hasta };
}

/** Corre el monitoreo una vez. Lanza solo si no puede leer el rastro; lo demás se registra y sigue. */
export async function corrigeMonitor(ahoraMs = Date.now(), cliente: ClienteSec = clienteDeServicio()): Promise<ResumenMonitor> {
  const iso = (ms: number) => new Date(ms).toISOString();

  // 1. El rastro de la última hora (lo más largo que mira algún detector).
  const { data: crudos, error: e1 } = (await cliente
    .from("sec_events")
    .select("ts, categoria, severidad, usuario_id, rol, ip, ip_pais, metodo, ruta, estado, objetivo_tipo, objetivo_id, filas, meta")
    .in("categoria", CATEGORIAS_LEIDAS)
    .gte("ts", iso(ahoraMs - 60 * MIN))
    .order("ts", { ascending: false })
    .limit(LIMITE_FILAS)) as { data: EventoLeido[] | null; error: { message: string } | null };
  if (e1) throw new Error(`sec_events: ${e1.message}`);
  const eventos = crudos ?? [];
  const truncado = eventos.length >= LIMITE_FILAS;

  // 2. Cambios de rol recientes (lo escriben el servidor y el navegador en security_events).
  const { data: roles, error: e2 } = (await cliente
    .from("security_events")
    .select("created_at, actor_id, target_id, detail")
    .eq("kind", "role_changed")
    .gte("created_at", iso(ahoraMs - 10 * MIN))
    .limit(500)) as { data: { created_at: string; actor_id: string | null; target_id: string | null; detail: string | null }[] | null; error: { message: string } | null };
  if (e2) throw new Error(`security_events: ${e2.message}`);
  const cambiosDeRol: CambioDeRol[] = (roles ?? []).map((r) => ({ ts: r.created_at, actor_id: r.actor_id, target_id: r.target_id, detail: r.detail }));

  // 3. Historial de países de las personas que entraron en los últimos 10 min (30 días, sin contar esos 10 min).
  const enSesion = [...new Set(eventos.filter((e) => e.categoria === "auth" && e.metodo === "sesion" && e.usuario_id && e.ip_pais).map((e) => e.usuario_id as string))];
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
    for (const p of previos ?? []) {
      const s = historialPais.get(p.usuario_id) ?? new Set<string>();
      s.add(p.ip_pais);
      historialPais.set(p.usuario_id, s);
    }
  }

  // 4. Detectar, y quitar lo que ya tiene alerta abierta de la última hora.
  const hallazgos = ejecutaDetectores({ eventos, cambiosDeRol, historialPais, ahora: ahoraMs });
  const { data: abiertas, error: e4 } = (await cliente
    .from("sec_alerts").select("detector, sujeto")
    .eq("estado", "abierta").gte("creada_en", iso(ahoraMs - 60 * MIN)).limit(1000)) as { data: FilaAlerta[] | null; error: { message: string } | null };
  if (e4) throw new Error(`sec_alerts: ${e4.message}`);
  const nuevos = sinDuplicar(hallazgos, abiertas ?? []);

  // 5. Por cada hallazgo nuevo: bloqueo (si procede), aviso y alerta.
  let bloqueos = 0;
  let avisos = 0;
  for (const h of nuevos) {
    const accion: Record<string, unknown> = {};
    if (h.proponeBloqueoIp && h.ip && ipSegura(h.ip)) {
      const guarda = decideBloqueoIp({ ip: h.ip, eventos, ahora: ahoraMs });
      if (guarda.aplica) {
        const r = await bloqueaIpAuto(cliente, h.ip, ahoraMs, h.detector);
        accion.bloqueo = { ip: h.ip, ...r };
        if (r.ok && !r.yaEstaba) {
          bloqueos++;
          // El rastro de la acción automática va también a security_events, junto a lo que hacen las personas.
          await cliente.from("security_events").insert({
            kind: "security_auto_response",
            detail: `Bloqueo automático de la IP ${h.ip} por ${UMBRALES.bloqueoIpMin} min (${h.detector}).`,
          });
        }
      } else {
        accion.bloqueo = { omitido: guarda.motivo };
      }
    }
    const enviados = await avisa(cliente, h);
    avisos += enviados.correo + enviados.sms;
    if (enviados.correo || enviados.sms) accion.avisos = enviados;

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

  return {
    eventos: eventos.length,
    truncado,
    hallazgos: hallazgos.length,
    nuevas: nuevos.length,
    bloqueos,
    avisos,
  };
}
