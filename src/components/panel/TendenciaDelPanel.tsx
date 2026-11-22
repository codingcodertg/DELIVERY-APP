"use client";

// La tendencia del periodo (D-1127): arriba, cuántas entregas por día (clientes y traslados apilados); abajo, el % a
// tiempo. Dos gráficas con el MISMO eje de fechas, no una con dos escalas: así ninguna inventa una relación con la otra.
// Pasar el cursor (o las flechas del teclado) enseña los números de ese día; «Ver tabla» los da todos sin cursor.
import { useEffect, useMemo, useRef, useState } from "react";
import { usePrefs } from "@/lib/prefs";
import { TablaEstandar } from "@/components/TablaEstandar";
import type { Cubeta, Grano } from "@/lib/panel-resumen";

const MESES_EN = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const MESES_ES = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];

/** Un tope «redondo» para el eje (0, 5, 10… / 0, 20, 40…) y sus marcas. */
export function ejeRedondo(max: number): { tope: number; marcas: number[] } {
  if (max <= 0) return { tope: 4, marcas: [0, 2, 4] };
  const bruto = max / 4;
  const pot = Math.pow(10, Math.floor(Math.log10(bruto)));
  const paso = [1, 2, 2.5, 5, 10].map((m) => m * pot).find((p) => p >= bruto) ?? 10 * pot;
  const pasoEntero = Math.max(1, Math.ceil(paso));
  const tope = Math.ceil(max / pasoEntero) * pasoEntero;
  const marcas: number[] = [];
  for (let v = 0; v <= tope; v += pasoEntero) marcas.push(v);
  return { tope, marcas };
}

/** Columna con la punta redondeada (4 px) y la base recta. */
const columna = (x: number, y: number, w: number, h: number, redonda: boolean) => {
  const r = redonda ? Math.min(4, w / 2, h) : 0;
  return `M${x} ${y + h}V${y + r}Q${x} ${y} ${x + r} ${y}H${x + w - r}Q${x + w} ${y} ${x + w} ${y + r}V${y + h}Z`;
};

