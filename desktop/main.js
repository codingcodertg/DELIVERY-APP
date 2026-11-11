"use strict";

// ============================================================
// RTG Hub — ventana de escritorio para Windows (D-166).
//
// Una ventana que abre el hub y ya. No trae el sitio dentro: lo carga en vivo, igual que la
// cáscara de Android de los choferes. Es la misma decisión y por el mismo motivo — cuando se
// despliega a Vercel, todo el mundo tiene el cambio sin reinstalar nada. Solo hay que volver
// a compilar esto si cambia el icono, el nombre o algo de esta ventana.
//
// ---------------------------------------------------------------------------
// Lo que esta app NO es
// ---------------------------------------------------------------------------
// **No es el cliente de Time Tracker.** Aquel expone `window.ttDesktop` y con eso hace dos
// cosas: captura pantallas y actividad, y **esconde el selector de módulos** (D-076), porque
// salir de /timetracker detiene la captura en silencio.
//
// Esta ventana no expone ese puente, a propósito y no por olvido:
//
//   · Si lo expusiera, la web escondería el selector de módulos — que es justo lo único que
//     esta app viene a ofrecer.
//   · Y Time Tracker creería que puede capturar pantallas desde aquí, sin que haya nada al
//     otro lado que las tome.
//
// O sea: dentro de esta ventana, Time Tracker se comporta exactamente como en una pestaña
// del navegador. Quien tenga que cronometrar con capturas sigue usando su cliente.
// ============================================================

const { app, BrowserWindow, shell, Menu, dialog, net, powerMonitor } = require("electron");
const path = require("node:path");
const fs = require("node:fs");
const { crearConfianza } = require("./origenes.js");
// La actualización automática (D-811): `electron-updater` pregunta a nuestro sitio (`/api/desktop-update/latest.yml`)
// si hay una versión más nueva, la baja en silencio y la instala al cerrar —o ya, si la persona acepta—. Es lo que hace
// que esta app NO haya que reinstalarla a mano tienda por tienda a partir de la 1.2.0. La 1.1.1 no la lleva: esa sí
// se reinstala una vez.
const { autoUpdater } = require("electron-updater");
const { CABECERA, idDeMaquina, salNueva, machineGuidDe } = require("./dispositivo.js");
const { execFileSync } = require("node:child_process");

const SITIO = "https://rtg-hub.vercel.app";
const INICIO = `${SITIO}/home`;
const ORIGEN = new URL(SITIO).origin;

// Dónde se recuerda el tamaño de la ventana. En la carpeta de datos del usuario, que es la
// única que Windows garantiza escribible (junto a Program Files no lo es).
const ESTADO = () => path.join(app.getPath("userData"), "ventana.json");
// Y dónde vive la sal de la identidad de esta instalación (D-811). Nace la primera vez y no se toca.
const SAL = () => path.join(app.getPath("userData"), "dispositivo.json");

/**
 * El id de ESTA instalación en ESTA máquina (D-811): sha256 del MachineGuid de Windows más una sal propia. Va en la
 * cabecera `x-rtg-device` de cada petición a nuestro sitio, y es lo que Security registra como «app de escritorio».
 * Copiar la app a otra PC da otro id. Si el registro no se deja leer, se usa solo la sal (ver `dispositivo.js`).
 */
function idDeEstaInstalacion() {
  let sal = null;
  try { sal = JSON.parse(fs.readFileSync(SAL(), "utf8")).sal || null; } catch { /* primera vez */ }
  if (!sal) {
    sal = salNueva();
    try { fs.writeFileSync(SAL(), JSON.stringify({ sal, creada: new Date().toISOString() })); } catch { /* sin carpeta: el id cambia en cada arranque, y Security lo verá como otro dispositivo */ }
  }
  let guid = null;
  try {
    guid = machineGuidDe(execFileSync("reg", ["query", "HKLM\SOFTWARE\Microsoft\Cryptography", "/v", "MachineGuid"], { encoding: "utf8", windowsHide: true }));
  } catch { /* sin registro (no es Windows, o sin permiso): solo la sal */ }
  return idDeMaquina(guid, sal);
}

