"use client";

import { mensajeDeError, mensajeDeErrorAlCargar } from "@/lib/mensaje-de-error";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { usePrefs } from "@/lib/prefs";
import { createClient } from "@/lib/supabase/client";
import { fmtDateTime, fmtMoney } from "@/lib/utils";
import { BotonesDeFoto } from "./BotonesDeFoto";
import { detalleParaConsola, leerFotoDelTelefono, mensajeDeFotoFallida } from "@/lib/almacen-ops/foto-del-telefono";
import { DEMO_PRODUCTOS, buscarProductos, enlacesDeFotos, subirAdjunto, subirFoto, tipoDeAdjuntoValido } from "@/lib/almacen-ops/datos";
import { hoyEnTexas } from "@/lib/almacen-ops/fecha-del-dano";
import type { ProductoElegido } from "@/lib/almacen-ops/pasos";
import {
  ALCANCES, ETAPAS_DE_CONTEO, INFO_DE_ALCANCE, INFO_DE_ETAPA_DE_CONTEO, accionesDeConteo, capturaPorCajas, diferencia, estaAbierto, estaContada, etapaHecha,
  faltaDelAlcance, fechaDeEtapaDeConteo, motivoDeCaptura, nombreDeEtapaDeConteo, ordenarLineas, ordenarPorDiferencia, progresoDelConteo, puedeGestionarConteo,
  resumenDelConteo, tituloDeAlcance, validarCaptura, valorDeLaDiferencia, type AlcanceElegido, type Conteo, type EstadoDeConteo, type Linea,
} from "@/lib/almacen-ops/conteos";
import { colorDeExactitud, kpiDeConteos, kpiPorEmpleado, periodoDeDias } from "@/lib/almacen-ops/conteos-kpi";
import {
  DEMO_CONTEOS, DEMO_PRODUCTOS_DE_CONTEO, DEMO_PROVEEDORES, ajustarConteo, avanzarConteo, cancelarConteo, crearConteo, faltaLa274, firmarConteo, leerConteos,
  leerProductosDelAlcance, leerProveedores, lineaDeLaFila, mandarARecontar, registrarLinea, type Conteos as Datos, type ProductoDeConteo, type Proveedor,
} from "@/lib/almacen-ops/conteos-datos";
import type { Contexto } from "./Operaciones";
import { CerrarX } from "./CerrarX";

/**
 * La sección «Conteos de inventario» de Operaciones de almacén (274): la lista de conteos de la tienda con su paso, la
 * tarjeta de cada conteo (línea de tiempo de los cinco pasos + lo que toca hacer), y para el gerente: crear uno (alcance:
 * proveedor + medida / proveedor + nota / producto), revisar sistema vs contado, firmar, ajustar; el KPI arriba.
 * Todo se abre en su sitio, como tarjeta (regla de la casa).
 */

type Carga = { estado: "cargando" } | { estado: "falta-274" } | { estado: "error"; mensaje: string } | { estado: "listo"; datos: Datos };
/* mensajeDeError: el compartido de @/lib/mensaje-de-error (D-1021) */
type Pon = (f: (d: Datos) => Datos) => void;

