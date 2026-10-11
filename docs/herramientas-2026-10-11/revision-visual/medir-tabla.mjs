// Medir una tabla de la app contra la de Órdenes, que es la referencia (el dueño: «make it the style of the order table»).
// Todo lo que devuelve es medido en el navegador; nada deducido del código.
import { abreChrome } from "./cdp.mjs";

/** Lo que se pregunta de CUALQUIER pantalla con tabla, al ancho que se le diga. */
export const MEDIDA = `(() => {
  const r = {};
  const doc = document.documentElement;
  r.ventana = { ancho: innerWidth, alto: innerHeight };
  // 1) ¿la PÁGINA se desplaza a lo ancho? (lo que el dueño llama «no cabe en una pantalla»)
  r.scrollHorizontalDeLaPagina = Math.max(0, doc.scrollWidth - doc.clientWidth);
  r.scrollVerticalDeLaPagina = Math.max(0, doc.scrollHeight - doc.clientHeight);
  const t = document.querySelector('table.orders') || document.querySelector('table');
  if (!t) return JSON.stringify({ ...r, tabla: 'NO HAY TABLA' });
  const rt = t.getBoundingClientRect();
  const caja = t.parentElement;
  const rc = caja.getBoundingClientRect();
  r.tabla = { ancho: Math.round(rt.width), alto: Math.round(rt.height), arriba: Math.round(rt.top), clase: t.className };
  // 2) ¿la tabla tiene su PROPIO desplazamiento, o empuja la página?
  r.cajaDeLaTabla = { claseDelPadre: caja.className, desplazaHorizontal: caja.scrollWidth > caja.clientWidth + 1, desplazaVertical: caja.scrollHeight > caja.clientHeight + 1,
    altoVisible: Math.round(rc.height), altoDelContenido: Math.round(caja.scrollHeight) };
  // 3) ¿la cabecera se queda al desplazar?
  const th = t.querySelector('thead th');
  r.cabecera = th ? { position: getComputedStyle(th).position, top: getComputedStyle(th).top, fondo: getComputedStyle(th).backgroundColor } : 'sin th';
  // 4) densidad: alto de fila, letra, relleno — para comparar dos tablas
  const td = t.querySelector('tbody td'), tr = t.querySelector('tbody tr');
  if (td && tr) { const cs = getComputedStyle(td);
    r.densidad = { altoDeFila: Math.round(tr.getBoundingClientRect().height), letra: cs.fontSize, relleno: cs.padding, corta: cs.textOverflow, envuelve: cs.whiteSpace }; }
  r.filas = t.querySelectorAll('tbody tr').length;
  r.columnas = t.querySelectorAll('thead th').length;
  // 5) asas de redimensionar y menús de columna
  r.asas = t.querySelectorAll('.col-resizer').length;
  r.menusDeColumna = t.querySelectorAll('th button').length;
  // 6) lo que hay ENCIMA de la tabla: cuánto alto se come antes de la primera fila
  r.altoAntesDeLaTabla = Math.round(rt.top);
  r.porcentajeDePantallaAntesDeLaTabla = Math.round((rt.top / innerHeight) * 100);
  // 7) contenido que se sale de su celda (pastillas, textos)
  const fuera = [];
  for (const fila of [...t.querySelectorAll('tbody tr')].slice(0, 40))
    for (const c of fila.children) { const rcd = c.getBoundingClientRect();
      for (const h of c.children) { const rh = h.getBoundingClientRect();
        if (rh.width && rh.right > rcd.right + 1) fuera.push((h.innerText || '').trim().slice(0, 18) + ' +' + Math.round(rh.right - rcd.right) + 'px'); } }
  r.seSalenDeSuCelda = [...new Set(fuera)].slice(0, 6);
  return JSON.stringify(r);
})()`;

/** Mide una pantalla a varios anchos. Devuelve { ancho: medida }. */
export async function mideTabla(p, url, anchos = [1280, 1440]) {
  const salida = {};
  for (const ancho of anchos) {
    await p.mide(ancho, 900);
    await p.ve(url, 3000);
    await p.espera(5000);
    salida[ancho] = JSON.parse(await p.evalua(MEDIDA));
  }
  return salida;
}

/** Una captura por pantalla y ancho, con el mismo nombre en las dos, para ponerlas lado a lado. */
export async function tirosComparados(p, pantallas, anchos = [1280, 1440]) {
  const rutas = [];
  for (const ancho of anchos)
    for (const [nombre, url] of Object.entries(pantallas)) {
      await p.mide(ancho, 900);
      await p.ve(url, 3000);
      await p.espera(5000);
      rutas.push(await p.tiro(`${nombre}-${ancho}`));
    }
  return rutas;
}

export { abreChrome };
