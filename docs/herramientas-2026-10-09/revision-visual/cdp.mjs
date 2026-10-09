// Conducir Chrome por CDP sin dependencias: Node 24 trae WebSocket y fetch.
import { spawn } from "node:child_process";
import { mkdtempSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const CHROME = "C:/Program Files/Google/Chrome/Application/chrome.exe";
const PORT = 9333;
export const TIROS = join(process.env.SCRATCH ?? ".", "tiros");
mkdirSync(TIROS, { recursive: true });

const duerme = (ms) => new Promise((r) => setTimeout(r, ms));

export async function abreChrome({ ancho = 1440, alto = 900 } = {}) {
  const perfil = mkdtempSync(join(tmpdir(), "cdp-"));
  const hijo = spawn(CHROME, [
    "--headless=new", `--remote-debugging-port=${PORT}`, `--user-data-dir=${perfil}`,
    `--window-size=${ancho},${alto}`, "--disable-gpu", "--no-first-run", "--no-default-browser-check",
    "--disable-extensions", "--hide-scrollbars", "--force-device-scale-factor=1", "about:blank",
  ], { stdio: "ignore", detached: false });
  let version = null;
  for (let i = 0; i < 60 && !version; i++) {
    try { version = await (await fetch(`http://127.0.0.1:${PORT}/json/version`)).json(); } catch { await duerme(250); }
  }
  if (!version) throw new Error("Chrome no abrio el puerto de depuracion");
  const ws = new WebSocket(version.webSocketDebuggerUrl);
  await new Promise((ok, mal) => { ws.onopen = ok; ws.onerror = () => mal(new Error("ws")); });
  return new Navegador(hijo, ws, ancho, alto);
}

class Navegador {
  constructor(hijo, ws, ancho, alto) {
    this.hijo = hijo; this.ws = ws; this.n = 0; this.pendientes = new Map(); this.sucesos = [];
    this.ancho = ancho; this.alto = alto;
    ws.onmessage = (e) => {
      const m = JSON.parse(e.data);
      if (m.id && this.pendientes.has(m.id)) { const [ok, mal] = this.pendientes.get(m.id); this.pendientes.delete(m.id);
        m.error ? mal(new Error(m.error.message)) : ok(m.result); }
      else if (m.method) this.sucesos.push(m);
    };
  }
  manda(method, params = {}, sessionId) {
    const id = ++this.n;
    return new Promise((ok, mal) => {
      this.pendientes.set(id, [ok, mal]);
      this.ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
      setTimeout(() => { if (this.pendientes.has(id)) { this.pendientes.delete(id); mal(new Error("timeout " + method)); } }, 45000);
    });
  }
  async pagina(url) {
    const { targetId } = await this.manda("Target.createTarget", { url: "about:blank" });
    const { sessionId } = await this.manda("Target.attachToTarget", { targetId, flatten: true });
    const p = new Pagina(this, sessionId);
    await p.manda("Page.enable"); await p.manda("Runtime.enable");
    await p.manda("Emulation.setDeviceMetricsOverride", { width: this.ancho, height: this.alto, deviceScaleFactor: 1, mobile: false });
    if (url) await p.ve(url);
    return p;
  }
  cierra() { try { this.ws.close(); } catch {} try { this.hijo.kill(); } catch {} }
}

class Pagina {
  constructor(nav, sessionId) { this.nav = nav; this.sid = sessionId; }
  manda(m, p) { return this.nav.manda(m, p, this.sid); }
  async ve(url, esperaMs = 2500) { await this.manda("Page.navigate", { url }); await duerme(esperaMs); }
  async mide(ancho, alto) { this.nav.ancho = ancho; await this.manda("Emulation.setDeviceMetricsOverride", { width: ancho, height: alto, deviceScaleFactor: 1, mobile: false }); await duerme(400); }
  async evalua(expr) {
    const r = await this.manda("Runtime.evaluate", { expression: `(() => { try { return (${expr}); } catch (e) { return "ERROR: " + e.message; } })()`, returnByValue: true, awaitPromise: true });
    // Un fallo de SINTAXIS no pasa por el try de dentro: llega en exceptionDetails y el valor viene vacio.
    // Sin esto, un guion roto devuelve undefined y parece "la pantalla no tiene eso".
    if (r.exceptionDetails) throw new Error("JS roto: " + (r.exceptionDetails.exception?.description ?? r.exceptionDetails.text) + " || " + expr.slice(0, 120));
    return r.result?.value;
  }
  async tiro(nombre, { completa = false } = {}) {
    const r = await this.manda("Page.captureScreenshot", { format: "png", captureBeyondViewport: completa });
    const ruta = join(TIROS, nombre.endsWith(".png") ? nombre : nombre + ".png");
    writeFileSync(ruta, Buffer.from(r.data, "base64"));
    return ruta;
  }
  /** Clic real por coordenadas, para lo que React escucha en document (arrastres). */
  async raton(tipo, x, y, { boton = "left", clics = 1 } = {}) {
    await this.manda("Input.dispatchMouseEvent", { type: tipo, x, y, button: boton, clickCount: clics, buttons: tipo === "mouseMoved" ? 1 : undefined });
  }
  async arrastra(x1, y1, x2, y2) {
    await this.raton("mousePressed", x1, y1);
    for (let i = 1; i <= 8; i++) await this.raton("mouseMoved", x1 + ((x2 - x1) * i) / 8, y1);
    await this.raton("mouseReleased", x2, y2);
    await duerme(300);
  }
  espera(ms) { return duerme(ms); }
}
export { duerme };
