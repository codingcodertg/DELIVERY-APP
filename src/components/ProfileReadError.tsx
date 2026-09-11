import { textoDeFallo } from "@/lib/profile-read";
import type { ErrorDeLectura } from "@/lib/profile-read";
import { RetryButton } from "@/components/RetryButton";

/**
 * La pantalla que sale cuando la consulta del perfil FALLA (D-234).
 *
 * Es lo que sustituye al `redirect("/login")` en ese camino. No es un detalle de
 * estilo: mientras el fallo mandaba al login, el login devolvía aquí y el
 * resultado era `ERR_TOO_MANY_REDIRECTS`, que no dice nada de lo que pasó.
 *
 * Bilingüe sin `usePrefs`: las preferencias viven en el cliente y detrás del
 * proveedor de datos, que es justo lo que no ha podido arrancar. Los dos idiomas
 * a la vez es más feo y siempre funciona.
 *
 * Estilos en línea por la misma razón que `SessionExpired`: esto puede salir en
 * el hub, en el ERP, en Reclutamiento o en el fichaje, y cada uno tiene su
 * paleta con su propio ámbito.
 */
export function ProfileReadError({ error, verDetalle }: { error: ErrorDeLectura; verDetalle: boolean }) {
  const t = textoDeFallo(error, verDetalle);

  return (
    <main
      role="alert"
      style={{ minHeight: "100vh", display: "grid", placeItems: "center", padding: 24, background: "var(--paper, #f4f6fa)" }}
    >
      <div
        style={{
          maxWidth: 520, width: "100%", background: "var(--card, #fff)", color: "var(--text, #1a2233)",
          border: "1px solid var(--line, #d7deea)", borderRadius: 16, padding: 22,
          fontFamily: "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif",
        }}
      >
        <div style={{ fontSize: 30, marginBottom: 8 }} aria-hidden>⚠️</div>
        <h2 style={{ margin: "0 0 6px", fontSize: 20 }}>{t.titulo}</h2>
        <p style={{ margin: "0 0 10px", fontSize: 14, lineHeight: 1.5 }}>{t.cuerpo}</p>
        <h3 style={{ margin: "14px 0 4px", fontSize: 15, opacity: 0.75 }}>{t.titulo_en}</h3>
        <p style={{ margin: "0 0 14px", fontSize: 13, lineHeight: 1.5, opacity: 0.75 }}>{t.cuerpo_en}</p>

        <p style={{ margin: "0 0 14px", fontSize: 13 }}>
          <strong>Ref:</strong> <code style={{ fontFamily: "ui-monospace,SFMono-Regular,Menlo,monospace" }}>{t.ref}</code>
        </p>

        {t.detalle && (
          <pre
            style={{
              margin: "0 0 14px", padding: 10, background: "var(--paper, #f4f6fa)", border: "1px solid var(--line, #e3e8f0)",
              borderRadius: 10, fontSize: 12, whiteSpace: "pre-wrap", wordBreak: "break-word",
            }}
          >
            {t.detalle}
          </pre>
        )}

        <RetryButton />
      </div>
    </main>
  );
}
