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

const { app, BrowserWindow, shell, Menu, dialog } = require("electron");
const path = require("node:path");
const fs = require("node:fs");
const { crearConfianza } = require("./origenes.js");

const SITIO = "https://rtg-hub.vercel.app";
const INICIO = `${SITIO}/home`;
const ORIGEN = new URL(SITIO).origin;

// Dónde se recuerda el tamaño de la ventana. En la carpeta de datos del usuario, que es la
// única que Windows garantiza escribible (junto a Program Files no lo es).
const ESTADO = () => path.join(app.getPath("userData"), "ventana.json");

function leeEstado() {
  try {
    const s = JSON.parse(fs.readFileSync(ESTADO(), "utf8"));
    if (Number.isFinite(s.width) && Number.isFinite(s.height)) return s;
  } catch { /* primera vez, o fichero roto: se usan los valores por defecto */ }
  return { width: 1280, height: 860 };
}

// ---------------------------------------------------------------------------
// El color con el que nace la ventana (D-NEXT)
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
  app.whenReady().then(crearVentana);
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

  win.on("close", () => guardaEstado(win));
  win.on("resized", () => guardaEstado(win));
  win.on("moved", () => guardaEstado(win));
}
