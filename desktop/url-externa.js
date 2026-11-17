// Qué direcciones puede abrir la app de escritorio con el navegador del sistema (`shell.openExternal`).
// Solo esquemas que no ejecutan nada en la máquina: un enlace `file:` o `ms-…:` lanzado desde la app sería una vía
// para abrir programas. Cualquier texto que no sea una URL válida se descarta.
const ESQUEMAS_EXTERNOS = ["http:", "https:", "mailto:", "tel:"];

function esUrlExterna(url) {
  try {
    const u = new URL(String(url));
    return ESQUEMAS_EXTERNOS.includes(u.protocol);
  } catch {
    return false;
  }
}

module.exports = { esUrlExterna, ESQUEMAS_EXTERNOS };
