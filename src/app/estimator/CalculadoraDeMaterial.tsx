"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type InputHTMLAttributes, type ReactNode } from "react";
import { usePrefs } from "@/lib/prefs";
import { TablaReducida, type ColumnaReducida } from "@/components/timetracker/TablaReducida";
import { leeDecimal, limpiaDecimal } from "@/lib/campo-decimal";
import {
  AJUSTES_META, AJUSTES_POR_DEFECTO, CALCULADORAS, DISPOSICIONES, ENTRADAS_POR_DEFECTO, MAX_FILAS_DE_MEDIDA, METODOS_DE_PARED, TAMANOS_DE_LOSETA,
  calcular, camposQueAplican,
  type AjustesCalculadora, type AreasCalculadas, type Bilingue, type Disposicion, type EntradasCalculadora, type Explicacion,
  type FilaCalculada, type Habitacion, type MetodoDePared, type TamanoDeLoseta, type TipoDeProyecto,
} from "@/lib/estimator/calculadora-material";
import { guardar, leeGuardado } from "@/lib/estimator/calculadora-guardado";

const TABLA_ID = "calculadora-material";

/** Las entradas numéricas (las que se capturan con un campo de número). */
type CampoNumero = { [K in keyof EntradasCalculadora]: EntradasCalculadora[K] extends number ? K : never }[keyof EntradasCalculadora];

/** El orden en que salen los campos de medida de la ducha (el uso de cada uno está en la tabla de la lógica). */
const ORDEN_DE_CAMPOS: readonly (keyof EntradasCalculadora)[] = [
  "paredMetodo", "paredAreaSf", "paredLargoFt", "paredAltoFt", "paredAberturasSf",
  "disposicion", "largoFt", "anchoFt", "altoFt", "aberturasSf", "morteroProfundidadIn", "cajaParedSf", "cajaPisoSf",
  "tamanoPared", "tamanoPiso", "juntaParedIn", "juntaPisoIn", "subidaLinerIn", "bordeExtraLinerIn", "bordeExpuestoLf",
];

const ETIQUETA_DE_CAMPO: Partial<Record<keyof EntradasCalculadora, Bilingue>> = {
  disposicion: { en: "Shower layout", es: "Disposición de la ducha" },
  largoFt: { en: "Length (ft)", es: "Largo (ft)" },
  anchoFt: { en: "Width (ft)", es: "Ancho (ft)" },
  altoFt: { en: "Height (ft)", es: "Alto (ft)" },
  aberturasSf: { en: "Wall openings (SF)", es: "Aberturas en pared (SF)" },
  morteroProfundidadIn: { en: "Mortar bed avg depth (in)", es: "Profundidad promedio del mortero (in)" },
  cajaParedSf: { en: "Wall tile SF per box", es: "SF por caja de loseta de pared" },
  cajaPisoSf: { en: "Floor tile SF per box", es: "SF por caja de loseta de piso" },
  tamanoPared: { en: "Wall tile size (grout only)", es: "Tamaño de loseta de pared (solo lechada)" },
  tamanoPiso: { en: "Floor tile size (grout only)", es: "Tamaño de loseta de piso (solo lechada)" },
  juntaParedIn: { en: "Wall joint width (in)", es: "Ancho de junta en pared (in)" },
  juntaPisoIn: { en: "Floor joint width (in)", es: "Ancho de junta en piso (in)" },
  subidaLinerIn: { en: "Liner upturn (in)", es: "Subida del liner (in)" },
  bordeExtraLinerIn: { en: "Pan liner extra edge (in)", es: "Borde extra del liner (in)" },
  bordeExpuestoLf: { en: "Exposed tile edge for trim (LF)", es: "Borde expuesto de loseta para perfil (LF)" },
  salpicaderoLargoFt: { en: "Backsplash length (ft)", es: "Largo del salpicadero (ft)" },
  salpicaderoAltoFt: { en: "Backsplash height (ft)", es: "Alto del salpicadero (ft)" },
  paredMetodo: { en: "Measurement method", es: "Método de medida" },
  paredAreaSf: { en: "Wall area (SF)", es: "Área de pared (SF)" },
  paredLargoFt: { en: "Length (ft)", es: "Largo (ft)" },
  paredAltoFt: { en: "Height (ft)", es: "Alto (ft)" },
  paredAberturasSf: { en: "Openings / deductions (SF)", es: "Aberturas / descuentos (SF)" },
};

