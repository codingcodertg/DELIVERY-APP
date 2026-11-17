"use client";

import { useEffect, useState } from "react";
import { usePrefs } from "@/lib/prefs";
import { MODO_DEMO } from "@/lib/recruiting/modo-demo";
import { formatoEnBrownsville } from "@/lib/recruiting/hora-de-brownsville";
import { TablaEstandar } from "@/components/TablaEstandar";
import { PasswordInput } from "@/components/PasswordInput";

/** Lo que devuelve GET /api/gmail/estado (nunca la contraseña, ni siquiera cifrada). */
interface Estado {
  configurada: boolean;
  conectada: boolean;
  correo: string | null;
  conectadaEl: string | null;
  ultimaRevision: string | null;
  ultimoError: string | null;
  totales: { revisados: number; creados: number; notas: number; omitidos: number; fallidos: number };
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

interface Resumen {
  ok: boolean;
  motivo?: string;
  revisados: number;
  creados: number;
  duplicados: number;
  notas: number;
  omitidos: number;
  fallidos: number;
  total?: number | null;
  siguiente?: { fase: "solicitud" | "mensaje"; saltar: number } | null;
}

const SIN_CONECTAR: Estado = {
  configurada: false,
  conectada: false,
  correo: null,
  conectadaEl: null,
  ultimaRevision: null,
  ultimoError: null,
  totales: { revisados: 0, creados: 0, notas: 0, omitidos: 0, fallidos: 0 },
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

function cuando(iso: string | null): string {
  return iso ? formatoEnBrownsville(iso, "es-MX", { dateStyle: "short", timeStyle: "short" }) : "—";
}

export default function GmailIndeedCard() {
  const { t } = usePrefs();
  const [estado, setEstado] = useState<Estado>(SIN_CONECTAR);
  const [cargando, setCargando] = useState(!MODO_DEMO);
  const [aviso, setAviso] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [correo, setCorreo] = useState("");
  // La contraseña solo vive aquí mientras se escribe; se borra al guardar. Nunca se muestra guardada.
  const [clave, setClave] = useState("");
  const [progreso, setProgreso] = useState<string | null>(null);

  const recargar = async () => {
    try {
      const res = await fetch("/api/gmail/estado", { cache: "no-store" });
      if (!res.ok) throw new Error(String(res.status));
      const e = (await res.json()) as Estado;
      setEstado(e);
      if (e.correo && !correo) setCorreo(e.correo);
    } catch {
      setAviso(t("Could not load the Gmail status.", "No se pudo cargar el estado de Gmail."));
    } finally {
      setCargando(false);
    }
  };

  useEffect(() => {
    if (MODO_DEMO) return;
    void recargar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const guardarYProbar = async () => {
    setOcupado(true);
    setAviso(null);
    try {
      const res = await fetch("/api/gmail/conectar", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: correo, password: clave }),
      });
      const r = (await res.json()) as { ok?: boolean; visibles?: number; error?: string };
      if (!res.ok || !r.ok) {
        setAviso(r.error ?? t("The connection failed.", "No se pudo conectar."));
      } else {
        setClave("");
        setAviso(
          t(
            `Connected. Gmail sees ${r.visibles} Indeed email(s) now. New ones will be imported every 15 minutes.`,
            `Conectado. Gmail ve ${r.visibles} correo(s) de Indeed ahora. Los nuevos se importan cada 15 minutos.`,
          ),
        );
      }
      await recargar();
    } catch {
      setAviso(t("The connection failed.", "No se pudo conectar."));
    } finally {
      setOcupado(false);
    }
  };

  const revisarAhora = async () => {
    setOcupado(true);
    setAviso(null);
    try {
      const res = await fetch("/api/gmail/revisar", { method: "POST" });
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

  /** Importa TODOS los correos de Indeed de la bandeja (sin mirar el cursor), en lotes de 50, primero solicitudes y luego mensajes. */
  const importarAnteriores = async () => {
    setOcupado(true);
    setAviso(null);
    let fase: "solicitud" | "mensaje" = "solicitud";
    let saltar = 0;
    let creados = 0;
    let notas = 0;
    let omitidos = 0;
    let fallidos = 0;
    try {
      for (let vuelta = 0; vuelta < 5000; vuelta++) {
        const res = await fetch("/api/gmail/anteriores", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ fase, saltar }),
        });
        const r = (await res.json()) as Resumen & { error?: string };
        if (!res.ok) {
          setAviso(r.error ?? t("The run failed.", "El procesamiento falló."));
          break;
        }
        if (!r.ok) {
          setAviso(t("The run could not finish: ", "No se pudo terminar: ") + (r.motivo ?? "?"));
          break;
        }
        creados += r.creados;
        notas += r.notas;
        omitidos += r.omitidos;
        fallidos += r.fallidos;
        setProgreso(
          t(
            `Importing from Gmail… ${r.siguiente?.saltar ?? r.total ?? 0} of ${r.total ?? "?"} emails checked`,
            `Importando de Gmail… ${r.siguiente?.saltar ?? r.total ?? 0} de ${r.total ?? "?"} correos revisados`,
          ),
        );
        if (!r.siguiente) {
          setAviso(
            t(
              `Done. Created: ${creados}, notes added: ${notas}, skipped: ${omitidos}, failed: ${fallidos}.`,
              `Listo. Creados: ${creados}, mensajes anotados: ${notas}, omitidos: ${omitidos}, con error: ${fallidos}.`,
            ),
          );
          break;
        }
        fase = r.siguiente.fase;
        saltar = r.siguiente.saltar;
      }
    } catch {
      setAviso(t("The run failed.", "El procesamiento falló."));
    } finally {
      setOcupado(false);
      setProgreso(null);
      await recargar();
    }
  };

