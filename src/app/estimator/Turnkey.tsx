"use client";

import { useEffect, useState, type ReactNode } from "react";
import { usePrefs } from "@/lib/prefs";
import { CampoDecimal } from "@/components/CampoDecimal";
import { TablaEstandar, type ColumnaEstandar } from "@/components/TablaEstandar";
import {
  calcular, desglosar, dinero, IMPUESTO_EN_DESGLOSE, porcentaje,
  type ArticuloMaterial, type ConceptoDeMano, type DatosTurnkey, type Entradas, type FilaFinanciera, type FormaDePago,
  type Pista, type Resultado,
} from "@/lib/estimator/turnkey";
import { tarifaDeLaCotizacion, type AjustesDeEntrega } from "@/lib/estimator/entrega";
import { entregaVacia, type Delivery } from "@/lib/estimator/modelo";
import { cargaTurnkey } from "./turnkey-actions";
import { EntregaCotizacion } from "./EntregaCotizacion";

/**
 * Turnkey (T-0408, la plantilla de Excel del dueño): material + mano de obra + financiamiento, para un trabajo de piso.
 *
 * Solo la abre el admin: `Estimador.tsx` la carga con `next/dynamic` únicamente cuando la pestaña se ve, y los precios,
 * planes y tasas de descuento llegan por `cargaTurnkey()` (que vuelve a comprobar el rol en el servidor). Aquí solo hay
 * presentación: la cuenta está en `lib/estimator/turnkey.ts`.
 *
 * La entrega del trabajo usa la misma calculadora que la ficha de Entregas y la cotización (`EntregaCotizacion`): la
 * dirección del trabajo, la tienda de salida, las millas y los minutos de la ruta. Lo que la persona escribe (cantidades,
 * precios que cambió, el plan del desglose) y la entrega se guardan en este navegador. Si no hay nada guardado, arranca
 * con la plantilla del dueño, sin dirección.
 */

const CLAVE_GUARDADO = "rtg_estimator_turnkey_v1";
const CLAVE_VIAJE = "rtg_estimator_turnkey_viaje_v1";

/** Notas que la hoja pone en los encabezados de sección (texto del dueño). */
const NOTA_TILE = "**PLUS SIZE TILE";
const NOTA_INSTALACION = "Includes moving furniture, installing the base board / quarter round, transition moldings, and underlayments.";

const FORMA: Record<FormaDePago, { en: string; es: string }> = {
  "All Upfront": { en: "All upfront", es: "De contado" },
  "Reduced (Fixed Pmt)": { en: "Reduced (fixed pmt)", es: "Reducido (pago fijo)" },
  "Deferred (W/ Pmt)": { en: "Deferred (with pmt)", es: "Diferido (con pagos)" },
  "Equal (No Int)": { en: "Equal, no interest", es: "Pagos iguales, sin interés" },
};

/** La entrega del trabajo en este navegador: la dirección (un `Delivery` como el de la cotización) y los minutos de ida. */
interface Viaje {
  entrega: Delivery;
  minutos: number | null;
}

function viajeInicial(): Viaje {
  return { entrega: { ...entregaVacia(), mode: "delivery" }, minutos: null };
}

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

/** La entrega guardada, o null. Igual que `leeGuardado`: lo roto cuenta como «no hay nada». */
function leeViaje(): Viaje | null {
  try {
    const crudo = localStorage.getItem(CLAVE_VIAJE);
    if (!crudo) return null;
    const v = JSON.parse(crudo) as Partial<Viaje> | null;
    if (!v || typeof v !== "object" || !v.entrega || typeof v.entrega !== "object") return null;
    const min = typeof v.minutos === "number" && Number.isFinite(v.minutos) ? v.minutos : null;
    return { entrega: { ...entregaVacia(), ...v.entrega, mode: "delivery" }, minutos: min };
  } catch {
    return null;
  }
}

function guardaViaje(v: Viaje): void {
  try {
    localStorage.setItem(CLAVE_VIAJE, JSON.stringify(v));
  } catch {
    // Igual que arriba.
  }
}

function borraGuardado(): void {
  try {
    localStorage.removeItem(CLAVE_GUARDADO);
    localStorage.removeItem(CLAVE_VIAJE);
  } catch {
    // Igual que arriba.
  }
}