export function Conteos({ ctx }: { ctx: Contexto }) {
  const { t, lang } = usePrefs();
  const [carga, setCarga] = useState<Carga>(ctx.demo ? { estado: "listo", datos: DEMO_CONTEOS } : { estado: "cargando" });
  const [tienda, setTienda] = useState(() => (ctx.yo.store && ctx.tiendas.includes(ctx.yo.store) ? ctx.yo.store : ctx.tiendas[0] ?? ""));
  const [abierto, setAbierto] = useState<string | null>(null);
  const [nuevo, setNuevo] = useState(false);
  const [verCerrados, setVerCerrados] = useState(false);

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
  const lista = useMemo(() => (datos?.conteos ?? []).filter((c) => c.store === tienda && (verCerrados || estaAbierto(c))), [datos, tienda, verCerrados]);
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
      {datos && (
        <>
          {gestiona && <Kpi datos={datos} tienda={tienda} />}
          <div className="ops-exportar ops-conteos-barra">
            <label className="ops-fila ops-filtros-espacio"><input type="checkbox" checked={verCerrados} onChange={(e) => setVerCerrados(e.target.checked)} data-campo="ver-cerrados" /> {t("Show closed", "Ver cerrados")}</label>
            {gestiona && <button type="button" className="btn btn-sm btn-primary" onClick={() => setNuevo(true)} data-accion="nuevo-conteo">＋ {t("New count", "Nuevo conteo")}</button>}
          </div>
          {lista.length === 0 && (
            <p className="ops-aviso" data-sin-conteos>
              {gestiona
                ? t("No open counts in this store. Start one: pick a supplier and size, a supplier and a note, or one product.", "No hay conteos abiertos en esta tienda. Abre uno: elige proveedor y medida, proveedor y nota, o un producto.")
                : t("No open counts in this store. Your manager opens them.", "No hay conteos abiertos en esta tienda. Los abre tu gerente.")}
            </p>
          )}
          <ul className="ops-lista-equipo" data-lista-conteos={lista.length}>
            {lista.map((c) => {
              const lineas = datos.lineas.filter((l) => l.count_id === c.id);
              const p = progresoDelConteo(lineas);
              return (
                <li key={c.id}>
                  <button type="button" className={`ops-equipo${estaAbierto(c) ? "" : " ops-equipo-baja"}`} onClick={() => setAbierto(c.id)} data-conteo={c.id} data-etapa={c.stage}>
                    <span className="ops-equipo-icono" aria-hidden>{INFO_DE_ALCANCE[c.scope_kind].emoji}</span>
                    <span className="ops-equipo-texto">
                      <span className="ops-equipo-nombre">{c.title}</span>
                      <span className="ops-equipo-meta">{lineas.length} {t("products", "productos")} · {t("opened", "abierto")} {fmtDateTime(c.created_at)}{c.created_by_name ? ` · ${c.created_by_name}` : ""}</span>
                      <span className="ops-equipo-insignias">
                        <ChipDeEtapa e={c.stage} />
                        {c.stage === "counting" && <span className="ops-insignia" data-progreso={p.pct}>{p.hechas}/{p.total} · {p.pct}%</span>}
                        {c.stage === "review" && c.signed_at && <span className="ops-insignia ops-insignia-ok">✍️ {t("Signed", "Firmado")}</span>}
                        {lineas.some((l) => l.recount_requested) && <span className="ops-insignia ops-insignia-sin-foto">↩ {t("Recount requested", "Recontar")}</span>}
                      </span>
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
          {elegido && <TarjetaConteo c={elegido} lineas={datos.lineas.filter((l) => l.count_id === elegido.id)} ctx={ctx} pon={pon} onCerrar={() => setAbierto(null)} />}
          {nuevo && <FormNuevoConteo ctx={ctx} tienda={tienda} onCerrar={() => setNuevo(false)}
            onCreado={(c, ls) => { pon((d) => ({ conteos: [c, ...d.conteos], lineas: [...d.lineas, ...ls] })); setNuevo(false); setAbierto(c.id); }} />}
          <p className="hint ops-conteos-pie">{lang === "es" ? "Las cantidades del sistema se congelan al abrir el conteo." : "System quantities are frozen when the count is opened."}</p>
        </>
      )}
    </section>
  );
}

function ChipDeEtapa({ e }: { e: EstadoDeConteo }) {
  const { lang } = usePrefs();
  const i = INFO_DE_ETAPA_DE_CONTEO[e];
  return (
    <span className="ops-etapa" style={{ "--etapa": i.color } as React.CSSProperties} data-etapa-conteo={e}>
      <span className="ops-etapa-nombre">{i.n > 0 ? `${i.n}. ` : ""}{nombreDeEtapaDeConteo(e, lang)}</span>
    </span>
  );
}

// ---------------------------------------------------------------------------
// KPI (gerentes): últimos 30 días
// ---------------------------------------------------------------------------
function Kpi({ datos, tienda }: { datos: Datos; tienda: string }) {
  const { t } = usePrefs();
  const periodo = useMemo(() => periodoDeDias(hoyEnTexas(), 30), []);
  const k = useMemo(() => kpiDeConteos(datos.conteos, datos.lineas, periodo, [tienda])[0], [datos, periodo, tienda]);
  const gente = useMemo(() => kpiPorEmpleado(datos.conteos, datos.lineas, periodo, tienda).slice(0, 4), [datos, periodo, tienda]);
  const color = colorDeExactitud(k.exactitudPct);
  return (
    <div className="ops-kpi-conteos" data-kpi-conteos data-kpi-exactitud={k.exactitudPct ?? ""}>
      <div className="ops-merma-totales ops-kpi">
        <div className="ops-merma-total">
          <span>{t("Counts done (30 d)", "Conteos hechos (30 d)")}</span>
          <span className="ops-merma-cifra">{k.hechos}</span>
          <span>{t(`${k.abiertos} open`, `${k.abiertos} abiertos`)}</span>
        </div>
        <div className="ops-merma-total">
          <span>{t("Accuracy", "Exactitud")}</span>
          <span className={`ops-merma-cifra ops-kpi-${color}`}>{k.exactitudPct === null ? "—" : `${k.exactitudPct}%`}</span>
          <span>{k.lineasExactas} / {k.lineasContadas} {t("lines", "líneas")}</span>
        </div>
        <div className="ops-merma-total">
          <span>{t("$ variance", "Variación $")}</span>
          <span className={`ops-merma-cifra ${k.variacionAbs > 0 ? "ops-kpi-ambar" : "ops-kpi-verde"}`}>{fmtMoney(k.variacionAbs)}</span>
          <span>{t("net", "neta")} {k.variacionNeta > 0 ? "+" : ""}{fmtMoney(k.variacionNeta)}</span>
        </div>
        <div className="ops-merma-total">
          <span>{t("Days to adjust", "Días hasta ajustar")}</span>
          <span className="ops-merma-cifra">{k.diasPromedio === null ? "—" : k.diasPromedio}</span>
          <span>{t("average", "promedio")}</span>
        </div>
      </div>
      {gente.length > 0 && (
        <p className="hint ops-kpi-gente" data-kpi-gente>
          {gente.map((g) => <span key={g.id} className="ops-insignia">{g.nombre}: {g.lineas} {t("lines", "líneas")}{g.exactitudPct !== null && ` · ${g.exactitudPct}%`}</span>)}
        </p>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Crear un conteo (gestor): el alcance → vista previa → crear
// ---------------------------------------------------------------------------
function FormNuevoConteo({ ctx, tienda, onCerrar, onCreado }: { ctx: Contexto; tienda: string; onCerrar: () => void; onCreado: (c: Conteo, lineas: Linea[]) => void }) {
  const { t, lang } = usePrefs();
  const [a, setA] = useState<AlcanceElegido>({ scope_kind: "vendor_size" });
  const [instrucciones, setInstrucciones] = useState("");
  const [proveedores, setProveedores] = useState<Proveedor[] | null>(ctx.demo ? DEMO_PROVEEDORES : null);
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

  // Vista previa en cuanto el alcance está completo (con una pausa corta para la nota escrita a mano).
  useEffect(() => {
    setVista(null);
    if (falta) return;
    let vivo = true;
    const h = setTimeout(() => {
      if (ctx.demo) {
        const lista = DEMO_PRODUCTOS_DE_CONTEO.filter((p) => a.scope_kind === "product" ? p.id === a.product_id
          : a.scope_kind === "vendor_size" ? p.vendor_name === a.vendor_name && p.size_in === a.size_in
          : p.vendor_name === a.vendor_name && p.name.toLowerCase().includes((a.note ?? "").toLowerCase()));
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
  const crear = async () => {
    if (falta || !vista || vista.length === 0) return;
    setOcupado(true); setError(null);
    try {
      const ahora = new Date().toISOString();
      const id = ctx.demo ? `c-${Date.now()}` : await crearConteo(createClient(), tienda, a, instrucciones);
      const c: Conteo = {
        id, store: tienda, scope_kind: a.scope_kind, vendor_name: a.vendor_name ?? null, size_in: a.size_in ?? null, note: a.note ?? null, product_id: a.product_id ?? null,
        title: tituloDeAlcance(a), stage: "organizing", instructions: instrucciones.trim() || null, comments: null, created_by: ctx.yo.id, created_by_name: ctx.yo.full_name, created_at: ahora,
        organized_at: null, organized_by: null, orders_reviewed_at: null, orders_reviewed_by: null, orders_note: null, counting_done_at: null, counting_done_by: null,
        signed_at: null, signed_by: null, signed_by_name: null, signed_sheet: null, adjusted_at: null, adjusted_by: null, adjustment_shots: [], cancelled_at: null, cancelled_by: null, cancel_note: null,
      };
      // Las líneas de la pantalla hasta que se vuelva a leer: la base las creó con los mismos datos de la vista previa.
      const lineas: Linea[] = vista.map((p, n) => ({
        id: ctx.demo ? `l-${id}-${n}` : `${id}:${p.id}`, count_id: id, product_id: p.id, sku: p.sku, name: p.name, size_in: p.size_in, system_qty: p.qoh, price: p.price, pieces_per_box: p.pieces_per_box,
        counted_boxes: null, counted_pieces: null, counted_total: null, counted_by: null, counted_by_name: null, counted_at: null, note: null, photo: null, recount_requested: false, recount_note: null, position: n + 1,
      }));
      if (!ctx.demo) {
        // Los ids reales de las líneas: se leen una vez (el personal las necesita para capturar).
        const { data } = await createClient().from("warehouse_count_lines").select("*").eq("count_id", id).order("position");
        if (data && data.length > 0) {
          onCreado(c, (data as Record<string, unknown>[]).map(lineaDeLaFila));
          return;
        }
      }
      onCreado(c, lineas);
    } catch (x) { setError(mensajeDeError(x)); } finally { setOcupado(false); }
  };

  return (
    <div className="overlay" onClick={onCerrar}>
      <div className="modal ops-tarjeta-reporte" onClick={(x) => x.stopPropagation()} role="dialog" aria-modal="true" data-form-conteo>
        <CerrarX onCerrar={onCerrar} />
        <h3>{t("New count", "Nuevo conteo")}</h3>
        <p className="sub">{tienda}</p>
        <div className="ops-formulario">
          <label className="ops-cantidad"><span>{t("What to count", "Qué contar")}</span>
            <div className="ops-opciones">
              {ALCANCES.map((k) => <button type="button" key={k} className={`ops-opcion${a.scope_kind === k ? " elegida" : ""}`} aria-pressed={a.scope_kind === k} onClick={() => setA({ scope_kind: k })} data-opcion={k}>{INFO_DE_ALCANCE[k].emoji} {lang === "es" ? INFO_DE_ALCANCE[k].es : INFO_DE_ALCANCE[k].en}</button>)}
            </div>
            <span className="hint">{lang === "es" ? INFO_DE_ALCANCE[a.scope_kind].desc_es : INFO_DE_ALCANCE[a.scope_kind].desc_en}</span>
          </label>
          {a.scope_kind !== "product" && (
            <label className="ops-cantidad"><span>{t("Supplier", "Proveedor")}</span>
              {proveedores === null ? <span className="hint">{t("Loading suppliers…", "Cargando proveedores…")}</span> : (
                <select className="ops-campo" value={a.vendor_name ?? ""} onChange={(e) => setA((x) => ({ ...x, vendor_name: e.target.value || null, size_in: null }))} data-campo="proveedor">
                  <option value="">{t("Choose…", "Elige…")}</option>
                  {proveedores.map((p) => <option key={p.vendor_name} value={p.vendor_name}>{p.vendor_name} ({p.products})</option>)}
                </select>
              )}
            </label>
          )}
          {a.scope_kind === "vendor_size" && prov && (
            <label className="ops-cantidad"><span>{t("Size", "Medida")}</span>
              <div className="ops-opciones">
                {prov.sizes.length === 0 && <span className="hint">{t("This supplier has no sizes in the catalog; use supplier + note.", "Este proveedor no tiene medidas en el catálogo; usa proveedor + nota.")}</span>}
                {prov.sizes.map((s) => <button type="button" key={s} className={`ops-opcion ops-opcion-chica${a.size_in === s ? " elegida" : ""}`} aria-pressed={a.size_in === s} onClick={() => setA((x) => ({ ...x, size_in: s }))} data-opcion={s}>{s}</button>)}
              </div>
            </label>
          )}
          {a.scope_kind === "vendor_note" && (
            <label className="ops-cantidad"><span>{t("Note (word in the name, collection or color)", "Nota (palabra del nombre, colección o color)")}</span>
              <input className="ops-campo" value={a.note ?? ""} onChange={(e) => setA((x) => ({ ...x, note: e.target.value }))} placeholder={t("e.g. black, Marazzi, matte", "p. ej. negro, Marazzi, mate")} data-campo="nota" />
            </label>
          )}
          {a.scope_kind === "product" && (
            <label className="ops-cantidad"><span>{t("Product (SKU or name)", "Producto (SKU o nombre)")}</span>
              {a.product_id != null ? (
                <span className="ops-seleccion" data-producto={a.product_id}>{a.product_sku} · {a.product_name} <button type="button" className="btn btn-sm" onClick={() => setA({ scope_kind: "product" })} data-accion="cambiar-producto">✕</button></span>
              ) : (
                <>
                  <input className="ops-campo" value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("Type at least 2 letters", "Escribe al menos 2 letras")} data-campo="buscar-producto" autoFocus />
                  {sugeridos.length > 0 && (
                    <ul className="ops-sugerencias" data-sugerencias={sugeridos.length}>
                      {sugeridos.map((p) => <li key={p.id ?? p.sku}><button type="button" className="ops-opcion ops-opcion-chica" onClick={() => { setA({ scope_kind: "product", product_id: p.id, product_sku: p.sku, product_name: p.name }); setQ(""); }} data-producto={p.id}>{p.sku} · {p.name}</button></li>)}
                    </ul>
                  )}
                </>
              )}
            </label>
          )}
          <label className="ops-cantidad"><span>{t("Step 1 instructions (what to organize)", "Instrucciones del paso 1 (qué acomodar)")}</span>
            <textarea className="ops-campo" rows={2} value={instrucciones} onChange={(e) => setInstrucciones(e.target.value)} placeholder={t("e.g. Pull the pallets to aisle 3, one SKU per spot, labels out.", "p. ej. Bajar los pallets al pasillo 3, un SKU por lugar, etiquetas a la vista.")} data-campo="instrucciones" />
          </label>
        </div>
        {!falta && (
          <section className="ops-etapas" data-vista-previa={vista?.length ?? "cargando"}>
            <h4>{tituloDeAlcance(a)} · {vista === null ? t("loading…", "cargando…") : t(`${vista.length} products`, `${vista.length} productos`)}</h4>
            {vista && vista.length === 0 && <p className="ops-aviso">{t("No products match. Change the scope.", "Ningún producto coincide. Cambia el alcance.")}</p>}
            {vista && vista.length > 0 && (
              <ul className="ops-linea-de-etapas ops-vista-previa">
                {vista.slice(0, 12).map((p) => <li key={p.id} className="ops-etapa-texto"><span className="hoja-folio">{p.sku}</span> {p.name}<span className="hint">{t("system", "sistema")}: {p.qoh ?? "—"}</span></li>)}
                {vista.length > 12 && <li className="hint">… {t(`and ${vista.length - 12} more`, `y ${vista.length - 12} más`)}</li>}
              </ul>
            )}
            {vista && vista.length > 0 && vista.every((p) => p.qoh == null) && <p className="hint" data-sin-qoh>{t("This store has no quantities in the ERP: lines will count without a system quantity.", "Esta tienda no tiene existencias en el ERP: las líneas se contarán sin cantidad del sistema.")}</p>}
          </section>
        )}
        {error && <p className="ops-aviso ops-aviso-error" role="alert">{error}</p>}
        <div className="modal-actions">
          <button type="button" className="btn" onClick={onCerrar} disabled={ocupado}>{t("Cancel", "Cancelar")}</button>
          <button type="button" className="btn btn-primary" onClick={() => void crear()} disabled={!!falta || !vista || vista.length === 0 || ocupado} data-accion="crear-conteo">{ocupado ? t("Creating…", "Creando…") : t("Open the count", "Abrir el conteo")}</button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// La tarjeta de un conteo: los cinco pasos y lo que toca
// ---------------------------------------------------------------------------
function TarjetaConteo({ c, lineas, ctx, pon, onCerrar }: { c: Conteo; lineas: Linea[]; ctx: Contexto; pon: Pon; onCerrar: () => void }) {
  const { t, lang } = usePrefs();
  const [modo, setModo] = useState<"ver" | "ordenes" | "firmar" | "ajustar" | "cancelar">("ver");
  const [lineaAbierta, setLineaAbierta] = useState<string | null>(null);
  const [recontar, setRecontar] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [enlaces, setEnlaces] = useState<Record<string, string>>({});
  const acciones = accionesDeConteo(ctx.yo, c, lineas);
  const gestiona = puedeGestionarConteo(ctx.yo, c.store);
  const nombre = (id: string | null) => (id ? ctx.personas.find((p) => p.id === id)?.full_name ?? "—" : "");
  const progreso = progresoDelConteo(lineas);
  const resumen = resumenDelConteo(lineas);
  const adjuntos = useMemo(() => [c.signed_sheet, ...c.adjustment_shots, ...lineas.map((l) => l.photo)].filter((x): x is string => !!x), [c.signed_sheet, c.adjustment_shots, lineas]);
  useEffect(() => {
    if (ctx.demo || adjuntos.length === 0) return;
    let vivo = true;
    void enlacesDeFotos(createClient(), adjuntos).then((u) => { if (vivo) setEnlaces(Object.fromEntries(adjuntos.map((a, n) => [a, u[n]]))); });
    return () => { vivo = false; };
  }, [adjuntos, ctx.demo]);

  const ponConteo = (f: (x: Conteo) => Conteo) => pon((d) => ({ ...d, conteos: d.conteos.map((x) => (x.id === c.id ? f(x) : x)) }));
  const avanzar = async (etapa: "reviewing_orders" | "counting" | "review", nota: string | null) => {
    setOcupado(true); setError(null);
    try {
      if (!ctx.demo) await avanzarConteo(createClient(), c.id, etapa, nota);
      const ahora = new Date().toISOString();
      ponConteo((x) => etapa === "reviewing_orders" ? { ...x, stage: etapa, organized_at: ahora, organized_by: ctx.yo.id }
        : etapa === "counting" ? { ...x, stage: etapa, orders_reviewed_at: ahora, orders_reviewed_by: ctx.yo.id, orders_note: nota }
        : { ...x, stage: etapa, counting_done_at: ahora, counting_done_by: ctx.yo.id });
      setModo("ver");
    } catch (x) { setError(mensajeDeError(x)); } finally { setOcupado(false); }
  };
  const Adjunto = ({ ruta, alt }: { ruta: string | null; alt: string }) => {
    if (!ruta) return null;
    const u = enlaces[ruta];
    if (ctx.demo || !u) return <span className="hint" data-adjunto={ruta}>📎 {t("attached", "adjunto")}</span>;
    return /\.pdf$/i.test(ruta)
      ? <a className="ops-adjunto-pdf" href={u} target="_blank" rel="noreferrer" data-adjunto={ruta}>📄 PDF</a>
      // eslint-disable-next-line @next/next/no-img-element
      : <a className="ops-adjunto-mini" href={u} target="_blank" rel="noreferrer" data-adjunto={ruta}><img src={u} alt={alt} /></a>;
  };

  const lineaElegida = lineaAbierta ? lineas.find((l) => l.id === lineaAbierta) ?? null : null;
  if (lineaElegida && c.stage === "counting" && acciones.includes("contar_linea")) {
    return <FormLinea l={lineaElegida} ctx={ctx} onCerrar={() => setLineaAbierta(null)} onGuardada={(n) => { pon((d) => ({ ...d, lineas: d.lineas.map((x) => (x.id === n.id ? n : x)) })); setLineaAbierta(null); }} />;
  }

  return (
    <div className="overlay" onClick={onCerrar}>
      <div className="modal ops-tarjeta-reporte ops-tarjeta-conteo" onClick={(x) => x.stopPropagation()} role="dialog" aria-modal="true" data-tarjeta-conteo={c.id} data-etapa={c.stage}>
        <CerrarX onCerrar={onCerrar} />
        <h3>{INFO_DE_ALCANCE[c.scope_kind].emoji} {c.title} <ChipDeEtapa e={c.stage} /></h3>
        <p className="sub">{c.store} · {lineas.length} {t("products", "productos")} · {t("opened by", "lo abrió")} {c.created_by_name ?? nombre(c.created_by)} · {fmtDateTime(c.created_at)}</p>

        {/* La línea de tiempo de los cinco pasos */}
        <section className="ops-etapas" data-etapas-conteo={c.stage}>
          <ol className="ops-linea-de-etapas">
            {ETAPAS_DE_CONTEO.map((e) => {
              const hecha = etapaHecha(c, e);
              const f = fechaDeEtapaDeConteo(c, e);
              const actual = c.stage === e;
              return (
                <li key={e} data-etapa={e} data-hecha={hecha ? "si" : "no"} className={hecha && !actual ? "hecha" : actual ? "hecha actual" : ""}>
                  <span className="ops-etapa-punto" aria-hidden />
                  <span className="ops-etapa-texto">
                    <strong>{INFO_DE_ETAPA_DE_CONTEO[e].n}. {nombreDeEtapaDeConteo(e, lang)}</strong>
                    {hecha && !actual && f.at && <span className="ops-etapa-cuando">{t("done", "hecho")} {fmtDateTime(f.at)}{f.by && ` · ${nombre(f.by)}`}</span>}
                    {actual && c.stage !== "adjusted" && <span className="ops-etapa-cuando">{lang === "es" ? INFO_DE_ETAPA_DE_CONTEO[e].que_es : INFO_DE_ETAPA_DE_CONTEO[e].que_en}</span>}
                    {e === "adjusted" && c.adjusted_at && <span className="ops-etapa-cuando">{fmtDateTime(c.adjusted_at)} · {nombre(c.adjusted_by)}</span>}
                    {e === "organizing" && c.instructions && <span className="ops-nota-fallo">📝 {c.instructions}</span>}
                    {e === "reviewing_orders" && c.orders_note && <span className="ops-nota-fallo">🗒 {c.orders_note}</span>}
                    {e === "review" && c.signed_at && <span className="ops-etapa-cuando" data-firmado>✍️ {t("Signed by", "Firmó")} {c.signed_by_name ?? nombre(c.signed_by)} · {fmtDateTime(c.signed_at)} <Adjunto ruta={c.signed_sheet} alt={t("Signed sheet", "Hoja firmada")} /></span>}
                    {e === "adjusted" && c.adjustment_shots.map((s) => <Adjunto key={s} ruta={s} alt={t("ERP screenshot", "Captura del ERP")} />)}
                  </span>
                </li>
              );
            })}
            {c.stage === "cancelled" && <li data-etapa="cancelled" className="hecha"><span className="ops-etapa-punto" aria-hidden /><span className="ops-etapa-texto"><strong>{t("Cancelled", "Cancelado")}</strong><span className="ops-etapa-cuando">{fmtDateTime(c.cancelled_at)} · {nombre(c.cancelled_by)}{c.cancel_note && ` · ${c.cancel_note}`}</span></span></li>}
          </ol>
        </section>

        {error && <p className="ops-aviso ops-aviso-error" role="alert">{error}</p>}

        {/* Paso 1 */}
        {c.stage === "organizing" && acciones.includes("organizado") && modo === "ver" && (
          <div className="ops-etapa-acciones" data-paso="1">
            <button type="button" className="ops-boton ops-boton-primario" onClick={() => void avanzar("reviewing_orders", null)} disabled={ocupado} data-accion="organizado">✅ {t("Material is organized", "El material ya está acomodado")}</button>
          </div>
        )}
        {/* Paso 2 */}
        {c.stage === "reviewing_orders" && acciones.includes("ordenes_revisadas") && modo === "ver" && (
          <div className="ops-etapa-acciones" data-paso="2">
            <p className="hint">{t("Deliveries in this app do not list products, so confirm by hand: check open orders / pick-ups that include these products and write what you found.", "Las entregas de esta app no llevan productos, así que se confirma a mano: revisa las órdenes / recolecciones abiertas con estos productos y anota lo que encontraste.")}</p>
            <button type="button" className="ops-boton ops-boton-primario" onClick={() => setModo("ordenes")} data-accion="revisar-ordenes">📋 {t("Pending orders reviewed", "Órdenes pendientes revisadas")}</button>
          </div>
        )}
        {modo === "ordenes" && <FormNota titulo={t("Pending orders", "Órdenes pendientes")} texto={t("What did you find? (e.g. 2 open deliveries with PORC-2448, not pulled yet; or: none)", "¿Qué encontraste? (p. ej. 2 entregas abiertas con PORC-2448, sin surtir; o: ninguna)")} boton={t("Reviewed, go to counting", "Revisadas, pasar a contar")} obligatoria ocupado={ocupado} onCancelar={() => setModo("ver")} onListo={(n) => void avanzar("counting", n)} />}

        {/* Paso 3: las líneas */}
        {(c.stage === "counting" || c.stage === "review" || c.stage === "adjusted") && (
          <section className="ops-etapas" data-lineas={lineas.length}>
            <h4>
              {c.stage === "counting" ? t("Count & record", "Contar y registrar") : t("System vs counted", "Sistema vs contado")}
              <span className="ops-cuenta">{progreso.hechas}/{progreso.total}</span>
            </h4>
            {c.stage === "counting" && (
              <ul className="ops-progreso ops-progreso-conteo" aria-label={`${progreso.pct}%`} data-progreso={progreso.pct}>
                {lineas.map((l) => <li key={l.id} className={estaContada(l) ? "hecho" : ""} />)}
              </ul>
            )}
            {c.stage !== "counting" && (
              <p className="ops-resumen-conteo" data-resumen data-exactitud={resumen.exactitudPct ?? ""}>
                <span className="ops-insignia ops-insignia-ok">{resumen.exactas} {t("exact", "exactas")}</span>
                <span className={`ops-insignia ${resumen.conDiferencia > 0 ? "ops-insignia-repetida" : ""}`}>{resumen.conDiferencia} {t("with difference", "con diferencia")}</span>
                {resumen.sinSistema > 0 && <span className="ops-insignia">{resumen.sinSistema} {t("no system qty", "sin sistema")}</span>}
                <span className="ops-insignia">{t("Accuracy", "Exactitud")} {resumen.exactitudPct === null ? "—" : `${resumen.exactitudPct}%`}</span>
                <span className="ops-insignia">{t("Variance", "Variación")} {fmtMoney(resumen.valorAbsoluto)} ({resumen.valorNeto > 0 ? "+" : ""}{fmtMoney(resumen.valorNeto)})</span>
              </p>
            )}
            <ul className="ops-lineas-conteo">
              {(c.stage === "counting" ? ordenarLineas(lineas) : ordenarPorDiferencia(lineas)).map((l) => {
                const d = diferencia(l);
                const v = valorDeLaDiferencia(l);
                const puedeCapturar = c.stage === "counting" && acciones.includes("contar_linea");
                return (
                  <li key={l.id} className={`ops-linea-conteo${estaContada(l) ? " contada" : ""}${l.recount_requested ? " recontar" : ""}${d != null && d !== 0 ? " con-diferencia" : ""}`} data-linea={l.id} data-diferencia={d ?? ""}>
                    <button type="button" className="ops-linea-conteo-boton" onClick={() => puedeCapturar && setLineaAbierta(l.id)} disabled={!puedeCapturar} data-accion="abrir-linea">
                      <span className="ops-linea-conteo-nombre"><span className="hoja-folio">{l.sku}</span> {l.name}{l.size_in ? <span className="hint"> · {l.size_in}</span> : null}</span>
                      <span className="ops-linea-conteo-cifras">
                        <span>{t("System", "Sistema")}: <b>{l.system_qty ?? "—"}</b></span>
                        <span>{t("Counted", "Contado")}: <b data-contado={l.counted_total ?? ""}>{l.counted_total ?? "—"}</b>{capturaPorCajas(l) && l.counted_boxes != null && <span className="hint"> ({l.counted_boxes} {t("bx", "cj")} + {l.counted_pieces ?? 0})</span>}</span>
                        {d != null && <span className={d === 0 ? "ops-kpi-verde" : "ops-kpi-rojo"}>{t("Diff", "Dif")}: <b>{d > 0 ? `+${d}` : d}</b>{v != null && d !== 0 && <> · {v > 0 ? "+" : ""}{fmtMoney(v)}</>}</span>}
                      </span>
                      <span className="ops-equipo-insignias">
                        {l.recount_requested && <span className="ops-insignia ops-insignia-sin-foto" data-recontar>↩ {t("Recount", "Recontar")}{l.recount_note && `: ${l.recount_note}`}</span>}
                        {estaContada(l) && <span className="ops-insignia ops-insignia-ok">✓ {l.counted_by_name ?? "—"} · {fmtDateTime(l.counted_at)}</span>}
                        {!estaContada(l) && !l.recount_requested && c.stage === "counting" && <span className="ops-insignia">{t("Tap to count", "Toca para contar")}</span>}
                        {l.note && <span className="hint">🗒 {l.note}</span>}
                        {l.photo && <Adjunto ruta={l.photo} alt={l.sku} />}
                      </span>
                    </button>
                    {acciones.includes("recontar") && estaContada(l) && recontar !== l.id && (
                      <button type="button" className="btn btn-sm btn-ghost" onClick={() => setRecontar(l.id)} data-accion="recontar">↩ {t("Recount", "Recontar")}</button>
                    )}
                    {recontar === l.id && <FormNota titulo={t("Send back to recount", "Mandar a recontar")} texto={t("Why? (optional)", "¿Por qué? (opcional)")} boton={t("Send back", "Mandar a recontar")} ocupado={ocupado} onCancelar={() => setRecontar(null)}
                      onListo={async (n) => {
                        setOcupado(true); setError(null);
                        try {
                          if (!ctx.demo) await mandarARecontar(createClient(), l.id, n);
                          pon((d) => ({
                            conteos: d.conteos.map((x) => (x.id === c.id ? { ...x, stage: "counting", counting_done_at: null, counting_done_by: null, signed_at: null, signed_by: null, signed_by_name: null, signed_sheet: null } : x)),
                            lineas: d.lineas.map((x) => (x.id === l.id ? { ...x, counted_boxes: null, counted_pieces: null, counted_total: null, counted_by: null, counted_by_name: null, counted_at: null, recount_requested: true, recount_note: n || null } : x)),
                          }));
                          setRecontar(null);
                        } catch (x) { setError(mensajeDeError(x)); } finally { setOcupado(false); }
                      }} />}
                  </li>
                );
              })}
            </ul>
            {c.stage === "counting" && acciones.includes("terminar_conteo") && (
              <div className="ops-etapa-acciones" data-paso="3">
                <button type="button" className="ops-boton ops-boton-primario" onClick={() => void avanzar("review", null)} disabled={ocupado} data-accion="terminar-conteo">✅ {t("All counted, send to review", "Todo contado, pasar a revisión")}</button>
              </div>
            )}
            {c.stage === "counting" && !acciones.includes("terminar_conteo") && progreso.total > 0 && <p className="hint">{t(`${progreso.total - progreso.hechas} products left to count.`, `Faltan ${progreso.total - progreso.hechas} productos por contar.`)}</p>}
          </section>
        )}

        {/* Paso 4 */}
        {c.stage === "review" && gestiona && modo === "ver" && (
          <div className="ops-etapa-acciones" data-paso="4">
            <a className="btn" href={`/operaciones/conteos/hoja?id=${encodeURIComponent(c.id)}`} target="_blank" rel="noreferrer" data-accion="imprimir-hoja">🖨 {t("Print sheet", "Imprimir hoja")}</a>
            {acciones.includes("firmar") && <button type="button" className="ops-boton ops-boton-primario" onClick={() => setModo("firmar")} data-accion="firmar">✍️ {t("Sign off", "Firmar")}</button>}
            {acciones.includes("ajustar") && <button type="button" className="ops-boton ops-boton-primario" onClick={() => setModo("ajustar")} data-accion="ajustar">🧾 {t("Adjusted in ERP: upload screenshot", "Ajustado en el ERP: subir captura")}</button>}
          </div>
        )}
        {modo === "firmar" && <FormAdjuntar ctx={ctx} titulo={t("Sign off", "Firmar")} texto={t(`Your name (${ctx.yo.full_name}) and today's date are recorded. Optionally attach the signed printed sheet (photo or PDF).`, `Quedan tu nombre (${ctx.yo.full_name}) y la fecha de hoy. Si quieres, adjunta la hoja impresa firmada (foto o PDF).`)}
          boton={t("Sign off", "Firmar")} opcional multiple={false} que="hoja" ocupado={ocupado} onCancelar={() => setModo("ver")}
          onListo={async (rutas) => {
            setOcupado(true); setError(null);
            try {
              if (!ctx.demo) await firmarConteo(createClient(), c.id, rutas[0] ?? null);
              ponConteo((x) => ({ ...x, signed_at: new Date().toISOString(), signed_by: ctx.yo.id, signed_by_name: ctx.yo.full_name, signed_sheet: rutas[0] ?? null }));
              setModo("ver");
            } catch (x) { setError(mensajeDeError(x)); } finally { setOcupado(false); }
          }} />}
        {modo === "ajustar" && <FormAdjuntar ctx={ctx} titulo={t("Adjust & screenshot", "Ajustar y captura")} texto={t("Upload the ERP screenshot(s) showing the adjustment. The count closes as Adjusted.", "Sube la(s) captura(s) del ERP con el ajuste hecho. El conteo se cierra como Ajustado.")}
          boton={t("Upload and mark Adjusted", "Subir y marcar Ajustado")} opcional={false} multiple que="ajuste" ocupado={ocupado} onCancelar={() => setModo("ver")}
          onListo={async (rutas) => {
            setOcupado(true); setError(null);
            try {
              if (!ctx.demo) await ajustarConteo(createClient(), c.id, rutas);
              ponConteo((x) => ({ ...x, stage: "adjusted", adjusted_at: new Date().toISOString(), adjusted_by: ctx.yo.id, adjustment_shots: rutas }));
              setModo("ver");
            } catch (x) { setError(mensajeDeError(x)); } finally { setOcupado(false); }
          }} />}

        {/* Cancelar */}
        {acciones.includes("cancelar") && modo === "ver" && (
          <div className="ops-etapa-acciones"><button type="button" className="btn btn-ghost btn-sm" onClick={() => setModo("cancelar")} data-accion="cancelar-conteo">✕ {t("Cancel this count", "Cancelar este conteo")}</button></div>
        )}
        {modo === "cancelar" && <FormNota titulo={t("Cancel this count", "Cancelar este conteo")} texto={t("Why? (optional)", "¿Por qué? (opcional)")} boton={t("Yes, cancel it", "Sí, cancelarlo")} ocupado={ocupado} onCancelar={() => setModo("ver")}
          onListo={async (n) => {
            setOcupado(true); setError(null);
            try {
              if (!ctx.demo) await cancelarConteo(createClient(), c.id, n);
              ponConteo((x) => ({ ...x, stage: "cancelled", cancelled_at: new Date().toISOString(), cancelled_by: ctx.yo.id, cancel_note: n || null }));
              setModo("ver");
            } catch (x) { setError(mensajeDeError(x)); } finally { setOcupado(false); }
          }} />}

        <div className="modal-actions"><button type="button" className="btn" onClick={onCerrar} data-accion="cerrar">{t("Close", "Cerrar")}</button></div>
      </div>
    </div>
  );
}

/** Una nota corta en la propia tarjeta (nunca `prompt()`), con su botón. */
function FormNota({ titulo, texto, boton, obligatoria, ocupado, onCancelar, onListo }: { titulo: string; texto: string; boton: string; obligatoria?: boolean; ocupado: boolean; onCancelar: () => void; onListo: (nota: string) => void }) {
  const { t } = usePrefs();
  const [n, setN] = useState("");
  return (
    <div className="ops-corregir ops-confirmar" role="alertdialog" data-nota={titulo}>
      <p>{titulo}</p>
      <textarea className="ops-campo" rows={2} value={n} onChange={(e) => setN(e.target.value)} placeholder={texto} data-campo="nota" autoFocus />
      <div className="modal-actions">
        <button type="button" className="btn" onClick={onCancelar} disabled={ocupado}>{t("Back", "Volver")}</button>
        <button type="button" className="btn btn-primary" onClick={() => onListo(n.trim())} disabled={ocupado || (!!obligatoria && n.trim().length < 2)} data-accion="nota-lista">{ocupado ? t("Saving…", "Guardando…") : boton}</button>
      </div>
    </div>
  );
}

/** Adjuntar la hoja firmada (una, opcional) o las capturas del ERP (varias): imagen por el lector del teléfono, PDF tal cual. */
function FormAdjuntar({ ctx, titulo, texto, boton, opcional, multiple, que, ocupado, onCancelar, onListo }: {
  ctx: Contexto; titulo: string; texto: string; boton: string; opcional: boolean; multiple: boolean; que: "hoja" | "ajuste"; ocupado: boolean; onCancelar: () => void; onListo: (rutas: string[]) => void;
}) {
  const { t, lang } = usePrefs();
  const entrada = useRef<HTMLInputElement>(null);
  const [ficheros, setFicheros] = useState<File[]>([]);
  const [subiendo, setSubiendo] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const elige = (fs: FileList | null) => {
    setError(null);
    const lista = Array.from(fs ?? []).filter((f) => tipoDeAdjuntoValido(f.type) || f.type.startsWith("image/"));
    if (lista.length === 0) { if (fs && fs.length > 0) setError(t("Only a photo or a PDF.", "Solo una foto o un PDF.")); return; }
    setFicheros((x) => (multiple ? [...x, ...lista] : lista.slice(0, 1)));
  };
  const subir = async () => {
    setSubiendo(true); setError(null);
    try {
      const rutas: string[] = [];
      for (const f of ficheros) {
        if (ctx.demo) { rutas.push(`demo/${que}-${rutas.length + 1}.jpg`); continue; }
        const sb = createClient();
        if (f.type === "application/pdf") { rutas.push(await subirAdjunto(sb, ctx.yo.id, f, f.type, que)); continue; }
        const leida = await leerFotoDelTelefono(f);
        if (!leida.ok) { console.error(detalleParaConsola(leida, f, navigator.userAgent, "galeria")); throw new Error(mensajeDeFotoFallida(leida.motivo, lang)); }
        rutas.push(await subirFoto(sb, ctx.yo.id, leida.jpg));
      }
      onListo(rutas);
    } catch (e) { setError(mensajeDeError(e)); } finally { setSubiendo(false); }
  };
  return (
    <div className="ops-corregir ops-adjuntar" data-adjuntar={que}>
      <p><strong>{titulo}</strong></p>
      <p className="hint">{texto}</p>
      {ficheros.length > 0 && <ul className="ops-fotos-lista">{ficheros.map((f, n) => <li key={n} className="ops-insignia">📎 {f.name} <button type="button" className="btn btn-sm" onClick={() => setFicheros((x) => x.filter((_, i) => i !== n))} data-accion="quitar-adjunto">✕</button></li>)}</ul>}
      <button type="button" className="ops-opcion ops-camara" onClick={() => entrada.current?.click()} disabled={subiendo || ocupado} data-accion={`elegir-${que}`}>
        📎 {ficheros.length > 0 && !multiple ? t("Choose another file", "Elegir otro fichero") : multiple && ficheros.length > 0 ? t("Add another", "Agregar otra") : t("Choose photo or PDF", "Elegir foto o PDF")}
      </button>
      <input ref={entrada} type="file" accept="image/*,application/pdf" multiple={multiple} hidden onChange={(e) => { elige(e.target.files); e.target.value = ""; }} data-entrada={que} />
      {error && <p className="ops-aviso ops-aviso-error" role="alert">{error}</p>}
      <div className="modal-actions">
        <button type="button" className="btn" onClick={onCancelar} disabled={subiendo || ocupado}>{t("Back", "Volver")}</button>
        <button type="button" className="btn btn-primary" onClick={() => void subir()} disabled={subiendo || ocupado || (!opcional && ficheros.length === 0)} data-accion={`listo-${que}`}>{subiendo || ocupado ? t("Saving…", "Guardando…") : boton}</button>
      </div>
    </div>
  );
}

/** Capturar una línea desde el teléfono: cajas + sueltas (si hay piezas por caja) o el total; nota y foto opcionales. */
function FormLinea({ l, ctx, onCerrar, onGuardada }: { l: Linea; ctx: Contexto; onCerrar: () => void; onGuardada: (n: Linea) => void }) {
  const { t, lang } = usePrefs();
  const porCajas = capturaPorCajas(l);
  const [cajas, setCajas] = useState(l.counted_boxes == null ? "" : String(l.counted_boxes));
  const [sueltas, setSueltas] = useState(l.counted_pieces == null ? "" : String(l.counted_pieces));
  const [total, setTotal] = useState(l.counted_total == null ? "" : String(l.counted_total));
  const [nota, setNota] = useState(l.note ?? "");
  const [foto, setFoto] = useState<string | null>(l.photo);
  const [leyendo, setLeyendo] = useState(false);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const val = validarCaptura(l, cajas, sueltas, total);
  const tomar = async (f: File, origen: "camara" | "galeria") => {
    setLeyendo(true); setError(null);
    try {
      if (ctx.demo) { setFoto(`demo/${crypto.randomUUID()}.jpg`); return; }
      const leida = await leerFotoDelTelefono(f);
      if (!leida.ok) { console.error(detalleParaConsola(leida, f, navigator.userAgent, origen)); setError(mensajeDeFotoFallida(leida.motivo, lang)); return; }
      setFoto(await subirFoto(createClient(), ctx.yo.id, leida.jpg));
    } catch (x) { setError(mensajeDeError(x)); } finally { setLeyendo(false); }
  };
  const guardar = async () => {
    if (!val.ok) return;
    setGuardando(true); setError(null);
    try {
      if (!ctx.demo) await registrarLinea(createClient(), { lineaId: l.id, cajas: val.cajas, sueltas: val.sueltas, total: porCajas ? null : val.total, nota, foto });
      onGuardada({ ...l, counted_boxes: val.cajas, counted_pieces: val.sueltas, counted_total: val.total, counted_by: ctx.yo.id, counted_by_name: ctx.yo.full_name, counted_at: new Date().toISOString(), note: nota.trim() || null, photo: foto, recount_requested: false });
    } catch (x) { setError(mensajeDeError(x)); } finally { setGuardando(false); }
  };
  return (
    <div className="overlay" onClick={onCerrar}>
      <div className="modal ops-tarjeta-reporte" onClick={(x) => x.stopPropagation()} role="dialog" aria-modal="true" data-form-linea={l.id}>
        <CerrarX onCerrar={onCerrar} />
        <h3><span className="hoja-folio">{l.sku}</span></h3>
        <p className="sub">{l.name}{l.size_in ? ` · ${l.size_in}` : ""}</p>
        {l.recount_requested && <p className="ops-aviso ops-aviso-pendiente" data-recontar>↩ {t("Manager asked for a recount", "El gerente pidió recontar")}{l.recount_note && `: ${l.recount_note}`}</p>}
        <div className="ops-formulario">
          {porCajas ? (
            <>
              <div className="ops-dos ops-opciones">
                <label className="ops-cantidad"><span>{t("Full boxes", "Cajas completas")}</span><input className="ops-campo ops-campo-grande" inputMode="numeric" value={cajas} onChange={(e) => setCajas(e.target.value)} data-campo="cajas" autoFocus /></label>
                <label className="ops-cantidad"><span>{t("Loose pieces", "Piezas sueltas")}</span><input className="ops-campo ops-campo-grande" inputMode="numeric" value={sueltas} onChange={(e) => setSueltas(e.target.value)} data-campo="sueltas" /></label>
              </div>
              <p className="ops-total-linea" data-total={val.ok ? val.total : ""}>{l.pieces_per_box} {t("pcs per box", "pzas por caja")} → <b>{val.ok ? val.total : "—"}</b> {t("pieces", "piezas")}</p>
            </>
          ) : (
            <label className="ops-cantidad"><span>{t("Total counted (pieces)", "Total contado (piezas)")}</span><input className="ops-campo ops-campo-grande" inputMode="numeric" value={total} onChange={(e) => setTotal(e.target.value)} data-campo="total" autoFocus /></label>
          )}
          <label className="ops-cantidad"><span>{t("Note (optional)", "Nota (opcional)")}</span><input className="ops-campo" value={nota} onChange={(e) => setNota(e.target.value)} placeholder={t("e.g. 3 broken, on the top rack", "p. ej. 3 rotas, en el rack de arriba")} data-campo="nota-linea" /></label>
          <div className="ops-fotos">
            <span className="ops-cantidad">{t("Photo (optional)", "Foto (opcional)")}</span>
            {foto && <p className="ops-insignia">📷 {foto.split("/").pop()} <button type="button" className="btn btn-sm" onClick={() => setFoto(null)} data-accion="quitar-foto">✕</button></p>}
            {!foto && <BotonesDeFoto onFoto={tomar} leyendo={leyendo} etiquetaCamara={t("Take a photo", "Tomar foto")} primario={false} />}
          </div>
        </div>
        {!val.ok && (cajas || sueltas || total) && <p className="hint" data-motivo={val.motivo}>{motivoDeCaptura(val.motivo, lang)}</p>}
        {error && <p className="ops-aviso ops-aviso-error" role="alert">{error}</p>}
        <div className="modal-actions">
          <button type="button" className="btn" onClick={onCerrar} disabled={guardando}>{t("Cancel", "Cancelar")}</button>
          <button type="button" className="btn btn-primary" onClick={() => void guardar()} disabled={!val.ok || guardando || leyendo} data-accion="guardar-linea">{guardando ? t("Saving…", "Guardando…") : t("Save count", "Guardar conteo")}</button>
        </div>
      </div>
    </div>
  );
}