function leeEstado() {
  try {
    const s = JSON.parse(fs.readFileSync(ESTADO(), "utf8"));
    if (Number.isFinite(s.width) && Number.isFinite(s.height)) return s;
  } catch { /* primera vez, o fichero roto: se usan los valores por defecto */ }
  return { width: 1280, height: 860 };
}

// ---------------------------------------------------------------------------
// El color con el que nace la ventana (D-226)
// ---------------------------------------------------------------------------
// Estaba fijo en `#0f151d`, el `--paper` del tema OSCURO, copiado del cliente de Time
// Tracker — donde sí aplica, porque aquel arranca en oscuro a propósito (D-080). **Aquí no**:
// el script de pre-pintado del hub (`layout.tsx`) elige oscuro solo si existe
// `window.ttDesktop`, que lo inyecta un `preload` que esta ventana **no tiene**. Así que el
// hub arranca en claro y la ventana lo enmarcaba en negro: parpadeo al abrir, y negro en
// cualquier zona que la web no llegue a pintar.
//
// Los dos valores son los `--paper` de `globals.css`, para que el marco y la página sean el
// mismo color y no haya costura.
const PAPEL = { light: "#f4f6f9", dark: "#0f151d" };

/**
 * El tema con el que se pinta el marco: el que se vio la última vez.
 *
 * El proceso principal no puede leer el `localStorage` de la página antes de crearla, y sin
 * `preload` tampoco hay puente. Así que se recuerda: tras cargar, se lee lo que la página
 * decidió y se guarda para el **próximo** arranque, igual que ya se recuerda el tamaño. La
 * primera vez sale claro, que es lo que pinta el script de pre-pintado sin preferencia
 * guardada; a partir de ahí, el marco acompaña a quien haya elegido oscuro.
 */
function temaRecordado() {
  try {
    const s = JSON.parse(fs.readFileSync(ESTADO(), "utf8"));
    return s.theme === "dark" ? "dark" : "light";
  } catch { return "light"; }
}

function guardaEstado(win) {
  try {
    if (win.isDestroyed() || win.isMinimized()) return;
    const b = win.getBounds();
    // Se conserva el tema recordado: `guardaEstado` escribe el fichero entero y sin esto
    // borraría lo que aprendió `did-finish-load`.
    fs.writeFileSync(ESTADO(), JSON.stringify({ ...b, maximized: win.isMaximized(), theme: temaRecordado() }));
  } catch { /* que no se recuerde el tamaño no es motivo para romper nada */ }
}

/**
 * Abrir al iniciar Windows (dueño, 11 nov: «que el RTG Hub haga launch on startup»). Se prende UNA vez, la primera
 * vez que corre esta versión; luego manda lo que la persona elija en Configuración de Windows → Aplicaciones →
 * Inicio (si lo apaga ahí, no se lo volvemos a prender). Solo en la app instalada, no con `npm start`.
 */
const ARRANQUE = () => path.join(app.getPath("userData"), "arranque.json");
function abrirAlIniciarLaPrimeraVez() {
  if (!app.isPackaged || process.platform !== "win32") return;
  try { if (JSON.parse(fs.readFileSync(ARRANQUE(), "utf8")).decidido) return; } catch { /* primera vez */ }
  try {
    app.setLoginItemSettings({ openAtLogin: true });
    fs.writeFileSync(ARRANQUE(), JSON.stringify({ decidido: true, cuando: new Date().toISOString() }));
  } catch { /* sin permiso o sin carpeta: se intenta otra vez al siguiente arranque */ }
}

/** Una sola ventana por máquina: abrir el acceso directo dos veces enfoca la que ya está. */
const unica = app.requestSingleInstanceLock();
if (!unica) {
  app.quit();
} else {
  app.on("second-instance", () => {
    const [win] = BrowserWindow.getAllWindows();
    if (win) {
      if (win.isMinimized()) win.restore();
      win.focus();
    }
  });
  app.whenReady().then(() => { abrirAlIniciarLaPrimeraVez(); crearVentana(); });
  app.on("window-all-closed", () => app.quit());
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) crearVentana();
  });
}

