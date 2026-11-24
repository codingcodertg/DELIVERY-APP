"use client";

import { mensajeDeErrorAlCargar } from "@/lib/mensaje-de-error";
import { useEffect, useMemo, useState } from "react";
import { usePrefs } from "@/lib/prefs";
import { fmtDateTime } from "@/lib/utils";
import { hoyEnTexas } from "@/lib/almacen-ops/fecha-del-dano";
import { sumarDias, type Rango } from "@/lib/almacen-ops/rango-de-merma";
import { DIAS_MAX_DEL_RANGO, claseDeNoLista, type ClaseDeNoLista, type OrdenEvaluada } from "@/lib/almacen-ops/kpi-entregas";
import type { Contexto } from "./Operaciones";
import { TablaEstandar, type ColumnaEstandar } from "@/components/TablaEstandar";

type Fila = OrdenEvaluada & { quienMarcoNombre: string | null };

/** Lo que se usa de `/api/almacen-ops/kpi-entregas`. `noListas` llegó en D-1150; una respuesta de antes trae solo `peores`. */
interface Respuesta {
  ok: true;
  desde: string;
  hasta: string;
  cortado: boolean;
  noListas?: Fila[];
  peores: Fila[];
}

type Carga = { estado: "cargando" } | { estado: "error"; mensaje: string } | { estado: "listo"; datos: Respuesta };

/**
 * Reportes → Entregas (gerentes): las órdenes que el almacén NO tuvo listas a tiempo, en una tabla.
 *
 * D-1150 (ayuda de Roberto, 2026-11-24, con tres recuadros sobre esta pestaña): «1) This is a KPI so dont need it in report»
 * (el % de listas a tiempo: vive en «KPIs de almacén»), «2) Dont need anything in the report» (las tablas por tienda y por
 * periodo) y «3) These are the only two filters needed on the report and when selected it will display Order table of the
 * ones it mentions» (las tarjetas «Marcadas después de recogidas» y «Nunca marcadas lista»). Así que aquí quedan esas dos
 * tarjetas, que ahora son FILTROS, y la tabla de sus órdenes. Sin ninguna elegida se ven las dos clases (como en los KPIs:
 * todo, hasta que se elige un filtro); pulsar la elegida vuelve a las dos.
 *
 * El rango lo pone el «📅» de Reportes (D-911) y la tienda, su filtro (D-1147). La regla de qué es «lista a tiempo» sigue en
 * `lib/almacen-ops/kpi-entregas.ts`; la ruta exige un rango cerrado de a lo más dos meses, porque lee el historial.
 */