const ID_DE_CAMPO: Partial<Record<keyof EntradasCalculadora, string>> = {
  largoFt: "calc-largo", anchoFt: "calc-ancho", altoFt: "calc-alto", disposicion: "calc-disposicion",
  aberturasSf: "calc-aberturas", morteroProfundidadIn: "calc-mortero", cajaParedSf: "calc-caja-pared", cajaPisoSf: "calc-caja-piso",
  tamanoPared: "calc-tamano-pared", tamanoPiso: "calc-tamano-piso", juntaParedIn: "calc-junta-pared", juntaPisoIn: "calc-junta-piso",
  subidaLinerIn: "calc-subida", bordeExtraLinerIn: "calc-borde-liner", bordeExpuestoLf: "calc-borde-expuesto",
  salpicaderoLargoFt: "calc-salp-largo", salpicaderoAltoFt: "calc-salp-alto",
  paredMetodo: "calc-pared-metodo", paredAreaSf: "calc-pared-area", paredLargoFt: "calc-pared-largo",
  paredAltoFt: "calc-pared-alto", paredAberturasSf: "calc-pared-aberturas",
};

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

/** Un campo de medida con su etiqueta. */
function CampoNum({ id, etiqueta, valor, onValor }: {
  id: string; etiqueta: string; valor: number; onValor: (n: number) => void;
}) {
  return (
    <div className="field">
      <label htmlFor={id}>{etiqueta}</label>
      <CampoNumerico id={id} className="calc-entrada" valor={valor} onValor={onValor} />
    </div>
  );
}

/** Los iconos de las tres calculadoras (trazo, sin relleno; toman el color del botón). */
function IconoDucha() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M3 4h6v3" /><path d="M5 7h10l-1 3H6z" /><path d="M7 13v3M11 13v4M15 13v3" />
    </svg>
  );
}
function IconoPiso() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <rect x="3" y="3" width="18" height="18" rx="2" /><path d="M3 12h18M12 3v18" />
    </svg>
  );
}
function IconoPared() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <rect x="3" y="3" width="18" height="18" rx="2" /><path d="M3 9h18M3 15h18M9 3v6M15 9v6M9 15v6" />
    </svg>
  );
}
const ICONO: Record<TipoDeProyecto, typeof IconoDucha> = { Shower: IconoDucha, "Flooring Only": IconoPiso, "Wall Only": IconoPared };