function crearVentana() {
  const previo = leeEstado();

  const win = new BrowserWindow({
    ...previo,
    minWidth: 900,
    minHeight: 600,
    title: "RTG Hub",
    backgroundColor: PAPEL[temaRecordado()],
    icon: path.join(__dirname, "build", "icon.ico"),
    // La barra de menú de Electron (Archivo/Editar/Ver…) no pinta nada aquí: la navegación
    // vive dentro de la web. Se quita, pero los atajos de recargar y de las herramientas
    // siguen existiendo abajo, porque un soporte remoto sin recargar es un soporte a ciegas.
    autoHideMenuBar: true,
    webPreferences: {
      // Sin acceso a Node desde la página. Esta ventana carga un sitio remoto: si mañana ese
      // sitio sirviera algo comprometido, `nodeIntegration` convertiría un problema web en
      // un problema del ordenador de quien lo abrió.
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      spellcheck: true,
    },
  });
  if (previo.maximized) win.maximize();
  Menu.setApplicationMenu(null);

  // El agente de usuario dice qué es esto, igual que hace la cáscara de Android. Sirve para
  // que la web pueda distinguirlo el día que haga falta — y para leerlo en un informe de
  // error sin tener que preguntar "¿lo abriste en Chrome o en la app?".
  // `RTGHub/`, no `RDZHub/` (D-225). Se comprobó antes de cambiarlo: **nadie compara esta
  // cadena** — no aparece en `src/` fuera de esta línea. Si algún día la web la mira, tiene que
  // aceptar las dos, porque las instalaciones viejas seguirán mandando la vieja durante meses.
  const ua = `${win.webContents.getUserAgent()} RTGHub/${app.getVersion()}`;
  win.webContents.setUserAgent(ua);

  win.loadURL(INICIO, { userAgent: ua });

  // ---------------------------------------------------------------------------
  // Nada sale de esta ventana salvo lo que no es nuestro
  // ---------------------------------------------------------------------------
  // Un enlace a Google Maps, a una factura o a cualquier sitio de fuera abre en el navegador
  // del sistema. Si se abriera aquí dentro, la persona se quedaría sin forma de volver: esta
  // ventana no tiene barra de direcciones ni botón de atrás.
  // Qué es «nuestro» NO puede ser una constante que envejece (D-225). La app instalada del 3 de
  // septiembre lleva embebido el dominio viejo; el sitio se mudó al día siguiente y el dominio
  // viejo redirige. Resultado: la ventana cargaba bien —el enrutado de cliente no dispara
  // `will-navigate`— pero el cierre de sesión, que es un POST de página completa, salía al
  // navegador porque su URL ya no coincidía con la constante. La sesión no se cerraba.
  //
  // Así que la confianza empieza en `ORIGEN` y aprende **un** origen más: donde acabe la primera
  // carga. La regla y su límite viven en `origenes.js`, que no depende de Electron y sí tiene
  // pruebas.
  const confianza = crearConfianza(ORIGEN);
  const esNuestro = (u) => confianza.esNuestro(u);

  // La identidad de la instalación (D-811), en una cabecera que SOLO esta ventana pone, y solo hacia nuestro sitio.
  // Un navegador no puede ponerla; por eso Security la cree y no cree al agente de usuario.
  const idInstalacion = idDeEstaInstalacion();
  win.webContents.session.webRequest.onBeforeSendHeaders((detalles, callback) => {
    const requestHeaders = { ...detalles.requestHeaders };
    if (esNuestro(detalles.url)) requestHeaders[CABECERA] = idInstalacion;
    callback({ requestHeaders });
  });

  // La primera carga la inicia esta app hacia su propia URL de inicio, así que si termina en otro
  // origen es porque **nuestro** dominio redirigió allí. Se aprende una sola vez: ver en
  // `origenes.js` por qué la regla general («confía en cualquier redirección desde un origen de
  // confianza») sería peor.
  // Se guarda el tema que la página acabó usando, para que el marco del PRÓXIMO arranque
  // nazca del color correcto. Solo lectura y a prueba de fallos: si no se puede leer, se
  // queda el que hubiera y el usuario ve, como mucho, un parpadeo.
  win.webContents.on("did-finish-load", () => {
    win.webContents
      .executeJavaScript("document.documentElement.getAttribute('data-theme')", true)
      .then((tema) => {
        if (tema !== "dark" && tema !== "light") return;
        try {
          const s = JSON.parse(fs.readFileSync(ESTADO(), "utf8"));
          if (s.theme !== tema) fs.writeFileSync(ESTADO(), JSON.stringify({ ...s, theme: tema }));
        } catch { /* aún no hay fichero de estado: lo escribirá `guardaEstado` al cerrar */ }
      })
      .catch(() => undefined);
  });

  win.webContents.once("did-navigate", (_e, url) => {
    const nuevo = confianza.aprendeDeLaPrimeraCarga(url);
    if (nuevo) console.log(`[RTG Hub] el sitio redirige a ${nuevo}; se añade a los orígenes propios`);
  });

  win.webContents.setWindowOpenHandler(({ url }) => {
    if (esNuestro(url)) return { action: "allow" };
    shell.openExternal(url);
    return { action: "deny" };
  });

  win.webContents.on("will-navigate", (e, url) => {
    if (esNuestro(url)) return;
    e.preventDefault();
    shell.openExternal(url);
  });

  // ---------------------------------------------------------------------------
  // Sin internet
  // ---------------------------------------------------------------------------
  // Se dice qué pasó y se ofrece reintentar. Una ventana en blanco con un error de Chromium
  // dentro no le dice nada a quien solo quería entrar a trabajar.
  win.webContents.on("did-fail-load", (_e, code, desc, url, esPrincipal) => {
    if (!esPrincipal || code === -3) return;   // -3 = navegación cancelada, no es un fallo
    dialog.showMessageBox(win, {
      type: "warning",
      title: "Sin conexión",
      message: "No se pudo abrir RTG Hub.",
      detail: `Revise su conexión a internet y vuelva a intentarlo.\n\n(${desc || code})\n${url}`,
      buttons: ["Reintentar", "Cerrar"],
      defaultId: 0,
      cancelId: 1,
    }).then(({ response }) => {
      if (response === 0) win.loadURL(INICIO, { userAgent: ua });
      else win.close();
    });
  });

  // Atajos mínimos, ya que no hay menú: recargar y abrir las herramientas para dar soporte.
  win.webContents.on("before-input-event", (e, input) => {
    if (input.type !== "keyDown") return;
    const k = (input.key || "").toLowerCase();
    if (k === "f5" || (input.control && k === "r")) { win.webContents.reload(); e.preventDefault(); }
    if (input.control && input.shift && k === "i") { win.webContents.toggleDevTools(); e.preventDefault(); }
  });

  // ---------------------------------------------------------------------------
  // Actualizarse sola (D-811)
  // ---------------------------------------------------------------------------
  // Se comprueba a los 15 s de abrir y cada 4 horas. La descarga va con la misma cabecera de identidad que el resto,
  // que es lo que la ruta del sitio pide para servir el instalador sin sesión (la app no tiene las cookies del hub en
  // el proceso principal). Si no hay red o la ruta no contesta, no pasa nada: se vuelve a intentar a las 4 horas.
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.requestHeaders = { [CABECERA]: idInstalacion };
  autoUpdater.on("error", (e) => console.log(`[RTG Hub] actualización: ${e && e.message ? e.message : e}`));
  autoUpdater.on("update-downloaded", (info) => {
    dialog.showMessageBox(win, {
      type: "info",
      title: "Actualización lista",
      message: `RTG Hub ${info.version} está lista.`,
      detail: "Se instala al cerrar la app. ¿Reiniciar ahora?",
      buttons: ["Reiniciar ahora", "Luego"],
      defaultId: 0,
      cancelId: 1,
    }).then(({ response }) => { if (response === 0) autoUpdater.quitAndInstall(); });
  });
  const buscaActualizacion = () => autoUpdater.checkForUpdates().catch(() => undefined);
  setTimeout(buscaActualizacion, 15_000);
  setInterval(buscaActualizacion, 4 * 60 * 60 * 1000);

  // ---------------------------------------------------------------------------
  // Volver de un corte de red sin perder el reloj de Time Tracker (D-916)
  // ---------------------------------------------------------------------------
  // El 2026-11-07 el portátil del dueño cambió de red varias veces y los latidos del cronómetro
  // dejaron de entrar 70 minutos aunque la red volvió a los pocos; la página no se enteró de que
  // había vuelto. La web ya sana sola (racha de latidos fallidos → `recuperacion.ts`), y esto es
  // el segundo cinturón desde el proceso principal, que sí ve la red: cada 30 s se mira
  // `net.isOnline()` (y al despertar del sistema), y al pasar de «sin red» a «con red» se le pide
  // a la página que sane. Sin `preload` no hay IPC: se despacha un evento `rtg:sanar` en la
  // página con `executeJavaScript`, y la página contesta dejando `window.__rtgSanarAck`. Si hay
  // quien escuche (`__rtgSanarEscucha`, lo pone el cronómetro) y en 60 s no contesta, la página
  // está muerta y se recarga sin caché: el cronómetro guarda su estado vivo en cada latido y
  // continúa la misma sesión al volver a montarse.
  vigilarRed(win);

  win.on("close", () => guardaEstado(win));
  win.on("resized", () => guardaEstado(win));
  win.on("moved", () => guardaEstado(win));
}

