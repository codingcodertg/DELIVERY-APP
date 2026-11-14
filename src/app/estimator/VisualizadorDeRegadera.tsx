"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { usePrefs } from "@/lib/prefs";
import { AJUSTES_POR_DEFECTO, ENTRADAS_POR_DEFECTO, DISPOSICIONES, TAMANOS_DE_LOSETA, calcular, type Disposicion, type EntradasCalculadora, type AjustesCalculadora } from "@/lib/estimator/calculadora-material";
import { leeGuardado } from "@/lib/estimator/calculadora-guardado";
import { CAPAS, ORDEN_DE_INSTALACION, capaDe, type IdCapa } from "@/lib/estimator/visualizador/capas";
import { dimensionesDeLaEscena, PATRONES, type Patron } from "@/lib/estimator/visualizador/geometria";
import { ESPEC_POR_DEFECTO, JUNTAS_IN, LECHADAS, PRESETS, type ColorLechada, type EspecLoseta, type FuenteLoseta } from "@/lib/estimator/visualizador/texturas";
import { EscenaRegadera, type EntradaEscena, type FotoSuperficie, type SuperficieId } from "@/lib/estimator/visualizador/escena";
import type { TamanoDeLoseta } from "@/lib/estimator/calculadora-material";

type Override = { largoFt: number; anchoFt: number; altoFt: number; disposicion: Disposicion };

const SUPERFICIES: { id: SuperficieId; en: string; es: string }[] = [
  { id: "pared", en: "Wall tile", es: "Azulejo de pared" },
  { id: "piso", en: "Floor tile", es: "Loseta de piso" },
  { id: "salpicadero", en: "Backsplash", es: "Salpicadero" },
];

const PATRON_ES: Record<Patron, { en: string; es: string }> = {
  apilado: { en: "Stacked (straight)", es: "A plomo (apilado)" },
  medio: { en: "1/2 offset", es: "Medio desfase (1/2)" },
  tercio: { en: "1/3 offset", es: "Un tercio (1/3)" },
};

const DISP_ES: Record<Disposicion, { en: string; es: string }> = {
  "2 Walls": { en: "2 walls", es: "2 paredes" },
  "3 Walls": { en: "3 walls", es: "3 paredes" },
  "4 Walls": { en: "4 walls", es: "4 paredes" },
};

/** Fracción de pulgada para las juntas: 0.125 → «1/8». */
function fraccion(pulg: number): string {
  const mapa: Record<string, string> = { "0.0625": "1/16", "0.125": "1/8", "0.1875": "3/16", "0.25": "1/4" };
  return mapa[String(pulg)] ?? `${pulg}`;
}

