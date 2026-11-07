"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { usePrefs } from "@/lib/prefs";
import { createClient } from "@/lib/supabase/client";
import { fmtDateTime, fmtMoney } from "@/lib/utils";
import { INFO_DE_TIPO, TIPOS, esDeRrhh, type TipoDeReporte } from "@/lib/almacen-ops/tipos";
import { PASOS, etiquetaDeOpcion } from "@/lib/almacen-ops/pasos";
import { totalesPorTienda } from "@/lib/almacen-ops/perdida";
import { DEMO_PRODUCTOS, DEMO_REPORTES, buscarProductos, corregirMerma, corregirOrigenDeMerma, enlacesDeFotos, type Reporte } from "@/lib/almacen-ops/datos";
import { ORIGENES_DE_MERMA, costoDelCampo, type ProductoElegido } from "@/lib/almacen-ops/pasos";
import { cuentaComoPerdida, perdidaDeMerma, repartoDeReporte } from "@/lib/almacen-ops/perdida";
import { puedeCorregirMerma, puedeVerReporte } from "@/lib/almacen-ops/visibilidad";
import { diaDelReporte, fmtDia, hoyEnTexas, ordenPorDia } from "@/lib/almacen-ops/fecha-del-dano";
import { ATAJOS, NOMBRE_DE_ATAJO, eleccionAUrl, eleccionDeUrl, etiquetaDeRango, filtrarPorRango, perdidaEnRango, rangoDeAtajo, rangoDeEleccion, type Atajo, type Eleccion } from "@/lib/almacen-ops/rango-de-merma";
import type { Contexto } from "./Operaciones";

const LIMITE = 500;

/**
 * «Mis reportes» y «Reportes» (D-883, 247). Las filas son las que la RLS deja ver; «Mis reportes» además se queda con
 * las que llenó quien mira (sin las de RR. HH., que el autor no ve). Cada fila se abre como tarjeta aquí mismo.
 * La tabla es la de Órdenes (CLAUDE.md): `table.orders` dentro de `.tbl-scroll.tbl-caja` (sin anchos que se arrastran, como el historial de RR. HH.), chips con `.cnt`.
 */
