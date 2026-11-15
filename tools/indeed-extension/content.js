/*
 * Content script en employers.indeed.com. Solo actúa cuando el dueño abre el detalle de una conversación o solicitud:
 *   - muestra un botón «Enviar a RTG Hub», un «Auto» (apagado por defecto) y «Copiar diagnóstico»;
 *   - con «Auto» encendido, envía cada detalle que abre, una vez (se recuerda por externalId en chrome.storage.local).
 * No hace clics en la página, no navega y no recorre nada por su cuenta: solo lee lo que el dueño ya tiene abierto.
 * Nada de esto se escribe en el log: el token vive en chrome.storage y nunca sale de la extensión salvo hacia el hub.
 */
(function () {
  if (window.__rtgIndeedCargado) return;
  window.__rtgIndeedCargado = true;

  const N = globalThis.RTGNucleo;
  const X = globalThis.RTGExtractor;
  const ESPERA_DOM_MS = 1500;

  let panel = null;
  let ultimaUrl = "";
  let enCurso = false;

  // ---------------------------------------------------------------------------
  // Almacenamiento (solo chrome.storage.local)
  // ---------------------------------------------------------------------------
  const leeStorage = (claves) => new Promise((r) => chrome.storage.local.get(claves, (v) => r(v || {})));
  const escribeStorage = (obj) => new Promise((r) => chrome.storage.local.set(obj, () => r()));

  // ---------------------------------------------------------------------------
  // Panel flotante (en un shadow root para no pelear con los estilos de Indeed)
  // ---------------------------------------------------------------------------
  function montaPanel() {
    if (panel) return panel;
    const host = document.createElement("div");
    host.id = "rtg-indeed-host";
    const sombra = host.attachShadow({ mode: "open" });
    sombra.innerHTML = `
      <style>
        .caja { position: fixed; right: 16px; bottom: 16px; z-index: 2147483647; font: 13px/1.3 system-ui, sans-serif;
          background: #fff; color: #1d2330; border: 1px solid #c9d1de; border-radius: 10px; padding: 10px; width: 230px;
          box-shadow: 0 6px 20px rgba(0,0,0,.18); }
        .fila { display: flex; gap: 6px; align-items: center; margin-top: 6px; }
        button { font: inherit; border: 0; border-radius: 6px; padding: 6px 9px; cursor: pointer; }
        .enviar { background: #1f5fbf; color: #fff; flex: 1; }
        .enviar:disabled { opacity: .6; cursor: wait; }
        .sec { background: #eef2f8; color: #1d2330; }
        .toast { margin-top: 8px; font-size: 12px; white-space: pre-wrap; }
        .oculto { display: none; }
      </style>
      <div class="caja">
        <div style="font-weight:600">RTG Hub</div>
        <div class="fila">
          <button class="enviar" id="enviar">Enviar a RTG Hub</button>
        </div>
        <div class="fila">
          <label style="display:flex;gap:4px;align-items:center;cursor:pointer">
            <input type="checkbox" id="auto"> Auto
          </label>
          <span style="flex:1"></span>
          <button class="sec" id="diag">Copiar diagnóstico</button>
        </div>
        <div class="toast" id="toast"></div>
      </div>`;
    document.documentElement.appendChild(host);
    panel = {
      host,
      caja: sombra.querySelector(".caja"),
      enviar: sombra.querySelector("#enviar"),
      auto: sombra.querySelector("#auto"),
      diag: sombra.querySelector("#diag"),
      toast: sombra.querySelector("#toast"),
    };
    panel.enviar.addEventListener("click", () => envia({ manual: true }));
    panel.auto.addEventListener("change", () => escribeStorage({ auto: panel.auto.checked }));
    panel.diag.addEventListener("click", copiaDiagnostico);
    return panel;
  }

  function muestraToast(texto) {
    if (!panel) return;
    panel.toast.textContent = texto;
  }

  async function copiaDiagnostico() {
    const texto = X.diagnostico(document);
    try {
      await navigator.clipboard.writeText(texto);
      muestraToast("Diagnóstico copiado. Pégalo en el chat.");
    } catch {
      // Respaldo para páginas que no dejan usar el portapapeles directamente.
      const ta = document.createElement("textarea");
      ta.value = texto;
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand("copy");
      ta.remove();
      muestraToast(ok ? "Diagnóstico copiado. Pégalo en el chat." : "No pude copiar. Revisa los permisos del portapapeles.");
    }
  }

  // ---------------------------------------------------------------------------
  // Envío
  // ---------------------------------------------------------------------------
  function mandaAlServicio(item) {
    return new Promise((resolver) => {
      try {
        chrome.runtime.sendMessage({ tipo: "enviar", item }, (res) => {
          if (chrome.runtime.lastError) resolver({ ok: false, error: "La extensión se recargó: vuelve a abrir la página." });
          else resolver(res || { ok: false, error: "Sin respuesta de la extensión." });
        });
      } catch {
        resolver({ ok: false, error: "La extensión se recargó: vuelve a abrir la página." });
      }
    });
  }

  /** Lee el detalle abierto y lo manda. `manual` = el botón; si no, es el modo Auto (una vez por externalId). */
  async function envia({ manual }) {
    if (enCurso) return;
    enCurso = true;
    if (panel) panel.enviar.disabled = true;
    try {
      const href = location.href;
      const item = await X.extraer(document, href);
      const { enviados = {} } = await leeStorage(["enviados"]);
      if (!manual && N.yaEnviado(enviados, item.externalId)) return;
      muestraToast(`Enviando ${item.candidateName}…`);
      const res = await mandaAlServicio(item);
      // Lo que el hub ya respondió (creado, ya estaba, omitido o error del propio hub) se anota: Auto no lo reintenta.
      if (res.ok) await escribeStorage({ enviados: N.anotaEnviado(enviados, item.externalId, res.resultado && res.resultado.result) });
      muestraToast(N.textoDeResultado(res, item.candidateName));
    } catch (e) {
      muestraToast(e.message || "No se pudo leer la página.");
    } finally {
      enCurso = false;
      if (panel) panel.enviar.disabled = false;
    }
  }

  // ---------------------------------------------------------------------------
  // Cambios de página (sin pedir nada: solo mirar la URL que ya cambió)
  // ---------------------------------------------------------------------------
  async function alCambiarPagina() {
    const href = location.href;
    const tipo = X.tipoDePagina(href);
    // El panel sale en TODA página de Indeed: así «Copiar diagnóstico» siempre está a mano aunque la forma de la URL
    // todavía no sea la que esperamos. «Auto» solo actúa en una página que sí reconocemos como detalle.
    montaPanel();
    panel.host.style.display = "";
    const { auto = false } = await leeStorage(["auto"]);
    panel.auto.checked = !!auto;
    muestraToast(tipo && tipo.detalle ? "" : "Abre un mensaje o una solicitud. Si ya está abierto, usa «Copiar diagnóstico».");
    if (!tipo || !tipo.detalle) return;
    if (auto) setTimeout(() => {
      if (location.href === href) envia({ manual: false });
    }, ESPERA_DOM_MS);
  }

  setInterval(() => {
    if (location.href !== ultimaUrl) {
      ultimaUrl = location.href;
      alCambiarPagina();
    }
  }, 1000);
  ultimaUrl = location.href;
  alCambiarPagina();
})();
