"use client";

import { mensajeDeErrorAlCargar } from "@/lib/mensaje-de-error";

import { useEffect, useMemo, useState } from "react";
import { usePrefs } from "@/lib/prefs";
import { createClient } from "@/lib/supabase/client";
import { fmtDateTime, fmtMoney } from "@/lib/utils";
import { TablaEstandar, type ColumnaEstandar } from "@/components/TablaEstandar";
import {
  ETAPAS_DE_CONTEO, INFO_DE_ETAPA_DE_CONTEO, nombreDeEtapaDeConteo, resumenDelConteo, type Conteo, type EstadoDeConteo, type Linea, type OrdenPendiente,
} from "@/lib/almacen-ops/conteos";
import { comparableConElSistema } from "@/lib/almacen-ops/conteos";
import {
  conteosDelPeriodo, colorDeExactitud, kpiDeConteos, kpiPorEmpleado, totalDeConteos, type KpiDeConteos, type Periodo,
} from "@/lib/almacen-ops/conteos-kpi";
import type { Rango } from "@/lib/almacen-ops/rango-de-merma";
import { DEMO_CONTEOS, faltaLa274, leerConteos, type Conteos as Datos } from "@/lib/almacen-ops/conteos-datos";
import type { Contexto } from "./Operaciones";
import { ChipDeEtapaDeConteo } from "./EtapasDeConteo";
import { TarjetaConteo } from "./Conteos";

/**
 * Operaciones de almacén (333): el INFORME de conteos de inventario, en REPORTES (pestaña «Conteos»). Dueño (19 nov):
 * «This is a table like the scrap… This is where I will see all reports… one thing is inputting and another thing is the
 * reports». Aquí van el KPI y la tabla de conteos; la pantalla de conteo no tiene nada de esto.
 * La diferencia es DESPUÉS de las órdenes pendientes (contado − pendiente − sistema). Lo primero que se lee: las CAJAS que
 * faltan («si cada mes faltan 50 cajas, es una bandera roja»).
 *
 * D-1148 (ayuda de Roberto, 2026-11-24, con la pestaña «Inventory counts» en el recuadro: «Need this page to look like the
 * scrap report page. Needs to be consistent in design»). Era otra pantalla: su propio selector de mes en un renglón aparte,
 * una cifra gigante a todo lo ancho, las tarjetas con el rótulo arriba, y tres tablas sin etapas ni buscador. Ahora sigue a
 * la de merma, pieza por pieza: el MISMO renglón de arriba (pestañas, «📅» con el rango y la tienda, que pone
 * `ListaDeReportes`), cuatro tarjetas en un renglón con la cifra arriba, «Conteos en el rango N», las etapas como chips
 * con su cuenta, el buscador y la tabla. «Por tienda» y «Por empleado» quedan debajo; «Por tienda» solo con varias tiendas,
 * como el desglose de la merma.
 */

type Carga = { estado: "cargando" } | { estado: "falta-274" } | { estado: "error"; mensaje: string } | { estado: "listo"; datos: Datos };

interface FilaDeConteo { c: Conteo; lineas: Linea[]; pendientes: OrdenPendiente[]; neto: number; faltanCajas: number; sobranCajas: number; exactitud: number | null; lineasN: number }