export function CalculadoraDeMaterial() {
  const { t, lang } = usePrefs();
  const [entradas, setEntradas] = useState<EntradasCalculadora>(ENTRADAS_POR_DEFECTO);
  const [ajustes, setAjustes] = useState<AjustesCalculadora>(AJUSTES_POR_DEFECTO);
  const [listo, setListo] = useState(false);
  const [copiado, setCopiado] = useState<"ok" | "error" | null>(null);
  // La tarjeta de «cómo sale»: qué se explica y el botón que la abrió (para devolverle el foco al cerrar).
  const [explicando, setExplicando] = useState<{ titulo: string; explicacion: Explicacion } | null>(null);
  const origenRef = useRef<HTMLElement | null>(null);
  const abrirExplicacion = useCallback((titulo: string, explicacion: Explicacion, origen: HTMLElement) => {
    origenRef.current = origen;
    setExplicando({ titulo, explicacion });
  }, []);
  const cerrarExplicacion = useCallback(() => {
    setExplicando(null);
    const origen = origenRef.current;
    origenRef.current = null;
    window.setTimeout(() => origen?.focus(), 0);
  }, []);

  // Lo guardado se lee al montar (no en el render: el servidor no tiene localStorage) y después se guarda cada cambio.
  // La calculadora elegida va dentro de las entradas (`proyecto`), así que también queda guardada en el navegador.
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

  const tipo = entradas.proyecto;
  const calc = CALCULADORAS.find((c) => c.tipo === tipo) ?? CALCULADORAS[0];
  // Lo que se muestra con esta calculadora y estos interruptores. Lo demás no sale en la pantalla.
  const sel = useMemo(() => camposQueAplican(tipo, ajustes), [tipo, ajustes]);
  const filasVisibles = resultado.filas.filter((f) => sel.filas.includes(f.clave));
  const cifra = (n: number) => fmt.format(n);

  const columnas = useMemo<ColumnaReducida<FilaCalculada>[]>(() => {
    const num = (n: number) => fmt.format(n);
    return [
      { key: "material", en: "Material", es: "Material", ancho: 230, fija: true, celda: (f) => f.material[lang] },
      {
        key: "necesaria", en: "Amount needed", es: "Cantidad necesaria", ancho: 120, numerico: true,
        celda: (f) => (
          <button type="button" className="calc-link" data-explica={f.clave} aria-haspopup="dialog"
            aria-label={`${lang === "es" ? "Ver cómo sale" : "See how it is calculated"}: ${f.material[lang]} — ${num(f.cantidad)}`}
            onClick={(ev) => abrirExplicacion(f.material[lang], f.explicacion, ev.currentTarget)}>
            {num(f.cantidad)}
          </button>
        ),
      },
      { key: "paquete", en: "Per package", es: "Por paquete", ancho: 110, numerico: true, celda: (f) => (f.porPaquete === null ? "—" : num(f.porPaquete)) },
      {
        key: "venta", en: "To sell", es: "A vender", ancho: 110, numerico: true,
        celda: (f) => (
          <button type="button" className="calc-venta calc-link" data-venta={f.clave} aria-haspopup="dialog"
            aria-label={`${lang === "es" ? "Ver cómo sale" : "See how it is calculated"}: ${f.material[lang]} — ${num(f.venta)}`}
            onClick={(ev) => abrirExplicacion(f.material[lang], f.explicacion, ev.currentTarget)}>
            {num(f.venta)}
          </button>
        ),
      },
      { key: "unidad", en: "Unit", es: "Unidad", ancho: 120, celda: (f) => f.unidad[lang] },
      { key: "notas", en: "Notes", es: "Notas", ancho: 340, envuelve: true, celda: (f) => f.nota[lang] },
    ];
  }, [fmt, lang, abrirExplicacion]);

  const copiarLista = async () => {
    // La primera línea dice qué calculadora la produjo, para que no se confunda con otra.
    const lineas = [
      `${calc.etiqueta[lang]}:`,
      ...filasVisibles
        .filter((f) => f.venta > 0)
        .map((f) => `${fmt.format(f.venta)} ${f.unidad[lang]} — ${f.material[lang]}`),
    ];
    try {
      await navigator.clipboard.writeText(lineas.join("\n"));
      setCopiado("ok");
    } catch {
      setCopiado("error");
    }
    window.setTimeout(() => setCopiado(null), 2500);
  };

  const areasVisibles = sel.areas;
  const etiquetasDeArea: Record<keyof AreasCalculadas, string> = {
    pisoSf: t("Floor area (SF)", "Área de piso (SF)"),
    paredSf: t("Wall area (SF)", "Área de pared (SF)"),
    perimetroLf: t("Wall perimeter (LF)", "Perímetro de pared (LF)"),
    tablerosPaneles: t("Estimated full backerboard panels", "Paneles de tablero completos estimados"),
  };
  // Calculadora de pared (D-1203): con «pies cuadrados» se captura el área; con «largo × alto», las dos medidas.
  const porMedidas = entradas.paredMetodo === "Dimensions";
  const camposDeMedida = ORDEN_DE_CAMPOS.filter((c) => sel.entradas.includes(c)
    && !(c === "paredAreaSf" && porMedidas) && !((c === "paredLargoFt" || c === "paredAltoFt") && !porMedidas));
  const tieneSalpicadero = sel.entradas.includes("salpicaderoLargoFt");
  const tieneHabitaciones = sel.entradas.includes("habitaciones");

  return (
    <div className="calc-wrap" data-calculadora data-calculadora-activa={tipo}>
      <div className="card calc-intro">
        <h2>🧮 {t("Material calculator", "Calculadora de material")}</h2>
        <p className="hint" style={{ margin: 0 }}>
          {t("Rodriguez Tile Group · Pick the job, enter the measurements and it calculates how many units to sell of each item.",
            "Rodriguez Tile Group · Elige el trabajo, captura las medidas y calcula cuántas unidades vender de cada material.")}
        </p>
        <div className="calc-elige" role="group" aria-label={t("Calculator", "Calculadora")}>
          {CALCULADORAS.map((c) => {
            const activa = c.tipo === tipo;
            const Icono = ICONO[c.tipo];
            return (
              <button key={c.tipo} type="button" className={"calc-elige-op" + (activa ? " activa" : "")}
                aria-pressed={activa} data-calculadora-tipo={c.tipo} onClick={() => poner("proyecto", c.tipo)}>
                <Icono />
                <span className="calc-elige-titulo">{c.etiqueta[lang]}</span>
                <span className="calc-elige-desc">{c.descripcion[lang]}</span>
              </button>
            );
          })}
        </div>
        <p className="hint calc-leyenda">
          <span className="calc-leyenda-azul">{t("Blue = enter / select", "Azul = capturar / elegir")}</span>
          {" · "}
          <span className="calc-leyenda-verde">{t("Green = quantity to sell", "Verde = cantidad a vender")}</span>
          {" · "}
          {t("Product settings and glossary below.", "Ajustes del producto y glosario abajo.")}
        </p>
      </div>

      {/* 01. Medidas (hoja 1: C7..C14, F6..F12, C37, C48, C49; piso y pared: filas) */}
      <div className="card">
        <h2>01 · {t("Dimensions", "Medidas")} — {calc.etiqueta[lang]}</h2>

        {tieneHabitaciones && (
          <EditorDeHabitaciones filas={entradas.habitaciones} areaTexto={cifra(resultado.areas.pisoSf)}
            onCambio={(habitaciones) => poner("habitaciones", habitaciones)} />
        )}

        {camposDeMedida.length > 0 && (
          <div className="calc-grid">
            {camposDeMedida.map((c) => {
              if (c === "disposicion") {
                return (
                  <div className="field" key={c}>
                    <label htmlFor="calc-disposicion">{ETIQUETA_DE_CAMPO.disposicion![lang]}</label>
                    <select id="calc-disposicion" className="calc-entrada" value={entradas.disposicion}
                      onChange={(e) => poner("disposicion", e.target.value as Disposicion)}>
                      {DISPOSICIONES.map((d) => (
                        <option key={d} value={d}>{d === "2 Walls" ? t("2 walls", "2 paredes") : d === "3 Walls" ? t("3 walls", "3 paredes") : t("4 walls", "4 paredes")}</option>
                      ))}
                    </select>
                  </div>
                );
              }
              if (c === "paredMetodo") {
                return (
                  <div className="field" key={c}>
                    <label htmlFor="calc-pared-metodo">{ETIQUETA_DE_CAMPO.paredMetodo![lang]}</label>
                    <select id="calc-pared-metodo" className="calc-entrada" value={entradas.paredMetodo}
                      onChange={(e) => poner("paredMetodo", e.target.value as MetodoDePared)}>
                      {METODOS_DE_PARED.map((m) => (
                        <option key={m} value={m}>{m === "Dimensions" ? t("Length × height", "Largo × alto") : t("Square footage", "Pies cuadrados")}</option>
                      ))}
                    </select>
                  </div>
                );
              }
              if (c === "tamanoPared" || c === "tamanoPiso") {
                return (
                  <div className="field" key={c}>
                    <label htmlFor={ID_DE_CAMPO[c]}>{ETIQUETA_DE_CAMPO[c]![lang]}</label>
                    <select id={ID_DE_CAMPO[c]} className="calc-entrada" value={entradas[c]}
                      onChange={(e) => poner(c, e.target.value as TamanoDeLoseta)}>
                      {TAMANOS_DE_LOSETA.map((m) => <option key={m} value={m}>{m}</option>)}
                    </select>
                  </div>
                );
              }
              const numero = c as CampoNumero;
              return (
                <CampoNum key={c} id={ID_DE_CAMPO[c]!} etiqueta={ETIQUETA_DE_CAMPO[c]![lang]} valor={entradas[numero]}
                  onValor={(n) => poner(numero, n)} />
              );
            })}
          </div>
        )}

        {tieneSalpicadero && (
          <div className="calc-salpicadero">
            <h3>{t("Backsplash (included in wall quantities)", "Salpicadero (incluido en las cantidades de pared)")}</h3>
            <div className="calc-grid calc-grid-2">
              <CampoNum id="calc-salp-largo" etiqueta={ETIQUETA_DE_CAMPO.salpicaderoLargoFt![lang]}
                valor={entradas.salpicaderoLargoFt} onValor={(n) => poner("salpicaderoLargoFt", n)} />
              <CampoNum id="calc-salp-alto" etiqueta={ETIQUETA_DE_CAMPO.salpicaderoAltoFt![lang]}
                valor={entradas.salpicaderoAltoFt} onValor={(n) => poner("salpicaderoAltoFt", n)} />
            </div>
            <p className="calc-nota">
              <b>{t("Note", "Nota")}:</b>{" "}
              {t("Backsplash is included above; set either dimension to 0 if not needed.",
                "El salpicadero va incluido arriba; pon cualquiera de las dos medidas en 0 si no lo necesitas.")}
            </p>
          </div>
        )}
      </div>

      {/* 02. Materiales a vender (hoja 1, filas 17–33): solo los que usa esta calculadora */}
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
          {t("The list copies each line as qty unit — material (only items with a quantity), under the name of the calculator. Rounding to whole packs is unavoidable.",
            "La lista copia cada línea como cantidad unidad — material (solo los que llevan cantidad), bajo el nombre de la calculadora. Redondear a paquetes enteros es inevitable.")}
        </p>
        <TablaReducida id={TABLA_ID} columnas={columnas} filas={filasVisibles} claveDe={(f) => f.clave} />
        <div className="calc-notas">
          {tieneSalpicadero && (
            <p><b>{t("Backsplash", "Salpicadero")}:</b> {t(
              "Backsplash is included in wall tile / wall thinset / wall grout quantities. No separate backsplash tile order.",
              "El salpicadero va incluido en las cantidades de loseta, pegamento y lechada de pared. No hay pedido separado de loseta para salpicadero.")}</p>
          )}
          <p><b>{t("Notes", "Notas")}:</b> {t(
            "No extra material for cutting/breakage. Rounding whole packs is unavoidable.",
            "No hay material extra por corte ni rotura. Redondear a paquetes enteros es inevitable.")}
            {sel.notaDeLiner && " " + t(
              "Liner upturn is a required shape allowance, not waste.",
              "La subida del liner es una previsión de forma requerida, no desperdicio.")}</p>
        </div>
      </div>

      {/* 03. Áreas calculadas (hoja 1, filas 40–43): solo las que usa esta calculadora */}
      <div className="card">
        <h2>03 · {t("Calculated surface areas", "Áreas calculadas")}</h2>
        <div className="calc-stats">
          {areasVisibles.map((clave) => (
            <div key={clave} className="calc-stat">
              <span className="hint">{etiquetasDeArea[clave]}</span>
              <button type="button" className="calc-link" aria-haspopup="dialog" data-explica-area={clave}
                onClick={(ev) => abrirExplicacion(etiquetasDeArea[clave], resultado.explicacionAreas[clave], ev.currentTarget)}>
                <b>{cifra(resultado.areas[clave])}</b>
              </button>
            </div>
          ))}
        </div>
      </div>

      <AjustesDelProducto visibles={sel.ajustes} ajustes={ajustes} onCambio={ponerAjuste} onRestablecer={() => setAjustes(AJUSTES_POR_DEFECTO)} />
      <Glosario tipo={tipo} />

      {explicando && (
        <TarjetaDeExplicacion titulo={explicando.titulo} explicacion={explicando.explicacion} onCerrar={cerrarExplicacion} />
      )}
    </div>
  );
}

