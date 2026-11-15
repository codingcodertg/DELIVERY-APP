"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { usePrefs } from "@/lib/prefs";
import { CampoDecimal } from "@/components/CampoDecimal";
import { TablaEstandar, type ColumnaEstandar } from "@/components/TablaEstandar";
import {
  calcular, desglosar, dinero, IMPUESTO_EN_DESGLOSE, porcentaje, precioDe,
  type ArticuloMaterial, type ConceptoDeMano, type DatosTurnkey, type Entradas, type FilaFinanciera, type FormaDePago,
  type Resultado,
} from "@/lib/estimator/turnkey";
import { cargaTurnkey } from "./turnkey-actions";

/**
 * Turnkey (T-0408, la plantilla de Excel del dueño): material + mano de obra + financiamiento, para una casa completa.
 *
 * Solo la abre el admin: `Estimador.tsx` la carga con `next/dynamic` únicamente cuando la pestaña se ve, y los precios,
 * planes y tasas de descuento llegan por `cargaTurnkey()` (que vuelve a comprobar el rol en el servidor). Aquí solo hay
 * presentación: la cuenta está en `lib/estimator/turnkey.ts`.
 *
 * Lo que la persona escribe (cantidades, precios que cambió, el plan del desglose) se guarda en este navegador. Si
 * no hay nada guardado, arranca con la plantilla del dueño, que da las cifras de la hoja.
 */

const CLAVE_GUARDADO = "rtg_estimator_turnkey_v1";

/** Notas que la hoja pone en los encabezados de sección (texto del dueño). */
const NOTA_TILE = "**PLUS SIZE TILE";
const NOTA_INSTALACION = "Includes moving furniture, installing the base board / quarter round, transition moldings, and underlayments.";
const NOTA_ENTREGA = "Depends on city and closest store";

const FORMA: Record<FormaDePago, { en: string; es: string }> = {
  "All Upfront": { en: "All upfront", es: "De contado" },
  "Reduced (Fixed Pmt)": { en: "Reduced (fixed pmt)", es: "Reducido (pago fijo)" },
  "Deferred (W/ Pmt)": { en: "Deferred (with pmt)", es: "Diferido (con pagos)" },
  "Equal (No Int)": { en: "Equal, no interest", es: "Pagos iguales, sin interés" },
};

function numeros(x: unknown): Record<string, number> {
  const out: Record<string, number> = {};
  if (x && typeof x === "object") {
    for (const [k, v] of Object.entries(x)) if (typeof v === "number" && Number.isFinite(v)) out[k] = v;
  }
  return out;
}

/** Lo guardado en este navegador, o null. Cualquier fallo (sin acceso, JSON roto) cuenta como «no hay nada». */
function leeGuardado(): Entradas | null {
  try {
    const crudo = localStorage.getItem(CLAVE_GUARDADO);
    if (!crudo) return null;
    const v = JSON.parse(crudo) as Partial<Entradas> | null;
    if (!v || typeof v !== "object") return null;
    return {
      cantidades: numeros(v.cantidades),
      precios: numeros(v.precios),
      planDesglose: typeof v.planDesglose === "string" ? v.planDesglose : "Plan 922",
    };
  } catch {
    return null;
  }
}

function guardaEntradas(e: Entradas): void {
  try {
    localStorage.setItem(CLAVE_GUARDADO, JSON.stringify(e));
  } catch {
    // Sin almacenamiento (modo privado, cuota llena): la pantalla sigue funcionando, solo no recuerda.
  }
}

function borraGuardado(): void {
  try {
    localStorage.removeItem(CLAVE_GUARDADO);
  } catch {
    // Igual que arriba.
  }
}

