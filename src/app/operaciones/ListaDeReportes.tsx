"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { usePrefs } from "@/lib/prefs";
import { createClient } from "@/lib/supabase/client";
import { fmtDateTime, fmtMoney } from "@/lib/utils";
import { INFO_DE_TIPO, TIPOS, esDeRrhh, type TipoDeReporte } from "@/lib/almacen-ops/tipos";
import { PASOS, PASO_QUIEN_REPORTO, etiquetaDeOpcion } from "@/lib/almacen-ops/pasos";
import { etiquetaDeEquipoDelReporte } from "@/lib/almacen-ops/mantenimiento";
import { nombreOTexto } from "@/lib/almacen-ops/personas";
import { totalesPorTienda } from "@/lib/almacen-ops/perdida";
import { DEMO_PRODUCTOS, DEMO_REPORTES, agregarFotos, buscarProductos, corregirMerma, corregirOrigenDeMerma, crearGrupoDeMerma, enlacesDeFotos, guardarHuellas, listarGrupos, reportesConLaFoto, subirFoto, type Reporte } from "@/lib/almacen-ops/datos";
import { estadoDelGrupo, type GrupoDeMerma } from "@/lib/almacen-ops/grupos";
import { HojaDeGrupo } from "./HojaDeGrupo";
import { MAX_FOTOS, avisoDeRepetida, duplicadosPorHuella, etiquetaSinFoto, fotoPendienteVencida, fotosSinHuella, iconoDeFotos, sha256Hex, sinFoto, type Repetida } from "@/lib/almacen-ops/fotos";
import { BotonesDeFoto } from "./BotonesDeFoto";
import { detalleParaConsola, leerFotoDelTelefono, mensajeDeFotoFallida } from "@/lib/almacen-ops/foto-del-telefono";
import { ORIGENES_DE_MERMA, costoDelCampo, type ProductoElegido } from "@/lib/almacen-ops/pasos";
import { cuentaComoPerdida, perdidaDeMerma, repartoDeReporte } from "@/lib/almacen-ops/perdida";
import { puedeCorregirMerma, puedeVerReporte } from "@/lib/almacen-ops/visibilidad";
import { diaDelReporte, fmtDia, hoyEnTexas, ordenPorDia } from "@/lib/almacen-ops/fecha-del-dano";
import { ATAJOS, NOMBRE_DE_ATAJO, eleccionAUrl, eleccionDeUrl, etiquetaDeRango, filtrarPorRango, perdidaEnRango, rangoDeAtajo, rangoDeEleccion, type Atajo, type Eleccion } from "@/lib/almacen-ops/rango-de-merma";
import { ETAPAS, etapaDe, nombreDeEtapa, perdidaPorEtapa, puedeCambiarEtapa, seleccionableParaHoja, tieneEtapas, urlDeHoja, type Etapa } from "@/lib/almacen-ops/etapas";
import { COLUMNAS_EXCEL, celdasDeMerma, csvDeMermas, nombreDelCsv } from "@/lib/almacen-ops/tabla-de-merma";
import { datosPdfDeMerma } from "@/lib/almacen-ops/pdf-de-merma";
import { AdjuntarYMarcar, ChipDeEtapa, LineaDeEtapas } from "./EtapasDeMerma";
import { KpiDeEntregas } from "./KpiDeEntregas";
import type { Contexto } from "./Operaciones";

const LIMITE = 500;
type Pestana = "lista" | "merma" | "entregas" | "revision";
// La fila cruda de PostgREST: como `Reporte`, pero `answers` puede traer claves extra (p. ej. `broken_on` antes de la
// 266) y las firmas vienen embebidas. Se mapea a `Reporte` al leer. 280.
type ReporteCrudo = Omit<Reporte, "answers"> & { answers: Reporte["answers"] & Record<string, unknown> };

/**
 * «Mis reportes» y «Reportes» (D-883, 247). Las filas son las que la RLS deja ver; «Mis reportes» además se queda con
 * las que llenó quien mira (sin las de RR. HH., que el autor no ve). Cada fila se abre como tarjeta aquí mismo.
 * La tabla es la de Órdenes (CLAUDE.md): `table.orders` dentro de `.tbl-scroll.tbl-caja` (sin anchos que se arrastran, como el historial de RR. HH.), chips con `.cnt`.
 */
