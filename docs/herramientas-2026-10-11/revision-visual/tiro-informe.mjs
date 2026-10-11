import { abreChrome } from "./cdp.mjs";
const nav = await abreChrome({ ancho: 1440, alto: 900 });
const ruta = process.env.INFORME.split(String.fromCharCode(92)).join("/");
const p = await nav.pagina("file:///" + ruta);
await p.espera(2500);
console.log(JSON.stringify(await p.evalua("({filas: document.querySelectorAll('tbody tr').length, anchoPagina: document.documentElement.scrollWidth, ventana: innerWidth, controles: document.querySelectorAll('input,select,button,textarea').length, titulo: document.title})")));
await p.tiro("informe-tracker");
nav.cierra();