/** Cada cuánto se mira la red, y cuánto se le da a la página para contestar. */
const RED_CADA_MS = 30_000;
const ACK_EN_MS = 60_000;

function vigilarRed(win) {
  let enLinea = net.isOnline();
  const mirar = () => {
    if (win.isDestroyed()) return;
    const ahora = net.isOnline();
    if (ahora === enLinea) return;
    enLinea = ahora;
    console.log(`[RTG Hub] red: ${ahora ? "vuelve" : "se fue"}`);
    if (ahora) pedirSanar(win);
  };
  const temporizador = setInterval(mirar, RED_CADA_MS);
  // Al despertar la red suele tardar unos segundos en volver: se mira dos veces.
  powerMonitor.on("resume", () => { setTimeout(mirar, 5_000); setTimeout(mirar, 20_000); });
  win.on("closed", () => clearInterval(temporizador));
}

function pedirSanar(win) {
  const pedido = Date.now();
  const js = `(() => {
    try { window.__rtgSanarPedido = ${pedido}; window.dispatchEvent(new CustomEvent("rtg:sanar", { detail: { at: ${pedido} } })); } catch (e) {}
    return !!window.__rtgSanarEscucha;
  })()`;
  win.webContents.executeJavaScript(js, true)
    .then((escucha) => {
      if (!escucha) return; // no es Time Tracker: nada que sanar
      setTimeout(() => {
        if (win.isDestroyed()) return;
        win.webContents.executeJavaScript(`Number(window.__rtgSanarAck || 0) >= ${pedido}`, true)
          .then((ack) => { if (!ack) recargarSinCache(win, "sin respuesta de la página en 60 s"); })
          .catch(() => recargarSinCache(win, "la página no contesta"));
      }, ACK_EN_MS);
    })
    .catch(() => recargarSinCache(win, "no se pudo hablar con la página"));
}

function recargarSinCache(win, motivo) {
  if (win.isDestroyed()) return;
  console.log(`[RTG Hub] recarga sin caché: ${motivo}`);
  win.webContents.reloadIgnoringCache();
}