export function KpiDeEntregas({ rango, ctx, tienda = "" }: { rango: Rango | null; ctx: Contexto; /** «» = todas las de quien mira. */ tienda?: string }) {
  const { t } = usePrefs();
  const hoy = hoyEnTexas();
  const [carga, setCarga] = useState<Carga>({ estado: "cargando" });
  const [clase, setClase] = useState<ClaseDeNoLista | null>(null);
  const [busca, setBusca] = useState("");
  // Un extremo abierto se cierra: «Desde» vacío = dos meses atrás desde «Hasta»; «Hasta» vacío = hoy.
  const cerrado = useMemo<Rango | null>(() => {
    if (!rango) return null;
    const hasta = rango.hasta || hoy;
    const desde = rango.desde || sumarDias(hasta, -(DIAS_MAX_DEL_RANGO - 1));
    return { desde, hasta };
  }, [rango, hoy]);
  const demasiado = cerrado ? (Date.parse(`${cerrado.hasta}T00:00:00Z`) - Date.parse(`${cerrado.desde}T00:00:00Z`)) / 86_400_000 >= DIAS_MAX_DEL_RANGO : false;

  useEffect(() => {
    if (!cerrado || demasiado) return;
    if (ctx.demo) { setCarga({ estado: "listo", datos: DEMO }); return; }
    let vivo = true;
    setCarga({ estado: "cargando" });
    (async () => {
      try {
        const r = await fetch(`/api/almacen-ops/kpi-entregas?from=${cerrado.desde}&to=${cerrado.hasta}`, { cache: "no-store" });
        const j = await r.json().catch(() => ({}));
        if (!vivo) return;
        if (!r.ok || !j.ok) { setCarga({ estado: "error", mensaje: j.error ?? `HTTP ${r.status}` }); return; }
        setCarga({ estado: "listo", datos: j as Respuesta });
      } catch (e) {
        if (vivo) setCarga({ estado: "error", mensaje: mensajeDeErrorAlCargar(e) });
      }
    })();
    return () => { vivo = false; };
  }, [cerrado, demasiado, ctx.demo]);

  const datos = carga.estado === "listo" ? carga.datos : null;
  // Las de la tienda elegida; de ellas salen las dos cuentas y la tabla.
  const deLaTienda = useMemo(() => (datos?.noListas ?? datos?.peores ?? []).filter((o) => tienda === "" || o.tienda === tienda), [datos, tienda]);
  const cuenta = (c: ClaseDeNoLista) => deLaTienda.filter((o) => claseDeNoLista(o) === c).length;
  const aLaVista = useMemo(() => {
    const q = busca.trim().toLowerCase();
    return deLaTienda.filter((o) => (clase === null || claseDeNoLista(o) === clase)
      && (q === "" || `${o.factura} ${o.tienda} ${o.quienMarcoNombre ?? ""}`.toLowerCase().includes(q)));
  }, [deLaTienda, clase, busca]);

  if (!cerrado) return <p className="hint">{t("Fix the dates to see the orders.", "Corrige las fechas para ver las órdenes.")}</p>;
  if (demasiado) return <p className="ops-aviso ops-aviso-error" data-rango-largo>{t(`Pick a range of at most ${DIAS_MAX_DEL_RANGO} days.`, `Elige un rango de a lo más ${DIAS_MAX_DEL_RANGO} días.`)}</p>;
  if (carga.estado === "cargando") return <p className="hint">{t("Loading…", "Cargando…")}</p>;
  if (carga.estado === "error") return <p className="ops-aviso ops-aviso-error">{t("Could not load: ", "No se pudo cargar: ")}{carga.mensaje}</p>;

  const nombre: Record<ClaseDeNoLista, string> = {
    tarde: t("Marked after pickup", "Marcadas después de recogidas"),
    sin_marcar: t("Never marked ready", "Nunca marcadas lista"),
  };
  const que: Record<ClaseDeNoLista, string> = {
    tarde: t("The warehouse marked the order “ready” after the driver had already pressed “picked up”.", "El almacén marcó la orden «lista» cuando el chofer ya había pulsado «recogida»."),
    sin_marcar: t("The driver picked the order up and nobody ever marked it “ready”.", "El chofer recogió la orden y nadie la marcó «lista»."),
  };
  const columnas: ColumnaEstandar<Fila>[] = [
    { key: "factura", en: "Invoice", es: "Factura", fija: true, valor: (o) => o.factura },
    { key: "tienda", en: "Store", es: "Tienda", valor: (o) => o.tienda },
    { key: "clase", en: "What happened", es: "Qué pasó", valor: (o) => { const c = claseDeNoLista(o); return c ? nombre[c] : ""; },
      celda: (o) => { const c = claseDeNoLista(o); return c ? <span className={c === "tarde" ? "ops-kpi-ambar" : "ops-kpi-rojo"}>{nombre[c]}</span> : "—"; } },
    { key: "recogida", en: "Picked up", es: "Recogida", valor: (o) => o.recogidaEn, etiqueta: (v) => (typeof v === "string" ? fmtDateTime(v) : ""), celda: (o) => fmtDateTime(o.recogidaEn) },
    { key: "lista", en: "Marked ready", es: "Marcada lista", valor: (o) => o.listaEn, etiqueta: (v) => (typeof v === "string" ? fmtDateTime(v) : "—"), celda: (o) => (o.listaEn ? fmtDateTime(o.listaEn) : "—") },
    { key: "minutos", en: "Minutes late", es: "Minutos tarde", numerico: true, valor: (o) => (o.minutos === null ? null : -o.minutos), celda: (o) => (
      <span data-minutos={o.minutos ?? ""}>{o.minutos === null ? "—" : `${-o.minutos} min`}</span>
    ) },
    { key: "marcola", en: "Marked ready by", es: "La marcó lista", valor: (o) => o.quienMarcoNombre ?? (o.quienMarco ? "—" : t("nobody", "nadie")) },
  ];

  return (
    <div data-reporte-entregas data-clase-elegida={clase ?? ""}>
      {/* Las dos tarjetas son los filtros: la cifra arriba y el rótulo debajo, como las de la merma. */}
      <div className="ops-merma-totales ops-kpi" role="group" aria-label={t("Filter", "Filtrar")} data-filtros-de-entregas>
        {(["tarde", "sin_marcar"] as const).map((c) => (
          <button type="button" key={c} className={`ops-merma-total ops-tarjeta-filtro${clase === c ? " elegida" : ""}`} aria-pressed={clase === c}
            onClick={() => setClase(clase === c ? null : c)} data-clase-de-no-lista={c} title={que[c]}>
            <span className={`ops-merma-cifra ${cuenta(c) === 0 ? "ops-kpi-verde" : c === "tarde" ? "ops-kpi-ambar" : "ops-kpi-rojo"}`} data-cuenta-de-clase>{cuenta(c)}</span>
            <span>{nombre[c]}</span>
          </button>
        ))}
      </div>
      {datos?.cortado && <p className="ops-aviso ops-aviso-error">{t("Too many orders in this range; the list is partial. Pick a shorter range.", "Demasiadas órdenes en el rango; la lista es parcial. Elige un rango más corto.")}</p>}

      <h3 className="ops-merma-titulo">{clase ? nombre[clase] : t("Orders not ready on time", "Órdenes que no estuvieron listas a tiempo")} <span className="count-tag" data-cuenta-de-ordenes>{aLaVista.length}</span></h3>
      <TablaEstandar id="entregas-no-listas" data-tabla="entregas-no-listas" filas={aLaVista} claveDe={(o) => o.id} columnas={columnas}
        barra={(
          <input type="search" className="ops-busca-merma" value={busca} onChange={(e) => setBusca(e.target.value)} data-busca-entregas
            placeholder={t("Search invoice, store, person…", "Buscar factura, tienda, persona…")} aria-label={t("Search orders", "Buscar en las órdenes")} />
        )}
        vacio={deLaTienda.length === 0 ? t("Every order was ready on time in this range.", "Todas las órdenes estuvieron listas a tiempo en este rango.") : t("No order matches.", "Ninguna orden coincide.")} />
    </div>
  );
}

