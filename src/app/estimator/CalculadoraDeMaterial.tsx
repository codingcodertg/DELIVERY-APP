"use client";

import { useEffect, useMemo, useState, type InputHTMLAttributes, type ReactNode } from "react";
import { usePrefs } from "@/lib/prefs";
import { TablaReducida, type ColumnaReducida } from "@/components/timetracker/TablaReducida";
import { leeDecimal, limpiaDecimal } from "@/lib/campo-decimal";
import {
  AJUSTES_META, AJUSTES_POR_DEFECTO, DISPOSICIONES, ENTRADAS_POR_DEFECTO, PROYECTOS, TAMANOS_DE_LOSETA, calcular,
  type AjustesCalculadora, type Disposicion, type EntradasCalculadora, type FilaCalculada, type TamanoDeLoseta, type TipoDeProyecto,
} from "@/lib/estimator/calculadora-material";

/** Dónde se guardan las últimas entradas y ajustes, en este navegador (no en la base). */
const CLAVE_GUARDADO = "rtg:calculadora-material:v1";
const TABLA_ID = "calculadora-material";

interface Guardado { entradas: EntradasCalculadora; ajustes: AjustesCalculadora }

/** Lo que haya en el navegador, con cada valor comprobado. Lo que no cuadra vuelve a su valor por defecto. */
function leeGuardado(): Guardado {
  const base: Guardado = { entradas: ENTRADAS_POR_DEFECTO, ajustes: AJUSTES_POR_DEFECTO };
  try {
    const txt = window.localStorage.getItem(CLAVE_GUARDADO);
    if (!txt) return base;
    const v = JSON.parse(txt) as { entradas?: unknown; ajustes?: unknown } | null;
    return {
      entradas: fusiona(ENTRADAS_POR_DEFECTO, v?.entradas, valorDeEntrada),
      ajustes: fusiona(AJUSTES_POR_DEFECTO, v?.ajustes, (_k, x) => typeof x === "number" && Number.isFinite(x)),
    };
  } catch {
    return base;
  }
}

function fusiona<T extends object>(base: T, guardado: unknown, valido: (k: keyof T, x: unknown) => boolean): T {
  const salida = { ...base };
  if (!guardado || typeof guardado !== "object") return salida;
  for (const k of Object.keys(base) as (keyof T)[]) {
    const x = (guardado as Record<string, unknown>)[k as string];
    if (valido(k, x)) salida[k] = x as T[keyof T];
  }
  return salida;
}

function valorDeEntrada(k: keyof EntradasCalculadora, x: unknown): boolean {
  if (k === "proyecto") return PROYECTOS.includes(x as TipoDeProyecto);
  if (k === "disposicion") return DISPOSICIONES.includes(x as Disposicion);
  if (k === "tamanoPared" || k === "tamanoPiso") return TAMANOS_DE_LOSETA.includes(x as TamanoDeLoseta);
  return typeof x === "number" && Number.isFinite(x);
}

function guardar(g: Guardado): void {
  try { window.localStorage.setItem(CLAVE_GUARDADO, JSON.stringify(g)); } catch { /* sin almacenamiento: no pasa nada */ }
}

const TIPO_ES: Record<TipoDeProyecto, string> = { Shower: "Ducha", "Flooring Only": "Solo piso", "Wall Only": "Solo pared" };
const TIPO_EN: Record<TipoDeProyecto, string> = { Shower: "Shower", "Flooring Only": "Flooring Only", "Wall Only": "Wall Only" };

/**
 * Campo de número que deja borrar el texto (vacío = 0) sin que aparezca un «0» al teclear. Cuando el valor cambia desde
 * fuera (restablecer, o cargar lo guardado), se pinta el valor nuevo.
 */
function CampoNumerico({ id, valor, onValor, className }: {
  id: string; valor: number; onValor: (n: number) => void; className?: string;
} & Omit<InputHTMLAttributes<HTMLInputElement>, "value" | "onChange" | "id" | "type">) {
  const [tecleado, setTecleado] = useState(String(valor));
  const pintado = (leeDecimal(tecleado) ?? 0) === valor ? tecleado : String(valor);
  return (
    <input id={id} type="text" inputMode="decimal" className={className} value={pintado}
      onChange={(e) => { const t = limpiaDecimal(e.target.value); setTecleado(t); onValor(leeDecimal(t) ?? 0); }} />
  );
}