export default function Turnkey({ ajustes }: { ajustes: AjustesDeEntrega }) {
  const { t, lang } = usePrefs();
  const nombre = (x: { en: string; es: string }) => (lang === "es" ? x.es : x.en);

  const [datos, setDatos] = useState<DatosTurnkey | null>(null);
  const [fallo, setFallo] = useState(false);
  const [entradas, setEntradas] = useState<Entradas | null>(() => leeGuardado());
  const [viaje, setViaje] = useState<Viaje>(() => leeViaje() ?? viajeInicial());

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

  useEffect(() => {
    guardaViaje(viaje);
  }, [viaje]);

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
  const volverAPlantilla = () => { borraGuardado(); setEntradas(null); setViaje(viajeInicial()); };

  /** Cambiar la dirección o la tienda borra las millas (y con ellas los minutos): el mismo criterio que la cotización. */
  const ponEntrega = (d: Delivery) => setViaje((v) => ({ entrega: d, minutos: d.miles === null ? null : v.minutos }));
  const ponMinutos = (m: number) => setViaje((v) => ({ ...v, minutos: m }));

  if (fallo) {
    return <p className="est-aviso rojo">{t("Turnkey is for admins only, and it could not be loaded.", "Turnkey es solo para admins, y no se pudo cargar.")}</p>;
  }
  if (!datos || !efectivas) {
    return <p className="hint">{t("Loading Turnkey…", "Cargando Turnkey…")}</p>;
  }

  // El cargo de la entrega: el que la persona eligió (Lista, Descuento o uno escrito); si no eligió, la tarifa de lista.
  const tarifa = tarifaDeLaCotizacion(viaje.entrega, ajustes);
  const cargoEntrega = viaje.entrega.charge ?? tarifa.list ?? null;
  const res: Resultado = calcular({ ...efectivas, entrega: { cargo: cargoEntrega, minutos: viaje.minutos } }, datos);

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
    {
      key: "negocio", en: "Financing fee ($)", es: "Comisión del financiamiento ($)", valor: (f) => f.negocio, celda: (f) => dinero(f.negocio),
      numerico: true, clase: "num", ancho: 150, oculta: true,
    },
    { key: "pagosIguales", en: "Equal pmts", es: "Pagos iguales", valor: (f) => f.pagosIguales, celda: (f) => dinero(f.pagosIguales), numerico: true, clase: "num", ancho: 110, oculta: true },
    { key: "interes", en: "Interest", es: "Interés", valor: (f) => f.interes, celda: (f) => dinero(f.interes), numerico: true, clase: "num", ancho: 110, oculta: true },
    { key: "total", en: "Sum", es: "Suma", valor: (f) => f.total, celda: (f) => dinero(f.total), numerico: true, clase: "num", ancho: 110, oculta: true },
    { key: "porSF", en: "$ / SF", es: "$ / SF", valor: (f) => f.porSF, celda: (f) => dinero(f.porSF), numerico: true, clase: "num", ancho: 90, oculta: true },
    { key: "costoPorSF", en: "Cost / SF", es: "Costo / SF", valor: (f) => f.costoPorSF, celda: (f) => dinero(f.costoPorSF), numerico: true, clase: "num", ancho: 90, oculta: true },
    { key: "descuentoPct", en: "Disc. % vs top", es: "Desc. % vs máximo", valor: (f) => f.descuentoPct, celda: (f) => porcentaje(f.descuentoPct), numerico: true, clase: "num", ancho: 120, oculta: true },
    { key: "descuentoDolar", en: "Disc. $ vs top", es: "Desc. $ vs máximo", valor: (f) => f.descuentoDolar, celda: (f) => dinero(f.descuentoDolar), numerico: true, clase: "num", ancho: 120, oculta: true },
    { key: "restricciones", en: "Restrictions", es: "Restricciones", valor: (f) => f.restricciones ?? null, envuelve: true, ancho: 220, oculta: true },
  ];

  const pistaDe = (p: Pista | undefined, sinSF: true | undefined) => {
    if (p) return <span className="tk-nota">{nombre(p)}</span>;
    if (sinSF) return <span className="tk-nota">{t("Not counted in SF", "No cuenta como SF")}</span>;
    return null;
  };

  return (
    <div className="tk-wrap" data-turnkey>
      <header className="tk-cabecera">
        <h1>Turnkey</h1>
        <p className="hint" style={{ margin: "2px 0 0" }}>
          {t("Material + labor + financing for a floor job. Admin only: costs, margins and discount rates.",
            "Material + mano de obra + financiamiento de un trabajo de piso. Solo admin: costos, márgenes y tasas de descuento.")}
        </p>
        <div className="est-acciones" style={{ marginTop: 8 }}>
          <button type="button" className="btn btn-sm btn-ghost" data-tk-accion="precios" disabled={!hayPreciosEditados} onClick={quitaTodosLosPrecios}>
            ↺ {t("Reset prices to defaults", "Restablecer precios por defecto")}
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
        <p className="hint" style={{ marginBottom: 0 }}>
          {t("Flooring SF counts the floor rows only. Deco is charged per piece.",
            "Los SF de piso cuentan solo las filas de piso. La decoración se cobra por pieza.")}
        </p>
      </section>

      {/* ---- MANO DE OBRA ------------------------------------------------------------------------------------------ */}
      <section className="tk-seccion" data-tk-seccion="mano">
        <h2>{t("Labor", "Mano de obra")}</h2>

        <div className="tk-entrega" data-tk-entrega style={{ marginBottom: 12 }}>
          <h3 style={{ margin: "0 0 6px", fontSize: "1rem" }}>{t("Delivery for this job", "Entrega de este trabajo")}</h3>
          <EntregaCotizacion entrega={viaje.entrega} onEntrega={ponEntrega} onMinutos={ponMinutos} minutos={viaje.minutos}
            ajustes={ajustes} admin t={t} notaCliente={false} />
          <p className="hint" style={{ margin: "6px 0 0" }}>
            {t("The fee is priced like any order. With no charge picked (Lista or Descuento), the list fee is used. It and the extra trips go to the Delivery rows below.",
              "La entrega se cotiza como cualquier orden. Sin cargo elegido (Lista o Descuento), se usa la tarifa de lista. Ella y los viajes extra van a las filas de Entrega de abajo.")}
          </p>
        </div>

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
                nombre={nombre} onPrecio={setPrecio} onCantidad={setCantidad} onQuitarPrecio={quitaPrecio} t={t} pistaDe={pistaDe} />
              <GrupoMano titulo={t("Installation: tile", "Instalación: azulejo")} conceptos={datos.instalacion.filter((c) => c.seccion === "tile")}
                filas={res.mano.filas} precios={efectivas.precios} nombre={nombre} onPrecio={setPrecio} onCantidad={setCantidad} onQuitarPrecio={quitaPrecio} t={t}
                pistaDe={pistaDe} nota={NOTA_TILE} />
              <GrupoMano titulo={t("Installation: laminate", "Instalación: laminado")} conceptos={datos.instalacion.filter((c) => c.seccion === "laminate")}
                filas={res.mano.filas} precios={efectivas.precios} nombre={nombre} onPrecio={setPrecio} onCantidad={setCantidad} onQuitarPrecio={quitaPrecio} t={t}
                pistaDe={pistaDe} nota={NOTA_INSTALACION} />
              <GrupoMano titulo={t("Installation: vinyl", "Instalación: vinilo")} conceptos={datos.instalacion.filter((c) => c.seccion === "vinyl")}
                filas={res.mano.filas} precios={efectivas.precios} nombre={nombre} onPrecio={setPrecio} onCantidad={setCantidad} onQuitarPrecio={quitaPrecio} t={t}
                pistaDe={pistaDe} />
              <GrupoMano titulo={t("Installation: carpet", "Instalación: alfombra")} conceptos={datos.instalacion.filter((c) => c.seccion === "carpet")}
                filas={res.mano.filas} precios={efectivas.precios} nombre={nombre} onPrecio={setPrecio} onCantidad={setCantidad} onQuitarPrecio={quitaPrecio} t={t}
                pistaDe={pistaDe} />
              <GrupoMano titulo={t("Installation: other", "Instalación: otros")} conceptos={datos.instalacion.filter((c) => c.seccion === "otros")}
                filas={res.mano.filas} precios={efectivas.precios} nombre={nombre} onPrecio={setPrecio} onCantidad={setCantidad} onQuitarPrecio={quitaPrecio} t={t}
                pistaDe={pistaDe} />
              <GrupoMano titulo={t("Appliances", "Electrodomésticos y aparatos")} conceptos={datos.extras.filter((c) => c.seccion === "aparatos")}
                filas={res.mano.filas} precios={efectivas.precios} nombre={nombre} onPrecio={setPrecio} onCantidad={setCantidad} onQuitarPrecio={quitaPrecio} t={t}
                pistaDe={pistaDe} />
              <GrupoMano titulo={t("Delivery and stairs", "Entrega y escaleras")} conceptos={datos.extras.filter((c) => c.seccion === "entrega")}
                filas={res.mano.filas} precios={efectivas.precios} nombre={nombre} onPrecio={setPrecio} onCantidad={setCantidad} onQuitarPrecio={quitaPrecio} t={t}
                pistaDe={pistaDe} />
              <GrupoMano titulo={t("Cleanup", "Limpieza")} conceptos={datos.extras.filter((c) => c.seccion === "limpieza")}
                filas={res.mano.filas} precios={efectivas.precios} nombre={nombre} onPrecio={setPrecio} onCantidad={setCantidad} onQuitarPrecio={quitaPrecio} t={t}
                pistaDe={pistaDe} />
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
        <p className="hint" style={{ marginBottom: 0 }}>
          {t("Install SF counts floor rows only. Running-foot rows, steps and per-piece rows are charged but not counted in SF.",
            "Los SF de instalación cuentan solo las filas de piso. Las de pie lineal, escalones y por pieza se cobran, pero no cuentan como SF.")}
        </p>
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
          {t("Profit = labor + material on every plan (price base = (labor + material) × 2). Tax and the financing company's fee are added on top for the customer.",
            "Utilidad = mano de obra + material en todos los planes (base del precio = (mano de obra + material) × 2). El impuesto y la comisión de la financiera se suman encima para el cliente.")}
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

/** Un concepto de material: precio editable (con ↺ si cambió), cantidad editable. */
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
        {a.pista ? <span className="tk-nota">{nombre(a.pista)}</span> : a.sinSF ? <span className="tk-nota">{t("Not counted in SF", "No cuenta como SF")}</span> : null}
        <Nota texto={a.nota} t={t} />
      </td>
      <td className="num">
        <CampoDecimal className="tk-num" aria-label={t("Retail price", "Precio de venta")}
          value={precio} onValor={(n) => onPrecio(a.id, n)} />
        {editado && (
          <button type="button" className="btn btn-ghost btn-sm" title={t("Back to the default price", "Volver al precio por defecto")}
            onClick={() => onQuitarPrecio(a.id)}>↺</button>
        )}
      </td>
      <td className="num">
        <CampoDecimal className="tk-num" aria-label={t("SF / #", "SF / #")} value={cantidad} onValor={(n) => onCantidad(a.id, n)} />
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

/**
 * Un grupo de conceptos de mano de obra. Las filas automáticas (la entrega y los viajes extra) muestran lo que calcula
 * la calculadora de la entrega, sin dejarlo escribir. Las escaleras tienen pago y tramos editables.
 */
function GrupoMano({ titulo, conceptos, filas, precios, nombre, onPrecio, onCantidad, onQuitarPrecio, t, pistaDe, nota }: {
  titulo: string; conceptos: ConceptoDeMano[]; filas: Resultado["mano"]["filas"]; precios: Record<string, number>;
  nombre: (x: { en: string; es: string }) => string;
  onPrecio: (id: string, n: number | null) => void; onCantidad: (id: string, n: number | null) => void;
  onQuitarPrecio: (id: string) => void; t: Tr;
  pistaDe: (p: Pista | undefined, sinSF: true | undefined) => ReactNode;
  nota?: string;
}) {
  return (
    <>
      <tr className="tk-grupo"><th colSpan={4}>{titulo}{nota && <span className="tk-nota">{nota}</span>}</th></tr>
      {conceptos.map((c) => {
        const f = filas[c.id];
        const automatica = c.formula === "entrega" || c.formula === "viajes";
        const editado = c.id in precios;
        const pago = f?.precio ?? c.pago;
        const cantidad = f?.cantidad ?? 0;
        return (
          <tr key={c.id} data-tk-fila={c.id}>
            <td>
              {nombre(c)}
              {editado && <span className="tk-nota">{t("pay changed for this job", "pago cambiado para este trabajo")}</span>}
              {pistaDe(c.pista, c.sinSF)}
              <Nota texto={c.nota} t={t} />
            </td>
            <td className="num">
              {automatica ? (
                <span>{dinero(pago)}</span>
              ) : (
                <>
                  <CampoDecimal className="tk-num" aria-label={t("Pay", "Pago")} value={pago} onValor={(n) => onPrecio(c.id, n)} />
                  {editado && (
                    <button type="button" className="btn btn-ghost btn-sm" title={t("Back to the default pay", "Volver al pago por defecto")}
                      onClick={() => onQuitarPrecio(c.id)}>↺</button>
                  )}
                </>
              )}
            </td>
            <td className="num">
              {automatica ? (
                <span>{cantidad}</span>
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