export function InformeDeConteos({ ctx, tiendas, rango, etiqueta }: {
  ctx: Contexto;
  /** Las tiendas que entran: las de quien mira, o la que eligió arriba. */
  tiendas: string[];
  /** El rango del «📅» de Reportes (el mismo de la merma). `null`: lo escrito a mano no cuadra. */
  rango: Rango | null;
  /** Cómo se llama ese rango («Este mes», «1 nov – 24 nov»). */
  etiqueta: string;
}) {
  const { t, lang } = usePrefs();
  const [carga, setCarga] = useState<Carga>(ctx.demo ? { estado: "listo", datos: DEMO_CONTEOS } : { estado: "cargando" });
  const [abierto, setAbierto] = useState<string | null>(null);
  // Las etapas como filtro, igual que en la merma: «Todos» o una; pulsar la activa vuelve a «Todos».
  const [etapa, setEtapa] = useState<EstadoDeConteo | "todas">("todas");
  const [busca, setBusca] = useState("");

  useEffect(() => {
    if (ctx.demo) return;
    let vivo = true;
    leerConteos(createClient(), 400)
      .then((d) => { if (vivo) setCarga({ estado: "listo", datos: d }); })
      .catch((e) => { if (vivo) setCarga(faltaLa274(e) ? { estado: "falta-274" } : { estado: "error", mensaje: mensajeDeErrorAlCargar(e) }); });
    return () => { vivo = false; };
  }, [ctx.demo]);

  const pon = (f: (d: Datos) => Datos) => setCarga((c) => (c.estado === "listo" ? { estado: "listo", datos: f(c.datos) } : c));
  const datos = carga.estado === "listo" ? carga.datos : null;
  // Un extremo vacío del rango no limita (como en la merma): se abre hasta el principio o el fin de los tiempos.
  const periodo: Periodo = useMemo(() => ({ desde: rango?.desde || "0000-01-01", hasta: rango?.hasta || "9999-12-31" }), [rango]);

  const porTienda: KpiDeConteos[] = useMemo(() => (datos ? kpiDeConteos(datos.conteos, datos.lineas, datos.pendientes, periodo, tiendas) : []), [datos, periodo, tiendas]);
  const total = useMemo(() => totalDeConteos(porTienda), [porTienda]);
  const empleados = useMemo(() => (datos ? kpiPorEmpleado(datos.conteos, datos.lineas, datos.pendientes, periodo, tiendas.length === 1 ? tiendas[0] : undefined) : []), [datos, periodo, tiendas]);
  const delMes: FilaDeConteo[] = useMemo(() => {
    if (!datos) return [];
    return conteosDelPeriodo(datos.conteos, periodo).filter((c) => tiendas.includes(c.store)).map((c) => {
      const lineas = datos.lineas.filter((l) => l.count_id === c.id);
      const pendientes = datos.pendientes.filter((o) => o.count_id === c.id);
      const r = resumenDelConteo(lineas, pendientes);
      const cajas = (signo: 1 | -1) => lineas.reduce((s, l) => {
        const pz = l.pieces_per_box;
        const pl = pendientes.filter((o) => o.line_id === l.id).reduce((x, o) => x + o.qty, 0);
        if (l.counted_at == null || l.system_qty == null || pz == null || pz <= 0 || !comparableConElSistema(l)) return s;
        const d = (l.counted_total ?? 0) - pl - l.system_qty;
        return s + (Math.sign(d) === signo ? Math.abs(d) / pz : 0);
      }, 0);
      return { c, lineas, pendientes, neto: r.valorNeto, faltanCajas: Math.round(cajas(-1) * 100) / 100, sobranCajas: Math.round(cajas(1) * 100) / 100, exactitud: r.exactitudPct, lineasN: r.contadas };
    }).sort((a, b) => b.c.created_at.localeCompare(a.c.created_at));
  }, [datos, periodo, tiendas]);

  const colsTienda: ColumnaEstandar<KpiDeConteos>[] = [
    { key: "tienda", en: "Store", es: "Tienda", valor: (k) => k.tienda },
    { key: "hechos", en: "Completed", es: "Completados", numerico: true, valor: (k) => k.hechos },
    { key: "exactitud", en: "Accuracy", es: "Exactitud", numerico: true, valor: (k) => k.exactitudPct, celda: (k) => (
      <span className={`ops-kpi-${colorDeExactitud(k.exactitudPct)}`}>{k.exactitudPct === null ? "—" : `${k.exactitudPct}%`}</span>) },
    { key: "cajasFaltan", en: "Missing boxes", es: "Cajas que faltan", numerico: true, valor: (k) => k.faltanCajas, celda: (k) => <span className={k.faltanCajas > 0 ? "ops-kpi-rojo" : ""} data-faltan-cajas={k.faltanCajas} data-falta={k.faltanCajas > 0 ? "" : undefined}>{k.faltanCajas}</span> },
    { key: "cajasSobran", en: "Over boxes", es: "Cajas que sobran", numerico: true, valor: (k) => k.sobranCajas },
    { key: "piezasSinCaja", en: "Missing pcs (no box size)", es: "Piezas que faltan (sin cajas)", numerico: true, valor: (k) => k.faltanPiezasSinCaja, oculta: true },
    { key: "faltaUsd", en: "Missing $", es: "Faltan $", numerico: true, valor: (k) => k.faltanValor, celda: (k) => <span className={k.faltanValor > 0 ? "ops-kpi-rojo" : ""} data-falta={k.faltanValor > 0 ? "" : undefined}>{fmtMoney(k.faltanValor)}</span> },
    { key: "sobraUsd", en: "Over $", es: "Sobran $", numerico: true, valor: (k) => k.sobranValor, celda: (k) => fmtMoney(k.sobranValor) },
    { key: "netoUsd", en: "Net $", es: "Neto $", numerico: true, valor: (k) => k.netoValor, celda: (k) => `${k.netoValor > 0 ? "+" : ""}${fmtMoney(k.netoValor)}` },
    { key: "pendientes", en: "Pending order pcs", es: "Pzas en órdenes pendientes", numerico: true, valor: (k) => k.pendientePiezas, oculta: true },
    { key: "abiertos", en: "Open now", es: "Abiertos ahora", numerico: true, valor: (k) => k.abiertos },
    { key: "dias", en: "Avg days", es: "Días prom.", numerico: true, valor: (k) => k.diasPromedio },
  ];

  const colsConteos: ColumnaEstandar<FilaDeConteo>[] = [
    { key: "conteo", en: "Count", es: "Conteo", valor: (f) => f.c.title, celda: (f) => <>{INFO_EMOJI(f.c)} {f.c.title}</>, envuelve: true },
    { key: "tienda", en: "Store", es: "Tienda", valor: (f) => f.c.store },
    { key: "etapa", en: "Stage", es: "Etapa", valor: (f) => f.c.stage, celda: (f) => <ChipDeEtapaDeConteo e={f.c.stage} /> },
    { key: "creado", en: "Opened", es: "Abierto", valor: (f) => f.c.created_at, celda: (f) => fmtDateTime(f.c.created_at), oculta: true },
    { key: "ajustado", en: "Adjusted", es: "Ajustado", valor: (f) => f.c.adjusted_at, celda: (f) => (f.c.adjusted_at ? fmtDateTime(f.c.adjusted_at) : "—") },
    { key: "lineas", en: "Lines", es: "Líneas", numerico: true, valor: (f) => f.lineasN },
    { key: "cajasFaltan", en: "Missing boxes", es: "Cajas que faltan", numerico: true, valor: (f) => f.faltanCajas, celda: (f) => <span className={f.faltanCajas > 0 ? "ops-kpi-rojo" : ""} data-falta={f.faltanCajas > 0 ? "" : undefined}>{f.faltanCajas}</span> },
    { key: "cajasSobran", en: "Over boxes", es: "Cajas que sobran", numerico: true, valor: (f) => f.sobranCajas, oculta: true },
    { key: "neto", en: "Net $", es: "Neto $", numerico: true, valor: (f) => f.neto, celda: (f) => `${f.neto > 0 ? "+" : ""}${fmtMoney(f.neto)}` },
    { key: "exactitud", en: "Accuracy", es: "Exactitud", numerico: true, valor: (f) => f.exactitud, celda: (f) => (f.exactitud === null ? "—" : `${f.exactitud}%`) },
  ];

  const colsEmpleados: ColumnaEstandar<{ id: string; nombre: string; lineas: number; exactitudPct: number | null }>[] = [
    { key: "nombre", en: "Employee", es: "Empleado", valor: (e) => e.nombre },
    { key: "lineas", en: "Lines counted", es: "Líneas contadas", numerico: true, valor: (e) => e.lineas },
    { key: "exactitud", en: "Accuracy", es: "Exactitud", numerico: true, valor: (e) => e.exactitudPct, celda: (e) => (e.exactitudPct === null ? "—" : `${e.exactitudPct}%`) },
  ];

  const abiertoFila = abierto && datos ? datos.conteos.find((c) => c.id === abierto) ?? null : null;
  // Lo que enseña la tabla: los del rango, por la etapa elegida y por lo que se busca (conteo, tienda o etapa).
  const cuentaDeEtapa = (e: EstadoDeConteo) => delMes.filter((f) => f.c.stage === e).length;
  const aLaVista = useMemo(() => {
    const q = busca.trim().toLowerCase();
    return delMes.filter((f) => (etapa === "todas" || f.c.stage === etapa)
      && (q === "" || `${f.c.title} ${f.c.store} ${nombreDeEtapaDeConteo(f.c.stage, lang)}`.toLowerCase().includes(q)));
  }, [delMes, etapa, busca, lang]);
  const hayCancelados = delMes.some((f) => f.c.stage === "cancelled");

  return (
    <section className="ops-merma ops-informe-conteos" data-informe-conteos data-desde={rango?.desde ?? ""} data-hasta={rango?.hasta ?? ""}>
      {carga.estado === "cargando" && <p className="hint">{t("Loading…", "Cargando…")}</p>}
      {carga.estado === "error" && <p className="ops-aviso ops-aviso-error">{t("Could not load: ", "No se pudo cargar: ")}{carga.mensaje}</p>}
      {carga.estado === "falta-274" && <p className="ops-aviso">{t("Inventory counts are not set up yet (migration 274).", "Los conteos de inventario aún no están instalados (migración 274).")}</p>}

      {!rango && <p className="hint" data-rango-invalido-conteos>{t("Fix the dates to see the counts.", "Corrige las fechas para ver los conteos.")}</p>}

      {datos && rango && (
        <>
          {/* Cuatro tarjetas en un renglón, con la cifra arriba, como las de la merma. La primera, lo primero que se lee. */}
          <div className="ops-merma-totales ops-kpi ops-kpi-conteos" data-kpi-conteos data-faltan-cajas-mes={total.faltanCajas}>
            <div className={`ops-merma-total${total.faltanCajas > 0 ? " ops-merma-total-rango" : ""}`}>
              <span className="ops-merma-cifra ops-kpi-rojo" data-falta data-faltan-cajas-total>{total.faltanCajas}</span>
              <span>{t("Boxes missing", "Cajas que faltan")} · <span data-etiqueta-rango>{etiqueta}</span>{total.faltanPiezasSinCaja > 0 ? ` · +${total.faltanPiezasSinCaja} ${t("pcs without box size", "pzas sin medida de caja")}` : ""}</span>
            </div>
            <div className="ops-merma-total">
              <span className="ops-merma-cifra" data-sobran-cajas-total>{total.sobranCajas}</span>
              <span>{t("Boxes over", "Cajas que sobran")}</span>
            </div>
            <div className="ops-merma-total">
              <span className={`ops-merma-cifra ${total.netoValor < 0 ? "ops-kpi-rojo" : ""}`} data-neto-usd>{total.netoValor > 0 ? "+" : ""}{fmtMoney(total.netoValor)}</span>
              <span>{t("Net $", "Neto $")} · <span className="ops-kpi-rojo" data-falta data-faltan-usd>{t("missing", "faltan")} {fmtMoney(total.faltanValor)}</span> · {t("over", "sobran")} {fmtMoney(total.sobranValor)}</span>
            </div>
            <div className="ops-merma-total">
              <span className={`ops-merma-cifra ops-kpi-${colorDeExactitud(total.exactitudPct)}`} data-exactitud-total>{total.exactitudPct === null ? "—" : `${total.exactitudPct}%`}</span>
              <span>{t("Accuracy", "Exactitud")} · {total.lineasExactas} / {total.lineasComparables} {t("lines", "líneas")}</span>
            </div>
          </div>

          <h3 className="ops-merma-titulo">{t("Counts in this range", "Conteos en el rango")} <span className="count-tag" data-cuenta-conteos>{delMes.length}</span></h3>
          <div className="filters-oneline ops-filtros" role="group" aria-label={t("Stage", "Etapa")} data-filtro-etapas-conteo>
            <button type="button" className={`chip${etapa === "todas" ? " active" : ""}`} onClick={() => setEtapa("todas")} data-etapa-conteo-filtro="todas" aria-pressed={etapa === "todas"}>{t("All", "Todos")} <span className="cnt">{delMes.length}</span></button>
            {ETAPAS_DE_CONTEO.map((e) => (
              <button type="button" key={e} className={`chip ops-chip-etapa${etapa === e ? " active" : ""}`} onClick={() => setEtapa(etapa === e ? "todas" : e)} data-etapa-conteo-filtro={e} aria-pressed={etapa === e}>
                {INFO_DE_ETAPA_DE_CONTEO[e].n}. {nombreDeEtapaDeConteo(e, lang)} <span className="cnt">{cuentaDeEtapa(e)}</span>
              </button>
            ))}
            {hayCancelados && (
              <button type="button" className={`chip ops-chip-etapa${etapa === "cancelled" ? " active" : ""}`} onClick={() => setEtapa(etapa === "cancelled" ? "todas" : "cancelled")} data-etapa-conteo-filtro="cancelled" aria-pressed={etapa === "cancelled"}>
                {nombreDeEtapaDeConteo("cancelled", lang)} <span className="cnt">{cuentaDeEtapa("cancelled")}</span>
              </button>
            )}
          </div>
          <TablaEstandar id="conteos-del-mes" data-tabla="conteos-del-mes" filas={aLaVista} claveDe={(f) => f.c.id} columnas={colsConteos}
            barra={(
              <input type="search" className="ops-busca-merma" value={busca} onChange={(e) => setBusca(e.target.value)} data-busca-conteos
                placeholder={t("Search count, store, stage…", "Buscar conteo, tienda, etapa…")} aria-label={t("Search counts", "Buscar en los conteos")} />
            )}
            onFila={(f) => setAbierto(f.c.id)}
            vacio={delMes.length === 0 ? t("No counts in this range.", "No hay conteos en este rango.") : t("No count matches.", "Ningún conteo coincide.")} />

          {/* El desglose por tienda solo aporta con más de una (igual que en la merma). */}
          {tiendas.length > 1 && (
            <>
              <h3 className="ops-merma-titulo">{t("By store", "Por tienda")}</h3>
              <TablaEstandar id="conteos-por-tienda" data-tabla="conteos-por-tienda" filas={porTienda} claveDe={(k) => k.tienda} columnas={colsTienda}
                vacio={t("No stores.", "No hay tiendas.")} />
            </>
          )}

          <h3 className="ops-merma-titulo">{t("By employee", "Por empleado")}</h3>
          <TablaEstandar id="conteos-por-empleado" data-tabla="conteos-por-empleado" filas={empleados} claveDe={(e) => e.id} columnas={colsEmpleados}
            vacio={t("Nobody counted a line in this range.", "Nadie contó una línea en este rango.")} />
        </>
      )}

      {abiertoFila && datos && (
        <TarjetaConteo c={abiertoFila} lineas={datos.lineas.filter((l) => l.count_id === abiertoFila.id)} pendientes={datos.pendientes.filter((o) => o.count_id === abiertoFila.id)}
          ctx={ctx} pon={pon} sin333={!!datos.sin333} onCerrar={() => setAbierto(null)} />
      )}
      {carga.estado === "listo" && carga.datos.sin333 && <p className="ops-aviso" data-aviso-333>{t("Migration 333 is not applied: pending orders and system quantities at sign-off are missing from these numbers.", "La migración 333 no está aplicada: las órdenes pendientes y las cantidades del sistema no entran en estos números.")}</p>}
    </section>
  );
}

function INFO_EMOJI(c: Conteo): string {
  return c.scope_kind === "product" ? "📦" : c.scope_kind === "vendor_note" ? "🏷️" : "📐";
}