export default function Turnkey() {
  const { t, lang } = usePrefs();
  const nombre = (x: { en: string; es: string }) => (lang === "es" ? x.es : x.en);

  const [datos, setDatos] = useState<DatosTurnkey | null>(null);
  const [fallo, setFallo] = useState(false);
  const [entradas, setEntradas] = useState<Entradas | null>(() => leeGuardado());

  useEffect(() => {
    let vivo = true;
    cargaTurnkey()
      .then((r) => { if (vivo) (r.ok ? setDatos(r.datos) : setFallo(true)); })
      .catch(() => { if (vivo) setFallo(true); });
    return () => { vivo = false; };
  }, []);

  const efectivas: Entradas | null = entradas ?? datos?.plantilla ?? null;

  useEffect(() => {
    if (entradas) guardaEntradas(entradas);
  }, [entradas]);

  /** Cambia una entrada sobre la base que se ve (lo guardado, o la plantilla si nunca se tocó). */
  const cambia = (fn: (e: Entradas) => Entradas) => {
    if (!datos) return;
    setEntradas((prev) => fn(prev ?? datos.plantilla));
  };
  const setCantidad = (id: string, n: number | null) => cambia((e) => ({ ...e, cantidades: { ...e.cantidades, [id]: n ?? 0 } }));
  const setPrecio = (id: string, n: number | null) => cambia((e) => ({ ...e, precios: { ...e.precios, [id]: n ?? 0 } }));
  const quitaPrecio = (id: string) => cambia((e) => {
    const precios = { ...e.precios };
    delete precios[id];
    return { ...e, precios };
  });
  const quitaTodosLosPrecios = () => cambia((e) => ({ ...e, precios: {} }));
  const setPlanDesglose = (plan: string) => cambia((e) => ({ ...e, planDesglose: plan }));
  const volverAPlantilla = () => { borraGuardado(); setEntradas(null); };

  const res: Resultado | null = useMemo(() => (datos && efectivas ? calcular(efectivas, datos) : null), [datos, efectivas]);

  if (fallo) {
    return <p className="est-aviso rojo">{t("Turnkey is for admins only, and it could not be loaded.", "Turnkey es solo para admins, y no se pudo cargar.")}</p>;
  }
  if (!datos || !efectivas || !res) {
    return <p className="hint">{t("Loading Turnkey…", "Cargando Turnkey…")}</p>;
  }

  const planSel = efectivas.planDesglose;
  const desglose = desglosar(res, planSel);
  const hayPreciosEditados = Object.keys(efectivas.precios).length > 0;

  // ---- Material -------------------------------------------------------------------------------------------------------
  const gruposMaterial: { id: ArticuloMaterial["grupo"]; en: string; es: string }[] = [
    { id: "preparacion", en: "Prep / setting material", es: "Material de preparación y pegado" },
    { id: "losa", en: "Tile below 48×48", es: "Azulejo menor a 48×48" },
    { id: "otros", en: "Other (flooring)", es: "Otros (piso)" },
  ];

  // ---- Columnas del plan -----------------------------------------------------------------------------------------------
  const columnasPlanes: ColumnaEstandar<FilaFinanciera>[] = [
    { key: "plan", en: "Plan", es: "Plan", valor: (f) => f.plan, fija: true, ancho: 110 },
    { key: "forma", en: "Type", es: "Tipo", valor: (f) => nombre(FORMA[f.forma]), ancho: 170 },
    { key: "descripcion", en: "Description", es: "Descripción", valor: (f) => f.descripcion || null, ancho: 300, envuelve: true },
    { key: "apr", en: "APR", es: "APR", valor: (f) => f.apr || null, celda: (f) => (f.apr ? porcentaje(f.apr) : "—"), numerico: true, clase: "num", ancho: 80 },
    {
      key: "plazo", en: "Timeframe (mo)", es: "Plazo (meses)", valor: (f) => f.plazo || null,
      celda: (f) => (f.plazo ? f.plazo.toFixed(f.plazo % 1 ? 1 : 0) : "—"), numerico: true, clase: "num", ancho: 110,
    },
    { key: "mensual", en: "Monthly payment", es: "Pago mensual", valor: (f) => f.mensual, celda: (f) => dinero(f.mensual), numerico: true, clase: "num", ancho: 125 },
    { key: "precio", en: "Price w/ fin & tax", es: "Precio con fin. e imp.", valor: (f) => f.precio, celda: (f) => dinero(f.precio), numerico: true, clase: "num", ancho: 150 },
    { key: "margen", en: "Margin", es: "Margen", valor: (f) => f.margen, celda: (f) => porcentaje(f.margen), numerico: true, clase: "num", ancho: 95 },
    { key: "utilidad", en: "Profit", es: "Utilidad", valor: (f) => f.utilidad, celda: (f) => dinero(f.utilidad), numerico: true, clase: "num", ancho: 110 },
    { key: "descuento", en: "Disc. rate", es: "Tasa de descuento", valor: (f) => f.descuento, celda: (f) => porcentaje(f.descuento), numerico: true, clase: "num", ancho: 110, oculta: true },
    { key: "negocio", en: "Business ($)", es: "Negocio ($)", valor: (f) => f.negocio, celda: (f) => dinero(f.negocio), numerico: true, clase: "num", ancho: 110, oculta: true },
    { key: "pagosIguales", en: "Equal pmts", es: "Pagos iguales", valor: (f) => f.pagosIguales, celda: (f) => dinero(f.pagosIguales), numerico: true, clase: "num", ancho: 110, oculta: true },
    { key: "interes", en: "Interest", es: "Interés", valor: (f) => f.interes, celda: (f) => dinero(f.interes), numerico: true, clase: "num", ancho: 110, oculta: true },
    { key: "total", en: "Sum", es: "Suma", valor: (f) => f.total, celda: (f) => dinero(f.total), numerico: true, clase: "num", ancho: 110, oculta: true },
    { key: "porSF", en: "$ / SF", es: "$ / SF", valor: (f) => f.porSF, celda: (f) => dinero(f.porSF), numerico: true, clase: "num", ancho: 90, oculta: true },
    { key: "costoPorSF", en: "Cost / SF", es: "Costo / SF", valor: (f) => f.costoPorSF, celda: (f) => dinero(f.costoPorSF), numerico: true, clase: "num", ancho: 90, oculta: true },
    { key: "descuentoPct", en: "Disc. % vs top", es: "Desc. % vs máximo", valor: (f) => f.descuentoPct, celda: (f) => porcentaje(f.descuentoPct), numerico: true, clase: "num", ancho: 120, oculta: true },
    { key: "descuentoDolar", en: "Disc. $ vs top", es: "Desc. $ vs máximo", valor: (f) => f.descuentoDolar, celda: (f) => dinero(f.descuentoDolar), numerico: true, clase: "num", ancho: 120, oculta: true },
    { key: "restricciones", en: "Restrictions", es: "Restricciones", valor: (f) => f.restricciones ?? null, envuelve: true, ancho: 220, oculta: true },
  ];

  return (
    <div className="tk-wrap" data-turnkey>
      <header className="tk-cabecera">
        <h1>Turnkey</h1>
        <p className="hint" style={{ margin: "2px 0 0" }}>
          {t("Material + labor + financing for a full job. Admin only: costs, margins and discount rates.",
            "Material + mano de obra + financiamiento de un trabajo completo. Solo admin: costos, márgenes y tasas de descuento.")}
        </p>
        <div className="est-acciones" style={{ marginTop: 8 }}>
          <button type="button" className="btn btn-sm btn-ghost" data-tk-accion="precios" disabled={!hayPreciosEditados} onClick={quitaTodosLosPrecios}>
            ↺ {t("Reset prices to sheet", "Restablecer precios de la hoja")}
          </button>
          <button type="button" className="btn btn-sm btn-ghost" data-tk-accion="plantilla" onClick={volverAPlantilla}>
            ↺ {t("Back to the owner's template", "Volver a la plantilla del dueño")}
          </button>
        </div>
      </header>

      {/* ---- MATERIAL ---------------------------------------------------------------------------------------------- */}
      <section className="tk-seccion" data-tk-seccion="material">
        <h2>{t("Material", "Material")}</h2>
        <div className="tk-scroll">
          <table className="tk-tabla">
            <thead>
              <tr>
                <th>{t("Item", "Concepto")}</th>
                <th className="num">{t("Retail price", "Precio de venta")}</th>
                <th className="num">{t("SF / #", "SF / #")}</th>
                <th className="num">{t("Total", "Total")}</th>
              </tr>
            </thead>
            <tbody>
              {gruposMaterial.map((g) => (
                <FragmentoMaterial key={g.id} titulo={nombre(g)} articulos={datos.materiales.filter((a) => a.grupo === g.id)}
                  filas={res.material.filas} precios={efectivas.precios} nombre={nombre}
                  onPrecio={setPrecio} onCantidad={setCantidad} onQuitarPrecio={quitaPrecio} t={t} />
              ))}
            </tbody>
          </table>
        </div>
        <dl className="tk-resumen">
          <div><dt>{t("Flooring SF", "SF de piso")}</dt><dd>{res.material.sf}</dd></div>
          <div><dt>{t("Setting material", "Material de pegado")}</dt><dd>{dinero(res.material.preparacion)}</dd></div>
          <div><dt>{t("Flooring material", "Material de piso")}</dt><dd>{dinero(res.material.piso)}</dd></div>
          <div><dt>{t("Material total", "Total de material")}</dt><dd>{dinero(res.material.total)}</dd></div>
        </dl>
      </section>

      {/* ---- MANO DE OBRA ------------------------------------------------------------------------------------------ */}
      <section className="tk-seccion" data-tk-seccion="mano">
        <h2>{t("Labor", "Mano de obra")}</h2>
        <div className="tk-scroll">
          <table className="tk-tabla">
            <thead>
              <tr>
                <th>{t("Item", "Concepto")}</th>
                <th className="num">{t("Pay", "Pago")}</th>
                <th className="num">{t("SF / #", "SF / #")}</th>
                <th className="num">{t("Total", "Total")}</th>
              </tr>
            </thead>
            <tbody>
              <GrupoMano titulo={t("Removal", "Remoción")} conceptos={datos.removal} filas={res.mano.filas} precios={efectivas.precios}
                nombre={nombre} onPrecio={setPrecio} onCantidad={setCantidad} onQuitarPrecio={quitaPrecio} t={t} />
              <GrupoMano titulo={t("Installation: tile", "Instalación: azulejo")} conceptos={datos.instalacion.filter((c) => c.seccion === "tile")}
                filas={res.mano.filas} precios={efectivas.precios} nombre={nombre} onPrecio={setPrecio} onCantidad={setCantidad} onQuitarPrecio={quitaPrecio} t={t}
                nota={NOTA_TILE} />
              <GrupoMano titulo={t("Installation: laminate", "Instalación: laminado")} conceptos={datos.instalacion.filter((c) => c.seccion === "laminate")}
                filas={res.mano.filas} precios={efectivas.precios} nombre={nombre} onPrecio={setPrecio} onCantidad={setCantidad} onQuitarPrecio={quitaPrecio} t={t}
                nota={NOTA_INSTALACION} />
              <GrupoMano titulo={t("Installation: vinyl", "Instalación: vinilo")} conceptos={datos.instalacion.filter((c) => c.seccion === "vinyl")}
                filas={res.mano.filas} precios={efectivas.precios} nombre={nombre} onPrecio={setPrecio} onCantidad={setCantidad} onQuitarPrecio={quitaPrecio} t={t} />
              <GrupoMano titulo={t("Installation: carpet", "Instalación: alfombra")} conceptos={datos.instalacion.filter((c) => c.seccion === "carpet")}
                filas={res.mano.filas} precios={efectivas.precios} nombre={nombre} onPrecio={setPrecio} onCantidad={setCantidad} onQuitarPrecio={quitaPrecio} t={t} />
              <GrupoMano titulo={t("Installation: other", "Instalación: otros")} conceptos={datos.instalacion.filter((c) => c.seccion === "otros")}
                filas={res.mano.filas} precios={efectivas.precios} nombre={nombre} onPrecio={setPrecio} onCantidad={setCantidad} onQuitarPrecio={quitaPrecio} t={t} />
              <GrupoMano titulo={t("Appliances", "Electrodomésticos y aparatos")} conceptos={datos.extras.filter((c) => c.seccion === "aparatos")}
                filas={res.mano.filas} precios={efectivas.precios} nombre={nombre} onPrecio={setPrecio} onCantidad={setCantidad} onQuitarPrecio={quitaPrecio} t={t} />
              <GrupoMano titulo={t("Delivery and stairs", "Entrega y escaleras")} conceptos={datos.extras.filter((c) => c.seccion === "entrega")}
                filas={res.mano.filas} precios={efectivas.precios} nombre={nombre} onPrecio={setPrecio} onCantidad={setCantidad} onQuitarPrecio={quitaPrecio} t={t}
                nota={NOTA_ENTREGA} />
              <GrupoMano titulo={t("Cleanup", "Limpieza")} conceptos={datos.extras.filter((c) => c.seccion === "limpieza")}
                filas={res.mano.filas} precios={efectivas.precios} nombre={nombre} onPrecio={setPrecio} onCantidad={setCantidad} onQuitarPrecio={quitaPrecio} t={t} />
            </tbody>
          </table>
        </div>
        <dl className="tk-resumen">
          <div><dt>{t("Removal SF", "SF de remoción")}</dt><dd>{res.mano.removal.sf}</dd></div>
          <div><dt>{t("Install SF (base)", "SF de instalación (base)")}</dt><dd>{res.mano.sf}</dd></div>
          <div><dt>{t("Laminate days", "Días de laminado")}</dt><dd>{res.mano.dias}</dd></div>
          <div><dt>{t("Removal", "Remoción")}</dt><dd>{dinero(res.mano.removal.total)}</dd></div>
          <div><dt>{t("Installation", "Instalación")}</dt><dd>{dinero(res.mano.instalacion.total)}</dd></div>
          <div><dt>{t("Extras", "Extras")}</dt><dd>{dinero(res.mano.extras.total)}</dd></div>
          <div><dt>{t("Labor total", "Total de mano de obra")}</dt><dd>{dinero(res.mano.total)}</dd></div>
        </dl>
      </section>

      {/* ---- FINANCIAMIENTO ---------------------------------------------------------------------------------------- */}
      <section className="tk-seccion" data-tk-seccion="financiamiento">
        <h2>{t("Financing", "Financiamiento")}</h2>
        <p className="tk-precio-contado">
          {t("Cash price", "Precio de contado")} <strong>${dinero(res.contado)}</strong>
        </p>
        <TablaEstandar<FilaFinanciera>
          id="turnkey-planes" data-tabla="turnkey-planes" sinCaja
          filas={res.planes} claveDe={(f) => String(f.fila)} columnas={columnasPlanes}
          claseDeFila={(f) => (f.plan === planSel ? "tk-fila-sel" : undefined)}
        />
        <p className="hint" style={{ marginBottom: 0 }}>
          {t("Highlighted row = the plan shown in Breakdown. Hidden columns: use ⚙ Columns.",
            "La fila marcada es el plan del desglose. Las columnas ocultas están en ⚙ Columnas.")}
        </p>
      </section>

      {/* ---- DESGLOSE ---------------------------------------------------------------------------------------------- */}
      <section className="tk-seccion" data-tk-seccion="desglose">
        <h2>{t("Breakdown", "Desglose")}</h2>
        <label htmlFor="tk-plan">{t("Plan", "Plan")}</label>
        <select id="tk-plan" value={planSel} onChange={(e) => setPlanDesglose(e.target.value)}>
          {res.planes.map((f) => (
            <option key={f.plan} value={f.plan}>{f.plan} · {f.descripcion || nombre(FORMA[f.forma])}</option>
          ))}
        </select>
        {desglose && (
          <dl className="tk-resumen" data-tk-desglose>
            <div><dt>{t("Revenue", "Ingreso")}</dt><dd>{dinero(desglose.ingreso)}</dd></div>
            <div><dt>{t("Labor", "Mano de obra")}</dt><dd>{dinero(desglose.mano)}</dd></div>
            <div><dt>{t("Material", "Material")}</dt><dd>{dinero(desglose.material)}</dd></div>
            <div><dt>{t("Fees & tax", "Cargos e impuesto")}</dt><dd>{dinero(desglose.cargosEImpuesto)}</dd></div>
            <div><dt>{t("Profit", "Utilidad")}</dt><dd>{dinero(desglose.utilidad)}</dd></div>
            <div><dt>{t("Margin", "Margen")}</dt><dd>{porcentaje(desglose.margen)}</dd></div>
            <div><dt>{t("Fin fee (disc. rate)", "Comisión fin. (tasa de descuento)")}</dt><dd>{porcentaje(desglose.finanzas)}</dd></div>
            <div><dt>{t("Tax", "Impuesto")}</dt><dd>{porcentaje(IMPUESTO_EN_DESGLOSE)}</dd></div>
          </dl>
        )}
        <p className="hint" style={{ marginBottom: 0 }}>
          {t("As in the sheet: profit is labor + material on every plan; the financing discount and the tax go into fees & tax.",
            "Como en la hoja: la utilidad es mano de obra + material en todos los planes; el descuento y el impuesto van en cargos e impuesto.")}
        </p>
      </section>
    </div>
  );
}