export default function VisualizadorDeRegadera() {
  const { t, lang } = usePrefs();

  // Medidas: las que el vendedor capturó en la calculadora (mismo navegador), o las de por defecto.
  const [calc, setCalc] = useState<{ entradas: EntradasCalculadora; ajustes: AjustesCalculadora }>({
    entradas: ENTRADAS_POR_DEFECTO, ajustes: AJUSTES_POR_DEFECTO,
  });
  const [override, setOverride] = useState<Override | null>(null);
  const [espec, setEspec] = useState(ESPEC_POR_DEFECTO);
  const [fotos, setFotos] = useState<Partial<Record<SuperficieId, FotoSuperficie>>>({});
  const urlsFotos = useRef<string[]>([]);
  const fotoId = useRef(0);

  // Capas y paso.
  const [visibles, setVisibles] = useState<Set<IdCapa>>(() => new Set(ORDEN_DE_INSTALACION));
  const [paso, setPaso] = useState<number>(ORDEN_DE_INSTALACION.length);
  const [seleccion, setSeleccion] = useState<IdCapa | null>(null);
  const [corte, setCorte] = useState(false);
  const [reproduciendo, setReproduciendo] = useState(false);
  const [copiado, setCopiado] = useState<"ok" | "error" | null>(null);

  const contenedor = useRef<HTMLDivElement>(null);
  const escenaRef = useRef<EscenaRegadera | null>(null);
  const [escenaLista, setEscenaLista] = useState(false);

  useEffect(() => {
    const g = leeGuardado();
    setCalc(g);
    // La pendiente de mortero va apagada si la calculadora la deja fuera (ajuste C33 = 0). Se puede prender a mano.
    setVisibles((prev) => {
      const n = new Set(prev);
      if (g.ajustes.preslopeIncluido === 1) n.add("base-mortero"); else n.delete("base-mortero");
      return n;
    });
  }, []);

  // Escena: se crea al montar (con su propio canvas, para que el modo estricto no reuse un contexto perdido).
  useEffect(() => {
    const host = contenedor.current;
    if (!host) return;
    const canvas = document.createElement("canvas");
    canvas.style.width = "100%";
    canvas.style.height = "100%";
    canvas.style.display = "block";
    canvas.setAttribute("aria-label", t("3D shower view", "Vista 3D de la regadera"));
    host.appendChild(canvas);
    let escena: EscenaRegadera | null = null;
    try {
      escena = new EscenaRegadera(canvas);
    } catch {
      canvas.remove();
      setEscenaLista(false);
      return;
    }
    escenaRef.current = escena;
    setEscenaLista(true);
    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(() => escena?.redimensiona()) : null;
    ro?.observe(host);
    return () => {
      ro?.disconnect();
      escena?.dispose();
      escenaRef.current = null;
      canvas.remove();
    };
    // Una sola vez por montaje: el resto de cambios entran por `actualiza` y `pon`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const urls = urlsFotos.current;
    return () => { for (const u of urls) URL.revokeObjectURL(u); };
  }, []);

  const { entradas, ajustes } = calc;
  const dims = useMemo(() => dimensionesDeLaEscena({
    proyecto: entradas.proyecto,
    disposicion: override?.disposicion ?? entradas.disposicion,
    largoFt: override?.largoFt ?? entradas.largoFt,
    anchoFt: override?.anchoFt ?? entradas.anchoFt,
    altoFt: override?.altoFt ?? entradas.altoFt,
  }), [entradas, override]);

  const resultado = useMemo(() => calcular(entradas, ajustes), [entradas, ajustes]);

  const entrada: EntradaEscena = useMemo(() => ({
    dims,
    espec,
    fotos,
    morteroIn: entradas.morteroProfundidadIn,
    preslopeIn: ajustes.preslopePromedioIn,
    subidaIn: entradas.subidaLinerIn,
    tornillosPorTablero: ajustes.tornillosPorTablero,
    tableroAnchoFt: ajustes.tableroAnchoLf,
    tableroAltoFt: ajustes.tableroAltoFt,
    salpicaderoLargoFt: entradas.salpicaderoLargoFt,
    salpicaderoAltoFt: entradas.salpicaderoAltoFt,
  }), [dims, espec, fotos, entradas, ajustes]);

  // Reconstruye la escena cuando cambian medidas o losetas.
  useEffect(() => {
    if (escenaLista) escenaRef.current?.actualiza(entrada);
  }, [entrada, escenaLista]);

  // Visibilidad, paso, selección y corte: sin reconstruir.
  useEffect(() => {
    escenaRef.current?.pon({ visibles, paso, seleccion, corte });
  }, [visibles, paso, seleccion, corte, escenaLista]);

  // Paso a paso automático.
  useEffect(() => {
    if (!reproduciendo) return;
    const id = window.setInterval(() => {
      setPaso((p) => {
        if (p >= ORDEN_DE_INSTALACION.length) { setReproduciendo(false); return p; }
        return p + 1;
      });
    }, 700);
    return () => window.clearInterval(id);
  }, [reproduciendo]);

  const total = ORDEN_DE_INSTALACION.length;
  const ultimaPuesta = paso > 0 ? capaDe(ORDEN_DE_INSTALACION[paso - 1]) : null;
  const seleccionada = seleccion ? capaDe(seleccion) : null;
  const seleccionPuesta = seleccion ? ORDEN_DE_INSTALACION.indexOf(seleccion) < paso : true;
  const fmt = useMemo(() => new Intl.NumberFormat(lang === "es" ? "es-US" : "en-US", { maximumFractionDigits: 1 }), [lang]);

  const cambiaEspec = (id: SuperficieId, cambio: Partial<EspecLoseta>) =>
    setEspec((e) => ({ ...e, [id]: { ...e[id], ...cambio } }));

  const subeFoto = (id: SuperficieId, archivo: File) => {
    const url = URL.createObjectURL(archivo);
    urlsFotos.current.push(url);
    const img = new Image();
    img.onload = () => {
      fotoId.current += 1;
      const numero = fotoId.current;
      setFotos((f) => ({ ...f, [id]: { id: numero, img } }));
      cambiaEspec(id, { fuente: "foto" });
    };
    img.src = url;
  };

  const quitaFoto = (id: SuperficieId) => {
    setFotos((f) => { const n = { ...f }; delete n[id]; return n; });
    cambiaEspec(id, { fuente: "marmol-blanco" });
  };

  const alternaCapa = (id: IdCapa) => {
    setVisibles((prev) => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id); else n.add(id);
      return n;
    });
  };

  const tomaFoto = async () => {
    const blob = await escenaRef.current?.fotoPng();
    if (!blob) { setCopiado("error"); window.setTimeout(() => setCopiado(null), 2500); return; }
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    const hoy = new Date().toISOString().slice(0, 10);
    a.href = url;
    a.download = `regadera-${hoy}.png`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 4000);
    setCopiado("ok");
    window.setTimeout(() => setCopiado(null), 2500);
  };

  const medidas = override ?? { largoFt: entradas.largoFt, anchoFt: entradas.anchoFt, altoFt: entradas.altoFt, disposicion: entradas.disposicion };

  return (
    <div className="vis-wrap" data-visualizador>
      <div className="card calc-intro">
        <h2>🚿 {t("Shower visualizer", "Visualizador de regadera")}</h2>
        <p className="hint" style={{ margin: 0 }}>
          {t("Shows how the shower is built, layer by layer, and lets the customer pick the tile. Sizes come from the Material calculator.",
            "Muestra cómo se arma la regadera, capa por capa, y deja que el cliente escoja la loseta. Las medidas vienen de la calculadora de material.")}
        </p>
        <p className="hint" style={{ margin: "6px 0 0" }}>
          <b>{t("Dimensions", "Medidas")}:</b>{" "}
          {override ? t("local override (not saved)", "medidas locales (no se guardan)") : t("from the calculator", "de la calculadora")}
          {" · "}{fmt.format(dims.largoFt)} × {fmt.format(dims.anchoFt)} × {fmt.format(dims.altoFt)} ft · {t(DISP_ES[dims.disposicion].en, DISP_ES[dims.disposicion].es)}
        </p>
        {dims.avisos.length > 0 && (
          <p className="hint vis-aviso">{t("A dimension is 0 or missing; it is drawn at 1 ft.", "Una medida está en 0 o vacía; se dibuja a 1 ft.")}</p>
        )}
      </div>

      <div className="vis-grid">
        <div className="vis-columna-escena">
          <div className="card vis-tarjeta-escena">
            <div className="vis-lienzo" ref={contenedor} />
            {!escenaLista && (
              <p className="hint vis-aviso">{t("This browser cannot show 3D (WebGL is off).", "Este navegador no muestra 3D (WebGL está apagado).")}</p>
            )}
            <div className="vis-botones">
              <button type="button" className="btn btn-sm btn-ghost" onClick={() => escenaRef.current?.resetVista()}>
                ↺ {t("Reset view", "Restablecer vista")}
              </button>
              <button type="button" className="btn btn-sm" aria-pressed={corte} onClick={() => setCorte((c) => !c)}>
                ✂️ {corte ? t("Cutaway: on", "Corte: sí") : t("Cutaway", "Corte")}
              </button>
              <button type="button" className="btn btn-sm btn-primary" onClick={() => void tomaFoto()}>
                📷 {t("Take picture", "Tomar foto")}
              </button>
              <span className="hint" role="status" aria-live="polite">
                {copiado === "ok" ? t("Picture saved.", "Foto guardada.")
                  : copiado === "error" ? t("Could not take the picture.", "No se pudo tomar la foto.") : ""}
              </span>
            </div>

            <div className="vis-paso">
              <label htmlFor="vis-paso">
                {t("Build step by step", "Construir paso a paso")}:{" "}
                <b>{paso === 0 ? t("nothing yet", "nada todavía") : t(`${paso} of ${total}`, `${paso} de ${total}`)}</b>
                {ultimaPuesta && <span className="hint"> · {t("last: ", "última: ")}{lang === "es" ? ultimaPuesta.nombre.es : ultimaPuesta.nombre.en}</span>}
              </label>
              <div className="vis-paso-controles">
                <button type="button" className="btn btn-sm btn-ghost" onClick={() => {
                  if (paso >= total) setPaso(0);
                  setReproduciendo((r) => !r);
                }}>
                  {reproduciendo ? `⏸ ${t("Pause", "Pausa")}` : `▶ ${t("Play", "Reproducir")}`}
                </button>
                <input id="vis-paso" type="range" min={0} max={total} step={1} value={paso}
                  onChange={(e) => { setReproduciendo(false); setPaso(Number(e.target.value)); }} />
              </div>
            </div>
          </div>

          <div className="card vis-tarjeta-capa">
            <h3>{t("Layers", "Capas")}</h3>
            {seleccionada ? (
              <div className="vis-detalle" style={{ borderColor: seleccionada.color }}>
                <b>{seleccionada.numero ?? "—"} · {lang === "es" ? seleccionada.nombre.es : seleccionada.nombre.en}</b>
                <span>{lang === "es" ? seleccionada.que.es : seleccionada.que.en}</span>
                {!seleccionPuesta && (
                  <span className="hint">{t("Not built yet at this step.", "Todavía no está puesta en este paso.")}</span>
                )}
              </div>
            ) : (
              <p className="hint" style={{ margin: 0 }}>{t("Tap a layer to see what it does and highlight it.", "Toca una capa para ver qué hace y resaltarla.")}</p>
            )}
            <ol className="vis-capas">
              {CAPAS.map((c) => {
                const vis = visibles.has(c.id);
                return (
                  <li key={c.id} className={"vis-capa" + (seleccion === c.id ? " vis-capa-activa" : "")}>
                    <button type="button" className="vis-capa-nombre" aria-pressed={seleccion === c.id}
                      onClick={() => setSeleccion((s) => (s === c.id ? null : c.id))}>
                      <span className="vis-num" style={{ background: c.color }}>{c.numero ?? "·"}</span>
                      <span>{lang === "es" ? c.nombre.es : c.nombre.en}</span>
                    </button>
                    <label className="vis-capa-ver">
                      <input type="checkbox" checked={vis} onChange={() => alternaCapa(c.id)} />
                      {vis ? t("Show", "Ver") : t("Hidden", "Oculta")}
                    </label>
                  </li>
                );
              })}
            </ol>
            <p className="hint vis-nota">
              {t("Mortar pre-slope starts hidden when the calculator has it off (Product Settings C33 = 0). Tick it to show.",
                "La base con pendiente empieza oculta cuando la calculadora la deja fuera (ajuste C33 = 0). Marca la casilla para verla.")}
            </p>
          </div>
        </div>

        <div className="vis-columna-controles">
          <div className="card">
            <h3>{t("Change the tile", "Cambiar la loseta")}</h3>
            {SUPERFICIES.map((s) => (
              <PickerSuperficie key={s.id} titulo={lang === "es" ? s.es : s.en} valor={espec[s.id]}
                foto={fotos[s.id]} onCambio={(c) => cambiaEspec(s.id, c)}
                onSubeFoto={(f) => subeFoto(s.id, f)} onQuitaFoto={() => quitaFoto(s.id)} />
            ))}
            <p className="hint vis-nota">
              {t("Photos stay in this browser; nothing is uploaded. Patterns and textures are drawn, not copied from anywhere.",
                "Las fotos se quedan en este navegador; no se suben a ningún lado. Los dibujos de loseta se generan, no se copian de ningún lado.")}
            </p>
          </div>

          <div className="card">
            <h3>{t("Quantities from the calculator", "Cantidades de la calculadora")}</h3>
            <div className="calc-stats">
              <div className="calc-stat"><span className="hint">{t("Floor (SF)", "Piso (SF)")}</span><b>{fmt.format(resultado.areas.pisoSf)}</b></div>
              <div className="calc-stat"><span className="hint">{t("Wall (SF)", "Pared (SF)")}</span><b>{fmt.format(resultado.areas.paredSf)}</b></div>
              <div className="calc-stat"><span className="hint">{t("Board panels", "Paneles de tablero")}</span><b>{fmt.format(resultado.areas.tablerosPaneles)}</b></div>
            </div>
            {override && (
              <p className="hint vis-nota">{t("The local dimensions above change only this picture, not the calculator.",
                "Las medidas locales cambian solo este dibujo, no la calculadora.")}</p>
            )}
          </div>

          <details className="card vis-medidas">
            <summary><h3 style={{ display: "inline" }}>{t("Local dimensions (override)", "Medidas locales (cambiar solo aquí)")}</h3></summary>
            <div className="calc-grid vis-medidas-grid">
              <MedidaCampo id="vis-largo" etiqueta={t("Length (ft)", "Largo (ft)")} valor={medidas.largoFt}
                onValor={(n) => setOverride({ ...medidas, largoFt: n })} />
              <MedidaCampo id="vis-ancho" etiqueta={t("Width (ft)", "Ancho (ft)")} valor={medidas.anchoFt}
                onValor={(n) => setOverride({ ...medidas, anchoFt: n })} />
              <MedidaCampo id="vis-alto" etiqueta={t("Height (ft)", "Alto (ft)")} valor={medidas.altoFt}
                onValor={(n) => setOverride({ ...medidas, altoFt: n })} />
              <div className="field">
                <label htmlFor="vis-disposicion">{t("Walls", "Paredes")}</label>
                <select id="vis-disposicion" className="calc-entrada" value={medidas.disposicion}
                  onChange={(e) => setOverride({ ...medidas, disposicion: e.target.value as Disposicion })}>
                  {DISPOSICIONES.map((d) => <option key={d} value={d}>{t(DISP_ES[d].en, DISP_ES[d].es)}</option>)}
                </select>
              </div>
            </div>
            <div className="vis-botones">
              <button type="button" className="btn btn-sm btn-ghost" disabled={!override}
                onClick={() => setOverride(null)}>
                ↺ {t("Use the calculator's", "Usar las de la calculadora")}
              </button>
            </div>
          </details>
        </div>
      </div>
    </div>
  );
}

