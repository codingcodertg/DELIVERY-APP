"use client";

import { mensajeDeError, mensajeDeErrorAlCargar } from "@/lib/mensaje-de-error";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { usePrefs } from "@/lib/prefs";
import { createClient } from "@/lib/supabase/client";
import { fmtDateTime } from "@/lib/utils";
import { DEMO_PRODUCTOS, buscarProductos } from "@/lib/almacen-ops/datos";
import type { ProductoElegido } from "@/lib/almacen-ops/pasos";
import {
  ALCANCES, INFO_DE_ALCANCE, accionesDeConteo, estaAbierto, estaContada, faltaDelAlcance, ordenarLineas, progresoDelConteo,
  puedeGestionarConteo, tituloDeAlcance, type AccionDeConteo, type AlcanceElegido, type Conteo, type Linea, type OrdenPendiente,
} from "@/lib/almacen-ops/conteos";
import { coincideConAlcance } from "@/lib/almacen-ops/conteos-alcance";
import {
  DEMO_CONTEOS, DEMO_PRODUCTOS_DE_CONTEO, DEMO_PROVEEDORES, avanzarConteo, cancelarConteo, crearConteo, faltaLa274, faltaLa333, leerConteos, leerProductosDelAlcance,
  leerProveedores, lineaDeLaFila, mandarARecontar, type Conteos as Datos, type ProductoDeConteo, type Proveedor,
} from "@/lib/almacen-ops/conteos-datos";
import type { Contexto } from "./Operaciones";
import { CerrarX } from "./CerrarX";
import { BuscadorDeConteo, type OpcionDeBusqueda } from "./BuscadorDeConteo";
import { ChipDeEtapaDeConteo, LineaDeEtapasDeConteo } from "./EtapasDeConteo";
import { AdjuntoDeConteo, FormLinea, FormNota, VentanaDeConteo, useEnlaces } from "./ConteosFormularios";
import { PanelDeFirma, PanelDeRevision } from "./ConteosRevision";

/**
 * La sección «Conteos de inventario» (274, revisada en 333). Dueño (19 nov): «when you open inventory counts, it already
 * lands you here and it's Start organizing… We don't even need this screen at all». Así que:
 *   · Abrir la sección cae directo en «Empezar a organizar» (el gerente abre un conteo: proveedor + medida [+ nota],
 *     proveedor + nota, o un producto). Sin lista ni botón «Nuevo conteo».
 *   · Debajo, los conteos en curso como tarjetas «Seguir» (el personal los retoma aquí).
 *   · Cada conteo se abre en su tarjeta: los cinco pasos (Organizar, Contar, Revisar, Firmar, Ajustar), con el mismo
 *     lenguaje visual que la merma. La tarjeta NO se cierra al arrastrar ni al tocar fuera: solo «Cerrar» o la ✕.
 * El KPI y el historial NO están aquí: viven en Reportes (InformeDeConteos).
 */

type Carga = { estado: "cargando" } | { estado: "falta-274" } | { estado: "error"; mensaje: string } | { estado: "listo"; datos: Datos };
type Pon = (f: (d: Datos) => Datos) => void;

