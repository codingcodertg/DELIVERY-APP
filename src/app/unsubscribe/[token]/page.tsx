"use client";

import { use, useState } from "react";
import { TOKEN_DE_BAJA_RE } from "@/lib/avisos-cliente";

// ============================================================
// Baja de los avisos al cliente (D-416, migración 150). Pública, sin login: el enlace va al final de cada aviso
// (SMS o correo). Abrirla NO da de baja: hay que pulsar el botón. Los antivirus de correo y las vistas previas de los
// mensajes abren los enlaces solos, y una baja por abrir la página daría de baja a quien no lo pidió.
//
// Bilingüe siempre: quien llega no tiene cuenta ni idioma elegido. En el demo (NEXT_PUBLIC_LOCAL_MODE) no hay base:
// el botón lo dice y no guarda nada.
// ============================================================

const LOCAL_MODE = process.env.NEXT_PUBLIC_LOCAL_MODE === "true";

type Estado = "listo" | "enviando" | "hecho" | "demo" | "no_encontrado" | "error";

export default function UnsubscribePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = use(params);
  const valido = TOKEN_DE_BAJA_RE.test(token);
  const [estado, setEstado] = useState<Estado>(valido ? "listo" : "no_encontrado");
  const [contactos, setContactos] = useState<string[]>([]);

  const darDeBaja = async () => {
    if (LOCAL_MODE) { setEstado("demo"); return; }
    setEstado("enviando");
    try {
      const res = await fetch("/api/avisos-cliente/baja", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token }),
      });
      const b = await res.json().catch(() => ({}));
      if (b.ok) { setContactos(Array.isArray(b.contactos) ? b.contactos : []); setEstado("hecho"); return; }
      setEstado(b.motivo === "no_encontrado" || b.motivo === "token" ? "no_encontrado" : "error");
    } catch {
      setEstado("error");
    }
  };

  return (
    <div className="auth-wrap" style={{ alignItems: "flex-start", paddingTop: 60 }}>
      <div className="auth-card" style={{ maxWidth: 460 }} data-baja={estado}>
        <h1>RDZ<span>·</span>Delivery updates</h1>
        <p className="hint" style={{ marginBottom: 20 }}>Avisos de entrega</p>

        {(estado === "listo" || estado === "enviando") && (
          <>
            <p>Stop receiving delivery updates (texts and emails) from RDZ?</p>
            <p className="hint">¿Dejar de recibir los avisos de entrega (mensajes y correos) de RDZ?</p>
            <button className="btn btn-primary" style={{ marginTop: 16, width: "100%" }} disabled={estado === "enviando"} onClick={darDeBaja}>
              {estado === "enviando" ? "…" : "Unsubscribe · Darme de baja"}
            </button>
          </>
        )}
        {estado === "hecho" && (
          <>
            <p>You won’t receive any more delivery updates{contactos.length ? ` at ${contactos.join(", ")}` : ""}.</p>
            <p className="hint">Ya no recibirá más avisos de entrega{contactos.length ? ` en ${contactos.join(", ")}` : ""}.</p>
          </>
        )}
        {estado === "demo" && (
          <p className="hint">Demo: nothing was saved. · Demo: no se guardó nada.</p>
        )}
        {estado === "no_encontrado" && (
          <p className="empty">This link is not valid. · Este enlace no es válido.</p>
        )}
        {estado === "error" && (
          <p className="empty">Something went wrong. Please try again. · Algo falló. Inténtelo de nuevo.</p>
        )}
      </div>
    </div>
  );
}
