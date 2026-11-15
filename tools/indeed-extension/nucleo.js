/*
 * Funciones puras de la extensión (sin DOM, sin red, sin chrome.*). Las usan el content script, el service worker y
 * las pruebas (`node --test tools/indeed-extension/`). Se cargan como script clásico: exponen `globalThis.RTGNucleo`
 * y, si hay `module`, también `module.exports` para las pruebas.
 */
(function () {
  const RE_ID = /^[A-Za-z0-9_-]{6,120}$/;
  const RE_NOMBRE = /^\p{L}[\p{L}'.-]*(\s+\p{L}[\p{L}'.-]*){1,3}$/u;
  const SEGMENTOS_NO_ID = new Set([
    "messages", "message", "conversations", "conversation", "applications", "application",
    "candidates", "candidate", "employers", "inbox", "jobs", "app",
  ]);

  /** SHA-256 en hex, recortado a 32 caracteres. Sirve de identificador estable cuando la URL no trae ninguno. */
  async function hashCorto(texto) {
    const bytes = new TextEncoder().encode(texto);
    const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes);
    return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("").slice(0, 32);
  }

  /** El id de la conversación o solicitud en la URL (parámetro o último segmento), o null. */
  function idDeUrl(href) {
    let u;
    try {
      u = new URL(href);
    } catch {
      return null;
    }
    for (const k of ["conversationId", "applicationId", "id"]) {
      const v = u.searchParams.get(k);
      if (v && RE_ID.test(v)) return v;
    }
    const segs = u.pathname.split("/").filter(Boolean);
    for (let i = segs.length - 1; i >= 0; i--) {
      if (RE_ID.test(segs[i]) && !SEGMENTOS_NO_ID.has(segs[i].toLowerCase())) return segs[i];
    }
    return null;
  }

  /**
   * externalId estable: `msg-<id>` o `app-<id>` si la URL trae el id; si no, `msg-h<hash>` / `app-h<hash>` del nombre,
   * el puesto y la primera fecha del mensaje. Mismo contenido, mismo id: así el reenvío no duplica.
   */
  async function externalIdDe({ kind, url, nombre, puesto, primerTiempo }) {
    const pref = kind === "application" ? "app" : "msg";
    const id = idDeUrl(url);
    if (id) return `${pref}-${id}`;
    return `${pref}-h${await hashCorto([nombre ?? "", puesto ?? "", primerTiempo ?? ""].join("|"))}`;
  }

  /** Teléfono de 10 dígitos: primero una línea con etiqueta («Phone:»), luego cualquier forma de teléfono. */
  function telefonoDeTexto(texto) {
    const etiquetado = /(?:phone|tel[eé]fono|celular|mobile|cell)\s*[:：]?\s*([+()\d][\d\s().-]{8,})/i.exec(texto);
    const candidatos = [etiquetado && etiquetado[1], (/\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}/.exec(texto) || [])[0]].filter(Boolean);
    for (const c of candidatos) {
      let d = c.replace(/\D/g, "");
      if (d.length === 11 && d.startsWith("1")) d = d.slice(1);
      if (d.length === 10) return d;
    }
    return null;
  }

  /** «Inventory Coordinator • McAllen, TX» → puesto y ubicación. */
  function datosDeVacante(texto) {
    for (const linea of texto.split("\n")) {
      const m = /^(.+?)\s*[•·|]\s*(.+,\s*[A-Z]{2}(?:\s+\d{5})?)\s*$/.exec(linea.trim());
      if (m) return { puesto: m[1].trim(), ubicacion: m[2].trim() };
    }
    return { puesto: null, ubicacion: null };
  }

  /** Calificaciones: las líneas tras el encabezado «Qualifications», separadas por •, hasta el primer enlace de acción. */
  function calificacionesDeTexto(texto) {
    const lineas = texto.split("\n").map((l) => l.trim());
    const i = lineas.findIndex((l) => /^qualifications$|^calificaciones$|^cualificaciones$/i.test(l));
    if (i < 0) return [];
    const out = [];
    for (const l of lineas.slice(i + 1)) {
      if (/see full application|view resume|manage|ver (la )?solicitud|ver (el )?curr[ií]culum|administrar/i.test(l)) break;
      for (const t of l.split(/\s*[•·|]\s*/)) {
        const limpio = t.trim();
        if (limpio && limpio.length <= 60 && !out.includes(limpio)) out.push(limpio);
      }
    }
    return out;
  }

  /** ¿Parece un nombre de persona (2 a 4 palabras, solo letras)? */
  function pareceNombre(s) {
    return RE_NOMBRE.test((s || "").trim());
  }

  /** Enlace https de indeed.com (o subdominio) o null. */
  function enlaceIndeed(href) {
    try {
      const u = new URL(href);
      const h = u.hostname.toLowerCase();
      if (u.protocol !== "https:") return null;
      if (h !== "indeed.com" && !h.endsWith(".indeed.com")) return null;
      return u.toString();
    } catch {
      return null;
    }
  }

  /** Ya se envió este externalId (en el mapa de enviados). */
  function yaEnviado(mapa, id) {
    return Object.prototype.hasOwnProperty.call(mapa || {}, id);
  }

  /** Anota un envío; el mapa conserva solo los últimos `tope` (el orden de inserción de las claves). */
  function anotaEnviado(mapa, id, resultado, tope = 500) {
    const nuevo = { ...(mapa || {}) };
    delete nuevo[id];
    nuevo[id] = { resultado, en: Date.now() };
    const claves = Object.keys(nuevo);
    for (const k of claves.slice(0, Math.max(0, claves.length - tope))) delete nuevo[k];
    return nuevo;
  }

  const FECHA = { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "America/Chicago" };

  /** Lo que ve el dueño en la notita: resultado en una frase, sin teléfonos ni texto de mensajes. */
  function textoDeResultado(res, nombre) {
    const quien = nombre ? `${nombre}: ` : "";
    if (!res || !res.ok) return `${quien}${(res && res.error) || "Error desconocido."}`;
    const r = res.resultado || {};
    let base;
    switch (r.result) {
      case "created":
        base = "Perfil creado";
        break;
      case "noted":
        base = "Mensaje anotado";
        break;
      case "duplicate":
        base = "Ya estaba en RTG Hub";
        break;
      case "skipped":
        base = /^ya recibido/.test(r.error || "") ? "Ya estaba enviado" : `Omitido: ${r.error || "sin motivo"}`;
        break;
      default:
        base = `Error: ${r.error || "no se pudo procesar"}`;
    }
    if (r.scheduledAt) {
      const cuando = new Date(r.scheduledAt).toLocaleString("es-MX", FECHA);
      base += ` · llamada agendada ${cuando}`;
    }
    return quien + base;
  }

  /** Mensaje legible para un código de respuesta del hub. */
  function mensajePorEstado(status) {
    const pistas = {
      400: "El hub rechazó los datos de este elemento.",
      401: "Token incorrecto: abre Opciones y pega el token de nuevo.",
      413: "El envío es demasiado grande.",
      429: "Demasiados envíos seguidos: espera un minuto.",
      503: "El hub no tiene INDEED_BOT_TOKEN configurado.",
    };
    return pistas[status] || `El hub respondió ${status}.`;
  }

  const API = {
    hashCorto, idDeUrl, externalIdDe, telefonoDeTexto, datosDeVacante, calificacionesDeTexto,
    pareceNombre, enlaceIndeed, yaEnviado, anotaEnviado, textoDeResultado, mensajePorEstado,
  };
  if (typeof module !== "undefined" && module.exports) module.exports = API;
  globalThis.RTGNucleo = API;
})();