export function Conteos({ ctx }: { ctx: Contexto }) {
  const { t, lang } = usePrefs();
  const [carga, setCarga] = useState<Carga>(ctx.demo ? { estado: "listo", datos: DEMO_CONTEOS } : { estado: "cargando" });
  const [tienda, setTienda] = useState(() => (ctx.yo.store && ctx.tiendas.includes(ctx.yo.store) ? ctx.yo.store : ctx.tiendas[0] ?? ""));
  const [abierto, setAbierto] = useState<string | null>(null);

  useEffect(() => {
    if (ctx.demo) return;
    let vivo = true;
    leerConteos(createClient())
      .then((d) => { if (vivo) setCarga({ estado: "listo", datos: d }); })
      .catch((e) => { if (vivo) setCarga(faltaLa274(e) ? { estado: "falta-274" } : { estado: "error", mensaje: mensajeDeErrorAlCargar(e) }); });
    return () => { vivo = false; };
  }, [ctx.demo]);

  const pon: Pon = (f) => setCarga((c) => (c.estado === "listo" ? { estado: "listo", datos: f(c.datos) } : c));
  const gestiona = puedeGestionarConteo(ctx.yo, tienda);
  const datos = carga.estado === "listo" ? carga.datos : null;
  const abiertos = useMemo(() => (datos?.conteos ?? []).filter((c) => c.store === tienda && estaAbierto(c)), [datos, tienda]);
  const elegido = abierto && datos ? datos.conteos.find((c) => c.id === abierto) ?? null : null;

  return (
    <section className="ops-mantenimiento ops-conteos" data-conteos>
      <header className="ops-asistente-barra ops-mant-cabeza">
        <h2>🔢 {t("Inventory counts", "Conteos de inventario")}</h2>
        <Link href="/operaciones" className="ops-boton ops-boton-chico" data-accion="volver">← {t("Back", "Volver")}</Link>
      </header>
      {ctx.tiendas.length > 1 && (
        <label className="ops-tienda ops-tienda-arriba">
          <span>{t("Store", "Tienda")}</span>
          <select value={tienda} onChange={(e) => setTienda(e.target.value)} data-campo="tienda-conteos">
            {ctx.tiendas.map((x) => <option key={x} value={x}>{x}</option>)}
          </select>
        </label>
      )}
      {carga.estado === "cargando" && <p className="hint">{t("Loading…", "Cargando…")}</p>}
      {carga.estado === "error" && <p className="ops-aviso ops-aviso-error">{t("Could not load: ", "No se pudo cargar: ")}{carga.mensaje}</p>}
      {carga.estado === "falta-274" && (
        <div className="ops-aviso" data-aviso="274">
          <h3>{t("Coming soon", "Muy pronto")}</h3>
          <p>{t("Inventory counts need one setup step before they can be saved (database migration 274). Ask the admin to finish the setup.",
            "Los conteos de inventario necesitan un paso de instalación antes de guardarse (la migración 274 de la base). Pide al admin que termine la instalación.")}</p>
        </div>
      )}
      {datos?.sin333 && (
        <div className="ops-aviso" data-aviso="333">
          <p><strong>{t("Setup pending: migration 333.", "Falta instalar: migración 333.")}</strong> {t("Until it is applied, pending orders and the system quantity at sign-off cannot be saved. Counting still works.",
            "Hasta que se aplique, no se pueden guardar las órdenes pendientes ni la cantidad del sistema al firmar. Contar sigue funcionando.")}</p>
        </div>
      )}
      {datos && gestiona && <FormNuevoConteo ctx={ctx} tienda={tienda} onCreado={(c, ls) => { pon((d) => ({ ...d, conteos: [c, ...d.conteos], lineas: [...d.lineas, ...ls] })); setAbierto(c.id); }} />}
      {datos && (
        <section className="ops-conteo-seguir" data-seguir>
          <h3>{t("Keep going", "Seguir")} <span className="count-tag">{abiertos.length}</span></h3>
          {abiertos.length === 0 && (
            <p className="hint" data-sin-conteos>{gestiona ? t("No counts in progress in this store.", "No hay conteos en curso en esta tienda.") : t("No counts in progress in this store. Your manager opens them.", "No hay conteos en curso en esta tienda. Los abre tu gerente.")}</p>
          )}
          <ul className="ops-lista-equipo" data-lista-conteos={abiertos.length}>
            {abiertos.map((c) => {
              const lineas = datos.lineas.filter((l) => l.count_id === c.id);
              const p = progresoDelConteo(lineas);
              const ordenes = datos.pendientes.filter((o) => o.count_id === c.id).length;
              return (
                <li key={c.id}>
                  <button type="button" className="ops-equipo" onClick={() => setAbierto(c.id)} data-conteo={c.id} data-etapa={c.stage}>
                    <span className="ops-equipo-icono" aria-hidden>{INFO_DE_ALCANCE[c.scope_kind].emoji}</span>
                    <span className="ops-equipo-texto">
                      <span className="ops-equipo-nombre">{c.title}</span>
                      <span className="ops-equipo-meta">{lineas.length} {t("products", "productos")} · {t("opened", "abierto")} {fmtDateTime(c.created_at)}{c.created_by_name ? ` · ${c.created_by_name}` : ""}</span>
                      <span className="ops-equipo-insignias">
                        <ChipDeEtapaDeConteo e={c.stage} />
                        {c.stage === "counting" && <span className="ops-insignia" data-progreso={p.pct}>{p.hechas}/{p.total} · {p.pct}%</span>}
                        {c.stage === "review" && <span className="ops-insignia" data-ordenes={ordenes}>{ordenes} {t("pending orders", "órdenes pendientes")}</span>}
                        {c.stage === "sign_off" && c.signed_at && <span className="ops-insignia ops-insignia-ok">✍️ {t("Signed", "Firmado")}</span>}
                        {lineas.some((l) => l.recount_requested) && <span className="ops-insignia ops-insignia-sin-foto">↩ {t("Recount requested", "Recontar")}</span>}
                      </span>
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </section>
      )}
      {elegido && datos && (
        <TarjetaConteo c={elegido} lineas={datos.lineas.filter((l) => l.count_id === elegido.id)} pendientes={datos.pendientes.filter((o) => o.count_id === elegido.id)}
          ctx={ctx} pon={pon} sin333={!!datos.sin333} onCerrar={() => setAbierto(null)} />
      )}
      <p className="hint ops-conteos-pie">{lang === "es" ? "Las cantidades del sistema se congelan al abrir el conteo; en la firma se pueden teclear o corregir." : "System quantities are frozen when the count is opened; at sign-off they can be typed or corrected."}</p>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Empezar a organizar (gerente): el alcance → vista previa → abrir el conteo
// ---------------------------------------------------------------------------
type Proveedores = Proveedor[] | null;

function FormNuevoConteo({ ctx, tienda, onCreado }: { ctx: Contexto; tienda: string; onCreado: (c: Conteo, lineas: Linea[]) => void }) {
  const { t, lang } = usePrefs();
  const [a, setA] = useState<AlcanceElegido>({ scope_kind: "vendor_size" });
  const [notas, setNotas] = useState("");
  const [proveedores, setProveedores] = useState<Proveedores>(ctx.demo ? DEMO_PROVEEDORES : null);
  const [vista, setVista] = useState<ProductoDeConteo[] | null>(null);
  const [q, setQ] = useState("");
  const [sugeridos, setSugeridos] = useState<ProductoElegido[]>([]);
  const [ocupado, setOcupado] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const falta = faltaDelAlcance(a);

  useEffect(() => {
    if (ctx.demo) return;
    let vivo = true;
    leerProveedores(createClient(), tienda).then((v) => { if (vivo) setProveedores(v); }).catch((e) => { if (vivo) setError(mensajeDeError(e)); });
    return () => { vivo = false; };
  }, [ctx.demo, tienda]);

  // Vista previa en cuanto el alcance está completo (una pausa corta para la nota escrita a mano).
  useEffect(() => {
    setVista(null);
    if (falta) return;
    let vivo = true;
    const h = setTimeout(() => {
      if (ctx.demo) {
        const lista = DEMO_PRODUCTOS_DE_CONTEO.filter((p) => coincideConAlcance(p, a));
        if (vivo) setVista(lista);
        return;
      }
      leerProductosDelAlcance(createClient(), tienda, a).then((p) => { if (vivo) setVista(p); }).catch((e) => { if (vivo) setError(mensajeDeError(e)); });
    }, 350);
    return () => { vivo = false; clearTimeout(h); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [a.scope_kind, a.vendor_name, a.size_in, a.note, a.product_id, tienda, ctx.demo]);

  useEffect(() => {
    if (a.scope_kind !== "product" || q.trim().length < 2) { setSugeridos([]); return; }
    let vivo = true;
    const h = setTimeout(() => {
      if (ctx.demo) { setSugeridos(DEMO_PRODUCTOS.filter((p) => `${p.sku} ${p.name}`.toLowerCase().includes(q.toLowerCase()))); return; }
      buscarProductos(createClient(), q).then((r) => { if (vivo) setSugeridos(r); }).catch(() => { if (vivo) setSugeridos([]); });
    }, 250);
    return () => { vivo = false; clearTimeout(h); };
  }, [q, a.scope_kind, ctx.demo]);

  const prov = proveedores?.find((p) => p.vendor_name === a.vendor_name) ?? null;
  const opcionesProveedor: OpcionDeBusqueda[] = (proveedores ?? []).map((p) => ({ valor: p.vendor_name, texto: p.vendor_name, detalle: `${p.products} ${t("products", "productos")}` }));
  const opcionesMedida: OpcionDeBusqueda[] = (prov?.sizes ?? []).map((s) => ({ valor: s, texto: s }));

  const reiniciar = () => { setA({ scope_kind: "vendor_size" }); setNotas(""); setQ(""); setError(null); };

  const crear = async () => {
    if (falta || !vista || vista.length === 0) return;
    setOcupado(true); setError(null);
    try {
      const ahora = new Date().toISOString();
      const id = ctx.demo ? `c-${Date.now()}` : await crearConteo(createClient(), tienda, a, notas);
      const c: Conteo = {
        id, store: tienda, scope_kind: a.scope_kind, vendor_name: a.vendor_name ?? null, size_in: a.size_in ?? null, note: a.note ?? null, product_id: a.product_id ?? null,
        title: tituloDeAlcance(a), stage: "organizing", instructions: notas.trim() || null, comments: null, created_by: ctx.yo.id, created_by_name: ctx.yo.full_name, created_at: ahora,
        organized_at: null, organized_by: null, counting_done_at: null, counting_done_by: null, orders_reviewed_at: null, orders_reviewed_by: null, orders_note: null,
        signed_at: null, signed_by: null, signed_by_name: null, signed_sheet: null, sign_note: null, adjusted_at: null, adjusted_by: null, adjustment_shots: [], cancelled_at: null, cancelled_by: null, cancel_note: null,
      };
      // Las líneas de la pantalla hasta que se vuelva a leer: la base las creó con los mismos datos de la vista previa.
      const lineas: Linea[] = vista.map((p, n) => ({
        id: ctx.demo ? `l-${id}-${n}` : `${id}:${p.id}`, count_id: id, product_id: p.id, sku: p.sku, name: p.name, size_in: p.size_in, system_qty: p.qoh, system_qty_set_by: null, system_qty_set_by_name: null, system_qty_set_at: null,
        price: p.price, pieces_per_box: p.pieces_per_box, counted_boxes: null, counted_pieces: null, counted_total: null, counted_by: null, counted_by_name: null, counted_at: null, note: null, photo: null,
        recount_requested: false, recount_note: null, position: n + 1,
      }));
      if (!ctx.demo) {
        // Los ids reales de las líneas: se leen una vez (el personal las necesita para capturar).
        const { data } = await createClient().from("warehouse_count_lines").select("*").eq("count_id", id).order("position");
        if (data && data.length > 0) { onCreado(c, (data as Record<string, unknown>[]).map(lineaDeLaFila)); reiniciar(); return; }
      }
      onCreado(c, lineas);
      reiniciar();
    } catch (x) { setError(mensajeDeError(x)); } finally { setOcupado(false); }
  };

  return (
    <section className="ops-conteo-inicio" data-form-conteo>
      <h3>{t("Start organizing", "Empezar a organizar")}</h3>
      <p className="sub">{tienda}</p>
      <div className="ops-formulario">
        <label className="ops-cantidad"><span>{t("What to count", "Qué contar")}</span>
          <div className="ops-opciones">
            {ALCANCES.map((k) => <button type="button" key={k} className={`ops-opcion${a.scope_kind === k ? " elegida" : ""}`} aria-pressed={a.scope_kind === k} onClick={() => setA({ scope_kind: k })} data-opcion={k}>{INFO_DE_ALCANCE[k].emoji} {lang === "es" ? INFO_DE_ALCANCE[k].es : INFO_DE_ALCANCE[k].en}</button>)}
          </div>
          <span className="hint">{lang === "es" ? INFO_DE_ALCANCE[a.scope_kind].desc_es : INFO_DE_ALCANCE[a.scope_kind].desc_en}</span>
        </label>
        {a.scope_kind !== "product" && (
          <label className="ops-cantidad"><span>{t("Supplier (type to search)", "Proveedor (escribe para buscar)")}</span>
            {proveedores === null ? <span className="hint">{t("Loading suppliers…", "Cargando proveedores…")}</span> : (
              <BuscadorDeConteo etiqueta={t("Supplier", "Proveedor")} placeholder={t("Type the supplier", "Escribe el proveedor")} opciones={opcionesProveedor}
                valor={a.vendor_name ?? null} dato="proveedor" onElegir={(v) => setA((x) => ({ ...x, vendor_name: v, size_in: null }))} />
            )}
          </label>
        )}
        {a.scope_kind === "vendor_size" && prov && (
          <label className="ops-cantidad"><span>{t("Size (type to search)", "Medida (escribe para buscar)")}</span>
            {prov.sizes.length === 0
              ? <span className="hint">{t("This supplier has no sizes in the catalog; use supplier + note.", "Este proveedor no tiene medidas en el catálogo; usa proveedor + nota.")}</span>
              : <BuscadorDeConteo etiqueta={t("Size", "Medida")} placeholder={t("Type the size, e.g. 24x48", "Escribe la medida, p. ej. 24x48")} opciones={opcionesMedida}
                  valor={a.size_in ?? null} dato="medida" onElegir={(v) => setA((x) => ({ ...x, size_in: v }))} />}
          </label>
        )}
        {a.scope_kind === "vendor_size" && prov && a.size_in && (
          <label className="ops-cantidad"><span>{t("Note (optional, narrows the size)", "Nota (opcional, afina la medida)")}</span>
            <input className="ops-campo" value={a.note ?? ""} onChange={(e) => setA((x) => ({ ...x, note: e.target.value }))} placeholder={t("e.g. black, matte", "p. ej. negro, mate")} data-campo="nota" />
          </label>
        )}
        {a.scope_kind === "vendor_note" && (
          <label className="ops-cantidad"><span>{t("Note (word in the name, collection, color or style)", "Nota (palabra del nombre, colección, color o estilo)")}</span>
            <input className="ops-campo ops-campo-grande" value={a.note ?? ""} onChange={(e) => setA((x) => ({ ...x, note: e.target.value }))} placeholder={t("e.g. black, Marazzi, matte", "p. ej. negro, Marazzi, mate")} data-campo="nota" />
          </label>
        )}
        {a.scope_kind === "product" && (
          <label className="ops-cantidad"><span>{t("Product (SKU or name)", "Producto (SKU o nombre)")}</span>
            {a.product_id != null ? (
              <span className="ops-seleccion" data-producto={a.product_id}><span>{a.product_sku} · {a.product_name}</span> <button type="button" className="btn btn-sm" onClick={() => setA({ scope_kind: "product" })} data-accion="cambiar-producto">{t("Change", "Cambiar")}</button></span>
            ) : (
              <>
                <input className="ops-campo ops-campo-grande" value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("Type at least 2 letters", "Escribe al menos 2 letras")} data-campo="buscar-producto" />
                {sugeridos.length > 0 && (
                  <ul className="ops-buscador-lista" data-sugerencias={sugeridos.length}>
                    {sugeridos.map((p) => <li key={p.id ?? p.sku}><button type="button" className="ops-opcion ops-buscador-opcion" onClick={() => { setA({ scope_kind: "product", product_id: p.id, product_sku: p.sku, product_name: p.name }); setQ(""); }} data-producto={p.id}>{p.sku} · {p.name}</button></li>)}
                  </ul>
                )}
              </>
            )}
          </label>
        )}
        <label className="ops-cantidad"><span>{t("Notes (optional)", "Notas (opcional)")}</span>
          <textarea className="ops-campo" rows={2} value={notas} onChange={(e) => setNotas(e.target.value)} placeholder={t("e.g. Pull the pallets to aisle 3, one SKU per spot.", "p. ej. Bajar los pallets al pasillo 3, un SKU por lugar.")} data-campo="notas" />
        </label>
      </div>
      {!falta && (
        <section className="ops-etapas" data-vista-previa={vista?.length ?? "cargando"}>
          <h4>{tituloDeAlcance(a)} · {vista === null ? t("loading…", "cargando…") : t(`${vista.length} products`, `${vista.length} productos`)}</h4>
          {vista && vista.length === 0 && <p className="ops-aviso" data-sin-productos>{t("No products match. Change the scope.", "Ningún producto coincide. Cambia el alcance.")}</p>}
          {vista && vista.length > 0 && (
            <ul className="ops-linea-de-etapas ops-vista-previa">
              {vista.slice(0, 12).map((p) => <li key={p.id} className="ops-etapa-texto"><span className="hoja-folio">{p.sku}</span> {p.name}<span className="hint">{t("system", "sistema")}: {p.qoh ?? "—"}</span></li>)}
              {vista.length > 12 && <li className="hint">… {t(`and ${vista.length - 12} more`, `y ${vista.length - 12} más`)}</li>}
            </ul>
          )}
          {vista && vista.length > 0 && vista.every((p) => p.qoh == null) && <p className="hint" data-sin-qoh>{t("This store has no quantities in the ERP: lines will count without a system quantity; type it at sign-off.", "Esta tienda no tiene existencias en el ERP: las líneas se contarán sin cantidad del sistema; se teclea al firmar.")}</p>}
        </section>
      )}
      {error && <p className="ops-aviso ops-aviso-error" role="alert">{error}</p>}
      <div className="ops-etapa-acciones">
        <button type="button" className="btn" onClick={reiniciar} disabled={ocupado}>{t("Start over", "Empezar de nuevo")}</button>
        <button type="button" className="btn btn-primary" onClick={() => void crear()} disabled={!!falta || !vista || vista.length === 0 || ocupado} data-accion="crear-conteo">{ocupado ? t("Opening…", "Abriendo…") : t("Open the count", "Abrir el conteo")}</button>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// La tarjeta de un conteo: los cinco pasos y lo que toca. Solo se cierra con «Cerrar» o la ✕.
// ---------------------------------------------------------------------------
export function TarjetaConteo({ c, lineas, pendientes, ctx, pon, sin333, onCerrar }: {
  c: Conteo; lineas: Linea[]; pendientes: OrdenPendiente[]; ctx: Contexto; pon: Pon; sin333: boolean; onCerrar: () => void;
}) {
  const { t } = usePrefs();
  const [lineaAbierta, setLineaAbierta] = useState<string | null>(null);
  const [recontar, setRecontar] = useState<Linea | null>(null);
  const [cancelando, setCancelando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const acciones: AccionDeConteo[] = accionesDeConteo(ctx.yo, c, lineas);
  const gestiona = puedeGestionarConteo(ctx.yo, c.store);
  const nombre = (id: string | null) => (id ? ctx.personas.find((p) => p.id === id)?.full_name ?? "—" : "");
  const progreso = progresoDelConteo(lineas);
  const adjuntos = useMemo(() => [c.signed_sheet, ...c.adjustment_shots, ...lineas.map((l) => l.photo)].filter((x): x is string => !!x), [c.signed_sheet, c.adjustment_shots, lineas]);
  const enlaces = useEnlaces(adjuntos, ctx.demo);
  const adj = (ruta: string, alt: string) => <AdjuntoDeConteo ruta={ruta} alt={alt} enlaces={enlaces} demo={ctx.demo} />;
  const ponConteo = (f: (x: Conteo) => Conteo) => pon((d) => ({ ...d, conteos: d.conteos.map((x) => (x.id === c.id ? f(x) : x)) }));

  const avanzar = async (etapa: "counting" | "review", nota: string | null) => {
    setOcupado(true); setError(null);
    try {
      if (!ctx.demo) await avanzarConteo(createClient(), c.id, etapa, nota);
      const ahora = new Date().toISOString();
      ponConteo((x) => (etapa === "counting"
        ? { ...x, stage: "counting", organized_at: ahora, organized_by: ctx.yo.id }
        : { ...x, stage: "review", counting_done_at: ahora, counting_done_by: ctx.yo.id }));
    } catch (x) { setError(mensajeDeError(x)); } finally { setOcupado(false); }
  };

  const recontarLinea = async (l: Linea, n: string) => {
    setOcupado(true); setError(null);
    try {
      if (!ctx.demo) await mandarARecontar(createClient(), l.id, n);
      pon((d) => ({
        conteos: d.conteos.map((x) => (x.id === c.id ? { ...x, stage: "counting", counting_done_at: null, counting_done_by: null, orders_reviewed_at: null, orders_reviewed_by: null, signed_at: null, signed_by: null, signed_by_name: null, signed_sheet: null, sign_note: null } : x)),
        lineas: d.lineas.map((x) => (x.id === l.id ? { ...x, counted_boxes: null, counted_pieces: null, counted_total: null, counted_by: null, counted_by_name: null, counted_at: null, recount_requested: true, recount_note: n || null } : x)),
        pendientes: d.pendientes,
        sin333: d.sin333,
      }));
      setRecontar(null);
    } catch (x) { setError(mensajeDeError(x)); } finally { setOcupado(false); }
  };

  const cancelar = async (n: string) => {
    setOcupado(true); setError(null);
    try {
      if (!ctx.demo) await cancelarConteo(createClient(), c.id, n);
      ponConteo((x) => ({ ...x, stage: "cancelled", cancelled_at: new Date().toISOString(), cancelled_by: ctx.yo.id, cancel_note: n || null }));
      setCancelando(false);
    } catch (x) { setError(mensajeDeError(x)); } finally { setOcupado(false); }
  };

  const lineaElegida = lineaAbierta ? lineas.find((l) => l.id === lineaAbierta) ?? null : null;
  if (lineaElegida && c.stage === "counting" && acciones.includes("contar_linea")) {
    return <FormLinea l={lineaElegida} ctx={ctx} onCerrar={() => setLineaAbierta(null)} onGuardada={(n) => { pon((d) => ({ ...d, lineas: d.lineas.map((x) => (x.id === n.id ? n : x)) })); setLineaAbierta(null); }} />;
  }

  const enRevisionOFirma = c.stage === "review" || c.stage === "sign_off" || c.stage === "adjusted";
  return (
    <VentanaDeConteo dato="conteo">
      <div data-tarjeta-conteo={c.id} data-etapa={c.stage}>
        <CerrarX onCerrar={onCerrar} />
        <h3>{INFO_DE_ALCANCE[c.scope_kind].emoji} {c.title} <ChipDeEtapaDeConteo e={c.stage} /></h3>
        <p className="sub">{c.store} · {lineas.length} {t("products", "productos")} · {t("opened by", "lo abrió")} {c.created_by_name ?? nombre(c.created_by)} · {fmtDateTime(c.created_at)}</p>
        {c.instructions && <p className="hint">📝 {c.instructions}</p>}

        <LineaDeEtapasDeConteo c={c} nombre={nombre} adjunto={adj} />

        {error && <p className="ops-aviso ops-aviso-error" role="alert">{error}</p>}

        {/* Paso 1 */}
        {c.stage === "organizing" && acciones.includes("organizado") && (
          <div className="ops-etapa-acciones" data-paso="1">
            <button type="button" className="ops-boton ops-boton-primario" onClick={() => void avanzar("counting", null)} disabled={ocupado} data-accion="organizado">✅ {t("Material is organized", "El material ya está acomodado")}</button>
          </div>
        )}

        {/* Paso 2: las líneas, con su captura */}
        {c.stage === "counting" && (
          <section className="ops-etapas" data-lineas={lineas.length}>
            <h4>{t("Count", "Contar")} <span className="ops-cuenta">{progreso.hechas}/{progreso.total}</span></h4>
            <ul className="ops-progreso ops-progreso-conteo" aria-label={`${progreso.pct}%`} data-progreso={progreso.pct}>
              {lineas.map((l) => <li key={l.id} className={estaContada(l) ? "hecho" : ""} />)}
            </ul>
            <ul className="ops-lineas-conteo">
              {ordenarLineas(lineas).map((l) => {
                const puedeCapturar = acciones.includes("contar_linea");
                return (
                  <li key={l.id} className={`ops-linea-conteo${estaContada(l) ? " contada" : ""}${l.recount_requested ? " recontar" : ""}`} data-linea={l.id}>
                    <button type="button" className="ops-linea-conteo-boton" onClick={() => puedeCapturar && setLineaAbierta(l.id)} disabled={!puedeCapturar} data-accion="abrir-linea">
                      <span className="ops-linea-conteo-nombre"><span className="hoja-folio">{l.sku}</span> {l.name}{l.size_in ? <span className="hint"> · {l.size_in}</span> : null}</span>
                      <span className="ops-linea-conteo-cifras">
                        <span>{t("System", "Sistema")}: <b>{l.system_qty ?? "—"}</b></span>
                        <span>{t("Counted", "Contado")}: <b data-contado={l.counted_total ?? ""}>{l.counted_total ?? "—"}</b></span>
                      </span>
                      <span className="ops-equipo-insignias">
                        {l.recount_requested && <span className="ops-insignia ops-insignia-sin-foto" data-recontar>↩ {t("Recount", "Recontar")}{l.recount_note && `: ${l.recount_note}`}</span>}
                        {estaContada(l) && <span className="ops-insignia ops-insignia-ok">✓ {l.counted_by_name ?? "—"} · {fmtDateTime(l.counted_at)}</span>}
                        {!estaContada(l) && !l.recount_requested && puedeCapturar && <span className="ops-insignia">{t("Tap to count", "Toca para contar")}</span>}
                        {l.note && <span className="hint">🗒 {l.note}</span>}
                        {l.photo && adj(l.photo, l.sku)}
                      </span>
                    </button>
                    {acciones.includes("recontar") && estaContada(l) && (
                      <button type="button" className="btn btn-sm btn-ghost" onClick={() => setRecontar(l)} data-accion="recontar">↩ {t("Recount", "Recontar")}</button>
                    )}
                  </li>
                );
              })}
            </ul>
            {recontar && c.stage === "counting" && (
              <FormNota titulo={t(`Send ${recontar.sku} back to recount`, `Mandar ${recontar.sku} a recontar`)} texto={t("Why? (optional)", "¿Por qué? (opcional)")} boton={t("Send back", "Mandar a recontar")} ocupado={ocupado} onCancelar={() => setRecontar(null)} onListo={(n) => void recontarLinea(recontar, n)} />
            )}
            {acciones.includes("terminar_conteo") && (
              <div className="ops-etapa-acciones" data-paso="2">
                <button type="button" className="ops-boton ops-boton-primario" onClick={() => void avanzar("review", null)} disabled={ocupado} data-accion="terminar-conteo">✅ {t("All counted, go to review", "Todo contado, pasar a revisar")}</button>
              </div>
            )}
            {!acciones.includes("terminar_conteo") && progreso.total > 0 && <p className="hint">{t(`${progreso.total - progreso.hechas} products left to count.`, `Faltan ${progreso.total - progreso.hechas} productos por contar.`)}</p>}
          </section>
        )}

        {/* Paso 3: las órdenes pendientes, por producto, después de contar */}
        {c.stage === "review" && (
          <PanelDeRevision c={c} lineas={lineas} pendientes={pendientes} ctx={ctx} pon={pon} acciones={acciones} sin333={sin333} onError={setError} nombre={nombre} />
        )}

        {/* Pasos 4 y 5: firma y ajuste; el paso 5 cerrado se ve igual, sin acciones */}
        {(c.stage === "sign_off" || c.stage === "adjusted") && (
          <PanelDeFirma c={c} lineas={lineas} pendientes={pendientes} ctx={ctx} pon={pon} acciones={acciones} onError={setError} nombre={nombre} />
        )}

        {gestiona && enRevisionOFirma && (
          <div className="ops-etapa-acciones">
            <a className="btn" href={`/operaciones/conteos/hoja?id=${encodeURIComponent(c.id)}`} target="_blank" rel="noreferrer" data-accion="imprimir-hoja">🖨 {t("Print sheet", "Imprimir hoja")}</a>
          </div>
        )}

        {acciones.includes("cancelar") && !cancelando && (
          <div className="ops-etapa-acciones"><button type="button" className="btn btn-ghost btn-sm" onClick={() => setCancelando(true)} data-accion="cancelar-conteo">✕ {t("Cancel this count", "Cancelar este conteo")}</button></div>
        )}
        {cancelando && <FormNota titulo={t("Cancel this count", "Cancelar este conteo")} texto={t("Why? (optional)", "¿Por qué? (opcional)")} boton={t("Yes, cancel it", "Sí, cancelarlo")} ocupado={ocupado} onCancelar={() => setCancelando(false)} onListo={(n) => void cancelar(n)} />}

        <div className="modal-actions ops-cerrar-abajo"><button type="button" className="btn" onClick={onCerrar} data-accion="cerrar">{t("Close", "Cerrar")}</button></div>
      </div>
    </VentanaDeConteo>
  );
}