/** Datos de muestra para el modo demo (sin base). */
const fila = (id: string, factura: string, tienda: string, dia: string, recogidaEn: string, listaEn: string | null, minutos: number | null, quien: string | null): Fila => ({
  id, factura, tienda, dia, semana: "2026-11-22", listaEn, recogidaEn, minutos, aTiempo: false, quienMarco: quien ? `u-${quien}` : null, quienMarcoNombre: quien,
});
const DEMO: Respuesta = {
  ok: true, desde: "2026-11-01", hasta: "2026-11-24", cortado: false, peores: [],
  noListas: [
    fila("d1", "INV-1021", "McAllen", "2026-11-23", "2026-11-23T15:55:00Z", "2026-11-23T16:40:00Z", -45, "Beto Ríos"),
    fila("d3", "INV-1040", "Edinburg", "2026-11-22", "2026-11-22T14:05:00Z", "2026-11-22T14:17:00Z", -12, "Ana López"),
    fila("d2", "INV-1034", "McAllen", "2026-11-23", "2026-11-23T14:10:00Z", null, null, null),
    fila("d4", "INV-1012", "Edinburg", "2026-11-21", "2026-11-21T17:30:00Z", null, null, null),
    fila("d5", "INV-0998", "Harlingen", "2026-11-20", "2026-11-20T13:45:00Z", null, null, null),
  ],
};
