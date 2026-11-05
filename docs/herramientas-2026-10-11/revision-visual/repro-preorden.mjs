// D-860: dirección del primer paso de una orden nueva y «Venta al mostrador». Demo en 127.0.0.1:3931.
import { abreChrome } from "./cdp.mjs";
const nav = await abreChrome();
try {
  const p = await nav.pagina("http://127.0.0.1:3931/");
  await p.espera(12000);
  const ev = (s) => p.evalua(s);
  const campos = `[...document.querySelectorAll('.modal input')].filter(i=>i.type!=='checkbox').map(i=>(i.closest('.field')?.querySelector('label')?.textContent||'?')+'='+i.value).join(' | ')`;
  await ev(`[...document.querySelectorAll('button')].find(b=>/new order|nueva orden/i.test(b.textContent))?.click()`);
  await p.espera(2000);
  await ev(`(()=>{const s=document.querySelector('.modal select');Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set.call(s,'Customer');s.dispatchEvent(new Event('change',{bubbles:true}));})()`);
  await p.espera(800);
  await ev(`(()=>{const i=document.querySelector('.modal .addr-field input');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(i,'123 Main St, McAllen, TX');i.dispatchEvent(new Event('input',{bubbles:true}));})()`);
  await p.espera(800);
  await ev(`[...document.querySelectorAll('.modal button')].find(b=>/Next|Siguiente/.test(b.textContent)).click()`);
  await p.espera(1500);
  console.log("tras Siguiente:", await ev(campos));
  await ev(`(()=>{const f=[...document.querySelectorAll('.modal .field')].find(f=>/^Account/.test(f.querySelector('label')?.textContent||''));const i=f.querySelector('input');i.focus();Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(i,'Ve');i.dispatchEvent(new Event('input',{bubbles:true}));})()`);
  await p.espera(800);
  console.log("botones:", await ev(`[...document.querySelectorAll('.modal button')].map(b=>b.textContent.trim()).filter(t=>/mostrador|counter|walk/i.test(t)).join(' / ')`));
  await ev(`(()=>{const b=[...document.querySelectorAll('.modal button')].find(b=>/mostrador|counter|walk/i.test(b.textContent));b.dispatchEvent(new MouseEvent('mousedown',{bubbles:true,cancelable:true}));})()`);
  await p.espera(1000);
  console.log("tras mostrador:", await ev(campos));
} catch (e) { console.log("ERR", e.message); }
nav.cierra(); process.exit(0);
