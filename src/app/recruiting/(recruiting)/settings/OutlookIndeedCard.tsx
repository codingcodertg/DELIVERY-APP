"use client";

import { useEffect, useState } from "react";
import { usePrefs } from "@/lib/prefs";
import { MODO_DEMO } from "@/lib/recruiting/modo-demo";
import { diaEnBrownsville, formatoEnBrownsville } from "@/lib/recruiting/hora-de-brownsville";
import { TablaEstandar } from "@/components/TablaEstandar";
import { MENSAJES_OUTLOOK, type ClaveErrorOutlook } from "@/lib/outlook/mensajes";

/** Lo que devuelve GET /api/outlook/estado (sin tokens). */
interface Estado {
  configurada: boolean;
  faltan: string[];
  conectada: boolean;
  buzon: string | null;
  conectadaEl: string | null;
  ultimaRevision: string | null;
  ultimoError: string | null;
  creadosUltimos7Dias: number;
  ultimos: Fila[];
}

interface Fila {
  message_id: string;
  received_at: string | null;
  subject: string | null;
  from_address: string | null;
  result: string;
  error: string | null;
  processed_at: string;
  candidato: string | null;
  scheduled_at: string | null;
  detail: string | null;
}

interface ResumenLote extends Resumen {
  fase: "solicitud" | "mensaje";
  saltar: number;
  total: number | null;
  siguiente: { fase: "solicitud" | "mensaje"; saltar: number } | null;
}

interface Resumen {
  ok: boolean;
  motivo?: string;
  revisados: number;
  creados: number;
  duplicados: number;
  notas: number;
  omitidos: number;
  fallidos: number;
}

const SIN_CONECTAR: Estado = {
  configurada: false,
  faltan: [],
  conectada: false,
  buzon: null,
  conectadaEl: null,
  ultimaRevision: null,
  ultimoError: null,
  creadosUltimos7Dias: 0,
  ultimos: [],
};

const ETIQUETA_RESULTADO: Record<string, { en: string; es: string }> = {
  created: { en: "Created", es: "Creado" },
  duplicate: { en: "Already existed", es: "Ya existía" },
  noted: { en: "Note added", es: "Mensaje anotado" },
  skipped: { en: "Skipped", es: "Omitido" },
  failed: { en: "Failed", es: "Error" },
};

/** Las horas de RR. HH. van siempre en hora de Brownsville (D-632), nunca en la zona del aparato. */
function cuando(iso: string | null): string {
  return iso ? formatoEnBrownsville(iso, "es-MX", { dateStyle: "short", timeStyle: "short" }) : "—";
}