export function TendenciaDelPanel({ cubetas, grano }: { cubetas: readonly Cubeta[]; grano: Grano }) {
  const { lang, t } = usePrefs();
  const caja = useRef<HTMLDivElement>(null);
  const [ancho, setAncho] = useState(900);
  const [i, setI] = useState<number | null>(null);
  const [tabla, setTabla] = useState(false);
  const hayEntregas = cubetas.some((c) => c.entregadas > 0);
  useEffect(() => {
    const el = caja.current;
    if (!el) return;
    const mide = () => setAncho(Math.max(280, el.clientWidth));
    mide();
    const ro = new ResizeObserver(mide);
    ro.observe(el);
    return () => ro.disconnect();
  }, [tabla, hayEntregas]);

  const meses = lang === "es" ? MESES_ES : MESES_EN;
  const etiqueta = (iso: string, larga = false) => {
    const [y, m, d] = iso.split("-").map(Number);
    if (grano === "mes") return `${meses[m - 1]} ${y}`;
    const base = `${d} ${meses[m - 1]}`;
    return grano === "semana" && larga ? t(`Week of ${base}`, `Semana del ${base}`) : base;
  };
  const porGrano = grano === "dia" ? t("per day", "por día") : grano === "semana" ? t("per week", "por semana") : t("per month", "por mes");

  const n = cubetas.length;
  const g = useMemo(() => {
    const izq = 44, der = 48, altoV = 170, altoP = 84, hueco = 34, arriba = 18, ejeX = 22;
    const w = Math.max(10, ancho - izq - der);
    const banda = n ? w / n : w;
    const grosor = Math.max(2, Math.min(24, banda * 0.66));
    const eje = ejeRedondo(Math.max(0, ...cubetas.map((c) => c.clientes + c.traslados)));
    const yV = (v: number) => arriba + altoV - (v / eje.tope) * altoV;
    const y0P = arriba + altoV + hueco;
    const yP = (v: number) => y0P + altoP - (v / 100) * altoP;
    const cx = (k: number) => izq + banda * (k + 0.5);
    const cada = Math.max(1, Math.ceil(52 / banda));
    return { izq, der, altoV, altoP, arriba, w, banda, grosor, eje, yV, y0P, yP, cx, cada, alto: y0P + altoP + ejeX };
  }, [ancho, n, cubetas]);

  const tramos = useMemo(() => {
    // La línea se corta donde no hay dato (un día sin entregas no tiene «% a tiempo»).
    const out: string[] = [];
    let actual = "";
    cubetas.forEach((c, k) => {
      if (c.aTiempoPct == null) { if (actual) out.push(actual); actual = ""; return; }
      actual += `${actual ? "L" : "M"}${g.cx(k).toFixed(1)} ${g.yP(c.aTiempoPct).toFixed(1)} `;
    });
    if (actual) out.push(actual);
    return out;
  }, [cubetas, g]);
  const ultimo = (() => { for (let k = n - 1; k >= 0; k--) if (cubetas[k].aTiempoPct != null) return k; return -1; })();

  const mueve = (e: React.PointerEvent<SVGSVGElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - r.left - g.izq;
    setI(n ? Math.max(0, Math.min(n - 1, Math.floor(x / g.banda))) : null);
  };
  const tecla = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowRight") { e.preventDefault(); setI((v) => Math.min(n - 1, (v ?? -1) + 1)); }
    else if (e.key === "ArrowLeft") { e.preventDefault(); setI((v) => Math.max(0, (v ?? n) - 1)); }
    else if (e.key === "Escape") setI(null);
  };
  const sel = i != null ? cubetas[i] : null;
  const globoIzq = i != null ? Math.min(Math.max(8, g.cx(i) + 12), Math.max(8, ancho - 180)) : 0;

  return (
    <div className="card" data-panel-tendencia>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 8, marginBottom: 8 }}>
        <h3 style={{ margin: 0 }}>{t("Deliveries and punctuality", "Entregas y puntualidad")} <span className="hint" style={{ margin: 0, fontWeight: 500 }}>· {porGrano}</span></h3>
        <div style={{ display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap" }}>
          <span className="panel-leyenda">
            <span><i className="muestra" style={{ background: "var(--viz-1)" }} />{t("Customer deliveries", "Entregas a clientes")}</span>
            <span><i className="muestra" style={{ background: "var(--viz-2)" }} />{t("Store transfers", "Traslados entre tiendas")}</span>
          </span>
          <button className="btn btn-ghost btn-sm" onClick={() => setTabla((v) => !v)} aria-pressed={tabla}>{tabla ? t("See chart", "Ver gráfica") : t("See table", "Ver tabla")}</button>
        </div>
      </div>

      {!hayEntregas ? (
        <div className="empty">{t("No deliveries in this range.", "Sin entregas en este rango.")}</div>
      ) : tabla ? (
        <TablaEstandar id="dash-tendencia" sinCaja data-tabla="dash-tendencia" filas={cubetas} claveDe={(c) => c.inicio}
          columnas={[
            { key: "fecha", en: "Date", es: "Fecha", ancho: 150, fija: true, valor: (c) => c.inicio, celda: (c) => <b>{etiqueta(c.inicio, true)}</b>, etiqueta: (v) => etiqueta(String(v), true) },
            { key: "clientes", en: "Customer deliveries", es: "Entregas a clientes", ancho: 160, numerico: true, valor: (c) => c.clientes },
            { key: "traslados", en: "Store transfers", es: "Traslados", ancho: 120, numerico: true, valor: (c) => c.traslados },
            { key: "total", en: "Total delivered", es: "Total entregadas", ancho: 140, numerico: true, valor: (c) => c.entregadas },
            { key: "atiempo", en: "On time", es: "A tiempo", ancho: 110, numerico: true, valor: (c) => c.aTiempoPct, celda: (c) => (c.aTiempoPct == null ? "—" : `${c.aTiempoPct}%`) },
            { key: "canceladas", en: "Canceled", es: "Canceladas", ancho: 110, numerico: true, valor: (c) => c.canceladas },
            { key: "pallets", en: "Pallets", es: "Pallets", ancho: 100, numerico: true, valor: (c) => c.pallets },
          ]} />
      ) : (
        <div className="panel-grafica" ref={caja} tabIndex={0} onKeyDown={tecla} onBlur={() => setI(null)}
          aria-label={t("Deliveries and on-time rate over the period. Use the left and right arrow keys to read each date.", "Entregas y puntualidad en el periodo. Use las flechas izquierda y derecha para leer cada fecha.")}>
          <svg height={g.alto} viewBox={`0 0 ${ancho} ${g.alto}`} onPointerMove={mueve} onPointerLeave={() => setI(null)} role="img" aria-hidden>
            {/* --- Entregas --- */}
            <text className="titulo" x={g.izq} y={11}>{t("Deliveries", "Entregas")}</text>
            {g.eje.marcas.map((v) => (
              <g key={v}>
                <line className={v === 0 ? "base" : "guia"} x1={g.izq} x2={g.izq + g.w} y1={g.yV(v)} y2={g.yV(v)} />
                <text className="eje" x={g.izq - 6} y={g.yV(v) + 4} textAnchor="end">{v}</text>
              </g>
            ))}
            {cubetas.map((c, k) => {
              const x = g.cx(k) - g.grosor / 2;
              const hC = (c.clientes / g.eje.tope) * g.altoV, hT = (c.traslados / g.eje.tope) * g.altoV;
              const sep = hC > 0 && hT > 0 ? 2 : 0;
              const apagada = i != null && i !== k ? " apagada" : "";
              return (
                <g key={c.inicio}>
                  {hC > 0 && <path className={"s1" + apagada} d={columna(x, g.yV(c.clientes), g.grosor, hC, hT === 0)} />}
                  {hT > 0 && <path className={"s2" + apagada} d={columna(x, g.yV(c.clientes + c.traslados), g.grosor, Math.max(1, hT - sep), true)} />}
                </g>
              );
            })}

            {/* --- % a tiempo --- */}
            <text className="titulo" x={g.izq} y={g.y0P - 12}>{t("On time (within its window)", "A tiempo (en su ventana)")}</text>
            {[0, 50, 100].map((v) => (
              <g key={v}>
                <line className={v === 0 ? "base" : "guia"} x1={g.izq} x2={g.izq + g.w} y1={g.yP(v)} y2={g.yP(v)} />
                <text className="eje" x={g.izq - 6} y={g.yP(v) + 4} textAnchor="end">{v}%</text>
              </g>
            ))}
            {tramos.map((d, k) => <path key={k} className="linea" d={d.trim()} />)}
            {cubetas.map((c, k) => (c.aTiempoPct == null ? null : (
              (n <= 40 || k === ultimo || k === i) && <circle key={c.inicio} className="punto" cx={g.cx(k)} cy={g.yP(c.aTiempoPct)} r={k === i ? 5 : 4} />
            )))}
            {ultimo >= 0 && i == null && (
              <text className="valor-final" x={g.cx(ultimo) + 8} y={g.yP(cubetas[ultimo].aTiempoPct as number) + 4}>{cubetas[ultimo].aTiempoPct}%</text>
            )}

            {/* --- Fechas (una sola fila, compartida) --- */}
            {cubetas.map((c, k) => (k % g.cada === 0 ? (
              <text key={c.inicio} className="eje" x={g.cx(k)} y={g.alto - 6} textAnchor="middle">{etiqueta(c.inicio)}</text>
            ) : null))}

            {i != null && <line className="mira" x1={g.cx(i)} x2={g.cx(i)} y1={g.arriba} y2={g.y0P + g.altoP} />}
          </svg>
          {sel && (
            <div className="panel-globo" style={{ left: globoIzq }} role="status">
              <div className="fecha">{etiqueta(sel.inicio, true)}</div>
              <div className="renglon"><span><i className="raya" style={{ background: "var(--viz-1)" }} />{t("Customers", "Clientes")}</span><b>{sel.clientes}</b></div>
              <div className="renglon"><span><i className="raya" style={{ background: "var(--viz-2)" }} />{t("Transfers", "Traslados")}</span><b>{sel.traslados}</b></div>
              <div className="renglon"><span>{t("Total delivered", "Total entregadas")}</span><b>{sel.entregadas}</b></div>
              <div className="renglon"><span>{t("On time", "A tiempo")}</span><b>{sel.aTiempoPct == null ? "—" : `${sel.aTiempoPct}%`}</b></div>
              {sel.canceladas > 0 && <div className="renglon"><span>{t("Canceled", "Canceladas")}</span><b>{sel.canceladas}</b></div>}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