  const desconectar = async () => {
    if (!window.confirm(t("Disconnect Gmail? The saved app password is deleted.", "¿Desconectar Gmail? Se borra la contraseña de aplicación guardada."))) return;
    setOcupado(true);
    try {
      const res = await fetch("/api/gmail/desconectar", { method: "POST" });
      if (!res.ok) throw new Error(String(res.status));
      setClave("");
      setAviso(t("Disconnected.", "Desconectado."));
      await recargar();
    } catch {
      setAviso(t("Could not disconnect.", "No se pudo desconectar."));
    } finally {
      setOcupado(false);
    }
  };

  const e = MODO_DEMO ? SIN_CONECTAR : estado;
  const puedeGuardar = !MODO_DEMO && e.configurada && !ocupado && correo.trim().length > 0 && clave.trim().length > 0;

  return (
    <div className="card" data-testid="gmail-indeed-card">
      <h2>📬 {t("Indeed by Gmail", "Indeed por Gmail")}</h2>
      <div className="hint" style={{ marginBottom: 10 }}>
        {t(
          "Reads the Gmail that receives the Indeed emails redirected from the company mailbox, over IMAP with a Google app password. Read-only: nothing is marked, moved or deleted.",
          "Lee el Gmail que recibe los correos de Indeed redirigidos desde el buzón de la empresa, por IMAP con una contraseña de aplicación de Google. Solo lectura: no se marca, mueve ni borra nada.",
        )}
      </div>

      {MODO_DEMO && (
        <div className="hint" style={{ marginBottom: 10 }}>
          {t("Demo: this card does not connect to Gmail.", "Demo: esta tarjeta no se conecta a Gmail.")}
        </div>
      )}

      {!MODO_DEMO && !cargando && !e.configurada && (
        <div className="hint" style={{ color: "var(--red)", marginBottom: 10 }}>
          {t("Missing environment variable (name only): ", "Falta la variable de entorno (solo el nombre): ")}
          <code>OUTLOOK_TOKEN_KEY</code>
          {t(". Saving stays off until it is set.", ". Guardar queda apagado hasta que esté.")}
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
          {e.conectada && <div><strong>{t("Gmail", "Gmail")}:</strong> {e.correo}</div>}
          {e.conectada && <div className="hint">{t("Connected", "Conectado el")} {cuando(e.conectadaEl)}</div>}
          {e.conectada && <div className="hint">{t("Password: saved (encrypted, never shown)", "Contraseña: guardada (cifrada, nunca se muestra)")}</div>}
        </div>
        <div>
          <div><strong>{t("Last check", "Última revisión")}:</strong> {cuando(e.ultimaRevision)}</div>
          <div><strong>{t("Last error", "Último error")}:</strong> {e.ultimoError ?? "—"}</div>
          <div><strong>{t("Candidates created, last 7 days", "Candidatos creados, últimos 7 días")}:</strong> {e.creadosUltimos7Dias}</div>
          <div className="hint">
            {t("Totals since connecting", "Totales desde que se conectó")}: {e.totales.creados} {t("created", "creados")} · {e.totales.notas} {t("notes", "notas")} · {e.totales.omitidos} {t("skipped", "omitidos")} · {e.totales.fallidos} {t("failed", "con error")}
          </div>
        </div>
      </div>

      <div className="grid g2" style={{ marginBottom: 10 }}>
        <div>
          <label>{t("Gmail address", "Dirección de Gmail")}</label>
          <input
            type="email"
            value={correo}
            onChange={(ev) => setCorreo(ev.target.value)}
            placeholder="nombre@gmail.com"
            autoComplete="off"
            disabled={MODO_DEMO || ocupado}
          />
        </div>
        <div>
          <label>{t("App password (16 letters from Google)", "Contraseña de aplicación (16 letras de Google)")}</label>
          <PasswordInput
            value={clave}
            onChange={setClave}
            placeholder={e.conectada ? t("Type a new one to replace the saved one", "Escribe una nueva para reemplazar la guardada") : ""}
            autoComplete="new-password"
          />
        </div>
      </div>

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <button className="btn btn-primary" onClick={guardarYProbar} disabled={!puedeGuardar}>
          {t("Save & test", "Guardar y probar")}
        </button>
        <button className="btn" onClick={revisarAhora} disabled={ocupado || !e.conectada || MODO_DEMO}>
          {t("Check now", "Revisar ahora")}
        </button>
        <button className="btn" onClick={importarAnteriores} disabled={ocupado || !e.conectada || MODO_DEMO}>
          {t("Import old ones", "Importar anteriores")}
        </button>
        <button className="btn" onClick={desconectar} disabled={ocupado || !e.conectada || MODO_DEMO}>
          {t("Disconnect", "Desconectar")}
        </button>
      </div>
      <div className="hint" style={{ marginTop: 6 }}>
        {t(
          "Import old ones reads every Indeed email in the inbox, applications first, then messages. Running it again creates nothing twice.",
          "Importar anteriores lee todos los correos de Indeed de la bandeja: primero solicitudes y luego mensajes. Volver a correrlo no duplica nada.",
        )}
      </div>
      {progreso && <div role="status" className="hint" style={{ marginTop: 6, color: "var(--ink)" }}>{progreso}</div>}

      {e.ultimos.length > 0 && (
        <div style={{ marginTop: 14 }}>
          <div className="hint" style={{ marginBottom: 6 }}>{t("Last 20 emails from Gmail", "Últimos 20 correos de Gmail")}</div>
          <TablaEstandar<Fila>
            id="rrhh-indeed-gmail-ultimos"
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
