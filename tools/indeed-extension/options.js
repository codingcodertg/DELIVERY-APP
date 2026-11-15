/* Página de opciones: guarda el token en chrome.storage.local y prueba la conexión con el hub. Nunca muestra el token. */
const campo = document.getElementById("token");
const estado = document.getElementById("estado");

function muestra(texto) {
  estado.textContent = texto;
}

chrome.storage.local.get("token", ({ token }) => {
  if (token) muestra("Ya hay un token guardado.");
});

document.getElementById("guardar").addEventListener("click", () => {
  const t = campo.value.trim();
  if (!t) return muestra("Pega el token primero.");
  chrome.storage.local.set({ token: t }, () => {
    campo.value = "";
    muestra("Token guardado.");
  });
});

document.getElementById("probar").addEventListener("click", () => {
  muestra("Probando…");
  chrome.runtime.sendMessage({ tipo: "probar" }, (res) => {
    if (chrome.runtime.lastError) return muestra("La extensión no respondió. Recárgala en chrome://extensions.");
    muestra(res && res.ok ? res.mensaje : (res && res.error) || "Sin respuesta.");
  });
});