/** Un campo de medida. `uso` dice si el tipo de proyecto lo usa; si no, se atenúa pero sigue editable (nota B46). */
function CampoNum({ id, etiqueta, valor, onValor, uso }: {
  id: string; etiqueta: string; valor: number; onValor: (n: number) => void;
  uso: { aplica: boolean; texto: string };
}) {
  return (
    <div className={"field" + (uso.aplica ? "" : " calc-no-aplica")}>
      <label htmlFor={id}>{etiqueta}</label>
      <CampoNumerico id={id} className="calc-entrada" valor={valor} onValor={onValor} />
      <span className="calc-aplica hint">{uso.texto}</span>
    </div>
  );
}

export function CalculadoraDeMaterial() {
  const { t, lang } = usePrefs();
  const [entradas, setEntradas] = useState<EntradasCalculadora>(ENTRADAS_POR_DEFECTO);
  const [ajustes, setAjustes] = useState<AjustesCalculadora>(AJUSTES_POR_DEFECTO);
  const [listo, setListo] = useState(false);
  const [copiado, setCopiado] = useState<"ok" | "error" | null>(null);

  // Lo guardado se lee al montar (no en el render: el servidor no tiene localStorage) y después se guarda cada cambio.
  useEffect(() => {
    const g = leeGuardado();
    setEntradas(g.entradas);
    setAjustes(g.ajustes);
    setListo(true);
  }, []);
  useEffect(() => { if (listo) guardar({ entradas, ajustes }); }, [listo, entradas, ajustes]);

  const resultado = useMemo(() => calcular(entradas, ajustes), [entradas, ajustes]);
  const fmt = useMemo(
    () => new Intl.NumberFormat(lang === "es" ? "es-US" : "en-US", { maximumFractionDigits: 3 }),
    [lang],
  );

  const poner = <K extends keyof EntradasCalculadora>(k: K, v: EntradasCalculadora[K]) =>
    setEntradas((e) => ({ ...e, [k]: v }));
  const ponerAjuste = <K extends keyof AjustesCalculadora>(k: K, v: number) =>
    setAjustes((a) => ({ ...a, [k]: v }));

  const proyecto = entradas.proyecto;
  const uso = (usa: TipoDeProyecto[]) => {
    const aplica = usa.includes(proyecto);
    const lista = usa.map((p) => (lang === "es" ? TIPO_ES[p] : TIPO_EN[p])).join(", ");
    const texto = aplica
      ? t(`Used for: ${lista}`, `Se usa en: ${lista}`)
      : t(`Not used for this type (used for ${lista}). Still editable.`, `No aplica a este tipo (se usa en ${lista}). Sigue editable.`);
    return { aplica, texto };
  };
  const claseCampo = (aplica: boolean) => "field" + (aplica ? "" : " calc-no-aplica");

  const columnas = useMemo<ColumnaReducida<FilaCalculada>[]>(() => {
    const num = (n: number) => fmt.format(n);
    return [
      { key: "material", en: "Material", es: "Material", ancho: 230, fija: true, celda: (f) => f.material[lang] },
      { key: "necesaria", en: "Amount needed", es: "Cantidad necesaria", ancho: 120, numerico: true, celda: (f) => num(f.cantidad) },
      { key: "paquete", en: "Per package", es: "Por paquete", ancho: 110, numerico: true, celda: (f) => (f.porPaquete === null ? "—" : num(f.porPaquete)) },
      {
        key: "venta", en: "To sell", es: "A vender", ancho: 110, numerico: true,
        celda: (f) => <span className="calc-venta" data-venta={f.clave}>{num(f.venta)}</span>,
      },
      { key: "unidad", en: "Unit", es: "Unidad", ancho: 120, celda: (f) => f.unidad[lang] },
      { key: "notas", en: "Notes", es: "Notas", ancho: 340, envuelve: true, celda: (f) => f.nota[lang] },
    ];
  }, [fmt, lang]);

  const copiarLista = async () => {
    const lineas = resultado.filas
      .filter((f) => f.venta > 0)
      .map((f) => `${fmt.format(f.venta)} ${f.unidad[lang]} — ${f.material[lang]}`);
    try {
      await navigator.clipboard.writeText(lineas.join("\n"));
      setCopiado("ok");
    } catch {
      setCopiado("error");
    }
    window.setTimeout(() => setCopiado(null), 2500);
  };

  const cifra = (n: number) => fmt.format(n);
  const salpicaderoAplica = proyecto !== "Flooring Only";

  return (
    <div className="calc-wrap" data-calculadora>
      <div className="card calc-intro">
        <h2>🧮 {t("Material calculator", "Calculadora de material")}</h2>
        <p className="hint" style={{ margin: 0 }}>
          {t("Rodriguez Tile Group · Enter the project's dimensions and it calculates how many units to sell of each item.",
            "Rodriguez Tile Group · Captura las medidas del proyecto y calcula cuántas unidades vender de cada material.")}
        </p>
        <p className="hint calc-leyenda">
          <span className="calc-leyenda-azul">{t("Blue = enter / select", "Azul = capturar / elegir")}</span>
          {" · "}
          <span className="calc-leyenda-verde">{t("Green = quantity to sell", "Verde = cantidad a vender")}</span>
          {" · "}
          {t("Product settings and glossary below.", "Ajustes del producto y glosario abajo.")}
        </p>
      </div>

      {/* 01. Proyecto y medidas (hoja 1: C6..C14, F6..F12, C37, C48, C49) */}
      <div className="card">
        <h2>01 · {t("Project & dimensions", "Proyecto y medidas")}</h2>
        <div className="calc-grid">
          <div className="field">
            <label htmlFor="calc-proyecto">{t("Project type", "Tipo de proyecto")}</label>
            <select id="calc-proyecto" className="calc-entrada" value={proyecto}
              onChange={(e) => poner("proyecto", e.target.value as TipoDeProyecto)}>
              {PROYECTOS.map((p) => <option key={p} value={p}>{lang === "es" ? TIPO_ES[p] : TIPO_EN[p]}</option>)}
            </select>
            <span className="calc-aplica hint">{t("Shower, Flooring Only or Wall Only. Each type uses a different set of fields.",
              "Ducha, solo piso o solo pared. Cada tipo usa un conjunto distinto de campos.")}</span>
          </div>
          <div className={claseCampo(proyecto === "Shower")}>
            <label htmlFor="calc-disposicion">{t("Shower layout", "Disposición de la ducha")}</label>
            <select id="calc-disposicion" className="calc-entrada" value={entradas.disposicion}
              onChange={(e) => poner("disposicion", e.target.value as Disposicion)}>
              {DISPOSICIONES.map((d) => (
                <option key={d} value={d}>{d === "2 Walls" ? t("2 walls", "2 paredes") : d === "3 Walls" ? t("3 walls", "3 paredes") : t("4 walls", "4 paredes")}</option>
              ))}
            </select>
            <span className="calc-aplica hint">{uso(["Shower"]).texto}</span>
          </div>

          <CampoNum id="calc-largo" etiqueta={t("Length (ft)", "Largo (ft)")} valor={entradas.largoFt}
            onValor={(n) => poner("largoFt", n)} uso={uso(["Shower", "Flooring Only", "Wall Only"])} />
          <CampoNum id="calc-ancho" etiqueta={t("Width (ft)", "Ancho (ft)")} valor={entradas.anchoFt}
            onValor={(n) => poner("anchoFt", n)} uso={uso(["Shower", "Flooring Only"])} />
          <CampoNum id="calc-alto" etiqueta={t("Height (ft)", "Alto (ft)")} valor={entradas.altoFt}
            onValor={(n) => poner("altoFt", n)} uso={uso(["Shower", "Wall Only"])} />
          <CampoNum id="calc-aberturas" etiqueta={t("Wall openings (SF)", "Aberturas en pared (SF)")} valor={entradas.aberturasSf}
            onValor={(n) => poner("aberturasSf", n)} uso={uso(["Shower", "Wall Only"])} />
          <CampoNum id="calc-mortero" etiqueta={t("Mortar bed avg depth (in)", "Profundidad promedio del mortero (in)")}
            valor={entradas.morteroProfundidadIn} onValor={(n) => poner("morteroProfundidadIn", n)} uso={uso(["Shower"])} />
          <CampoNum id="calc-caja-pared" etiqueta={t("Wall tile SF per box", "SF por caja de loseta de pared")} valor={entradas.cajaParedSf}
            onValor={(n) => poner("cajaParedSf", n)} uso={uso(["Shower", "Wall Only"])} />
          <CampoNum id="calc-caja-piso" etiqueta={t("Floor tile SF per box", "SF por caja de loseta de piso")} valor={entradas.cajaPisoSf}
            onValor={(n) => poner("cajaPisoSf", n)} uso={uso(["Shower", "Flooring Only"])} />

          <div className={claseCampo(proyecto !== "Flooring Only")}>
            <label htmlFor="calc-tamano-pared">{t("Wall tile size (grout only)", "Tamaño de loseta de pared (solo lechada)")}</label>
            <select id="calc-tamano-pared" className="calc-entrada" value={entradas.tamanoPared}
              onChange={(e) => poner("tamanoPared", e.target.value as TamanoDeLoseta)}>
              {TAMANOS_DE_LOSETA.map((m) => <option key={m} value={m}>{m}</option>)}
            </select>
            <span className="calc-aplica hint">{uso(["Shower", "Wall Only"]).texto}</span>
          </div>
          <div className={claseCampo(proyecto !== "Wall Only")}>
            <label htmlFor="calc-tamano-piso">{t("Floor tile size (grout only)", "Tamaño de loseta de piso (solo lechada)")}</label>
            <select id="calc-tamano-piso" className="calc-entrada" value={entradas.tamanoPiso}
              onChange={(e) => poner("tamanoPiso", e.target.value as TamanoDeLoseta)}>
              {TAMANOS_DE_LOSETA.map((m) => <option key={m} value={m}>{m}</option>)}
            </select>
            <span className="calc-aplica hint">{uso(["Shower", "Flooring Only"]).texto}</span>
          </div>
          <CampoNum id="calc-junta-pared" etiqueta={t("Wall joint width (in)", "Ancho de junta en pared (in)")} valor={entradas.juntaParedIn}
            onValor={(n) => poner("juntaParedIn", n)} uso={uso(["Shower", "Wall Only"])} />
          <CampoNum id="calc-junta-piso" etiqueta={t("Floor joint width (in)", "Ancho de junta en piso (in)")} valor={entradas.juntaPisoIn}
            onValor={(n) => poner("juntaPisoIn", n)} uso={uso(["Shower", "Flooring Only"])} />
          <CampoNum id="calc-subida" etiqueta={t("Liner upturn (in)", "Subida del liner (in)")} valor={entradas.subidaLinerIn}
            onValor={(n) => poner("subidaLinerIn", n)} uso={uso(["Shower"])} />
          <CampoNum id="calc-borde-liner" etiqueta={t("Pan liner extra edge (in)", "Borde extra del liner (in)")}
            valor={entradas.bordeExtraLinerIn} onValor={(n) => poner("bordeExtraLinerIn", n)} uso={uso(["Shower"])} />
          <CampoNum id="calc-borde-expuesto" etiqueta={t("Exposed tile edge for trim (LF)", "Borde expuesto de loseta para perfil (LF)")}
            valor={entradas.bordeExpuestoLf} onValor={(n) => poner("bordeExpuestoLf", n)}
            uso={{ aplica: true, texto: t("Trim = exposed edges only. 0 if none.", "El perfil es solo para bordes expuestos. 0 si no hay.") }} />
        </div>

        <div className={"calc-salpicadero" + (salpicaderoAplica ? "" : " calc-no-aplica")}>
          <h3>{t("Backsplash (included in wall quantities)", "Salpicadero (incluido en las cantidades de pared)")}</h3>
          <div className="calc-grid calc-grid-2">
            <CampoNum id="calc-salp-largo" etiqueta={t("Backsplash length (ft)", "Largo del salpicadero (ft)")}
              valor={entradas.salpicaderoLargoFt} onValor={(n) => poner("salpicaderoLargoFt", n)} uso={uso(["Shower", "Wall Only"])} />
            <CampoNum id="calc-salp-alto" etiqueta={t("Backsplash height (ft)", "Alto del salpicadero (ft)")}
              valor={entradas.salpicaderoAltoFt} onValor={(n) => poner("salpicaderoAltoFt", n)} uso={uso(["Shower", "Wall Only"])} />
          </div>
          <p className="calc-nota">
            <b>{t("Note", "Nota")}:</b>{" "}
            {t("Backsplash is included above; set either dimension to 0 if not needed.",
              "El salpicadero va incluido arriba; pon cualquiera de las dos medidas en 0 si no lo necesitas.")}
          </p>
        </div>

        <p className="calc-nota calc-nota-sheet">
          <b>{t("Sheet note", "Nota de la hoja")}:</b>{" "}
          {t("Floor-only needs length × width. Wall-only needs length × height. Shower needs all three. Blue product settings are editable.",
            "Solo piso necesita largo × ancho. Solo pared necesita largo × alto. La ducha necesita las tres. Los ajustes azules del producto se pueden editar.")}
        </p>
      </div>

      {/* 02. Materiales a vender (hoja 1, filas 17–33) */}
      <div className="card">
        <div className="calc-cab">
          <h2>02 · {t("Materials to sell", "Materiales a vender")}</h2>
          <button type="button" className="btn btn-sm btn-ghost" onClick={() => void copiarLista()}>
            📋 {t("Copy list", "Copiar lista")}
          </button>
          <span className="hint" role="status" aria-live="polite">
            {copiado === "ok" ? t("Copied.", "Copiada.")
              : copiado === "error" ? t("Could not copy. Select the table and copy it.", "No se pudo copiar. Selecciona la tabla y cópiala.") : ""}
          </span>
        </div>
        <p className="hint calc-nota-tabla">
          {t("The list copies each line as qty unit — material (only items with a quantity). Rounding to whole packs is unavoidable.",
            "La lista copia cada línea como cantidad unidad — material (solo los que llevan cantidad). Redondear a paquetes enteros es inevitable.")}
        </p>
        <TablaReducida id={TABLA_ID} columnas={columnas} filas={resultado.filas} claveDe={(f) => f.clave} />
        <div className="calc-notas">
          <p><b>{t("Backsplash", "Salpicadero")}:</b> {t(
            "Backsplash is included in wall tile / wall thinset / wall grout quantities. No separate backsplash tile order.",
            "El salpicadero va incluido en las cantidades de loseta, pegamento y lechada de pared. No hay pedido separado de loseta para salpicadero.")}</p>
          <p><b>{t("Notes", "Notas")}:</b> {t(
            "No extra material for cutting/breakage. Rounding whole packs is unavoidable. Liner upturn is a required shape allowance, not waste.",
            "No hay material extra por corte ni rotura. Redondear a paquetes enteros es inevitable. La subida del liner es una previsión de forma requerida, no desperdicio.")}</p>
        </div>
      </div>

      {/* 03. Áreas calculadas (hoja 1, filas 40–43) */}
      <div className="card">
        <h2>03 · {t("Calculated surface areas", "Áreas calculadas")}</h2>
        <div className="calc-stats">
          <div className="calc-stat"><span className="hint">{t("Floor area (SF)", "Área de piso (SF)")}</span><b>{cifra(resultado.areas.pisoSf)}</b></div>
          <div className="calc-stat"><span className="hint">{t("Wall area (SF)", "Área de pared (SF)")}</span><b>{cifra(resultado.areas.paredSf)}</b></div>
          <div className="calc-stat"><span className="hint">{t("Wall perimeter (LF)", "Perímetro de pared (LF)")}</span><b>{cifra(resultado.areas.perimetroLf)}</b></div>
          <div className="calc-stat"><span className="hint">{t("Estimated full backerboard panels", "Paneles de tablero completos estimados")}</span><b>{cifra(resultado.areas.tablerosPaneles)}</b></div>
        </div>
      </div>

      <AjustesDelProducto ajustes={ajustes} onCambio={ponerAjuste} onRestablecer={() => setAjustes(AJUSTES_POR_DEFECTO)} />
      <Glosario />
    </div>
  );
}

