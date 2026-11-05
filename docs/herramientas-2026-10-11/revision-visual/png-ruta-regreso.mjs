// D-863: ¿la foto «📸 PNG» de la ruta lleva la fila «🏠 Base: regreso» con su hora? Guarda la tabla fotografiada y la
// pantalla. Uso: SCRATCH=<carpeta> ETIQUETA=antes node png-ruta-regreso.mjs
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { abreChrome, TIROS } from "./cdp.mjs";
const URL_ = process.env.URL_APP ?? "http://127.0.0.1:3931/routes";
const ETIQUETA = process.env.ETIQUETA ?? "tiro";
const nav = await abreChrome({ ancho: 1440, alto: 900 });
try {
  const p = await nav.pagina(URL_);
  await p.espera(12000);
  const n = await p.evalua("document.querySelectorAll('[data-png-de-la-ruta]').length");
  console.log("botones PNG:", n);
  for (let i = 0; i < Math.min(n, 3); i++) {
    await p.evalua(`(() => { const b = document.querySelectorAll('[data-png-de-la-ruta]')[${i}]; b.scrollIntoView({block:'center'}); b.click(); return 1; })()`);
    await p.espera(6000);
    const r = await p.evalua(`(() => {
      const key = document.querySelectorAll('[data-png-de-la-ruta]')[${i}].getAttribute('data-png-de-la-ruta');
      const t = document.querySelector('[data-tabla-de-la-ruta="' + CSS.escape(key) + '"]');
      const img = document.querySelector('[data-tabla-en-la-foto]');
      const caja = t && t.parentElement;
      const hora = t && t.querySelector('[data-hora-de-la-base="regreso"]');
      return JSON.stringify({ key, altoTabla: t && t.offsetHeight, altoCaja: caja && caja.clientHeight, horaRegreso: hora && hora.textContent,
        img: img ? { w: img.naturalWidth, h: img.naturalHeight } : null, src: img ? img.src : null });
    })()`);
    const o = JSON.parse(r);
    if (o.src) writeFileSync(join(TIROS, `${ETIQUETA}-tabla-${i}.png`), Buffer.from(o.src.split(",")[1], "base64"));
    delete o.src; console.log(i, JSON.stringify(o));
    await p.tiro(`${ETIQUETA}-cuadro-${i}`);
    await p.evalua(`(() => { const o = document.querySelector('[data-foto-de-la-ruta]'); o && o.click(); return 1; })()`);
    await p.espera(800);
  }
} finally { nav.cierra(); }
