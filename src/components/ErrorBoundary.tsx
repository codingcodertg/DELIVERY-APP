"use client";

import { Component, type ReactNode } from "react";
import * as Sentry from "@sentry/nextjs";
import { installedApkVersion } from "@/lib/app-update";
import { APP_VERSIONS } from "@/lib/app-versions";
import { appForPath } from "@/lib/app-for-path";
import { canAutoReload, isStaleChunkError, markAutoReload } from "@/lib/stale-chunk";
import type { UserRole } from "@/lib/types";

// ============================================================
// App-wide error boundary (#38). Catches render/runtime errors in the UI so a
// single broken component shows a friendly recovery card instead of a blank
// white screen.
//
// Desde D-120 la tarjeta deja COPIAR el detalle. El motivo es concreto: un fallo real llegó
// como "algo como cant read length", porque lo único que la tarjeta enseñaba era el mensaje —
// sin archivo, sin línea, sin el árbol de componentes. Buscar un `.length` en todo el árbol de
// render sin la traza es buscar a ciegas, y así fue como se fueron cuatro intentos de arreglo
// a bulto. La traza se manda a Sentry desde el principio, pero leerla exige acceso que no
// siempre se tiene a mano; el portapapeles no exige ninguno.
// ============================================================

interface Props { children: ReactNode; role?: UserRole; }
interface State { error: Error | null; componentStack: string | null; copied: boolean; when: string | null }


export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null, componentStack: null, copied: false, when: null };

  static getDerivedStateFromError(error: Error): State {
    // La hora se fija AQUÍ, cuando revienta. Calcularla al pintar daría la hora de mirar la
    // tarjeta, que no es el dato que sirve para cruzarla con un log.
    return { error, componentStack: null, copied: false, when: new Date().toISOString() };
  }

  componentDidCatch(error: Error, info: { componentStack?: string | null }) {
    // Antes que nada: si es el bundle viejo, recargar y ya. Es exactamente lo que la
    // persona iba a hacer con el botón de abajo, y no hay motivo para hacérselo pedir.
    // Se avisa a Sentry igual —con su etiqueta— porque si esto empieza a pasar veinte
    // veces al día deja de ser una anécdota de despliegue.
    if (isStaleChunkError(error) && canAutoReload()) {
      markAutoReload();
      Sentry.captureException(error, { tags: { role: this.props.role ?? "unknown", staleChunk: "true" } });
      location.reload();
      return;
    }

    const apk = typeof navigator !== "undefined" ? installedApkVersion(navigator.userAgent) : null;
    // Se guarda además de mandarse: es lo que hace falta para el botón de copiar.
    this.setState({ componentStack: info.componentStack ?? null });
    Sentry.captureException(error, {
      tags: { role: this.props.role ?? "unknown", apkVersion: apk ?? "web" },
      contexts: { react: { componentStack: info.componentStack } },
    });
  }

  /** Todo lo que hace falta para localizar el fallo, en texto plano. */
  private details(): string {
    const e = this.state.error;
    const path = typeof location !== "undefined" ? location.pathname + location.search : "?";
    const app = appForPath(typeof location !== "undefined" ? location.pathname : null);
    return [
      `mensaje: ${e?.message ?? "(sin mensaje)"}`,
      `cuándo:  ${this.state.when ?? "?"}`,
      `dónde:   ${path}`,
      // La versión del bundle que está corriendo AHORA en esa pestaña. Ya nos hizo falta una
      // vez para separar "el arreglo no funciona" de "esta pestaña tiene el código viejo".
      `app:     ${app} v${APP_VERSIONS[app] ?? "?"}`,
      `rol:     ${this.props.role ?? "?"}`,
      `agente:  ${typeof navigator !== "undefined" ? navigator.userAgent : "?"}`,
      "",
      "--- stack ---",
      e?.stack ?? "(sin stack)",
      "",
      "--- componentes ---",
      this.state.componentStack ?? "(sin árbol de componentes)",
    ].join("\n");
  }

  private async copy() {
    const texto = this.details();
    try {
      await navigator.clipboard.writeText(texto);
      this.setState({ copied: true });
    } catch {
      // El portapapeles falla sin HTTPS y dentro del WebView de la app de escritorio — que es
      // justo donde más falta hace. Se cae a enseñar el texto para copiarlo a mano en vez de
      // no dar nada.
      const ta = document.getElementById("eb-detalle") as HTMLTextAreaElement | null;
      if (ta) { ta.hidden = false; ta.focus(); ta.select(); }
    }
  }

  render() {
    if (this.state.error) {
      return (
        <div className="wrap">
          <div className="card" style={{ maxWidth: 560, margin: "40px auto", textAlign: "center" }}>
            <div style={{ fontSize: 34 }}>⚠️</div>
            <h2 style={{ margin: "10px 0" }}>Something went wrong</h2>
            <p className="hint" style={{ marginBottom: 16, userSelect: "text" }}>{this.state.error.message}</p>
            <div style={{ display: "flex", gap: 8, justifyContent: "center", flexWrap: "wrap" }}>
              <button className="btn btn-ghost" onClick={() => this.setState({ error: null, componentStack: null, copied: false, when: null })}>Try again</button>
              <button className="btn btn-primary" onClick={() => location.reload()}>Reload app</button>
              <button className="btn btn-ghost" onClick={() => void this.copy()}>
                {this.state.copied ? "✓ Copied" : "Copy details"}
              </button>
            </div>
            <p className="hint" style={{ marginTop: 12, fontSize: 12 }}>
              Copy the details and send them over — they say which file and line broke, which the
              message alone does not.
            </p>
            {/* Salida de emergencia cuando el portapapeles no está disponible. Oculto hasta que
                hace falta: si no, la tarjeta de error se convierte en un muro de texto. */}
            <textarea
              id="eb-detalle"
              hidden
              readOnly
              value={this.details()}
              style={{ width: "100%", height: 180, marginTop: 12, fontFamily: "monospace", fontSize: 11 }}
            />
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