export default function OutlookIndeedCard() {
  const { t } = usePrefs();
  const [estado, setEstado] = useState<Estado>(SIN_CONECTAR);
  const [cargando, setCargando] = useState(!MODO_DEMO);
  const [aviso, setAviso] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);
  // Procesar correos anteriores: la fecha se pone al montar (evita diferencias entre servidor y navegador).
  const [desde, setDesde] = useState("");
  const [corriendo, setCorriendo] = useState(false);
  const [progreso, setProgreso] = useState<string | null>(null);

  const recargar = async () => {
    try {
      const res = await fetch("/api/outlook/estado", { cache: "no-store" });
      if (!res.ok) throw new Error(String(res.status));
      setEstado((await res.json()) as Estado);
    } catch {
      setAviso(t("Could not load the Outlook status.", "No se pudo cargar el estado de Outlook."));
    } finally {
      setCargando(false);
    }
  };

  useEffect(() => {
    if (MODO_DEMO) return;
    // Vuelta de la conexión: ?outlook=ok o ?outlook_error=<clave>. Se lee una vez y se quita de la barra.
    const params = new URLSearchParams(window.location.search);
    const ok = params.get("outlook") === "ok";
    const err = params.get("outlook_error") as ClaveErrorOutlook | null;
    if (ok) setAviso(t("Outlook connected.", "Outlook conectado."));
    if (err) setAviso(MENSAJES_OUTLOOK[err] ?? MENSAJES_OUTLOOK.microsoft);
    if (ok || err) {
      params.delete("outlook");
      params.delete("outlook_error");
      const resto = params.toString();
      window.history.replaceState(null, "", window.location.pathname + (resto ? `?${resto}` : ""));
    }
    setDesde(diaEnBrownsville(Date.now() - 30 * 86_400_000));
    void recargar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const revisarAhora = async () => {
    setOcupado(true);
    setAviso(null);
    try {
      const res = await fetch("/api/outlook/revisar", { method: "POST" });
      const r = (await res.json()) as Resumen & { error?: string };
      if (!res.ok) setAviso(r.error ?? t("The check failed.", "La revisión falló."));
      else if (r.motivo && !r.ok) setAviso(t("The check could not run: ", "No se pudo revisar: ") + r.motivo);
      else
        setAviso(
          t(
            `Checked. New applications: ${r.creados}, existing: ${r.duplicados}, messages added: ${r.notas}, skipped: ${r.omitidos}, failed: ${r.fallidos}.`,
            `Revisado. Solicitudes nuevas: ${r.creados}, ya existían: ${r.duplicados}, mensajes anotados: ${r.notas}, omitidos: ${r.omitidos}, con error: ${r.fallidos}.`,
          ),
        );
      await recargar();
    } catch {
      setAviso(t("The check failed.", "La revisión falló."));
    } finally {
      setOcupado(false);
    }
  };

  /** Procesa los correos desde la fecha, en lotes de 50 (una llamada por lote) hasta terminar. Repetir no duplica nada. */
  const procesarAnteriores = async () => {
    if (!desde) return;
    setCorriendo(true);
    setAviso(null);
    let fase: "solicitud" | "mensaje" = "solicitud";
    let saltar = 0;
    let total: number | null = null;
    let creados = 0;
    let notas = 0;
    let omitidos = 0;
    let fallidos = 0;
    try {
      for (let vuelta = 0; vuelta < 5000; vuelta++) {
        const res = await fetch("/api/outlook/backfill", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ desde, fase, saltar }),
        });
        const r = (await res.json()) as ResumenLote & { error?: string };
        if (!res.ok) {
          setAviso(r.error ?? t("The run failed.", "El procesamiento falló."));
          break;
        }
        if (!r.ok) {
          setAviso(t("The run could not start: ", "No se pudo empezar: ") + (r.motivo ?? "?"));
          break;
        }
        if (r.total !== null) total = r.total;
        creados += r.creados;
        notas += r.notas;
        omitidos += r.omitidos;
        fallidos += r.fallidos;
        const etiquetaFase = fase === "solicitud" ? t("applications", "solicitudes") : t("messages", "mensajes");
        setProgreso(
          t(`Processing ${etiquetaFase}: ${r.siguiente ? Math.min(r.siguiente.saltar, total ?? r.siguiente.saltar) : (total ?? 0)} of ${total ?? "?"} emails checked`,
            `Procesando ${etiquetaFase}: ${r.siguiente ? Math.min(r.siguiente.saltar, total ?? r.siguiente.saltar) : (total ?? 0)} de ${total ?? "?"} correos revisados`),
        );
        if (!r.siguiente) {
          setAviso(
            t(`Done. Created: ${creados}, notes added: ${notas}, skipped: ${omitidos}, failed: ${fallidos}.`,
              `Listo. Creados: ${creados}, mensajes anotados: ${notas}, omitidos: ${omitidos}, con error: ${fallidos}.`),
          );
          break;
        }
        fase = r.siguiente.fase;
        saltar = r.siguiente.saltar;
      }
    } catch {
      setAviso(t("The run failed.", "El procesamiento falló."));
    } finally {
      setCorriendo(false);
      setProgreso(null);
      await recargar();
    }
  };

  const desconectar = async () => {
    if (!window.confirm(t("Disconnect the Outlook mailbox? The stored token is deleted.", "¿Desconectar el buzón de Outlook? Se borra el token guardado."))) return;
    setOcupado(true);
    try {
      const res = await fetch("/api/outlook/desconectar", { method: "POST" });
      if (!res.ok) throw new Error(String(res.status));
      setAviso(t("Disconnected.", "Desconectado."));
      await recargar();
    } catch {
      setAviso(t("Could not disconnect.", "No se pudo desconectar."));
    } finally {
      setOcupado(false);
    }
  };

  // En demo no se llama a nada: se enseña el estado «no conectado» y el botón apagado.
  const e = MODO_DEMO ? SIN_CONECTAR : estado;
  const puedeConectar = !MODO_DEMO && e.configurada;

  return (
    <div className="card" data-testid="outlook-indeed-card">
      <h2>✉️ {t("Indeed by email", "Indeed por correo")}</h2>
      <div className="hint" style={{ marginBottom: 10 }}>
        {t(
          "Applications that arrive by email in the company mailbox become candidates here. Read-only: nothing is marked, moved or deleted in Outlook.",
          "Las solicitudes que llegan por correo al buzón de la empresa se vuelven candidatos aquí. Solo lectura: no se marca, mueve ni borra nada en Outlook.",
        )}
      </div>

      {MODO_DEMO && (
        <div className="hint" style={{ marginBottom: 10 }}>
          {t("Demo: this card does not connect to Microsoft.", "Demo: esta tarjeta no se conecta a Microsoft.")}
        </div>
      )}

      {!MODO_DEMO && !cargando && !e.configurada && (
        <div className="hint" style={{ color: "var(--red)", marginBottom: 10 }}>
          {t("Missing environment variables (names only): ", "Faltan variables de entorno (solo los nombres): ")}
          <code>{e.faltan.join(", ")}</code>
          {t(". The connect button stays off until they are set.", ". El botón de conectar queda apagado hasta que estén.")}
        </div>
      )}

      {aviso && (
        <div role="status" className="hint" style={{ marginBottom: 10, color: "var(--ink)" }}>
          {aviso}
        </div>
      )}

      <div className="grid g2" style={{ marginBottom: 10 }}>
        <div>
          <div><strong>{t("Status", "Estado")}:</strong> {e.conectada ? t("Connected", "Conectado") : t("Not connected", "No conectado")}</div>
          {e.conectada && <div><strong>{t("Connected as", "Conectado como")}:</strong> {e.buzon}</div>}
          {e.conectada && <div className="hint">{t("Connected", "Conectado el")} {cuando(e.conectadaEl)}</div>}
        </div>
        <div>
          <div><strong>{t("Last check", "Última revisión")}:</strong> {cuando(e.ultimaRevision)}</div>
          <div><strong>{t("Last error", "Último error")}:</strong> {e.ultimoError ?? "—"}</div>
          <div><strong>{t("Candidates created, last 7 days", "Candidatos creados, últimos 7 días")}:</strong> {e.creadosUltimos7Dias}</div>
        </div>
      </div>

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        {puedeConectar ? (
          <a className="btn btn-primary" href="/api/outlook/connect">
            {e.conectada ? t("Reconnect Outlook", "Reconectar Outlook") : t("Connect Outlook", "Conectar Outlook")}
          </a>
        ) : (
          <button className="btn btn-primary" disabled>
            {t("Connect Outlook", "Conectar Outlook")}
          </button>
        )}
        <button className="btn" onClick={revisarAhora} disabled={ocupado || !e.conectada || MODO_DEMO}>
          {t("Check now", "Revisar ahora")}
        </button>
        <button className="btn" onClick={desconectar} disabled={ocupado || !e.conectada || MODO_DEMO}>
          {t("Disconnect", "Desconectar")}
        </button>
      </div>

      {(
        <div style={{ marginTop: 14, paddingTop: 12, borderTop: "1px solid var(--line)" }}>
          <div><strong>{t("Past emails", "Correos anteriores")}</strong></div>
          <div className="hint" style={{ marginBottom: 8 }}>
            {t(
              "Processes Indeed emails already in the inbox since this date, oldest first, with the same checks. Applications first, then messages. Running it again creates nothing twice.",
              "Procesa los correos de Indeed que ya están en la bandeja desde esta fecha, del más viejo al más nuevo, con las mismas reglas. Primero solicitudes y luego mensajes. Volver a correrlo no duplica nada.",
            )}
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
            <label style={{ margin: 0 }}>{t("Since", "Desde")}</label>
            <input
              type="date"
              value={desde}
              onChange={(ev) => setDesde(ev.target.value)}
              disabled={corriendo}
            />
            <button className="btn btn-primary" onClick={procesarAnteriores} disabled={corriendo || !e.conectada || !desde || MODO_DEMO}>
              {corriendo ? t("Processing…", "Procesando…") : t("Process past emails", "Procesar correos anteriores")}
            </button>
          </div>
          {progreso && <div role="status" className="hint" style={{ marginTop: 6, color: "var(--ink)" }}>{progreso}</div>}
        </div>
      )}

      {e.ultimos.length > 0 && (
        <div style={{ marginTop: 14 }}>
          <div className="hint" style={{ marginBottom: 6 }}>{t("Last 20 emails", "Últimos 20 correos")}</div>
          <TablaEstandar<Fila>
            id="rrhh-indeed-correo-ultimos"
            filas={e.ultimos}
            claveDe={(f) => f.message_id}
            vacio={t("No emails yet.", "Todavía no hay correos.")}
            columnas={[
              { key: "cuando", en: "When", es: "Cuándo", ancho: 150, valor: (f) => f.processed_at, celda: (f) => cuando(f.processed_at) },
              { key: "asunto", en: "Subject", es: "Asunto", ancho: 300, valor: (f) => f.subject ?? "" },
              {
                key: "resultado",
                en: "Result",
                es: "Resultado",
                ancho: 150,
                valor: (f) => f.result,
                celda: (f) => t(ETIQUETA_RESULTADO[f.result]?.en ?? f.result, ETIQUETA_RESULTADO[f.result]?.es ?? f.result),
              },
              { key: "candidato", en: "Candidate", es: "Candidato", ancho: 170, valor: (f) => f.candidato ?? "" },
              {
                key: "agenda",
                en: "Detected and scheduled",
                es: "Detectado y agendado",
                ancho: 340,
                envuelve: true,
                valor: (f) => f.detail ?? "",
                celda: (f) => (f.detail ? f.detail : "—"),
              },
              { key: "error", en: "Error / note", es: "Error / nota", ancho: 260, envuelve: true, valor: (f) => f.error ?? "" },
            ]}
          />
        </div>
      )}
    </div>
  );
}
