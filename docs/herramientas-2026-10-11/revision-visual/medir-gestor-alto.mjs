import { abreChrome } from "./cdp.mjs";
const fase = process.argv[2] ?? "antes";
const tam = [[1920,1080],[1440,900],[1366,768],[390,844]];
const rutas = (process.argv[3] ?? "/routes").split(",");
const nav = await abreChrome({ ancho: 1920, alto: 1080 });
for (const ruta of rutas) for (const [w,h] of tam) {
  const p = await nav.pagina("http://127.0.0.1:3947" + ruta);
  await p.mide(w,h); await p.espera(7000);
  const r = await p.evalua(`(() => {
    window.scrollTo(0, 1e6);
    const H = document.documentElement.scrollHeight, V = innerHeight;
    const wrap = document.querySelector('.wrap'); const ws = wrap && getComputedStyle(wrap);
    const kids = wrap ? [...wrap.children].filter(e => e.offsetHeight>0) : [];
    const last = kids[kids.length-1]; const lr = last && last.getBoundingClientRect();
    const ver = [...document.querySelectorAll('body *')].find(e => /^v1\.\d+/.test((e.textContent||'').trim()) && e.children.length===0);
    const vr = ver && ver.getBoundingClientRect();
    const av = [...document.querySelectorAll('button,a')].find(e => /avisos ocultos/.test(e.textContent||''));
    const ar = av && av.getBoundingClientRect();
    const sy = scrollY;
    return { H, V, scrollY: sy, wrapPb: ws && ws.paddingBottom, wrapBottom: wrap && wrap.getBoundingClientRect().bottom + sy,
      lastCls: last && last.className.slice(0,60), lastBottom: lr && lr.bottom + sy,
      avisos: ar && [ar.top+sy, ar.bottom+sy], version: vr && [vr.top+sy, vr.bottom+sy, ver.parentElement.className.slice(0,40)],
      finContenido: Math.round(Math.max(...[...wrap.querySelectorAll('*')].map(e => { const b = e.getBoundingClientRect(); return b.height > 0 && b.width > 0 ? b.bottom : 0; })) + sy),
      vacioAbajo: Math.round(H - (Math.max(...[...wrap.querySelectorAll('*')].map(e => { const b = e.getBoundingClientRect(); return b.height > 0 && b.width > 0 ? b.bottom : 0; })) + sy)),
      vacioTrasVersion: vr ? Math.round(H - (vr.bottom + sy)) : null,
      mapa: (document.querySelector('[data-mapa-del-gestor]') || {}).offsetHeight,
      hueco: getComputedStyle(document.documentElement).getPropertyValue('--hueco-de-ayuda') };
  })()`);
  console.log(ruta, w+"x"+h, JSON.stringify(r));
  await p.evalua("window.scrollTo(0, 1e6)"); await p.espera(300);
  await p.tiro(`${fase}${ruta.replace(/\//g,"_")}-${w}x${h}`);
}
nav.cierra();