/** Las habitaciones de la calculadora de piso: cada una con su nombre, largo y ancho; se suman. */
function EditorDeHabitaciones({ filas, areaTexto, onCambio }: {
  filas: Habitacion[]; areaTexto: string; onCambio: (filas: Habitacion[]) => void;
}) {
  const { t } = usePrefs();
  const cambiar = (i: number, patch: Partial<Habitacion>) => onCambio(filas.map((f, j) => (j === i ? { ...f, ...patch } : f)));
  const agregar = () => onCambio([...filas, { nombre: `${t("Room", "Habitación")} ${filas.length + 1}`, largoFt: 0, anchoFt: 0 }]);
  const quitar = (i: number) => onCambio(filas.filter((_, j) => j !== i));
  return (
    <div className="calc-filas-medida">
      {filas.map((h, i) => (
        <div className="calc-fila-medida" key={i}>
          <div className="field calc-nombre">
            <label htmlFor={`calc-hab-${i}-nombre`}>{t("Room name", "Nombre de la habitación")}</label>
            <input id={`calc-hab-${i}-nombre`} type="text" className="calc-entrada" value={h.nombre} maxLength={40}
              onChange={(e) => cambiar(i, { nombre: e.target.value })} />
          </div>
          <CampoNum id={`calc-hab-${i}-largo`} etiqueta={t("Length (ft)", "Largo (ft)")} valor={h.largoFt} onValor={(n) => cambiar(i, { largoFt: n })} />
          <CampoNum id={`calc-hab-${i}-ancho`} etiqueta={t("Width (ft)", "Ancho (ft)")} valor={h.anchoFt} onValor={(n) => cambiar(i, { anchoFt: n })} />
          <button type="button" className="btn btn-sm btn-ghost calc-quitar" disabled={filas.length === 1}
            aria-label={t(`Remove room ${i + 1}`, `Quitar habitación ${i + 1}`)} onClick={() => quitar(i)}>✕</button>
        </div>
      ))}
      <div className="calc-cab">
        <button type="button" className="btn btn-sm btn-ghost" disabled={filas.length >= MAX_FILAS_DE_MEDIDA} onClick={agregar}>
          + {t("Add room", "Agregar habitación")}
        </button>
        <span className="hint">{t("Total floor area", "Área de piso total")}: <b>{areaTexto}</b> SF</span>
      </div>
    </div>
  );
}

