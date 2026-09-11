"use client";

/**
 * «Reintentar» de la pantalla de fallo de lectura (D-234).
 *
 * Recarga la MISMA dirección, y eso es el punto: el fallo que enseña esa
 * pantalla suele ser pasajero (una migración a medio aplicar, la red), así que
 * el camino de vuelta es repetir la petición, no ir a ningún otro sitio.
 * Mandar al login desde aquí sería volver al bucle que esta rama quita.
 */
export function RetryButton() {
  return (
    <button
      onClick={() => window.location.reload()}
      style={{
        padding: "9px 16px", borderRadius: 10, border: "1px solid var(--line, #c9d3e4)",
        background: "var(--accent, #2456c9)", color: "#fff", fontWeight: 700, fontSize: 14, cursor: "pointer",
      }}
    >
      Reintentar · Retry
    </button>
  );
}
