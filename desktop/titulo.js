// El título de la ventana de escritorio (D-1085): el programa se llama iFloor y lo que abre es RTG Hub, así que la barra
// dice «RTG Hub by iFloor». El sitio manda su título («RTG Hub | Order & Dispatch»); aquí solo se le añade la firma.
const FIRMA = "RTG Hub by iFloor";

function tituloDeLaVentana(titulo) {
  const t = String(titulo || "").trim();
  if (!t || t === "RTG Hub") return FIRMA;
  if (t.includes(FIRMA)) return t;
  if (t.startsWith("RTG Hub")) return FIRMA + t.slice("RTG Hub".length);
  return `${FIRMA} | ${t}`;
}

module.exports = { tituloDeLaVentana, FIRMA };