/** Ajustes de «Product Settings» (hoja 2): editables, con su unidad y su nota de la hoja, y restablecer. */
function AjustesDelProducto({ ajustes, onCambio, onRestablecer }: {
  ajustes: AjustesCalculadora;
  onCambio: <K extends keyof AjustesCalculadora>(k: K, v: number) => void;
  onRestablecer: () => void;
}) {
  const { t, lang } = usePrefs();
  return (
    <details className="card calc-ajustes">
      <summary><h2 style={{ display: "inline" }}>{t("Product settings", "Ajustes del producto")}</h2></summary>
      <p className="calc-nota">
        <b>{t("Important", "Importante")}:</b>{" "}
        {t("Thinset, mortar, waterproofing, grout and silicone rates are application-dependent. Verify product technical data sheets before quoting.",
          "Los rendimientos de pegamento, mortero, impermeabilizante, lechada y silicón dependen de la aplicación. Verifica las fichas técnicas del producto antes de cotizar.")}
      </p>
      <div className="calc-cab">
        <button type="button" className="btn btn-sm btn-ghost" onClick={onRestablecer}>
          ↺ {t("Reset to defaults", "Restablecer valores por defecto")}
        </button>
      </div>
      <div className="calc-ajustes-lista">
        {AJUSTES_META.map((m) => {
          const id = `calc-ajuste-${m.clave}`;
          return (
            <div key={m.clave} className={"field calc-ajuste" + (m.sinUso ? " calc-no-aplica" : "")}>
              <label htmlFor={id}>
                {m.etiqueta[lang]} <span className="hint">· {t("Product Settings", "Hoja 2")} {m.celda}</span>
              </label>
              {m.esSiNo ? (
                <label className="calc-check">
                  <input id={id} type="checkbox" checked={ajustes[m.clave] === 1}
                    onChange={(e) => onCambio(m.clave, e.target.checked ? 1 : 0)} />
                  {t("Yes (1)", "Sí (1)")}
                </label>
              ) : (
                <CampoNumerico id={id} className="calc-entrada" valor={ajustes[m.clave]} onValor={(n) => onCambio(m.clave, n)} />
              )}
              <span className="calc-aplica hint">{t("Unit", "Unidad")}: {m.unidad}</span>
              <span className="calc-aplica hint">{m.nota}</span>
              {m.sinUso && (
                <span className="calc-aplica hint"><b>{t("Not used by any formula in the sheet.", "La hoja no lo usa en ninguna fórmula.")}</b></span>
              )}
            </div>
          );
        })}
      </div>
    </details>
  );
}

