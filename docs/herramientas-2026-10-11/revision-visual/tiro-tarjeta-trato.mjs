import { abreChrome } from "./cdp.mjs";
const nav = await abreChrome({ ancho: 1440, alto: 1000 });
try {
  const p = await nav.pagina("http://127.0.0.1:4123/customers");
  await p.espera(15000);
  console.log("abre", await p.evalua("(() => { const f = document.querySelector('tbody tr td'); if (!f) return 'sin filas'; f.scrollIntoView(); f.click(); return 'ok'; })()"));
  await p.espera(8000);
  console.log("filas", await p.evalua("document.querySelectorAll('[data-abre-trato]').length"));
  await p.evalua("(() => { const b = document.querySelector('[data-clase=orden] [data-abre-trato]'); b.scrollIntoView(); b.click(); return 1; })()");
  await p.espera(15000);
  console.log("orden", await p.evalua("JSON.stringify({url: location.pathname, modal: !!document.querySelector('.overlay .modal h3'), titulo: document.querySelector('.overlay .modal h3')?.textContent, enlace: document.querySelector('[data-enlace-aparte]')?.textContent})"));
  await p.evalua("(() => { document.querySelector('[data-enlace-aparte]').scrollIntoView({block:'center'}); return 1; })()");
  await p.tiro("orden-en-tarjeta-pie");
  await p.evalua("(() => { document.querySelector('[data-enlace-aparte]').closest('.overlay').scrollTop = 0; return 1; })()");
  await p.tiro("orden-en-tarjeta");
  await p.evalua("(() => { const m = document.querySelector('[data-enlace-aparte]').closest('.modal'); const x=[...m.querySelectorAll('button')].find(b=>b.textContent.trim()==='✕'||b.textContent.trim()==='×'); x.click(); return x ? 1 : 0; })()");
  await p.espera(3000);
  console.log("tras cerrar", await p.evalua("JSON.stringify({ordenAbierta: !!document.querySelector('[data-enlace-aparte]'), filas: document.querySelectorAll('[data-abre-trato]').length})"));
  await p.evalua("(() => { const b = document.querySelector('[data-clase=cotizacion] [data-abre-trato]'); b.scrollIntoView(); b.click(); return 1; })()");
  await p.espera(8000);
  console.log("coti", await p.evalua("JSON.stringify({hoja: !!document.querySelector('.tarjeta-cotizacion .hoja-cliente'), enlace: document.querySelector('[data-abrir-en-cotizador]')?.textContent})"));
  await p.tiro("cotizacion-en-tarjeta");
} finally { nav.cierra(); }
