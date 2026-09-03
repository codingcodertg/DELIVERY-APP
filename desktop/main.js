"use strict";

// ============================================================
// RDZ Hub — ventana de escritorio para Windows (D-166).
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

const SITIO = "https://deliveries-app-seven.vercel.app";
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

function guardaEstado(win) {
  try {
    if (win.isDestroyed() || win.isMinimized()) return;
    const b = win.getBounds();
    fs.writeFileSync(ESTADO(), JSON.stringify({ ...b, maximized: win.isMaximized() }));
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
    title: "RDZ Hub",
    backgroundColor: "#0f151d",
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
  const ua = `${win.webContents.getUserAgent()} RDZHub/${app.getVersion()}`;
  win.webContents.setUserAgent(ua);

  win.loadURL(INICIO, { userAgent: ua });

  // ---------------------------------------------------------------------------
  // Nada sale de esta ventana salvo lo que no es nuestro
  // ---------------------------------------------------------------------------
  // Un enlace a Google Maps, a una factura o a cualquier sitio de fuera abre en el navegador
  // del sistema. Si se abriera aquí dentro, la persona se quedaría sin forma de volver: esta
  // ventana no tiene barra de direcciones ni botón de atrás.
  const esNuestro = (u) => {
    try { return new URL(u).origin === ORIGEN; } catch { return false; }
  };

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
      message: "No se pudo abrir RDZ Hub.",
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