function MedidaCampo({ id, etiqueta, valor, onValor }: { id: string; etiqueta: string; valor: number; onValor: (n: number) => void }) {
  return (
    <div className="field">
      <label htmlFor={id}>{etiqueta}</label>
      <input id={id} type="number" min={0} step={0.5} className="calc-entrada" value={Number.isFinite(valor) ? valor : 0}
        onChange={(e) => { const n = Number(e.target.value); onValor(Number.isFinite(n) ? n : 0); }} />
    </div>
  );
}

function PickerSuperficie({ titulo, valor, foto, onCambio, onSubeFoto, onQuitaFoto }: {
  titulo: string;
  valor: EspecLoseta;
  foto: FotoSuperficie | undefined;
  onCambio: (c: Partial<EspecLoseta>) => void;
  onSubeFoto: (f: File) => void;
  onQuitaFoto: () => void;
}) {
  const { t, lang } = usePrefs();
  const idBase = `vis-${titulo.replace(/\W+/g, "-").toLowerCase()}`;
  return (
    <fieldset className="vis-picker">
      <legend>{titulo}</legend>
      <div className="calc-grid vis-picker-grid">
        <div className="field">
          <label htmlFor={`${idBase}-preset`}>{t("Design", "Diseño")}</label>
          <select id={`${idBase}-preset`} className="calc-entrada" value={valor.fuente}
            onChange={(e) => onCambio({ fuente: e.target.value as FuenteLoseta })}>
            {PRESETS.map((p) => <option key={p.id} value={p.id}>{lang === "es" ? p.es : p.en}</option>)}
            {foto && <option value="foto">{t("Your photo", "Tu foto")}</option>}
          </select>
        </div>
        <div className="field">
          <label htmlFor={`${idBase}-tamano`}>{t("Tile size (in)", "Tamaño (in)")}</label>
          <select id={`${idBase}-tamano`} className="calc-entrada" value={valor.tamano}
            onChange={(e) => onCambio({ tamano: e.target.value as TamanoDeLoseta })}>
            {TAMANOS_DE_LOSETA.map((m) => <option key={m} value={m}>{m}</option>)}
          </select>
        </div>
        <div className="field">
          <label htmlFor={`${idBase}-patron`}>{t("Layout", "Patrón")}</label>
          <select id={`${idBase}-patron`} className="calc-entrada" value={valor.patron}
            onChange={(e) => onCambio({ patron: e.target.value as Patron })}>
            {PATRONES.map((p) => <option key={p} value={p}>{lang === "es" ? PATRON_ES[p].es : PATRON_ES[p].en}</option>)}
          </select>
        </div>
        <div className="field">
          <label htmlFor={`${idBase}-lechada`}>{t("Grout color", "Color de boquilla")}</label>
          <select id={`${idBase}-lechada`} className="calc-entrada" value={valor.lechada}
            onChange={(e) => onCambio({ lechada: e.target.value as ColorLechada })}>
            {LECHADAS.map((l) => <option key={l.id} value={l.id}>{lang === "es" ? l.es : l.en}</option>)}
          </select>
        </div>
        <div className="field">
          <label htmlFor={`${idBase}-junta`}>{t("Joint width (in)", "Ancho de junta (in)")}</label>
          <select id={`${idBase}-junta`} className="calc-entrada" value={valor.juntaIn}
            onChange={(e) => onCambio({ juntaIn: Number(e.target.value) })}>
            {JUNTAS_IN.map((j) => <option key={j} value={j}>{fraccion(j)}</option>)}
          </select>
        </div>
      </div>
      <div className="vis-foto">
        {foto ? (
          <button type="button" className="btn btn-sm btn-ghost" onClick={onQuitaFoto}>
            ✕ {t("Remove photo", "Quitar foto")}
          </button>
        ) : (
          <label className="btn btn-sm btn-ghost vis-subir">
            📁 {t("Upload a photo of the tile", "Subir foto de la loseta")}
            <input type="file" accept="image/*" hidden onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) onSubeFoto(f);
              e.target.value = "";
            }} />
          </label>
        )}
      </div>
    </fieldset>
  );
}