export function ListaDeReportes({ modo, ctx }: { modo: "mios" | "todos"; ctx: Contexto }) {
  const { t, lang } = usePrefs();
  const [filas, setFilas] = useState<Reporte[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  // D-NEXT: la pestaña y el rango de la merma viven en la URL (?pestana=merma&rango=mes…): aguantan un refresh y se comparten.
  const router = useRouter();
  const ruta = usePathname();
  const params = useSearchParams();
  const hoy = hoyEnTexas();
  const pestana: "lista" | "merma" = modo === "todos" && params.get("pestana") === "merma" ? "merma" : "lista";
  const eleccion = useMemo(() => eleccionDeUrl(params), [params]);
  const irA = useCallback((cambios: { pestana?: "lista" | "merma"; eleccion?: Eleccion }) => {
    const q = new URLSearchParams();
    const p = cambios.pestana ?? pestana;
    if (p === "merma") q.set("pestana", "merma");
    for (const [k, v] of Object.entries(eleccionAUrl(cambios.eleccion ?? eleccion))) q.set(k, v);
    const qs = q.toString();
    router.replace(qs ? `${ruta}?${qs}` : ruta, { scroll: false });
  }, [router, ruta, pestana, eleccion]);
  const setPestana = (p: "lista" | "merma") => irA({ pestana: p });
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

  useEffect(() => {
    let vivo = true;
    (async () => {
      // 266: la merma se ordena por el día en que se rompió; lo demás, por el día en que se reportó.
      if (ctx.demo) { setFilas(ordenPorDia(DEMO_REPORTES.filter((r) => puedeVerReporte(ctx.yo, r)))); return; }
      let q = createClient().from("warehouse_reports").select("*").order("created_at", { ascending: false }).limit(LIMITE);
      if (modo === "mios") q = q.eq("author_id", ctx.yo.id);
      const { data, error: e } = await q;
      if (!vivo) return;
      if (e) { setError(e.message); setFilas([]); return; }
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
  const nombreTipo = (k: TipoDeReporte) => (lang === "es" ? INFO_DE_TIPO[k].es : INFO_DE_TIPO[k].en);

  const mermas = useMemo(() => propias.filter((r) => r.kind === "scrap"), [propias]);
  const totales = useMemo(() => totalesPorTienda(mermas, new Date()), [mermas]);
  // D-NEXT: el rango elegido manda sobre la lista de merma y sobre la pérdida por tienda; todo por el día en que se rompió.
  const rango = useMemo(() => rangoDeEleccion(eleccion, hoy), [eleccion, hoy]);
  const mermasEnRango = useMemo(() => (rango ? filtrarPorRango(mermas, rango) : []), [mermas, rango]);
  const enRango = useMemo(() => (rango ? perdidaEnRango(mermas, rango) : { "*": 0 }), [mermas, rango]);
  const etiqueta = rango ? etiquetaDeRango(rango, lang, hoy) : "—";
  const tiendasDeMerma = Array.from(new Set([...Object.keys(totales), ...Object.keys(enRango)])).filter((k) => k !== "*").sort();

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
        </div>
      )}

      {error && <p className="ops-aviso ops-aviso-error">{error}</p>}
      {filas === null && <p className="hint">{t("Loading…", "Cargando…")}</p>}

      {filas && pestana === "merma" && (
        <div className="ops-merma" data-merma>
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
          <div className="tbl-scroll tbl-caja">
            <table className="orders" data-perdida-por-tienda>
              <thead><tr><th>{t("Store", "Tienda")}</th><th className="ops-col-rango">{etiqueta}</th><th>{t("This week", "Esta semana")}</th><th>{t("This month", "Este mes")}</th><th>{t("All time", "Siempre")}</th></tr></thead>
              <tbody>
                {tiendasDeMerma.length === 0 && <tr><td colSpan={5} className="hint">{t("No scrap reported yet.", "Todavía no hay merma reportada.")}</td></tr>}
                {tiendasDeMerma.map((s) => (
                  <tr key={s} data-tienda={s}><td>{s}</td><td className="num ops-col-rango" data-perdida-rango={enRango[s] ?? 0}>{fmtMoney(enRango[s] ?? 0)}</td><td className="num">{fmtMoney(totales[s]?.semana ?? 0)}</td><td className="num">{fmtMoney(totales[s]?.mes ?? 0)}</td><td className="num">{fmtMoney(totales[s]?.todo ?? 0)}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="hint" data-totales-por="fecha-del-dano">{t("The range, weeks and months go by the date the material was broken, not the date it was reported. ", "El rango, las semanas y los meses van por el día en que se rompió el material, no por el día en que se reportó. ")}{t(`Loss = damaged pieces × the product's cost per piece when it was reported (pieces usable as samples are not counted). A customer return without a CRMA is not counted as loss until its CRMA is added. Based on the latest ${LIMITE} reports you can see.`,
            `Pérdida = piezas dañadas × el costo por pieza del producto al reportarse (las que sirven de muestra no cuentan). Una devolución de cliente sin CRMA no cuenta como pérdida hasta que se le pone el CRMA. Sobre los últimos ${LIMITE} reportes que puedes ver.`)}</p>

          <h3 className="ops-merma-titulo">{t("Scrap in this range", "Merma en el rango")} <span className="count-tag" data-cuenta-rango>{mermasEnRango.length}</span></h3>
          <TablaDeReportes filas={mermasEnRango} ctx={ctx} onAbrir={setAbierto} data-lista="merma-en-rango"
            vacio={rango ? t("No scrap broken in this range.", "No se rompió nada en este rango.") : t("Fix the dates to see the list.", "Corrige las fechas para ver la lista.")} />
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
          <TablaDeReportes filas={visibles} ctx={ctx} onAbrir={setAbierto} data-lista="todos"
            vacio={modo === "mios"
              ? t("You haven't filed any reports yet. Pick one on the Warehouse Ops screen.", "Todavía no has llenado reportes. Elige uno en la pantalla de Operaciones.")
              : t("No reports match these filters.", "Ningún reporte coincide con estos filtros.")} />
        </>
      )}

      {abierto && <Tarjeta r={abierto} ctx={ctx} onCerrar={() => setAbierto(null)}
        onCambio={(n) => { setAbierto(n); setFilas((f) => (f ?? []).map((x) => (x.id === n.id ? n : x))); }} />}
    </section>
  );
}

/** La tabla de reportes (la de Órdenes, CLAUDE.md); la usan la lista y la pestaña de merma. Cada fila se abre como tarjeta. */
function TablaDeReportes({ filas, ctx, onAbrir, vacio, "data-lista": dataLista }: { filas: Reporte[]; ctx: Contexto; onAbrir: (r: Reporte) => void; vacio: string; "data-lista": string }) {
  const { t, lang } = usePrefs();
  const nombre = (id: string) => ctx.personas.find((p) => p.id === id)?.full_name ?? "—";
  const nombreTipo = (k: TipoDeReporte) => (lang === "es" ? INFO_DE_TIPO[k].es : INFO_DE_TIPO[k].en);
  return (
    <div className="tbl-scroll tbl-caja">
      <table className="orders" data-lista={dataLista}>
        <thead>
          <tr>
            <th title={t("Scrap: the date it was broken. Others: when it was reported.", "Merma: el día en que se rompió. Los demás: cuándo se reportó.")}>{t("When", "Cuándo")}</th><th>{t("Type", "Tipo")}</th><th>{t("Store", "Tienda")}</th>
            <th>{t("Filed by", "Lo llenó")}</th><th>{t("Employee", "Empleado")}</th><th>{t("Detail", "Detalle")}</th>
          </tr>
        </thead>
        <tbody>
          {filas.length === 0 && <tr><td colSpan={6} className="hint">{vacio}</td></tr>}
          {filas.map((r) => (
            <tr key={r.id} onClick={() => onAbrir(r)} className="ops-fila-tabla" data-reporte={r.id}>
              <td style={{ whiteSpace: "nowrap" }} data-dia={diaDelReporte(r)}>{r.kind === "scrap" ? fmtDia(diaDelReporte(r), lang) : fmtDateTime(r.created_at)}</td>
              <td style={{ whiteSpace: "nowrap" }}>{INFO_DE_TIPO[r.kind].emoji} {nombreTipo(r.kind)}</td>
              <td>{r.store}</td>
              <td>{r.author_name ?? nombre(r.author_id)}</td>
              <td>{r.subject_ids.map(nombre).join(", ")}</td>
              <td className="ops-detalle-corto">{r.kind === "scrap"
                ? `${r.product_not_in_catalog ? `${r.product_name ?? ""} (${t("not in catalog", "fuera de catálogo")})` : r.product_sku ?? ""} · ${repartoDeReporte(r).damaged} ${t("damaged", "dañadas")} · ${fmtMoney(r.total_loss)}${cuentaComoPerdida(r) ? "" : ` (${t("no CRMA", "sin CRMA")})`}`
                : String(r.answers.description ?? "")}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Un reporte como tarjeta, encima de la lista (regla de la casa: los registros se abren en su sitio). */
function Tarjeta({ r, ctx, onCerrar, onCambio }: { r: Reporte; ctx: Contexto; onCerrar: () => void; onCambio: (r: Reporte) => void }) {
  const { t, lang } = usePrefs();
  const [fotos, setFotos] = useState<string[]>([]);
  const [corrigiendo, setCorrigiendo] = useState(false);
  const corrige = puedeCorregirMerma(ctx.yo, r);
  useEffect(() => {
    if (ctx.demo || r.photos.length === 0) return;
    let vivo = true;
    void enlacesDeFotos(createClient(), r.photos).then((u) => { if (vivo) setFotos(u); });
    return () => { vivo = false; };
  }, [r.photos, ctx.demo]);
  const nombre = (id: string) => ctx.personas.find((p) => p.id === id)?.full_name ?? "—";
  const info = INFO_DE_TIPO[r.kind];
  const reparto = repartoDeReporte(r);
  const filas: [string, string][] = [];
  for (const p of PASOS[r.kind]) {
    const v = r.answers[p.id];
    if (v == null || v === "") continue;
    if (p.tipo === "personas" || p.tipo === "persona" || p.tipo === "fecha") continue;
    // En merma, el origen, el motivo y el CRMA ya salen arriba desde sus columnas (las que el gerente puede corregir).
    if (r.kind === "scrap" && (p.id === "return_type" || p.id === "reason" || p.id === "crma")) continue;
    filas.push([(lang === "es" ? p.es : p.en).replace(/ \((optional|opcional)\)$/, ""), p.tipo === "opcion" || p.tipo === "sino" ? etiquetaDeOpcion(r.kind, p.id, v, lang) : String(v)]);
  }
  return (
    <div className="overlay" onClick={onCerrar}>
      <div className="modal ops-tarjeta-reporte" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" data-tarjeta={r.id}>
        <h3>{info.emoji} {lang === "es" ? info.es : info.en}</h3>
        <p className="sub">{r.kind === "scrap" ? t("Reported ", "Reportado ") : ""}{fmtDateTime(r.created_at)} · {r.store} · {t("filed by", "lo llenó")} {r.author_name ?? nombre(r.author_id)}</p>
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
              <dt>{t("Cost per piece (when reported)", "Costo por pieza (al reportar)")}</dt><dd>{fmtMoney(r.unit_cost)}</dd>
              <dt>{t("Loss (damaged pieces only)", "Pérdida (solo piezas dañadas)")}</dt><dd className="ops-tarjeta-perdida" data-perdida-reporte={r.total_loss ?? ""} data-cuenta-como-perdida={cuentaComoPerdida(r) ? "si" : "no"}>
                {fmtMoney(r.total_loss)}
                {!cuentaComoPerdida(r) && <span className="hint" data-sin-crma> · {t("No CRMA: not counted as loss", "Sin CRMA: no cuenta como pérdida")}</span>}
              </dd>
              <dt>{t("Where from", "De dónde")}</dt><dd data-origen-reporte={r.return_type ?? ""}>{etiquetaDeOpcion("scrap", "return_type", r.return_type, lang) || "—"}</dd>
              <dt>{t("Reason", "Motivo")}</dt><dd>{etiquetaDeOpcion("scrap", "reason", r.reason, lang)}</dd>
              {r.broken_by.length > 0 && <><dt>{t("Broken by", "Lo rompió")}</dt><dd>{r.broken_by.map(nombre).join(", ")}</dd></>}
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
        <div className="modal-actions"><button type="button" className="btn btn-primary" onClick={onCerrar}>{t("Close", "Cerrar")}</button></div>
      </div>
    </div>
  );
}

/**
 * Corregir el producto de una merma (migración 252, pedido b158a7a5): el gerente/supervisor de la tienda o el admin
 * la vincula a un producto del catálogo, o corrige el nombre y el costo a mano. La base recalcula la pérdida.
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

  // La misma cuenta que la base (259 y 263): costo × piezas dañadas; $0 en devolución de cliente sin CRMA.
  const total = (c: number | null) => perdidaDeMerma(c, repartoDeReporte(r), r);
  const guarda = async (p: ProductoElegido | null) => {
    const c = costoDelCampo(costo);
    if (!p && (nombre.trim().length < 2 || Number.isNaN(c))) { setError(t("Write a name and a valid cost.", "Escribe un nombre y un costo válido.")); return; }
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
            <span className="ops-producto-meta">{p.sku} · {p.cost == null ? t("no cost", "sin costo") : fmtMoney(p.cost)}</span>
          </button>
        ))}
      </div>
      <p className="hint">{t("Or keep it out of the catalog and fix the name and cost:", "O déjalo fuera del catálogo y corrige nombre y costo:")}</p>
      <label className="ops-cantidad"><span>{t("Product name", "Nombre del producto")}</span>
        <input className="ops-campo" value={nombre} onChange={(e) => setNombre(e.target.value)} data-campo="corregir-nombre" /></label>
      <label className="ops-cantidad"><span>{t("Cost per piece", "Costo por pieza")}</span>
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
 * devolución de cliente sin CRMA no cuenta como pérdida; con CRMA, costo × piezas dañadas.
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