export function ListaDeReportes({ modo, ctx }: { modo: "mios" | "todos"; ctx: Contexto }) {
  const { t, lang } = usePrefs();
  const [filas, setFilas] = useState<Reporte[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  // D-911: la pestaña y el rango de la merma viven en la URL (?pestana=merma&rango=mes…): aguantan un refresh y se comparten.
  const router = useRouter();
  const ruta = usePathname();
  const params = useSearchParams();
  const hoy = hoyEnTexas();
  // KPI de entregas (Roberto, fase 1): tercera pestaña, «Entregas», con el mismo selector de rango que la merma.
  const pedida = params.get("pestana");
  const pestana: Pestana = modo === "todos" && (pedida === "merma" || pedida === "entregas" || pedida === "revision") ? pedida : "lista";
  const eleccion = useMemo(() => eleccionDeUrl(params), [params]);
  const irA = useCallback((cambios: { pestana?: Pestana; eleccion?: Eleccion }) => {
    const q = new URLSearchParams();
    const p = cambios.pestana ?? pestana;
    if (p !== "lista") q.set("pestana", p);
    for (const [k, v] of Object.entries(eleccionAUrl(cambios.eleccion ?? eleccion))) q.set(k, v);
    const qs = q.toString();
    router.replace(qs ? `${ruta}?${qs}` : ruta, { scroll: false });
  }, [router, ruta, pestana, eleccion]);
  const setPestana = (p: Pestana) => irA({ pestana: p });
  // 281: un grupo de aprobación abierto vive en la URL (?grupo=<id>): aguanta refresh y se comparte. Solo en «Reportes».
  const grupoId = modo === "todos" ? params.get("grupo") : null;
  const abrirGrupo = useCallback((id: string) => router.replace(`${ruta}?pestana=merma&grupo=${encodeURIComponent(id)}`, { scroll: false }), [router, ruta]);
  const [grupos, setGrupos] = useState<GrupoDeMerma[]>([]);
  useEffect(() => {
    if (ctx.demo || modo !== "todos" || pestana !== "merma" || grupoId) return;
    let vivo = true;
    void listarGrupos(createClient()).then((g) => { if (vivo) setGrupos(g); }).catch(() => { /* sin 281: no hay grupos */ });
    return () => { vivo = false; };
  }, [ctx.demo, modo, pestana, grupoId]);
  const elegir = (atajo: Atajo) => irA({ eleccion: atajo === "otro"
    // Al pasar a «a mano» se arranca con el rango del atajo que estaba puesto, para solo ajustar un extremo.
    ? { atajo, ...(eleccion.atajo === "otro" ? { desde: eleccion.desde, hasta: eleccion.hasta } : rangoDeAtajo(eleccion.atajo, hoy)) }
    : { atajo, desde: "", hasta: "" } });
  const [tipo, setTipo] = useState<TipoDeReporte | "">("");
  const [tienda, setTienda] = useState("");
  const [empleado, setEmpleado] = useState("");
  const [desde, setDesde] = useState("");
  const [hasta, setHasta] = useState("");
  const [abierto, setAbierto] = useState<Reporte | null>(null);
  // D-921 (270): filtro por etapa, y la selección de mermas para la hoja de aprobación (solo fotografiadas, sin aprobar).
  const [etapaFiltro, setEtapaFiltro] = useState<Etapa | "">("");
  const [seleccion, setSeleccion] = useState<Set<string>>(new Set());
  const [adjuntando, setAdjuntando] = useState(false);

  useEffect(() => {
    let vivo = true;
    (async () => {
      // 266: la merma se ordena por el día en que se rompió; lo demás, por el día en que se reportó.
      if (ctx.demo) { setFilas(ordenPorDia(DEMO_REPORTES.filter((r) => puedeVerReporte(ctx.yo, r)))); return; }
      // 280: traemos las firmas de aprobación embebidas (sin el dibujo, para la lista). Si la 280 no está aplicada, la
      // relación no existe y PostgREST falla: se reintenta con `select("*")` a secas, y la pantalla sigue sin firmas.
      const sb = createClient();
      const EMBED = "*, firmas:warehouse_report_signatures(slot, signer_id, signer_name, signed_at)";
      const arma = async (cols: string): Promise<{ data: ReporteCrudo[] | null; error: { code?: string | null; message?: string | null } | null }> => {
        let q = sb.from("warehouse_reports").select(cols).order("created_at", { ascending: false }).limit(LIMITE);
        if (modo === "mios") q = q.eq("author_id", ctx.yo.id);
        const res = await q;
        return { data: res.data as unknown as ReporteCrudo[] | null, error: res.error };
      };
      let { data, error: e } = await arma(EMBED);
      if (e && /warehouse_report_signatures|relationship|schema cache|PGRST200/i.test(`${e.code ?? ""} ${e.message ?? ""}`)) {
        ({ data, error: e } = await arma("*"));
      }
      if (!vivo) return;
      if (e) { setError(e.message ?? "error"); setFilas([]); return; }
      setFilas(ordenPorDia((data ?? []).map((r) => ({ ...r, unit_cost: r.unit_cost == null ? null : Number(r.unit_cost), total_loss: r.total_loss == null ? null : Number(r.total_loss),
        // Hasta que se aplique la 266 la fecha del daño viaja dentro de `answers`; después, en su columna.
        broken_on: r.broken_on ?? (typeof r.answers?.broken_on === "string" ? r.answers.broken_on : null) })) as Reporte[]));
    })();
    return () => { vivo = false; };
  }, [ctx.demo, ctx.yo, modo]);

  const propias = useMemo(() => (filas ?? []).filter((r) => modo === "todos" || (r.author_id === ctx.yo.id && !esDeRrhh(r.kind))), [filas, modo, ctx.yo.id]);
  const visibles = useMemo(() => propias.filter((r) => {
    if (tipo && r.kind !== tipo) return false;
    if (tienda && r.store !== tienda) return false;
    if (empleado && !(r.author_id === empleado || r.subject_ids.includes(empleado) || r.broken_by.includes(empleado))) return false;
    // El día que cuenta (266): en la merma, cuando se rompió; en lo demás, cuando se reportó (hora de Texas).
    const dia = diaDelReporte(r);
    if (desde && dia < desde) return false;
    if (hasta && dia > hasta) return false;
    return true;
  }), [propias, tipo, tienda, empleado, desde, hasta]);
  const cuenta = (k: TipoDeReporte) => propias.filter((r) => r.kind === k).length;
  // Pedido del dueño (10 nov): en «Reportes» quiero ver TODAS las columnas (las del Excel), como en la pestaña de merma.
  // Solo cuando lo que se ve es puro scrap (filtro en «Merma» o todas las filas son merma): el Excel es específico de
  // merma, así que una lista mezclada o de otro tipo sigue con la tabla simple, para no romper los demás reportes.
  const listaSoloMerma = visibles.length > 0 && visibles.every((r) => r.kind === "scrap");
  const listaUsaExcel = tipo === "scrap" || listaSoloMerma;
  // 268: qué reportes comparten una foto (misma huella) con otro, entre los que se ven; la marca sale en ambos.
  const repetidas = useMemo(() => duplicadosPorHuella(propias), [propias]);
  // 268: mermas guardadas sin foto que ya pasaron 24 h (el gerente las reclama).
  const pendientesDeFoto = useMemo(() => propias.filter((r) => fotoPendienteVencida(r)).length, [propias]);
  const nombreTipo = (k: TipoDeReporte) => (lang === "es" ? INFO_DE_TIPO[k].es : INFO_DE_TIPO[k].en);

  const mermas = useMemo(() => propias.filter((r) => r.kind === "scrap"), [propias]);
  const totales = useMemo(() => totalesPorTienda(mermas, new Date()), [mermas]);
  // D-911: el rango elegido manda sobre la lista de merma y sobre la pérdida por tienda; todo por el día en que se rompió.
  const rango = useMemo(() => rangoDeEleccion(eleccion, hoy), [eleccion, hoy]);
  const mermasEnRango = useMemo(() => (rango ? filtrarPorRango(mermas, rango) : []), [mermas, rango]);
  const enRango = useMemo(() => (rango ? perdidaEnRango(mermas, rango) : { "*": 0 }), [mermas, rango]);
  const etiqueta = rango ? etiquetaDeRango(rango, lang, hoy) : "—";
  const tiendasDeMerma = Array.from(new Set([...Object.keys(totales), ...Object.keys(enRango)])).filter((k) => k !== "*").sort();
  // D-921 (270): la lista de merma filtrada por etapa, la cuenta por etapa y el desglose de la pérdida del rango por etapa.
  const mermasPorEtapa = useMemo(() => (etapaFiltro ? mermasEnRango.filter((r) => etapaDe(r) === etapaFiltro) : mermasEnRango), [mermasEnRango, etapaFiltro]);
  const cuentaEtapa = (e: Etapa) => mermasEnRango.filter((r) => etapaDe(r) === e).length;
  const porEtapa = useMemo(() => perdidaPorEtapa(mermasEnRango), [mermasEnRango]);
  const puedeSeleccionar = useCallback((r: Reporte) => seleccionableParaHoja(r) && puedeCambiarEtapa(ctx.yo, r), [ctx.yo]);
  const seleccionadas = useMemo(() => mermasEnRango.filter((r) => seleccion.has(r.id) && puedeSeleccionar(r)), [mermasEnRango, seleccion, puedeSeleccionar]);
  const alternar = (id: string) => setSeleccion((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const actualizaFilas = (nuevos: Reporte[]) => {
    const porId = new Map(nuevos.map((n) => [n.id, n]));
    setFilas((f) => (f ?? []).map((x) => porId.get(x.id) ?? x));
    setAbierto((a) => (a && porId.get(a.id)) || a);
    setSeleccion((s) => { const n = new Set(s); for (const id of porId.keys()) n.delete(id); return n; });
  };
  // Pedido de Roberto: bajar la lista de merma tal cual se ve (mismas columnas del Excel) para pegarla en su hoja.
  // Se arma en el navegador (Blob); el nombre lleva la tienda si todas las filas son de la misma, o «all».
  const exportarCsv = (lista: Reporte[]) => {
    const tiendas = new Set(lista.map((r) => r.store));
    const csv = csvDeMermas(lista, ctx.personas, lang);
    // El BOM hace que Excel lea bien los acentos (ñ, á…) al abrir el archivo con doble clic.
    const blob = new Blob(["﻿", csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = nombreDelCsv(tiendas.size === 1 ? [...tiendas][0] : null, hoy);
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  // Mismo reporte, en PDF (pedido del dueño, 10 nov). La librería (`jspdf` + autotable) se carga diferida al tocar el
  // botón, como `@zumer/snapdom`, para no cargarla en cada visita. Las columnas son las del Excel/CSV, para que cuadren.
  const [generandoPdf, setGenerandoPdf] = useState(false);
  const descargarPdf = async (lista: Reporte[], conRango: boolean) => {
    if (lista.length === 0 || generandoPdf) return;
    setGenerandoPdf(true);
    try {
      const tiendas = new Set(lista.map((r) => r.store));
      const d = datosPdfDeMerma(lista, ctx.personas, lang, {
        rango: conRango && rango ? etiqueta : null,
        tienda: tiendas.size === 1 ? [...tiendas][0] : null,
        hoy,
      });
      const [{ jsPDF }, auto] = await Promise.all([import("jspdf"), import("jspdf-autotable")]);
      const autoTable = auto.default;
      const doc = new jsPDF({ orientation: "landscape" });
      doc.setFontSize(14); doc.text(d.empresa, 14, 14);
      doc.setFontSize(11); doc.text(d.titulo, 14, 21);
      doc.setFontSize(9); doc.text(d.subtitulo, 14, 27);
      autoTable(doc, {
        head: [d.encabezados], body: d.filas, startY: 31,
        styles: { fontSize: 7, cellPadding: 1.5, overflow: "linebreak" },
        headStyles: { fillColor: [31, 41, 55] },
      });
      const finalY = (doc as unknown as { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY ?? 31;
      doc.setFontSize(10);
      doc.text(`${d.etiquetaTotal}: ${fmtMoney(d.total)}`, 14, finalY + 8);
      doc.save(d.nombreArchivo);
    } finally {
      setGenerandoPdf(false);
    }
  };

  // 281: crear un grupo de aprobación con las mermas marcadas y abrir su hoja digital (firmar y aprobar de una vez).
  const iniciarAprobacion = async () => {
    const nombre = window.prompt(t("Name this approval group", "Nombra este grupo de aprobación"), "");
    if (nombre == null || !nombre.trim()) return;
    try {
      const id = await crearGrupoDeMerma(createClient(), nombre.trim(), seleccionadas.map((r) => r.id));
      setSeleccion(new Set());
      abrirGrupo(id);
    } catch (e) { setError((e as Error).message); }
  };

  // El selector de rango (D-911) lo comparten la pestaña de merma y la de entregas.
  const selectorDeRango = (
    <>
      <div className="filters-oneline ops-filtros" role="group" aria-label={t("Date range", "Rango de fechas")} data-rango-atajos>
        {ATAJOS.map((a) => (
          <button type="button" key={a} className={`chip${eleccion.atajo === a ? " active" : ""}`} onClick={() => elegir(a)} data-atajo={a} aria-pressed={eleccion.atajo === a}>
            {lang === "es" ? NOMBRE_DE_ATAJO[a].es : NOMBRE_DE_ATAJO[a].en}
          </button>
        ))}
      </div>
      {eleccion.atajo === "otro" && (
        <div className="ops-filtros-campos" data-rango-a-mano>
          <span className="ops-fecha">{t("From", "Desde")} <input type="date" value={eleccion.desde} max={hoy} onChange={(e) => irA({ eleccion: { ...eleccion, desde: e.target.value } })} aria-label={t("From", "Desde")} data-campo="rango-desde" /></span>
          <span className="ops-fecha">{t("To", "Hasta")} <input type="date" value={eleccion.hasta} max={hoy} onChange={(e) => irA({ eleccion: { ...eleccion, hasta: e.target.value } })} aria-label={t("To", "Hasta")} data-campo="rango-hasta" /></span>
          {!rango && <span className="ops-aviso ops-aviso-error" role="alert" data-rango-invalido>{t("“From” must be on or before “To”.", "«Desde» no puede ir después de «Hasta».")}</span>}
        </div>
      )}
    </>
  );

  // 281: con un grupo abierto (?grupo=…), la pantalla muestra SOLO su hoja de aprobación (los demás reportes se ocultan).
  if (grupoId) return (
    <section className="ops-reportes" data-modo={modo} data-grupo-abierto={grupoId}>
      <HojaDeGrupo grupoId={grupoId} ctx={ctx} onSalir={() => irA({ pestana: "merma" })} />
    </section>
  );

  return (
    <section className="ops-reportes" data-modo={modo}>
      <div className="page-head">
        <h2>{modo === "mios" ? t("My reports", "Mis reportes") : t("Reports", "Reportes")} <span className="count-tag">{visibles.length}</span></h2>
        <Link href="/operaciones" className="btn btn-ghost">{t("Back to Warehouse Ops", "Volver a Operaciones")}</Link>
      </div>

      {modo === "todos" && (
        <div className="ops-pestanas" role="tablist">
          <button type="button" role="tab" aria-selected={pestana === "lista"} className={`chip${pestana === "lista" ? " active" : ""}`} onClick={() => setPestana("lista")}>{t("All reports", "Todos los reportes")}</button>
          <button type="button" role="tab" aria-selected={pestana === "merma"} className={`chip${pestana === "merma" ? " active" : ""}`} onClick={() => setPestana("merma")} data-pestana="merma">🧱 {t("Scrap", "Merma")}</button>
          <button type="button" role="tab" aria-selected={pestana === "entregas"} className={`chip${pestana === "entregas" ? " active" : ""}`} onClick={() => setPestana("entregas")} data-pestana="entregas">🚚 {t("Deliveries", "Entregas")}</button>
        </div>
      )}

      {error && <p className="ops-aviso ops-aviso-error">{error}</p>}
      {filas === null && <p className="hint">{t("Loading…", "Cargando…")}</p>}

      {filas && pestana === "merma" && (
        <div className="ops-merma" data-merma>
          {selectorDeRango}
          <div className="ops-merma-totales">
            <div className="ops-merma-total ops-merma-total-rango" data-total-rango={enRango["*"]}>
              <span className="ops-merma-cifra">{fmtMoney(enRango["*"])}</span>
              <span data-etiqueta-rango>{etiqueta}</span>
            </div>
            {([["semana", "This week", "Esta semana"], ["mes", "This month", "Este mes"], ["todo", "All time", "Siempre"]] as const).map(([k, en, es]) => (
              <div key={k} className="ops-merma-total">
                <span className="ops-merma-cifra">{fmtMoney(totales["*"]?.[k] ?? 0)}</span>
                <span>{t(en, es)}</span>
              </div>
            ))}
          </div>
          {/* El desglose por tienda solo aporta con MÁS DE UNA tienda: con una sola repite las tarjetas de arriba
              (ayuda de Roberto, 10 nov: «Remove; Redundant»). Con varias, se sigue mostrando. */}
          {tiendasDeMerma.length > 1 && (
          <div className="tbl-scroll tbl-caja">
            <table className="orders" data-perdida-por-tienda>
              <thead><tr><th>{t("Store", "Tienda")}</th><th className="ops-col-rango">{etiqueta}</th><th>{t("This week", "Esta semana")}</th><th>{t("This month", "Este mes")}</th><th>{t("All time", "Siempre")}</th></tr></thead>
              <tbody>
                {tiendasDeMerma.map((s) => (
                  <tr key={s} data-tienda={s}><td>{s}</td><td className="num ops-col-rango" data-perdida-rango={enRango[s] ?? 0}>{fmtMoney(enRango[s] ?? 0)}</td><td className="num">{fmtMoney(totales[s]?.semana ?? 0)}</td><td className="num">{fmtMoney(totales[s]?.mes ?? 0)}</td><td className="num">{fmtMoney(totales[s]?.todo ?? 0)}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
          )}
          {Object.keys(porEtapa).length > 0 && (
            <p className="hint ops-desglose-etapas" data-desglose-etapas>
              {t("In this range: ", "En el rango: ")}
              <span data-desglose="pendiente">{t("pending approval", "pendiente de aprobar")} <b>{fmtMoney(porEtapa["*"]?.pendiente ?? 0)}</b></span> · <span data-desglose="aprobada">{t("approved", "aprobada")} <b>{fmtMoney(porEtapa["*"]?.aprobada ?? 0)}</b></span> · <span data-desglose="desechada">{t("dumped / adjusted", "desechada / ajustada")} <b>{fmtMoney(porEtapa["*"]?.desechada ?? 0)}</b></span>
            </p>
          )}
          <p className="hint" data-totales-por="fecha-del-dano">{t("The range, weeks and months go by the date the material was broken, not the date it was reported. ", "El rango, las semanas y los meses van por el día en que se rompió el material, no por el día en que se reportó. ")}{t(`Loss = damaged pieces × the product's sales price per piece when it was reported (pieces usable as samples are not counted). A customer return without a CRMA is not counted as loss until its CRMA is added. Based on the latest ${LIMITE} reports you can see.`,
            `Pérdida = piezas dañadas × el precio de venta por pieza del producto al reportarse (las que sirven de muestra no cuentan). Una devolución de cliente sin CRMA no cuenta como pérdida hasta que se le pone el CRMA. Sobre los últimos ${LIMITE} reportes que puedes ver.`)}</p>

          <h3 className="ops-merma-titulo">{t("Scrap in this range", "Merma en el rango")} <span className="count-tag" data-cuenta-rango>{mermasEnRango.length}</span></h3>
          <div className="filters-oneline ops-filtros" role="group" aria-label={t("Stage", "Etapa")} data-filtro-etapas>
            <button type="button" className={`chip${etapaFiltro === "" ? " active" : ""}`} onClick={() => setEtapaFiltro("")} data-etapa-filtro="">{t("All stages", "Todas las etapas")} <span className="cnt">{mermasEnRango.length}</span></button>
            {ETAPAS.map((e) => (
              <button type="button" key={e} className={`chip ops-chip-etapa${etapaFiltro === e ? " active" : ""}`} onClick={() => setEtapaFiltro(etapaFiltro === e ? "" : e)} data-etapa-filtro={e} aria-pressed={etapaFiltro === e}>
                <span className="ops-etapa ops-etapa-mini" data-etapa={e} aria-hidden /> {nombreDeEtapa(e, lang)} <span className="cnt">{cuentaEtapa(e)}</span>
              </button>
            ))}
          </div>
          {seleccionadas.length > 0 && (
            <div className="ops-seleccion" role="region" aria-label={t("Selected for approval", "Seleccionadas para aprobar")} data-seleccion={seleccionadas.length}>
              <span>{t(`${seleccionadas.length} selected`, `${seleccionadas.length} seleccionada${seleccionadas.length === 1 ? "" : "s"}`)}</span>
              {/* 281: crear un grupo, firmarlo (gerente + supervisor) y aprobar todas de una vez — la vía principal. */}
              <button type="button" className="btn btn-primary" onClick={() => void iniciarAprobacion()} data-accion="iniciar-aprobacion">
                ✅ {t(`Start approval (${seleccionadas.length})`, `Iniciar aprobación (${seleccionadas.length})`)}
              </button>
              <a className="btn" href={urlDeHoja(seleccionadas.map((r) => r.id))} target="_blank" rel="noreferrer" data-accion="imprimir-hoja">
                🖨 {t(`Print approval sheet (${seleccionadas.length})`, `Imprimir hoja de aprobación (${seleccionadas.length})`)}
              </a>
              <button type="button" className="btn" onClick={() => setAdjuntando((x) => !x)} data-accion="adjuntar-hoja-seleccion">📎 {t(`Attach signed sheet (${seleccionadas.length})`, `Adjuntar hoja firmada (${seleccionadas.length})`)}</button>
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => { setSeleccion(new Set()); setAdjuntando(false); }} data-accion="limpiar-seleccion">{t("Clear", "Quitar")}</button>
            </div>
          )}
          {adjuntando && seleccionadas.length > 0 && (
            <AdjuntarYMarcar reportes={seleccionadas} ctx={ctx} etapa="approved" etiqueta={t("Choose the signed sheet (photo or PDF)", "Elegir la hoja firmada (foto o PDF)")}
              onListo={(n) => { setAdjuntando(false); actualizaFilas(n); }} onParcial={actualizaFilas} onCancelar={() => setAdjuntando(false)} />
          )}
          {mermasPorEtapa.length > 0 && (
            <div className="ops-exportar">
              <button type="button" className="btn btn-sm" onClick={() => exportarCsv(mermasPorEtapa)} data-accion="exportar-csv" title={t("Download these rows as a CSV file to paste into Excel", "Baja estas filas como CSV para pegarlas en Excel")}>
                ⬇ {t("Export CSV", "Exportar CSV")} <span className="cnt">{mermasPorEtapa.length}</span>
              </button>
              <button type="button" className="btn btn-sm" onClick={() => void descargarPdf(mermasPorEtapa, true)} disabled={generandoPdf} data-accion="exportar-pdf" title={t("Download these rows as a PDF report", "Baja estas filas como un reporte PDF")}>
                📄 {generandoPdf ? t("Generating…", "Generando…") : t("Download PDF", "Descargar PDF")} <span className="cnt">{mermasPorEtapa.length}</span>
              </button>
            </div>
          )}
          <TablaDeMermaExcel filas={mermasPorEtapa} ctx={ctx} onAbrir={setAbierto} repetidas={repetidas} data-lista="merma-en-rango" conEtapa
            seleccion={{ ids: seleccion, puede: puedeSeleccionar, alternar }}
            vacio={rango ? (etapaFiltro ? t("No scrap in that stage in this range.", "No hay merma en esa etapa en este rango.") : t("No scrap broken in this range.", "No se rompió nada en este rango.")) : t("Fix the dates to see the list.", "Corrige las fechas para ver la lista.")} />
          {/* 281: archivo de grupos de aprobación — abre la hoja digital de cada uno (firmas + fotos). */}
          {grupos.length > 0 && (
            <div className="ops-grupos" data-grupos={grupos.length}>
              <h3 className="ops-merma-titulo">{t("Approval groups", "Grupos de aprobación")} <span className="count-tag">{grupos.length}</span></h3>
              <ul className="ops-grupos-lista">
                {grupos.map((g) => (
                  <li key={g.id} data-grupo={g.id}>
                    <button type="button" className="btn btn-sm" onClick={() => abrirGrupo(g.id)} data-abrir-grupo={g.id}>🗂 {g.name}</button>
                    <span className="hint">{t(`${g.n_reportes ?? 0} reports`, `${g.n_reportes ?? 0} reportes`)} · {g.store} · <span data-estado-grupo={g.id}>{estadoDelGrupo(g, lang)}</span></span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      {filas && pestana === "entregas" && (
        <div className="ops-merma ops-entregas" data-entregas>
          {selectorDeRango}
          <KpiDeEntregas rango={rango} ctx={ctx} />
        </div>
      )}

      {filas && pestana === "lista" && (
        <>
          <div className="filters-oneline ops-filtros">
            <button type="button" className={`chip${tipo === "" ? " active" : ""}`} onClick={() => setTipo("")}>{t("All", "Todos")} <span className="cnt">{propias.length}</span></button>
            {TIPOS.filter((k) => cuenta(k) > 0).map((k) => (
              <button type="button" key={k} className={`chip${tipo === k ? " active" : ""}`} onClick={() => setTipo(k)} data-chip={k}>
                {INFO_DE_TIPO[k].emoji} {nombreTipo(k)} <span className="cnt">{cuenta(k)}</span>
              </button>
            ))}
          </div>
          {modo === "todos" && (
            <div className="ops-filtros-campos">
              <select value={tienda} onChange={(e) => setTienda(e.target.value)} aria-label={t("Store", "Tienda")}>
                <option value="">{t("All stores", "Todas las tiendas")}</option>
                {ctx.tiendas.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
              <select value={empleado} onChange={(e) => setEmpleado(e.target.value)} aria-label={t("Employee", "Empleado")}>
                <option value="">{t("Any employee", "Cualquier empleado")}</option>
                {ctx.personas.map((p) => <option key={p.id} value={p.id}>{p.full_name}</option>)}
              </select>
              <span className="ops-fecha">{t("From", "Desde")} <input type="date" value={desde} onChange={(e) => setDesde(e.target.value)} aria-label={t("From", "Desde")} /></span>
              <span className="ops-fecha">{t("To", "Hasta")} <input type="date" value={hasta} onChange={(e) => setHasta(e.target.value)} aria-label={t("To", "Hasta")} /></span>
            </div>
          )}
          {modo === "todos" && pendientesDeFoto > 0 && (
            <p className="ops-aviso ops-aviso-pendiente" role="status" data-pendientes-de-foto={pendientesDeFoto}>
              📷 {t(`${pendientesDeFoto} scrap report${pendientesDeFoto === 1 ? "" : "s"} saved on paper more than 24 h ago still without a photo. Ask for the photo; nothing is deleted on its own.`,
                `${pendientesDeFoto} merma${pendientesDeFoto === 1 ? "" : "s"} guardada${pendientesDeFoto === 1 ? "" : "s"} en papel hace más de 24 h sigue${pendientesDeFoto === 1 ? "" : "n"} sin foto. Pide la foto; nada se borra solo.`)}
            </p>
          )}
          {listaUsaExcel && visibles.length > 0 && (
            <div className="ops-exportar">
              <button type="button" className="btn btn-sm" onClick={() => exportarCsv(visibles)} data-accion="exportar-csv" title={t("Download these rows as a CSV file to paste into Excel", "Baja estas filas como CSV para pegarlas en Excel")}>
                ⬇ {t("Export CSV", "Exportar CSV")} <span className="cnt">{visibles.length}</span>
              </button>
              <button type="button" className="btn btn-sm" onClick={() => void descargarPdf(visibles, false)} disabled={generandoPdf} data-accion="exportar-pdf" title={t("Download these rows as a PDF report", "Baja estas filas como un reporte PDF")}>
                📄 {generandoPdf ? t("Generating…", "Generando…") : t("Download PDF", "Descargar PDF")} <span className="cnt">{visibles.length}</span>
              </button>
            </div>
          )}
          {listaUsaExcel
            ? <TablaDeMermaExcel filas={visibles} ctx={ctx} onAbrir={setAbierto} repetidas={repetidas} data-lista="todos" conEtapa
                vacio={modo === "mios"
                  ? t("You haven't filed any reports yet. Pick one on the Warehouse Ops screen.", "Todavía no has llenado reportes. Elige uno en la pantalla de Operaciones.")
                  : t("No reports match these filters.", "Ningún reporte coincide con estos filtros.")} />
            : <TablaDeReportes filas={visibles} ctx={ctx} onAbrir={setAbierto} repetidas={repetidas} data-lista="todos"
                vacio={modo === "mios"
                  ? t("You haven't filed any reports yet. Pick one on the Warehouse Ops screen.", "Todavía no has llenado reportes. Elige uno en la pantalla de Operaciones.")
                  : t("No reports match these filters.", "Ningún reporte coincide con estos filtros.")} />}
        </>
      )}

      {abierto && <Tarjeta r={abierto} ctx={ctx} onCerrar={() => setAbierto(null)}
        onCambio={(n) => { setAbierto(n); setFilas((f) => (f ?? []).map((x) => (x.id === n.id ? n : x))); }} />}
    </section>
  );
}

/** La tabla de reportes (la de Órdenes, CLAUDE.md); la usan la lista y la pestaña de merma. Cada fila se abre como tarjeta. */
function TablaDeReportes({ filas, ctx, onAbrir, vacio, repetidas, conEtapa, seleccion, "data-lista": dataLista }: {
  filas: Reporte[]; ctx: Contexto; onAbrir: (r: Reporte) => void; vacio: string; repetidas: Map<string, string[]>; "data-lista": string;
  /** D-921 (270): la columna «Etapa» (pestaña de merma). Sin ella, el chip sale chico junto al detalle. */
  conEtapa?: boolean;
  /** Casillas para la hoja de aprobación: qué ids están marcados, cuáles se pueden marcar, y el cambio. */
  seleccion?: { ids: Set<string>; puede: (r: Reporte) => boolean; alternar: (id: string) => void };
}) {
  const { t, lang } = usePrefs();
  const nombre = (id: string) => ctx.personas.find((p) => p.id === id)?.full_name ?? "—";
  const nombreTipo = (k: TipoDeReporte) => (lang === "es" ? INFO_DE_TIPO[k].es : INFO_DE_TIPO[k].en);
  const conCasillas = !!seleccion && filas.some((r) => seleccion.puede(r));
  const columnas = 6 + (conEtapa ? 1 : 0) + (conCasillas ? 1 : 0);
  return (
    <div className="tbl-scroll tbl-caja">
      <table className="orders" data-lista={dataLista}>
        <thead>
          <tr>
            {conCasillas && <th className="ops-col-casilla" aria-label={t("Select for the approval sheet", "Marcar para la hoja de aprobación")} />}
            <th title={t("Scrap: the date it was broken. Others: when it was reported.", "Merma: el día en que se rompió. Los demás: cuándo se reportó.")}>{t("When", "Cuándo")}</th>
            {conEtapa && <th>{t("Stage", "Etapa")}</th>}
            <th>{t("Type", "Tipo")}</th><th>{t("Store", "Tienda")}</th>
            <th>{t("Filed by", "Lo llenó")}</th><th>{t("Employee", "Empleado")}</th><th>{t("Detail", "Detalle")}</th>
          </tr>
        </thead>
        <tbody>
          {filas.length === 0 && <tr><td colSpan={columnas} className="hint">{vacio}</td></tr>}
          {filas.map((r) => (
            <tr key={r.id} onClick={() => onAbrir(r)} className="ops-fila-tabla" data-reporte={r.id} data-etapa={r.kind === "scrap" ? etapaDe(r) : undefined}>
              {conCasillas && (
                <td className="ops-col-casilla" onClick={(e) => e.stopPropagation()}>
                  {seleccion!.puede(r) && (
                    <input type="checkbox" checked={seleccion!.ids.has(r.id)} onChange={() => seleccion!.alternar(r.id)}
                      aria-label={t("Select for the approval sheet", "Marcar para la hoja de aprobación")} data-casilla={r.id} />
                  )}
                </td>
              )}
              <td style={{ whiteSpace: "nowrap" }} data-dia={diaDelReporte(r)}>
                {r.kind === "scrap" ? fmtDia(diaDelReporte(r), lang) : fmtDateTime(r.created_at)}
                <IconoDeFotos r={r} />
                <InsigniasDeFoto r={r} repetida={repetidas.has(r.id)} />
              </td>
              {conEtapa && <td className="ops-col-etapa">{r.kind === "scrap" ? <ChipDeEtapa r={r} /> : "—"}</td>}
              <td style={{ whiteSpace: "nowrap" }}>{INFO_DE_TIPO[r.kind].emoji} {nombreTipo(r.kind)}</td>
              <td>{r.store}</td>
              <td>{r.author_name ?? nombre(r.author_id)}</td>
              <td>{r.subject_ids.map(nombre).join(", ")}</td>
              <td className="ops-detalle-corto">{r.kind === "scrap"
                ? `${r.product_not_in_catalog ? `${r.product_name ?? ""} (${t("not in catalog", "fuera de catálogo")})` : r.product_sku ?? ""} · ${repartoDeReporte(r).damaged} ${t("damaged", "dañadas")} · ${fmtMoney(r.total_loss)}${cuentaComoPerdida(r) ? "" : ` (${t("no CRMA", "sin CRMA")})`}`
                : String(r.answers.description ?? "")}{!conEtapa && r.kind === "scrap" && <ChipDeEtapa r={r} conFecha={false} />}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * La lista de merma como el Excel de Roberto (gerente de almacén): una fila por reporte, con las columnas de su hoja
 * (fecha, código, descripción, cantidades agrupadas, cómo, motivo, lo rompió, lo reportó, CRMA #, comentarios) y las
 * de siempre (casilla, Cuándo, Etapa, Tipo, Tienda, Lo llenó), que pidió conservar. Encabezado de dos niveles; las
 * cifras a la derecha; se desplaza de lado dentro de su caja. Cada fila se abre como tarjeta, igual que antes.
 */
function TablaDeMermaExcel({ filas, ctx, onAbrir, vacio, repetidas, conEtapa = true, seleccion, "data-lista": dataLista }: {
  filas: Reporte[]; ctx: Contexto; onAbrir: (r: Reporte) => void; vacio: string; repetidas: Map<string, string[]>; "data-lista": string;
  conEtapa?: boolean;
  seleccion?: { ids: Set<string>; puede: (r: Reporte) => boolean; alternar: (id: string) => void };
}) {
  const { t, lang } = usePrefs();
  const nombre = (id: string) => ctx.personas.find((p) => p.id === id)?.full_name ?? "—";
  const nombreTipo = (k: TipoDeReporte) => (lang === "es" ? INFO_DE_TIPO[k].es : INFO_DE_TIPO[k].en);
  const conCasillas = !!seleccion && filas.some((r) => seleccion.puede(r));
  const fijas = 4 + (conEtapa ? 1 : 0) + (conCasillas ? 1 : 0);
  const grupo = COLUMNAS_EXCEL.filter((c) => c.grupo);
  const antes = COLUMNAS_EXCEL.filter((c, n) => !c.grupo && n < COLUMNAS_EXCEL.findIndex((x) => x.grupo));
  const despues = COLUMNAS_EXCEL.filter((c, n) => !c.grupo && n > COLUMNAS_EXCEL.findIndex((x) => x.grupo));
  const columnas = fijas + COLUMNAS_EXCEL.length;
  const titulo = (c: (typeof COLUMNAS_EXCEL)[number]) => (lang === "es" ? c.es : c.en);
  return (
    <div className="tbl-scroll tbl-caja ops-tabla-excel-caja">
      <table className="orders ops-tabla-excel" data-lista={dataLista}>
        <thead>
          <tr>
            {conCasillas && <th rowSpan={2} className="ops-col-casilla" aria-label={t("Select for the approval sheet", "Marcar para la hoja de aprobación")} />}
            <th rowSpan={2} title={t("When it was reported", "Cuándo se reportó")}>{t("When", "Cuándo")}</th>
            {conEtapa && <th rowSpan={2}>{t("Stage", "Etapa")}</th>}
            <th rowSpan={2}>{t("Type", "Tipo")}</th><th rowSpan={2}>{t("Store", "Tienda")}</th><th rowSpan={2}>{t("Filed by", "Lo llenó")}</th>
            {antes.map((c) => <th key={c.id} rowSpan={2} data-col={c.id}>{titulo(c)}</th>)}
            <th colSpan={grupo.length} className="ops-col-grupo" data-col="cantidades">{t("Quantities", "Cantidades")}</th>
            {despues.map((c) => <th key={c.id} rowSpan={2} data-col={c.id}>{titulo(c)}</th>)}
          </tr>
          <tr>
            {grupo.map((c) => <th key={c.id} className="num ops-col-subgrupo" data-col={c.id}>{titulo(c)}</th>)}
          </tr>
        </thead>
        <tbody>
          {filas.length === 0 && <tr><td colSpan={columnas} className="hint">{vacio}</td></tr>}
          {filas.map((r) => {
            const c = celdasDeMerma(r, ctx.personas, lang);
            const celda = (k: (typeof COLUMNAS_EXCEL)[number]) => {
              if (k.id === "fecha") return <td key={k.id} className="ops-celda-fecha" data-col={k.id} data-dia={c.fecha}>{fmtDia(c.fecha, lang)}</td>;
              if (k.id === "costo") return (
                <td key={k.id} className="num" data-col={k.id} title={t(`Price per piece: ${fmtMoney(r.unit_cost)}`, `Precio por pieza: ${fmtMoney(r.unit_cost)}`)} data-cuenta-como-perdida={cuentaComoPerdida(r) ? "si" : "no"}>
                  {fmtMoney(r.total_loss)}{!cuentaComoPerdida(r) && <span className="hint"> ({t("no CRMA", "sin CRMA")})</span>}
                </td>
              );
              if (k.id === "codigo" && r.product_not_in_catalog) return <td key={k.id} data-col={k.id}><span className="ops-fuera-de-catalogo">{t("Not in catalog", "No está en el catálogo")}</span></td>;
              if (k.id === "comentarios" || k.id === "descripcion") return <td key={k.id} className="ops-celda-texto" data-col={k.id} title={c[k.id]}>{c[k.id]}</td>;
              return <td key={k.id} className={k.num ? "num" : undefined} data-col={k.id}>{c[k.id]}</td>;
            };
            return (
              <tr key={r.id} onClick={() => onAbrir(r)} className="ops-fila-tabla" data-reporte={r.id} data-etapa={etapaDe(r)}>
                {conCasillas && (
                  <td className="ops-col-casilla" onClick={(e) => e.stopPropagation()}>
                    {seleccion!.puede(r) && (
                      <input type="checkbox" checked={seleccion!.ids.has(r.id)} onChange={() => seleccion!.alternar(r.id)}
                        aria-label={t("Select for the approval sheet", "Marcar para la hoja de aprobación")} data-casilla={r.id} />
                    )}
                  </td>
                )}
                <td style={{ whiteSpace: "nowrap" }} data-reportado={r.created_at}>
                  {fmtDateTime(r.created_at)}
                  <IconoDeFotos r={r} />
                  <InsigniasDeFoto r={r} repetida={repetidas.has(r.id)} />
                </td>
                {conEtapa && <td className="ops-col-etapa"><ChipDeEtapa r={r} /></td>}
                <td style={{ whiteSpace: "nowrap" }}>{INFO_DE_TIPO[r.kind].emoji} {nombreTipo(r.kind)}</td>
                <td>{r.store}</td>
                <td>{r.author_name ?? nombre(r.author_id)}</td>
                {COLUMNAS_EXCEL.map(celda)}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/** 268: la cámara junto a la fecha; solo si hay fotos, y el título dice cuántas. Sin icono = sin fotos. */
function IconoDeFotos({ r }: { r: Pick<Reporte, "photos"> }) {
  const { lang } = usePrefs();
  const n = (r.photos ?? []).length;
  const ic = iconoDeFotos(n, lang);
  if (!ic.muestra) return null;
  return <span className="ops-icono-fotos" title={ic.titulo} aria-label={ic.titulo} role="img" data-fotos={n}> 📷</span>;
}

/** 268: «Falta la foto» / «Foto pendiente» (guardada en papel) y «Foto repetida» (comparte una foto con otro reporte). */
function InsigniasDeFoto({ r, repetida }: { r: Reporte; repetida: boolean }) {
  const { t, lang } = usePrefs();
  const sin = sinFoto(r);
  if (!sin && !repetida) return null;
  return (
    <>
      {sin && <span className={`ops-insignia ops-insignia-sin-foto${fotoPendienteVencida(r) ? " vencida" : ""}`} data-sin-foto={fotoPendienteVencida(r) ? "vencida" : "si"}>{etiquetaSinFoto(r, lang)}</span>}
      {repetida && <span className="ops-insignia ops-insignia-repetida" data-foto-repetida title={t("One of its photos is also in another report", "Una de sus fotos también está en otro reporte")}>{t("Duplicate photo", "Foto repetida")}</span>}
    </>
  );
}

/**
 * Un reporte como tarjeta, encima de la lista (regla de la casa: los registros se abren en su sitio). También la abre
 * el asistente (268) cuando una foto ya se usó en otro reporte.
 */
export function Tarjeta({ r, ctx, onCerrar, onCambio }: { r: Reporte; ctx: Contexto; onCerrar: () => void; onCambio: (r: Reporte) => void }) {
  const { t, lang } = usePrefs();
  const [fotos, setFotos] = useState<string[]>([]);
  const [corrigiendo, setCorrigiendo] = useState(false);
  const [huellasCalculadas, setHuellasCalculadas] = useState(false);
  const corrige = puedeCorregirMerma(ctx.yo, r);
  // 268: el autor o quien corrige la merma le agrega la foto a una guardada «sin foto».
  const agregaFoto = r.kind === "scrap" && sinFoto(r) && (r.author_id === ctx.yo.id || corrige);
  const sinHuella = fotosSinHuella(r);
  useEffect(() => {
    if (ctx.demo || r.photos.length === 0) return;
    let vivo = true;
    void enlacesDeFotos(createClient(), r.photos).then((u) => { if (vivo) setFotos(u); });
    return () => { vivo = false; };
  }, [r.photos, ctx.demo]);
  // 268: las fotos de antes no tienen huella (SQL no puede leer storage): se calcula aquí, al abrir, y se guarda.
  useEffect(() => {
    if (ctx.demo || sinHuella === 0 || fotos.length !== r.photos.length || huellasCalculadas) return;
    let vivo = true;
    (async () => {
      try {
        const nuevas: (string | null)[] = [];
        for (let n = 0; n < fotos.length; n++) {
          const ya = r.photo_hashes?.[n];
          if (ya) { nuevas.push(ya); continue; }
          const res = await fetch(fotos[n]);
          nuevas.push(res.ok ? await sha256Hex(await res.arrayBuffer()) : null);
        }
        if (!vivo) return;
        await guardarHuellas(createClient(), r.id, nuevas);
        if (vivo) { setHuellasCalculadas(true); onCambio({ ...r, photo_hashes: nuevas }); }
      } catch { /* sin la 268, o sin red: se intenta la próxima vez que se abra */ }
    })();
    return () => { vivo = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fotos, sinHuella, ctx.demo, huellasCalculadas]);
  const nombre = (id: string) => ctx.personas.find((p) => p.id === id)?.full_name ?? "—";
  const info = INFO_DE_TIPO[r.kind];
  const reparto = repartoDeReporte(r);
  const reportadoPor = Array.isArray(r.answers[PASO_QUIEN_REPORTO]) ? (r.answers[PASO_QUIEN_REPORTO] as string[]) : [];
  const filas: [string, string][] = [];
  for (const p of PASOS[r.kind]) {
    const v = r.answers[p.id];
    if (v == null || v === "") continue;
    if (p.tipo === "personas" || p.tipo === "persona" || p.tipo === "fecha") continue;
    // En merma, el origen, el motivo y el CRMA ya salen arriba desde sus columnas (las que el gerente puede corregir).
    if (r.kind === "scrap" && (p.id === "return_type" || p.id === "reason" || p.id === "crma")) continue;
    // 273: el equipo de un reporte de mantenimiento puede venir del inventario (answers.equipment_name).
    const texto = p.tipo === "opcion" || p.tipo === "sino" ? etiquetaDeOpcion(r.kind, p.id, v, lang) : String(v);
    filas.push([(lang === "es" ? p.es : p.en).replace(/ \((optional|opcional)\)$/, ""), r.kind === "maintenance" && p.id === "equipment" ? etiquetaDeEquipoDelReporte(r.answers, texto) : texto]);
  }
  return (
    <div className="overlay" onClick={onCerrar}>
      <div className="modal ops-tarjeta-reporte" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" data-tarjeta={r.id}>
        <h3>{info.emoji} {lang === "es" ? info.es : info.en}<IconoDeFotos r={r} /></h3>
        <p className="sub">{r.kind === "scrap" ? t("Reported ", "Reportado ") : ""}{fmtDateTime(r.created_at)} · {r.store} · {t("filed by", "lo llenó")} {r.author_name ?? nombre(r.author_id)}</p>
        {sinFoto(r) && (
          <p className="ops-aviso ops-aviso-error" role="status" data-tarjeta-sin-foto={fotoPendienteVencida(r) ? "vencida" : "si"}>
            📷 {etiquetaSinFoto(r, lang)} · {t("Saved from paper, without a photo of the pieces. It is incomplete until the photo is added.", "Guardado desde papel, sin foto de las piezas. Está incompleto hasta que se le agregue la foto.")}
          </p>
        )}
        {esDeRrhh(r.kind) && <p className="ops-tarjeta-rrhh">{t("In the employee's HR file", "En el expediente del empleado")}</p>}
        <dl className="ops-tarjeta-datos">
          {r.subject_ids.length > 0 && <><dt>{t("Employee", "Empleado")}</dt><dd>{r.subject_ids.map(nombre).join(", ")}</dd></>}
          {r.kind === "scrap" && (
            <>
              <dt>{t("Date broken", "Fecha del daño")}</dt><dd data-fecha-del-dano={diaDelReporte(r)}>{fmtDia(diaDelReporte(r), lang)}</dd>
              <dt>{t("Product", "Producto")}</dt>
              <dd data-producto-reporte={r.product_not_in_catalog ? "libre" : "catalogo"}>
                {r.product_not_in_catalog
                  ? <>{r.product_name} <span className="ops-fuera-de-catalogo">{t("Not in catalog", "No está en el catálogo")}</span></>
                  : <>{r.product_sku} · {r.product_name}</>}
                {corrige && !corrigiendo && (
                  <button type="button" className="btn btn-sm" onClick={() => setCorrigiendo(true)} data-accion="corregir-producto">
                    {r.product_not_in_catalog ? t("Link / edit", "Vincular / editar") : t("Edit", "Editar")}
                  </button>
                )}
              </dd>
              {corrigiendo && <CorregirProducto r={r} ctx={ctx} onListo={(n) => { setCorrigiendo(false); if (n) onCambio(n); }} />}
              {corrigiendo && <CorregirOrigen r={r} ctx={ctx} onListo={(n) => { setCorrigiendo(false); if (n) onCambio(n); }} />}
              <dt>{t("Type", "Tipo")}</dt><dd>{etiquetaDeOpcion("scrap", "scrap_type", r.scrap_type, lang)}</dd>
              <dt>{t("Damaged / sample", "Dañadas / muestra")}</dt>
              <dd data-reparto-reporte={`${reparto.damaged}/${reparto.sample}`}>{t(`${reparto.damaged} damaged · ${reparto.sample} sample`, `${reparto.damaged} dañadas · ${reparto.sample} de muestra`)}</dd>
              <dt>{t("Quantity", "Cantidad")}</dt><dd>{r.loose_pieces
                ? t(`${r.boxes} boxes × ${r.pieces_per_box} + ${r.loose_pieces} loose = ${r.total_pieces} pieces`, `${r.boxes} cajas × ${r.pieces_per_box} + ${r.loose_pieces} sueltas = ${r.total_pieces} piezas`)
                : t(`${r.boxes} boxes × ${r.pieces_per_box} = ${r.total_pieces} pieces`, `${r.boxes} cajas × ${r.pieces_per_box} = ${r.total_pieces} piezas`)}</dd>
              <dt>{t("Price per piece (when reported)", "Precio por pieza (al reportar)")}</dt><dd>{fmtMoney(r.unit_cost)}</dd>
              <dt>{t("Loss (damaged pieces only)", "Pérdida (solo piezas dañadas)")}</dt><dd className="ops-tarjeta-perdida" data-perdida-reporte={r.total_loss ?? ""} data-cuenta-como-perdida={cuentaComoPerdida(r) ? "si" : "no"}>
                {fmtMoney(r.total_loss)}
                {!cuentaComoPerdida(r) && <span className="hint" data-sin-crma> · {t("No CRMA: not counted as loss", "Sin CRMA: no cuenta como pérdida")}</span>}
              </dd>
              <dt>{t("Where from", "De dónde")}</dt><dd data-origen-reporte={r.return_type ?? ""}>{etiquetaDeOpcion("scrap", "return_type", r.return_type, lang) || "—"}</dd>
              <dt>{t("Reason", "Motivo")}</dt><dd>{etiquetaDeOpcion("scrap", "reason", r.reason, lang)}</dd>
              {r.broken_by.length > 0 && <><dt>{t("Broken by", "Lo rompió")}</dt><dd>{r.broken_by.map(nombre).join(", ")}</dd></>}
              {/* Quién avisó (D-915): va en answers, no en columna. Distinto de quién lo rompió y de quién lo llenó. */}
              {reportadoPor.length > 0 && <><dt>{t("Reported by", "Lo reportó")}</dt><dd data-reportado-por>{reportadoPor.map((x) => nombreOTexto(ctx.personas, x)).join(", ")}</dd></>}
              {(r.crma || r.return_type === "customer_return") && <><dt>CRMA</dt><dd data-crma-reporte={r.crma ?? ""}>{r.crma || t("Not yet", "Todavía no")}</dd></>}
            </>
          )}
          {filas.map(([k, v]) => <div key={k} className="ops-par"><dt>{k}</dt><dd>{v}</dd></div>)}
        </dl>
        {r.photos.length > 0 && (
          <div className="ops-fotos-lista">
            {fotos.map((u, n) => (
              // eslint-disable-next-line @next/next/no-img-element
              <a key={n} href={u} target="_blank" rel="noreferrer"><img src={u} alt={t(`Photo ${n + 1}`, `Foto ${n + 1}`)} /></a>
            ))}
            {ctx.demo && <p className="hint">{t("Photos are not shown in demo mode.", "En el demo no se enseñan fotos.")}</p>}
          </div>
        )}
        {r.photos.length > 0 && sinHuella > 0 && !ctx.demo && (
          <p className="hint" data-huellas="calculando">{t("Report from before duplicate detection: the photo fingerprints are being computed now and saved for next time.", "Reporte de antes de la detección de repetidas: las huellas de las fotos se calculan ahora y se guardan para la próxima.")}</p>
        )}
        {agregaFoto && <AgregarFoto r={r} ctx={ctx} onListo={onCambio} />}
        {/* D-921 (270): la línea de etapas y lo que el gerente hace con ella. Sin la 270 (sin columnas) sale solo la línea, sin botones. */}
        {r.kind === "scrap" && <LineaDeEtapas r={r} ctx={ctx} onCambio={onCambio} />}
        {r.kind === "scrap" && !tieneEtapas(r) && puedeCorregirMerma(ctx.yo, r) && <p className="hint" data-sin-270>{t("Approval stages need database migration 270.", "Las etapas de aprobación necesitan la migración 270 de la base.")}</p>}
        <div className="modal-actions"><button type="button" className="btn btn-primary" onClick={onCerrar}>{t("Close", "Cerrar")}</button></div>
      </div>
    </div>
  );
}

/**
 * 268: agregar la foto a una merma guardada «sin foto» (la apuntaron en papel). Sube, calcula la huella, avisa si la
 * foto ya está en otro reporte (solo aviso) y llama a `warehouse_ops_add_photos`, que quita `photo_pending`.
 */
function AgregarFoto({ r, ctx, onListo }: { r: Reporte; ctx: Contexto; onListo: (n: Reporte) => void }) {
  const { t, lang } = usePrefs();
  const [lista, setLista] = useState<{ jpg: string; huella: string; otros: Repetida[] }[]>([]);
  const [leyendo, setLeyendo] = useState(false);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dia = (iso: string) => (/^\d{4}-\d{2}-\d{2}$/.test(iso) ? fmtDia(iso, lang) : fmtDateTime(iso));
  // D-917: la misma lectura que el asistente (bytes en el acto, decodificador con respaldo, motivo visible y en consola).
  const agrega = async (f: File, origen: "camara" | "galeria") => {
    if (lista.length >= MAX_FOTOS) return;
    setLeyendo(true); setError(null);
    try {
      const leida = await leerFotoDelTelefono(f);
      if (!leida.ok) {
        console.error(detalleParaConsola(leida, f, navigator.userAgent, origen));
        setError(mensajeDeFotoFallida(leida.motivo, lang));
        return;
      }
      const { jpg, huella } = leida;
      const otros = ctx.demo ? [] : await reportesConLaFoto(createClient(), huella).catch(() => [] as Repetida[]);
      setLista((x) => [...x, { jpg, huella, otros: otros.filter((o) => o.reporteId !== r.id) }]);
    } catch (e) {
      console.error(`[merma/foto] inesperado · origen=${origen} · ua=${navigator.userAgent}`, e);
      setError(mensajeDeFotoFallida("no-decodifica", lang));
    } finally { setLeyendo(false); }
  };
  const guarda = async () => {
    if (lista.length === 0) return;
    setGuardando(true); setError(null);
    try {
      let rutas = lista.map((_, n) => `demo/${n}.jpg`);
      if (!ctx.demo) {
        const sb = createClient();
        rutas = [];
        for (const x of lista) rutas.push(await subirFoto(sb, ctx.yo.id, x.jpg));
        await agregarFotos(sb, r.id, rutas, lista.map((x) => x.huella));
      }
      onListo({ ...r, photos: [...r.photos, ...rutas], photo_hashes: [...(r.photo_hashes ?? r.photos.map(() => null)), ...lista.map((x) => x.huella)], photo_pending: false });
    } catch (e) { setError(e instanceof Error ? e.message : String((e as { message?: string })?.message ?? e)); }
    finally { setGuardando(false); }
  };
  return (
    <div className="ops-corregir ops-agregar-foto" data-agregar-foto={r.id}>
      <p className="hint">{t("Add the photo of the damaged pieces to complete this report.", "Agrega la foto de las piezas dañadas para completar este reporte.")}</p>
      <div className="ops-fotos-lista">
        {lista.map((x, n) => (
          <figure key={n} data-repetida={x.otros.length > 0 ? "si" : undefined}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={x.jpg} alt={t(`Photo ${n + 1}`, `Foto ${n + 1}`)} />
            <button type="button" className="ops-boton" onClick={() => setLista((l) => l.filter((_, m) => m !== n))}>{t("Remove", "Quitar")}</button>
          </figure>
        ))}
      </div>
      {lista.map((x, n) => x.otros.length > 0 && (
        <p key={n} className="ops-aviso ops-aviso-error" role="alert" data-aviso="foto-repetida" data-foto={n}>⚠️ {avisoDeRepetida(x.otros[0], lang, dia)} {t("Keep it only if it is the same damage.", "Déjala solo si es el mismo daño.")}</p>
      ))}
      {lista.length < MAX_FOTOS && (
        <BotonesDeFoto onFoto={(f, origen) => void agrega(f, origen)} leyendo={leyendo} disabled={guardando}
          etiquetaCamara={t("Take the photo of the pieces", "Tomar la foto de las piezas")} />
      )}
      {error && <p className="ops-aviso ops-aviso-error" role="alert" data-aviso="foto-fallida">{error}</p>}
      <div className="modal-actions">
        <button type="button" className="btn btn-primary" onClick={() => void guarda()} disabled={lista.length === 0 || guardando} data-accion="guardar-foto">
          {guardando ? t("Saving…", "Guardando…") : t("Add photo and complete", "Agregar foto y completar")}
        </button>
      </div>
    </div>
  );
}

/**
 * Corregir el producto de una merma (migración 252, pedido b158a7a5): el gerente/supervisor de la tienda o el admin
 * la vincula a un producto del catálogo, o corrige el nombre y el precio a mano. La base recalcula la pérdida.
 */
function CorregirProducto({ r, ctx, onListo }: { r: Reporte; ctx: Contexto; onListo: (n: Reporte | null) => void }) {
  const { t } = usePrefs();
  const [q, setQ] = useState("");
  const [lista, setLista] = useState<ProductoElegido[]>([]);
  const [nombre, setNombre] = useState(r.product_name ?? "");
  const [costo, setCosto] = useState(r.unit_cost == null ? "" : String(r.unit_cost));
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    const texto = q.trim();
    if (texto.length < 2) { setLista([]); return; }
    let vivo = true;
    const id = setTimeout(async () => {
      try {
        const res = ctx.demo
          ? DEMO_PRODUCTOS.filter((p) => (p.sku + " " + p.name).toLowerCase().includes(texto.toLowerCase()))
          : await buscarProductos(createClient(), texto);
        if (vivo) setLista(res);
      } catch (e) { if (vivo) setError(e instanceof Error ? e.message : String((e as { message?: string })?.message ?? e)); }
    }, 250);
    return () => { vivo = false; clearTimeout(id); };
  }, [q, ctx.demo]);

  // La misma cuenta que la base (259, 263 y 272): precio de venta × piezas dañadas; $0 en devolución de cliente sin CRMA.
  const total = (c: number | null) => perdidaDeMerma(c, repartoDeReporte(r), r);
  const guarda = async (p: ProductoElegido | null) => {
    const c = costoDelCampo(costo);
    if (!p && (nombre.trim().length < 2 || Number.isNaN(c))) { setError(t("Write a name and a valid price.", "Escribe un nombre y un precio válido.")); return; }
    setGuardando(true); setError(null);
    try {
      if (!ctx.demo) await corregirMerma(createClient(), r.id, { productId: p?.id ?? null, nombre: p ? p.name : nombre.trim(), costo: p ? p.cost : c });
      const n: Reporte = p
        ? { ...r, product_id: p.id, product_sku: p.sku, product_name: p.name, unit_cost: p.cost, total_loss: total(p.cost), product_not_in_catalog: false }
        : { ...r, product_id: null, product_sku: null, product_name: nombre.trim(), unit_cost: c, total_loss: total(c), product_not_in_catalog: true };
      onListo(n);
    } catch (e) {
      setError(e instanceof Error ? e.message : String((e as { message?: string })?.message ?? e));
    } finally { setGuardando(false); }
  };

  return (
    <div className="ops-corregir" data-corregir={r.id}>
      <p className="hint">{t("Link it to a catalog product:", "Vincúlalo a un producto del catálogo:")}</p>
      <input className="ops-campo" type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("Product name or SKU", "Nombre o SKU del producto")} data-campo="corregir-buscar" />
      <div className="ops-opciones">
        {lista.map((p) => (
          <button type="button" key={p.id} className="ops-opcion ops-producto" disabled={guardando} onClick={() => void guarda(p)} data-producto={p.id}>
            <span className="ops-producto-nombre">{p.name}</span>
            <span className="ops-producto-meta">{p.sku} · {p.cost == null ? t("no price", "sin precio") : fmtMoney(p.cost)}</span>
          </button>
        ))}
      </div>
      <p className="hint">{t("Or keep it out of the catalog and fix the name and sales price:", "O déjalo fuera del catálogo y corrige nombre y precio de venta:")}</p>
      <label className="ops-cantidad"><span>{t("Product name", "Nombre del producto")}</span>
        <input className="ops-campo" value={nombre} onChange={(e) => setNombre(e.target.value)} data-campo="corregir-nombre" /></label>
      <label className="ops-cantidad"><span>{t("Sales price per piece", "Precio de venta por pieza")}</span>
        <input className="ops-campo" inputMode="decimal" value={costo} onChange={(e) => setCosto(e.target.value)} data-campo="corregir-costo" /></label>
      {error && <p className="ops-aviso ops-aviso-error" role="alert">{error}</p>}
      <div className="modal-actions">
        <button type="button" className="btn" onClick={() => onListo(null)} disabled={guardando}>{t("Cancel", "Cancelar")}</button>
        <button type="button" className="btn btn-primary" onClick={() => void guarda(null)} disabled={guardando} data-accion="guardar-correccion">{t("Save", "Guardar")}</button>
      </div>
    </div>
  );
}

/**
 * Corregir de dónde viene una merma y su CRMA (migración 263). El CRMA es opcional al reportar y suele llegar después:
 * quien puede corregir el producto lo pone (o lo quita) aquí. La base recalcula la pérdida con la misma regla: una
 * devolución de cliente sin CRMA no cuenta como pérdida; con CRMA, precio × piezas dañadas.
 */
function CorregirOrigen({ r, ctx, onListo }: { r: Reporte; ctx: Contexto; onListo: (n: Reporte | null) => void }) {
  const { t, lang } = usePrefs();
  const [origen, setOrigen] = useState<"internal" | "customer_return">(r.return_type === "customer_return" ? "customer_return" : "internal");
  const [crma, setCrma] = useState(r.crma ?? "");
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const nuevo = { return_type: origen, crma: origen === "customer_return" && crma.trim() ? crma.trim().slice(0, 100) : null };
  const total = perdidaDeMerma(r.unit_cost, repartoDeReporte(r), nuevo);
  const guarda = async () => {
    setGuardando(true); setError(null);
    try {
      if (!ctx.demo) await corregirOrigenDeMerma(createClient(), r.id, { origen, crma: nuevo.crma });
      onListo({ ...r, ...nuevo, total_loss: total });
    } catch (e) {
      setError(e instanceof Error ? e.message : String((e as { message?: string })?.message ?? e));
    } finally { setGuardando(false); }
  };
  return (
    <div className="ops-corregir" data-corregir-origen={r.id}>
      <p className="hint">{t("Where it came from and its CRMA / claim #:", "De dónde viene y su CRMA / n.º de reclamo:")}</p>
      <label className="ops-cantidad"><span>{t("Where from", "De dónde")}</span>
        <select className="ops-campo" value={origen} onChange={(e) => setOrigen(e.target.value === "customer_return" ? "customer_return" : "internal")} data-campo="corregir-origen">
          {ORIGENES_DE_MERMA.map((o) => <option key={o.v} value={o.v}>{lang === "es" ? o.es : o.en}</option>)}
        </select></label>
      {origen === "customer_return" && (
        <label className="ops-cantidad"><span>{t("CRMA / claim # (optional)", "CRMA / n.º de reclamo (opcional)")}</span>
          <input className="ops-campo" value={crma} maxLength={100} onChange={(e) => setCrma(e.target.value)} data-campo="corregir-crma" /></label>
      )}
      <p className="hint" data-perdida-al-guardar={total ?? ""}>
        {cuentaComoPerdida(nuevo)
          ? t(`Loss when saved: ${fmtMoney(total)}`, `Pérdida al guardar: ${fmtMoney(total)}`)
          : t(`Loss when saved: ${fmtMoney(0)}. No CRMA: not counted as loss.`, `Pérdida al guardar: ${fmtMoney(0)}. Sin CRMA: no cuenta como pérdida.`)}
      </p>
      {error && <p className="ops-aviso ops-aviso-error" role="alert">{error}</p>}
      <div className="modal-actions">
        <button type="button" className="btn" onClick={() => onListo(null)} disabled={guardando}>{t("Cancel", "Cancelar")}</button>
        <button type="button" className="btn btn-primary" onClick={() => void guarda()} disabled={guardando} data-accion="guardar-origen">{t("Save origin / CRMA", "Guardar origen / CRMA")}</button>
      </div>
    </div>
  );
}
