"use client";

/**
 * "Tu sesión caducó" — lo que la app nunca decía.
 *
 * Hasta ahora, cuando la sesión moría (típicamente al despertar el ordenador), cada módulo
 * enseñaba una pantalla vacía y se quedaba callado: sin error, sin aviso, sin nada que
 * distinguirlo de "hoy no hay datos". Andrés lo reportó tres veces. El fallo no era solo que
 * la recuperación no funcionara en ese caso —no puede, hay que volver a entrar— sino que
 * **no lo decía**, así que parecía que la app estaba rota.
 *
 * Se dibuja ENCIMA y no en lugar de la pantalla: lo de abajo sigue montado. En el cronómetro
 * eso importa —hay un contador corriendo y un turno a medias— y desmontarlo para enseñar un
 * cartel perdería lo que hubiera sin guardar.
 *
 * Estilos en línea, a propósito: esto sale en los tres módulos y cada uno tiene su propia
 * paleta con su propio ámbito (`.timetracker-module`, `.recruiting-module`, el hub). Una
 * clase compartida se vería bien en uno y ilegible en otro — ya pasó con `.section-label`.
 */
export function SessionExpired({ lang = "es" }: { lang?: "es" | "en" }) {
  const es = lang === "es";
  const volver = () => {
    const next = typeof window !== "undefined" ? window.location.pathname + window.location.search : "/";
    window.location.href = "/login?next=" + encodeURIComponent(next);
  };

  return (
    <div
      role="alertdialog"
      aria-modal="true"
      style={{
        position: "fixed", inset: 0, zIndex: 90,
        background: "rgba(8,12,20,.72)",
        display: "flex", alignItems: "center", justifyContent: "center", padding: 20,
      }}
    >
      <div
        style={{
          maxWidth: 420, width: "100%",
          background: "#fff", color: "#1a2233",
          border: "1px solid #d7deea", borderRadius: 16,
          padding: 22, boxShadow: "0 18px 50px rgba(0,0,0,.35)",
          fontFamily: "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif",
        }}
      >
        <h2 style={{ margin: "0 0 8px", fontSize: 18, fontWeight: 800 }}>
          {es ? "Tu sesión caducó" : "Your session expired"}
        </h2>
        <p style={{ margin: "0 0 6px", fontSize: 14, lineHeight: 1.5 }}>
          {es
            ? "Por eso la pantalla se ve vacía: la app dejó de tener permiso para leer tus datos. No se ha perdido nada."
            : "That is why the screen looks empty: the app lost permission to read your data. Nothing has been lost."}
        </p>
        <p style={{ margin: "0 0 16px", fontSize: 13, lineHeight: 1.5, color: "#5c6b86" }}>
          {es
            ? "Suele pasar al volver de suspender el ordenador. Entra otra vez y vuelves justo a esta pantalla."
            : "It usually happens after the computer wakes from sleep. Sign in again and you come straight back to this screen."}
        </p>
        <button
          onClick={volver}
          style={{
            width: "100%", height: 44, borderRadius: 12, border: "none",
            background: "#3a63e0", color: "#fff", fontSize: 15, fontWeight: 700, cursor: "pointer",
          }}
        >
          {es ? "Volver a entrar" : "Sign in again"}
        </button>
      </div>
    </div>
  );
}