/**
 * «Cómo sale»: una tarjeta encima de la página (no navega). Muestra la fórmula, los pasos con las cifras puestas, lo que
 * usa y la línea de cierre. Se cierra con «Cerrar», con Esc o tocando fuera; el foco vuelve al número que la abrió.
 */
function TarjetaDeExplicacion({ titulo, explicacion, onCerrar }: {
  titulo: string; explicacion: Explicacion; onCerrar: () => void;
}) {
  const { t, lang } = usePrefs();
  const cerrarRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    cerrarRef.current?.focus();
    const alTeclear = (ev: KeyboardEvent) => {
      if (ev.key === "Escape") { ev.preventDefault(); onCerrar(); }
      // Único botón enfocable de la tarjeta: el Tab se queda ahí en vez de pasar a la página de atrás.
      else if (ev.key === "Tab") { ev.preventDefault(); cerrarRef.current?.focus(); }
    };
    document.addEventListener("keydown", alTeclear);
    return () => document.removeEventListener("keydown", alTeclear);
  }, [onCerrar]);

  return (
    <div className="overlay" data-explicacion onClick={(ev) => { if (ev.target === ev.currentTarget) onCerrar(); }}>
      <div className="modal calc-explica" role="dialog" aria-modal="true" aria-labelledby="calc-explica-titulo">
        <h3 id="calc-explica-titulo">{titulo}</h3>
        <p className="calc-formula">{explicacion.formula[lang]}</p>
        <ol className="calc-pasos">
          {explicacion.pasos.map((p, i) => <li key={i}>{p[lang]}</li>)}
        </ol>
        {explicacion.usa.length > 0 && (
          <>
            <h4>{t("Inputs and settings it uses", "Entradas y ajustes que usa")}</h4>
            <ul className="calc-usa">
              {explicacion.usa.map((u, i) => <li key={i}>{u[lang]}</li>)}
            </ul>
          </>
        )}
        <p className="calc-cierre">{explicacion.cierre[lang]}</p>
        <div className="modal-actions">
          <button ref={cerrarRef} type="button" className="btn btn-ghost" onClick={onCerrar}>{t("Close", "Cerrar")}</button>
        </div>
      </div>
    </div>
  );
}

