"use client";

import { useEffect } from "react";
import { informarFalla } from "@/lib/fallas/cliente";

/**
 * La última red (2026-11-25): cae aquí si falla el layout raíz. No hay providers ni CSS en este punto, así que el texto
 * va en los dos idiomas a la vez y con estilos en línea. La falla se registra (origen cliente) antes de mostrar nada.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    informarFalla(error, { origen: "cliente", componente: "global-error.tsx" });
  }, [error]);

  return (
    <html lang="en">
      <body>
        <div role="alert" style={{ maxWidth: 520, margin: "80px auto", padding: "0 16px", textAlign: "center", fontFamily: "sans-serif" }}>
          <div style={{ fontSize: 34 }} aria-hidden="true">⚠️</div>
          <h2 style={{ margin: "10px 0" }}>Something went wrong · Algo salió mal</h2>
          <p style={{ margin: "0 0 18px", opacity: 0.8 }}>
            It was reported to the team. You can try again.
            <br />
            Quedó reportado para el equipo. Puedes intentarlo otra vez.
          </p>
          <button type="button" onClick={() => reset()} style={{ marginRight: 8 }}>
            Retry · Reintentar
          </button>
          <button type="button" onClick={() => location.reload()}>
            Reload · Recargar
          </button>
        </div>
      </body>
    </html>
  );
}
