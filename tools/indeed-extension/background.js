/*
 * Service worker: el ÚNICO que habla con el hub. Como tiene host_permissions para rtg-hub.vercel.app no necesita CORS.
 * El token se lee de chrome.storage.local y nunca se escribe en el log ni se devuelve a la página.
 */
importScripts("nucleo.js");

const N = globalThis.RTGNucleo;
const HUB = "https://rtg-hub.vercel.app";
const RUTA = `${HUB}/api/indeed-bot/ingest`;

async function leeToken() {
  const { token } = await chrome.storage.local.get("token");
  return typeof token === "string" ? token.trim() : "";
}

async function enviar(item) {
  const token = await leeToken();
  if (!token) return { ok: false, error: "Falta el token: abre Opciones de la extensión y pégalo." };
  let res;
  try {
    res = await fetch(RUTA, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
      body: JSON.stringify({ items: [item] }),
    });
  } catch {
    return { ok: false, error: "Sin conexión con RTG Hub. Intenta de nuevo." };
  }
  if (!res.ok) return { ok: false, status: res.status, error: N.mensajePorEstado(res.status) };
  const j = await res.json().catch(() => ({}));
  const resultado = Array.isArray(j.results) ? j.results[0] : null;
  if (!resultado) return { ok: false, error: "Respuesta inesperada del hub." };
  return { ok: true, resultado };
}

/** Comprueba el token sin crear nada: un envío vacío con el token bueno responde 400 (el token se valida antes). */
async function probar() {
  const token = await leeToken();
  if (!token) return { ok: false, error: "Pega el token primero." };
  try {
    const res = await fetch(RUTA, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
      body: JSON.stringify({ items: [] }),
    });
    if (res.status === 400) return { ok: true, mensaje: "Token correcto. Conexión con RTG Hub lista." };
    return { ok: false, error: N.mensajePorEstado(res.status) };
  } catch {
    return { ok: false, error: "Sin conexión con RTG Hub." };
  }
}

chrome.runtime.onMessage.addListener((msg, _sender, responder) => {
  const trabajo = msg && msg.tipo === "enviar" ? enviar(msg.item) : msg && msg.tipo === "probar" ? probar() : null;
  if (!trabajo) return false;
  trabajo.then(responder, () => responder({ ok: false, error: "Error interno de la extensión." }));
  return true;
});