/** Ajustes de «Product Settings» (hoja 2) que usa esta calculadora: editables, con su unidad y su nota, y restablecer. */
function AjustesDelProducto({ visibles: claves, ajustes, onCambio, onRestablecer }: {
  visibles: (keyof AjustesCalculadora)[];
  ajustes: AjustesCalculadora;
  onCambio: <K extends keyof AjustesCalculadora>(k: K, v: number) => void;
  onRestablecer: () => void;
}) {
  const { t, lang } = usePrefs();
  const visibles = AJUSTES_META.filter((m) => claves.includes(m.clave));
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
        {visibles.map((m) => {
          const id = `calc-ajuste-${m.clave}`;
          return (
            <div key={m.clave} className="field calc-ajuste">
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
            </div>
          );
        })}
      </div>
    </details>
  );
}

/**
 * Glosario de la hoja 2 (columnas G y H), tal como sale en la hoja. Cada término lleva las calculadoras para las que
 * importa; lo que no aplica a la calculadora elegida no sale.
 */
const TODAS_LAS_CALCULADORAS: TipoDeProyecto[] = ["Shower", "Flooring Only", "Wall Only"];
const GLOSARIO: readonly { titulo: string; filas: readonly [string, string, readonly TipoDeProyecto[]][] }[] = [
  {
    titulo: "Términos / Terms",
    filas: [
      ["Grout / Boquilla", "Fills grout joints between tiles", TODAS_LAS_CALCULADORAS],
      ["Joint / Junta", "Gap or seam between tiles", TODAS_LAS_CALCULADORAS],
      ["Thinset / Pegamento / Cemento para loseta", "Tile-setting mortar; different from grout", TODAS_LAS_CALCULADORAS],
      ["Mortar bed / Mortero seco", "Builds a sloped shower pan base", ["Shower"]],
      ["Backerboard / Cement board", "Tile backing panel", ["Shower", "Wall Only"]],
      ["Mesh tape / Malla para juntas", "Reinforces seams between backerboards", ["Shower", "Wall Only"]],
      ["Pan liner / Cuero de marrano", "Waterproof liner beneath mortar bed", ["Shower"]],
      ["Silicone / Silicón", "Flexible sealant at corners and plane changes", ["Shower", "Wall Only"]],
      ["Mosaic / Mosaico", "Small tiles on mesh; estimate grout using individual chip dimensions", TODAS_LAS_CALCULADORAS],
    ],
  },
  {
    titulo: "Campos de la calculadora / Calculator fields",
    filas: [
      ["Floor joint width (in)", "Grout spacing between neighboring floor tiles (not the floor-to-wall corner).", ["Shower", "Flooring Only"]],
      ["Mosaic vs. regular tile", "Use the actual individual mosaic chip dimensions, not the full mesh sheet size, to estimate grout.", TODAS_LAS_CALCULADORAS],
      ["Liner upturn (in)", "How high the waterproof pan liner rises up the walls, measured in inches.", ["Shower"]],
      ["Pan liner extra edge (in)", "Optional material added to each side if required by the shower design; defaults to zero, not automatic waste.", ["Shower"]],
      ["Grout coverage (SF/bag)", "Floor or wall area covered by one 25-lb grout bag; depends on tile and joint size.", TODAS_LAS_CALCULADORAS],
      ["Backsplash", "A standard 1 ft × 3 ft backsplash is 3 SF and is included in wall area, not added twice.", ["Shower", "Wall Only"]],
      ["Rooms / Walls", "Floor calculator: each room is length × width, added together. Wall calculator: each wall is height × length minus its openings.", ["Flooring Only", "Wall Only"]],
    ],
  },
  {
    titulo: "Tamaño de loseta vs. cajas / Tile size vs. boxes",
    filas: [["Tile box count", "Tile box quantity = area needed ÷ SF per box, rounded up. Tile dimensions are not needed.", TODAS_LAS_CALCULADORAS]],
  },
  {
    titulo: "Referencia de suministro (ducha estándar 3×5×8) / Supply benchmark",
    filas: [
      ["Backerboard", "7 sheets (3×5), sold in LF per store preference", ["Shower"]],
      ["Pan liner", "1 piece (5×7)", ["Shower"]],
      ["Mortar bed", "5 bags (44 lb)", ["Shower"]],
      ["Waterproofing", "3 gallons; choose Crest OR Hydrorite OR Cemix", ["Shower"]],
      ["Thinset", "4–5 bags; choose ONE listed product", ["Shower"]],
      ["Mesh / screws / grout", "1 roll / 1 box of 575+ / 1 bag", ["Shower"]],
    ],
  },
];

function Glosario({ tipo }: { tipo: TipoDeProyecto }): ReactNode {
  const { t } = usePrefs();
  const bloques = GLOSARIO
    .map((g) => ({ ...g, filas: g.filas.filter(([, , usa]) => usa.includes(tipo)) }))
    .filter((g) => g.filas.length > 0);
  return (
    <details className="card calc-glosario">
      <summary><h2 style={{ display: "inline" }}>{t("Glossary", "Glosario")}</h2></summary>
      {bloques.map((g) => (
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