// ---- piezas de tabla ---------------------------------------------------------------------------------------------------

type Tr = (en: string, es: string) => string;

function Nota({ texto, t }: { texto?: string; t: Tr }): ReactNode {
  if (!texto) return null;
  return <span className="tk-nota">{t("Sheet: ", "Hoja: ")}{texto}</span>;
}

/** Un concepto de material: precio editable (con ↺ si cambió), cantidad editable; el monto fijo no pide cantidad. */
function FilaMaterial({ a, fila, editado, nombre, onPrecio, onCantidad, onQuitarPrecio, t }: {
  a: ArticuloMaterial; fila: { precio: number; cantidad: number; total: number } | undefined; editado: boolean;
  nombre: (x: { en: string; es: string }) => string;
  onPrecio: (id: string, n: number | null) => void; onCantidad: (id: string, n: number | null) => void;
  onQuitarPrecio: (id: string) => void; t: Tr;
}) {
  const precio = fila?.precio ?? a.precio;
  const cantidad = fila?.cantidad ?? 0;
  return (
    <tr data-tk-fila={a.id}>
      <td>
        {nombre(a)}
        {editado && <span className="tk-nota">{t("price changed for this job", "precio cambiado para este trabajo")}</span>}
        <Nota texto={a.nota} t={t} />
      </td>
      <td className="num">
        <CampoDecimal className="tk-num" aria-label={a.fijo ? t("Fixed amount", "Monto fijo") : t("Retail price", "Precio de venta")}
          value={precio} onValor={(n) => onPrecio(a.id, n)} />
        {editado && (
          <button type="button" className="btn btn-ghost btn-sm" title={t("Back to the sheet price", "Volver al precio de la hoja")}
            onClick={() => onQuitarPrecio(a.id)}>↺</button>
        )}
      </td>
      <td className="num">
        {a.fijo ? "1" : <CampoDecimal className="tk-num" aria-label={t("SF / #", "SF / #")} value={cantidad} onValor={(n) => onCantidad(a.id, n)} />}
      </td>
      <td className="num">{dinero(fila?.total ?? 0)}</td>
    </tr>
  );
}