/** Glosario de la hoja 2 (columnas G y H), tal como sale en la hoja. */
const GLOSARIO: readonly { titulo: string; filas: readonly [string, string][] }[] = [
  {
    titulo: "Términos / Terms",
    filas: [
      ["Grout / Boquilla", "Fills grout joints between tiles"],
      ["Joint / Junta", "Gap or seam between tiles"],
      ["Thinset / Pegamento / Cemento para loseta", "Tile-setting mortar; different from grout"],
      ["Mortar bed / Mortero seco", "Builds a sloped shower pan base"],
      ["Backerboard / Cement board", "Tile backing panel"],
      ["Mesh tape / Malla para juntas", "Reinforces seams between backerboards"],
      ["Pan liner / Cuero de marrano", "Waterproof liner beneath mortar bed"],
      ["Silicone / Silicón", "Flexible sealant at corners and plane changes"],
      ["Mosaic / Mosaico", "Small tiles on mesh; estimate grout using individual chip dimensions"],
    ],
  },
  {
    titulo: "Campos de la calculadora / Calculator fields",
    filas: [
      ["Floor joint width (in)", "Grout spacing between neighboring floor tiles (not the floor-to-wall corner)."],
      ["Mosaic vs. regular tile", "Use the actual individual mosaic chip dimensions, not the full mesh sheet size, to estimate grout."],
      ["Liner upturn (in)", "How high the waterproof pan liner rises up the walls, measured in inches."],
      ["Pan liner extra edge (in)", "Optional material added to each side if required by the shower design; defaults to zero, not automatic waste."],
      ["Grout coverage (SF/bag)", "Floor or wall area covered by one 25-lb grout bag; depends on tile and joint size."],
      ["Backsplash", "A standard 1 ft × 3 ft backsplash is 3 SF and is included in wall area, not added twice."],
    ],
  },
  {
    titulo: "Tamaño de loseta vs. cajas / Tile size vs. boxes",
    filas: [["Tile box count", "Tile box quantity = area needed ÷ SF per box, rounded up. Tile dimensions are not needed."]],
  },
  {
    titulo: "Referencia de suministro (ducha estándar 3×5×8) / Supply benchmark",
    filas: [
      ["Backerboard", "7 sheets (3×5), sold in LF per store preference"],
      ["Pan liner", "1 piece (5×7)"],
      ["Mortar bed", "5 bags (44 lb)"],
      ["Waterproofing", "3 gallons; choose Crest OR Hydrorite OR Cemix"],
      ["Thinset", "4–5 bags; choose ONE listed product"],
      ["Mesh / screws / grout", "1 roll / 1 box of 575+ / 1 bag"],
    ],
  },
];

function Glosario(): ReactNode {
  const { t } = usePrefs();
  return (
    <details className="card calc-glosario">
      <summary><h2 style={{ display: "inline" }}>{t("Glossary", "Glosario")}</h2></summary>
      {GLOSARIO.map((g) => (
        <div key={g.titulo} className="calc-glosario-bloque">
          <h3>{g.titulo}</h3>
          <dl>
            {g.filas.map(([termino, significado]) => (
              <div key={termino} className="calc-glosario-fila">
                <dt>{termino}</dt>
                <dd>{significado}</dd>
              </div>
            ))}
          </dl>
        </div>
      ))}
    </details>
  );
}
