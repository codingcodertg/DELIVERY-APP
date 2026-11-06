"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { usePrefs } from "@/lib/prefs";
import { createClient } from "@/lib/supabase/client";
import { fmtDateTime, fmtMoney } from "@/lib/utils";
import { INFO_DE_TIPO, TIPOS, esDeRrhh, type TipoDeReporte } from "@/lib/almacen-ops/tipos";
import { PASOS, etiquetaDeOpcion } from "@/lib/almacen-ops/pasos";
import { totalesPorTienda } from "@/lib/almacen-ops/perdida";
import { DEMO_PRODUCTOS, DEMO_REPORTES, buscarProductos, corregirMerma, enlacesDeFotos, type Reporte } from "@/lib/almacen-ops/datos";
import { costoDelCampo, type ProductoElegido } from "@/lib/almacen-ops/pasos";
import { perdida, repartoDeReporte } from "@/lib/almacen-ops/perdida";
import { puedeCorregirMerma, puedeVerReporte } from "@/lib/almacen-ops/visibilidad";
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
  const [pestana, setPestana] = useState<"lista" | "merma">("lista");
  const [tipo, setTipo] = useState<TipoDeReporte | "">("");
  const [tienda, setTienda] = useState("");
  const [empleado, setEmpleado] = useState("");
  const [desde, setDesde] = useState("");
  const [hasta, setHasta] = useState("");
  const [abierto, setAbierto] = useState<Reporte | null>(null);

  useEffect(() => {
    let vivo = true;
    (async () => {
      if (ctx.demo) { setFilas(DEMO_REPORTES.filter((r) => puedeVerReporte(ctx.yo, r)).sort((a, b) => b.created_at.localeCompare(a.created_at))); return; }
      let q = createClient().from("warehouse_reports").select("*").order("created_at", { ascending: false }).limit(LIMITE);
      if (modo === "mios") q = q.eq("author_id", ctx.yo.id);
      const { data, error: e } = await q;
      if (!vivo) return;
      if (e) { setError(e.message); setFilas([]); return; }
      setFilas((data ?? []).map((r) => ({ ...r, unit_cost: r.unit_cost == null ? null : Number(r.unit_cost), total_loss: r.total_loss == null ? null : Number(r.total_loss) })) as Reporte[]);
    })();
    return () => { vivo = false; };
  }, [ctx.demo, ctx.yo, modo]);

  const propias = useMemo(() => (filas ?? []).filter((r) => modo === "todos" || (r.author_id === ctx.yo.id && !esDeRrhh(r.kind))), [filas, modo, ctx.yo.id]);
  const visibles = useMemo(() => propias.filter((r) => {
    if (tipo && r.kind !== tipo) return false;
    if (tienda && r.store !== tienda) return false;
    if (empleado && !(r.author_id === empleado || r.subject_ids.includes(empleado) || r.broken_by.includes(empleado))) return false;
    const dia = r.created_at.slice(0, 10);
    if (desde && dia < desde) return false;
    if (hasta && dia > hasta) return false;
    return true;
  }), [propias, tipo, tienda, empleado, desde, hasta]);
  const cuenta = (k: TipoDeReporte) => propias.filter((r) => r.kind === k).length;
  const nombre = (id: string) => ctx.personas.find((p) => p.id === id)?.full_name ?? "—";
  const nombreTipo = (k: TipoDeReporte) => (lang === "es" ? INFO_DE_TIPO[k].es : INFO_DE_TIPO[k].en);

  const totales = useMemo(() => totalesPorTienda(propias.filter((r) => r.kind === "scrap"), new Date()), [propias]);
  const tiendasDeMerma = Object.keys(totales).filter((k) => k !== "*").sort();

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
          <div className="ops-merma-totales">
            {([["semana", "This week", "Esta semana"], ["mes", "This month", "Este mes"], ["todo", "All time", "Siempre"]] as const).map(([k, en, es]) => (
              <div key={k} className="ops-merma-total">
                <span className="ops-merma-cifra">{fmtMoney(totales["*"]?.[k] ?? 0)}</span>
                <span>{t(en, es)}</span>
              </div>
            ))}
          </div>
          <div className="tbl-scroll tbl-caja">
            <table className="orders">
              <thead><tr><th>{t("Store", "Tienda")}</th><th>{t("This week", "Esta semana")}</th><th>{t("This month", "Este mes")}</th><th>{t("All time", "Siempre")}</th></tr></thead>
              <tbody>
                {tiendasDeMerma.length === 0 && <tr><td colSpan={4} className="hint">{t("No scrap reported yet.", "Todavía no hay merma reportada.")}</td></tr>}
                {tiendasDeMerma.map((s) => (
                  <tr key={s}><td>{s}</td><td className="num">{fmtMoney(totales[s].semana)}</td><td className="num">{fmtMoney(totales[s].mes)}</td><td className="num">{fmtMoney(totales[s].todo)}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="hint">{t(`Loss = pieces × the product's cost per piece when it was reported. Based on the latest ${LIMITE} reports you can see.`,
            `Pérdida = piezas × el costo por pieza del producto al reportarse. Sobre los últimos ${LIMITE} reportes que puedes ver.`)}</p>
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
          <div className="tbl-scroll tbl-caja">
            <table className="orders">
              <thead>
                <tr>
                  <th>{t("When", "Cuándo")}</th><th>{t("Type", "Tipo")}</th><th>{t("Store", "Tienda")}</th>
                  <th>{t("Filed by", "Lo llenó")}</th><th>{t("Employee", "Empleado")}</th><th>{t("Detail", "Detalle")}</th>
                </tr>
              </thead>
              <tbody>
                {visibles.length === 0 && (
                  <tr><td colSpan={6} className="hint">{modo === "mios"
                    ? t("You haven't filed any reports yet. Pick one on the Warehouse Ops screen.", "Todavía no has llenado reportes. Elige uno en la pantalla de Operaciones.")
                    : t("No reports match these filters.", "Ningún reporte coincide con estos filtros.")}</td></tr>
                )}
                {visibles.map((r) => (
                  <tr key={r.id} onClick={() => setAbierto(r)} className="ops-fila-tabla" data-reporte={r.id}>
                    <td style={{ whiteSpace: "nowrap" }}>{fmtDateTime(r.created_at)}</td>
                    <td style={{ whiteSpace: "nowrap" }}>{INFO_DE_TIPO[r.kind].emoji} {nombreTipo(r.kind)}</td>
                    <td>{r.store}</td>
                    <td>{r.author_name ?? nombre(r.author_id)}</td>
                    <td>{r.subject_ids.map(nombre).join(", ")}</td>
                    <td className="ops-detalle-corto">{r.kind === "scrap"
                      ? `${r.product_not_in_catalog ? `${r.product_name ?? ""} (${t("not in catalog", "fuera de catálogo")})` : r.product_sku ?? ""} · ${r.total_pieces ?? 0} ${t("pcs", "pzs")} · ${fmtMoney(r.total_loss)}`
                      : String(r.answers.description ?? "")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {abierto && <Tarjeta r={abierto} ctx={ctx} onCerrar={() => setAbierto(null)}
        onCambio={(n) => { setAbierto(n); setFilas((f) => (f ?? []).map((x) => (x.id === n.id ? n : x))); }} />}
    </section>
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
    if (p.tipo === "personas" || p.tipo === "persona") continue;
    filas.push([(lang === "es" ? p.es : p.en).replace(/ \((optional|opcional)\)$/, ""), p.tipo === "opcion" || p.tipo === "sino" ? etiquetaDeOpcion(r.kind, p.id, v, lang) : String(v)]);
  }
  return (
    <div className="overlay" onClick={onCerrar}>
      <div className="modal ops-tarjeta-reporte" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" data-tarjeta={r.id}>
        <h3>{info.emoji} {lang === "es" ? info.es : info.en}</h3>
        <p className="sub">{fmtDateTime(r.created_at)} · {r.store} · {t("filed by", "lo llenó")} {r.author_name ?? nombre(r.author_id)}</p>
        {esDeRrhh(r.kind) && <p className="ops-tarjeta-rrhh">{t("In the employee's HR file", "En el expediente del empleado")}</p>}
        <dl className="ops-tarjeta-datos">
          {r.subject_ids.length > 0 && <><dt>{t("Employee", "Empleado")}</dt><dd>{r.subject_ids.map(nombre).join(", ")}</dd></>}
          {r.kind === "scrap" && (
            <>
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
              <dt>{t("Type", "Tipo")}</dt><dd>{etiquetaDeOpcion("scrap", "scrap_type", r.scrap_type, lang)}</dd>
              <dt>{t("Damaged / sample", "Dañadas / muestra")}</dt>
              <dd data-reparto-reporte={`${reparto.damaged}/${reparto.sample}`}>{t(`${reparto.damaged} damaged · ${reparto.sample} sample`, `${reparto.damaged} dañadas · ${reparto.sample} de muestra`)}</dd>
              <dt>{t("Quantity", "Cantidad")}</dt><dd>{r.loose_pieces
                ? t(`${r.boxes} boxes × ${r.pieces_per_box} + ${r.loose_pieces} loose = ${r.total_pieces} pieces`, `${r.boxes} cajas × ${r.pieces_per_box} + ${r.loose_pieces} sueltas = ${r.total_pieces} piezas`)
                : t(`${r.boxes} boxes × ${r.pieces_per_box} = ${r.total_pieces} pieces`, `${r.boxes} cajas × ${r.pieces_per_box} = ${r.total_pieces} piezas`)}</dd>
              <dt>{t("Cost per piece (when reported)", "Costo por pieza (al reportar)")}</dt><dd>{fmtMoney(r.unit_cost)}</dd>
              <dt>{t("Loss", "Pérdida")}</dt><dd className="ops-tarjeta-perdida">{fmtMoney(r.total_loss)}</dd>
              <dt>{t("Where from", "De dónde")}</dt><dd>{etiquetaDeOpcion("scrap", "return_type", r.return_type, lang)}</dd>
              <dt>{t("Reason", "Motivo")}</dt><dd>{etiquetaDeOpcion("scrap", "reason", r.reason, lang)}</dd>
              {r.broken_by.length > 0 && <><dt>{t("Broken by", "Lo rompió")}</dt><dd>{r.broken_by.map(nombre).join(", ")}</dd></>}
              {r.crma && <><dt>CRMA</dt><dd>{r.crma}</dd></>}
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

  const total = (c: number | null) => perdida(c, r.total_pieces ?? 0);
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