function FragmentoMaterial({ titulo, articulos, filas, precios, nombre, onPrecio, onCantidad, onQuitarPrecio, t }: {
  titulo: string; articulos: ArticuloMaterial[]; filas: Record<string, { precio: number; cantidad: number; total: number }>;
  precios: Record<string, number>; nombre: (x: { en: string; es: string }) => string;
  onPrecio: (id: string, n: number | null) => void; onCantidad: (id: string, n: number | null) => void;
  onQuitarPrecio: (id: string) => void; t: Tr;
}) {
  return (
    <>
      <tr className="tk-grupo"><th colSpan={4}>{titulo}</th></tr>
      {articulos.map((a) => (
        <FilaMaterial key={a.id} a={a} fila={filas[a.id]} editado={a.id in precios} nombre={nombre}
          onPrecio={onPrecio} onCantidad={onCantidad} onQuitarPrecio={onQuitarPrecio} t={t} />
      ))}
    </>
  );
}

/** Un grupo de conceptos de mano de obra. La fórmula (gas, escaleras) muestra su cantidad sin dejarla escribir. */
function GrupoMano({ titulo, conceptos, filas, precios, nombre, onPrecio, onCantidad, onQuitarPrecio, t, nota }: {
  titulo: string; conceptos: ConceptoDeMano[]; filas: Resultado["mano"]["filas"]; precios: Record<string, number>;
  nombre: (x: { en: string; es: string }) => string;
  onPrecio: (id: string, n: number | null) => void; onCantidad: (id: string, n: number | null) => void;
  onQuitarPrecio: (id: string) => void; t: Tr; nota?: string;
}) {
  return (
    <>
      <tr className="tk-grupo"><th colSpan={4}>{titulo}{nota && <span className="tk-nota">{nota}</span>}</th></tr>
      {conceptos.map((c) => {
        const f = filas[c.id];
        const editado = c.id in precios;
        const pago = f?.precio ?? c.pago;
        const cantidad = f?.cantidad ?? 0;
        const soloLectura = c.formula === "gas";
        return (
          <tr key={c.id} data-tk-fila={c.id}>
            <td>
              {nombre(c)}
              {c.fueraDelTotal && <span className="tk-nota">{t("Left out of the labor total, as in the sheet.", "Fuera del total de mano de obra, como en la hoja.")}</span>}
              {editado && <span className="tk-nota">{t("pay changed for this job", "pago cambiado para este trabajo")}</span>}
              <Nota texto={c.nota} t={t} />
            </td>
            <td className="num">
              <CampoDecimal className="tk-num" aria-label={t("Pay", "Pago")} value={pago} onValor={(n) => onPrecio(c.id, n)} />
              {editado && (
                <button type="button" className="btn btn-ghost btn-sm" title={t("Back to the sheet pay", "Volver al pago de la hoja")}
                  onClick={() => onQuitarPrecio(c.id)}>↺</button>
              )}
            </td>
            <td className="num">
              {soloLectura ? (
                <span title={t("80 × laminate days", "80 × días de laminado")}>{cantidad}</span>
              ) : (
                <CampoDecimal className="tk-num" aria-label={t("SF / #", "SF / #")} value={cantidad} onValor={(n) => onCantidad(c.id, n)} />
              )}
            </td>
            <td className="num">{dinero(f?.total ?? 0)}</td>
          </tr>
        );
      })}
    </>
  );
}
