"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { usePrefs } from "@/lib/prefs";
import { CampoDecimal } from "@/components/CampoDecimal";
import { createClient } from "@/lib/supabase/client";
import { createClient as createErpClient } from "@/lib/erp/supabase/client";
import {
  apellidoDe, borradorVacio, cajasDeLinea, cajasPorDefecto, claveDeEstimado, dinero, lineaSfVacia, lineaUnidadVacia,
  numero, paraQuienSeImprime, SALUTATIONS, sfReal, totalDeLinea, totalDeMateriales,
  type DisplayLevel, type QuoteDraft, type QuoteLine, type Salutation,
} from "@/lib/estimator/modelo";
import { hojaDelCliente } from "@/lib/estimator/hoja";
import {
  estadoDelEstimado, lineasCortas, loQueFalta, puedeGuardar, TEXTO_DE_FALTA, type EstimadoHallado,
} from "@/lib/estimator/validar";
import {
  almacenDeLaBase, buscarEnCatalogo, type AlmacenDeCotizaciones, type AprobacionPendiente, type ProductoDelCatalogo,
} from "@/lib/estimator/almacen";
import { almacenDeCompetenciaDemo, almacenDemo, buscarEnCatalogoDemo } from "@/lib/estimator/demo";
import { almacenDeCompetenciaDeLaBase, type AlmacenDeCompetencia } from "@/lib/estimator/competencia";
import {
  POLITICA_CASILLA, POLITICA_PARRAFOS, POLITICA_PARRAFOS_ES, POLITICA_TITULO, sePuedeGenerar, sePuedePedirLaCopia,
} from "@/lib/estimator/politica";
import { HojaCliente } from "./HojaCliente";
import { SeccionCompetencia } from "./Competencia";

/** Donde el modo demo guarda quién eres: la misma clave que escribe «Ver como» (y que lee promos). */
const ME_DEMO = "rtg_deliveries_local_me";
const claveDeExtension = (id: string) => `rtg_estimator_ext_${id}`;

type Yo = { id: string; name: string; admin: boolean };
type Aviso = { tipo: "verde" | "ambar" | "rojo"; texto: string } | null;

/**
 * El Estimador (T-0408): **Entradas internas → Salida al cliente**.
 *
 * Todo lo que decide vive en `lib/estimator` y está probado sin navegador: los cálculos (`modelo`),
 * qué ve el cliente (`hoja`), qué falta y quién puede (`validar`), la política (`politica`) y dónde se
 * guarda (`almacen`, o `demo`). Este componente los conecta.
 *
 * Sin la migración 148 aplicada, se arma e imprime igual —y se dice que no se guarda ni se comprueba
 * el dueño del estimado—, como la prioridad sin la 147.
 */
export function Estimador({ me: meServidor, demo }: { me: Yo | null; demo: boolean }) {
  const { t, lang } = usePrefs();

  // ---- quién soy (en demo, «Ver como») --------------------------------------------------------
  const [me, setMe] = useState<Yo | null>(meServidor);
  const meRef = useRef<Yo>(meServidor ?? { id: "", name: "", admin: false });
  useEffect(() => {
    if (!demo) return;
    const lee = () => {
      try {
        const crudo = localStorage.getItem(ME_DEMO);
        const m = crudo ? JSON.parse(crudo) : null;
        setMe(m && typeof m.id === "string"
          ? { id: m.id, name: typeof m.full_name === "string" ? m.full_name : m.id, admin: m.role === "admin" }
          : { id: "u-admin", name: "You (Admin)", admin: true });
      } catch { setMe({ id: "u-admin", name: "You (Admin)", admin: true }); }
    };
    lee();
    window.addEventListener("focus", lee);
    return () => window.removeEventListener("focus", lee);
  }, [demo]);
  useEffect(() => { if (me) meRef.current = me; }, [me]);

  // ---- dónde se guarda --------------------------------------------------------------------------
  const [sinTablaDemo, setSinTablaDemo] = useState(false);
  useEffect(() => {
    if (demo) setSinTablaDemo(new URLSearchParams(window.location.search).get("sinTabla") === "1");
  }, [demo]);
  const almacen: AlmacenDeCotizaciones = useMemo(
    () => (demo ? almacenDemo(() => meRef.current, sinTablaDemo) : almacenDeLaBase(createClient())),
    [demo, sinTablaDemo],
  );
  // El estimado de la competencia (D-NEXT): su propia tabla y su cubo (153), con la misma pareja base/demo.
  const almacenCompetencia: AlmacenDeCompetencia = useMemo(
    () => (demo ? almacenDeCompetenciaDemo(() => meRef.current, sinTablaDemo) : almacenDeCompetenciaDeLaBase(createClient())),
    [demo, sinTablaDemo],
  );
  const erp = useMemo(() => (demo ? null : createErpClient()), [demo]);

  /** null = aún no se sabe; false = la 148 no está aplicada. */
  const [baseDisponible, setBaseDisponible] = useState<boolean | null>(null);
  const [pendientes, setPendientes] = useState<AprobacionPendiente[]>([]);
  const [aviso, setAviso] = useState<Aviso>(null);

  const cargarPendientes = useCallback(async () => {
    const r = await almacen.pendientes();
    if (r.ok) { setBaseDisponible(true); setPendientes(r.valor); return; }
    if (r.sinTabla) { setBaseDisponible(false); return; }
    setBaseDisponible(true);
    setAviso({ tipo: "rojo", texto: `${t("Could not read approval requests", "No se pudieron leer las aprobaciones")}: ${r.error}` });
  }, [almacen, t]);
  useEffect(() => { if (me) void cargarPendientes(); }, [cargarPendientes, me]);

  // ---- el borrador ------------------------------------------------------------------------------
  const [draft, setDraft] = useState<QuoteDraft>(() => borradorVacio());
  const [quoteId, setQuoteId] = useState<string | null>(null);
  const [printCount, setPrintCount] = useState(0);
  const [busqueda, setBusqueda] = useState<{ num: string; hallado: EstimadoHallado | null } | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [catalogo, setCatalogo] = useState<Record<string, ProductoDelCatalogo[] | "nada">>({});
  const [politicaAbierta, setPoliticaAbierta] = useState(false);
  const [politicaMarcada, setPoliticaMarcada] = useState(false);
  const [vistaPrevia, setVistaPrevia] = useState(false);

  // La extensión se recuerda por persona en este navegador: es suya, no de la cotización.
  useEffect(() => {
    if (!me) return;
    try {
      const ext = localStorage.getItem(claveDeExtension(me.id));
      if (ext) setDraft((d) => (d.sales_ext ? d : { ...d, sales_ext: ext }));
    } catch { /* sin almacenamiento: se escribe a mano */ }
  }, [me]);

  const set = <K extends keyof QuoteDraft>(k: K, v: QuoteDraft[K]) => setDraft((d) => ({ ...d, [k]: v }));
  const setCliente = (patch: Partial<QuoteDraft["customer"]>) => setDraft((d) => ({ ...d, customer: { ...d.customer, ...patch } }));
  const setEntrega = (patch: Partial<QuoteDraft["delivery"]>) => setDraft((d) => ({ ...d, delivery: { ...d.delivery, ...patch } }));
  const setLinea = (id: string, patch: Partial<QuoteLine>) =>
    setDraft((d) => ({ ...d, lines: d.lines.map((l) => (l.id === id ? ({ ...l, ...patch } as QuoteLine) : l)) }));

  const buscado = busqueda !== null && claveDeEstimado(busqueda.num) === claveDeEstimado(draft.estimate_num);
  const hallado = buscado ? busqueda!.hallado : null;
  const estado = estadoDelEstimado({
    baseDisponible: baseDisponible !== false, buscado, hallado, meId: me?.id ?? null, esAdmin: me?.admin ?? false,
  });
  const faltas = loQueFalta(draft, estado);
  const cortas = lineasCortas(draft);
  const total = totalDeMateriales(draft.lines);

  // ---- acciones -------------------------------------------------------------------------------------
  const buscar = async () => {
    const num = draft.estimate_num.trim();
    if (!num) return;
    setOcupado(true);
    setAviso(null);
    const r = await almacen.buscar(num);
    setOcupado(false);
    if (!r.ok) {
      if (r.sinTabla) { setBaseDisponible(false); return; }
      setAviso({ tipo: "rojo", texto: `${t("Search failed", "Falló la búsqueda")}: ${r.error}` });
      return;
    }
    setBusqueda({ num, hallado: r.valor });
    const h = r.valor;
    if (!h) {
      setQuoteId(null);
      setPrintCount(0);
      setAviso({ tipo: "verde", texto: t("No quote exists for this estimate yet. When you save, you will be its owner.", "Todavía no hay cotización para este estimado. Al guardar, quedas como su dueño.") });
      return;
    }
    const puedeAbrir = h.owner_id === me?.id || me?.admin || h.my_approval === "approved";
    if (!puedeAbrir) {
      setQuoteId(null);
      setAviso({ tipo: "ambar", texto: t(`This estimate belongs to ${h.owner_name ?? "another rep"}. You need their approval before you prepare a quote for it.`, `Este estimado es de ${h.owner_name ?? "otro vendedor"}. Necesitas su aprobación antes de preparar una cotización.`) });
      return;
    }
    const c = await almacen.cargar(h.quote_id);
    if (!c.ok) { setAviso({ tipo: "rojo", texto: `${t("Could not open the quote", "No se pudo abrir la cotización")}: ${c.error}` }); return; }
    setDraft(c.valor.draft);
    setQuoteId(c.valor.id);
    setPrintCount(c.valor.print_count);
    setAviso({ tipo: "verde", texto: t("Saved quote opened. Changes replace it: one quote per estimate.", "Cotización guardada abierta. Los cambios la reemplazan: una cotización por estimado.") });
  };

  const guardar = async (): Promise<string | null> => {
    if (!me || !puedeGuardar(draft, estado)) return null;
    setOcupado(true);
    const r = await almacen.guardar(quoteId, draft);
    setOcupado(false);
    if (!r.ok) {
      if (r.sinTabla) { setBaseDisponible(false); return null; }
      if (r.duplicado) {
        setBusqueda(null);
        setAviso({ tipo: "rojo", texto: t("Someone else just saved a quote for this estimate. Search it again.", "Alguien acaba de guardar una cotización para este estimado. Búscalo otra vez.") });
        return null;
      }
      setAviso({ tipo: "rojo", texto: `${t("Not saved", "No se guardó")}: ${r.error}` });
      return null;
    }
    setQuoteId(r.valor);
    if (!hallado) {
      setBusqueda({ num: draft.estimate_num.trim(), hallado: { quote_id: r.valor, estimate_num: draft.estimate_num.trim(), owner_id: me.id, owner_name: me.name, owner_store: null, my_approval_id: null, my_approval: null } });
    }
    setAviso({ tipo: "verde", texto: t("Saved.", "Guardada.") });
    return r.valor;
  };

  const pedirAprobacion = async () => {
    if (!hallado) return;
    setOcupado(true);
    const r = await almacen.pedirAprobacion(hallado.quote_id, hallado.my_approval_id);
    setOcupado(false);
    if (!r.ok) { setAviso({ tipo: "rojo", texto: `${t("Request failed", "No se pudo pedir")}: ${r.error}` }); return; }
    setAviso({ tipo: "ambar", texto: t(`Approval requested from ${hallado.owner_name ?? "the owner"}. Search again once they approve.`, `Aprobación pedida a ${hallado.owner_name ?? "el dueño"}. Vuelve a buscar cuando la dé.`) });
    await buscar();
  };

  const decidir = async (a: AprobacionPendiente, st: "approved" | "denied") => {
    const r = await almacen.decidir(a.approval_id, st);
    if (!r.ok) { setAviso({ tipo: "rojo", texto: `${t("Not saved", "No se guardó")}: ${r.error}` }); return; }
    await cargarPendientes();
  };

  const abrirPolitica = () => {
    if (!sePuedePedirLaCopia(faltas)) return;
    setPoliticaMarcada(false);
    setPoliticaAbierta(true);
  };

  const generar = async () => {
    if (!sePuedeGenerar(faltas, politicaMarcada)) return;
    setPoliticaAbierta(false);
    // Con base, la copia queda registrada: se guarda la cotización y se cuenta la impresión.
    if (estado !== "sin-base") {
      const id = await guardar();
      if (id) {
        const r = await almacen.marcarImpresa(id, printCount + 1);
        if (r.ok) setPrintCount(printCount + 1);
      }
    }
    setVistaPrevia(true);
  };

  const buscarProducto = async (l: QuoteLine) => {
    const code = l.item_code.trim();
    if (!code) return;
    const res = demo ? buscarEnCatalogoDemo(code) : erp ? await buscarEnCatalogo(erp, code) : [];
    setCatalogo((c) => ({ ...c, [l.id]: res.length ? res : "nada" }));
  };

  const elegirProducto = (l: QuoteLine, p: ProductoDelCatalogo) => {
    const patch: Partial<QuoteLine> = {
      item_code: p.sku,
      internal_description: p.name,
      customer_category: l.customer_category || (p.size_in ? `${p.size_in} Tile` : ""),
    };
    if (l.kind === "sf") Object.assign(patch, { sf_per_box: p.sf_per_box ?? l.sf_per_box, price_per_sf: p.price_per_sf ?? l.price_per_sf });
    setLinea(l.id, patch);
    setCatalogo((c) => { const n = { ...c }; delete n[l.id]; return n; });
  };

  const hoja = useMemo(() => hojaDelCliente(draft), [draft]);

  if (!me) {
    return <div className="est-wrap"><p className="hint">{t("Loading…", "Cargando…")}</p></div>;
  }

  // ---- pintado --------------------------------------------------------------------------------------
  // Los campos de número van por `CampoDecimal`: pintar `String(n)` en cada tecla se comía el punto (D-420).
  const inv = (vacio: boolean) => (vacio ? "invalid" : undefined);

  return (
    <div className="est-wrap">
      <p style={{ margin: "0 0 8px" }}>
        <Link href="/home" className="btn btn-ghost btn-sm">◂ {t("Back to hub", "Volver al hub")}</Link>
      </p>
      <h1>🧮 {t("Quote Builder", "Cotizador")}</h1>
      <p className="hint" style={{ marginTop: 0 }}>
        {t("Internal inputs → customer output. Only the customer sheet is printed.", "Entradas internas → salida al cliente. Solo se imprime la hoja del cliente.")}
        {demo && <> · <b>{t("Demo mode: made-up data", "Modo demo: datos inventados")}</b></>}
      </p>

      {baseDisponible === false && (
        <div className="est-aviso ambar" data-aviso-sin-base>
          {t(
            "Saving is not available yet: the database has not been updated (migration 148). You can build and print this quote, but it will not be saved and the estimate owner cannot be checked — search the estimate yourself before you print.",
            "Todavía no se puede guardar: la base no está actualizada (migración 148). Puedes armar e imprimir esta cotización, pero no se guardará ni se puede comprobar el dueño del estimado: búscalo tú antes de imprimir.",
          )}
        </div>
      )}
      {aviso && <div className={`est-aviso ${aviso.tipo}`} data-aviso>{aviso.texto}</div>}

      {pendientes.length > 0 && (
        <div className="card" data-pendientes>
          <h2>✋ {t("Approval requests for your estimates", "Te piden aprobación en tus estimados")}</h2>
          {pendientes.map((a) => (
            <div key={a.approval_id} className="est-acciones" style={{ marginBottom: 8 }}>
              <span><b>{a.estimate_num}</b> · {a.requester_name ?? "?"}</span>
              <button className="btn btn-green btn-sm" onClick={() => decidir(a, "approved")}>{t("Approve", "Aprobar")}</button>
              <button className="btn btn-danger btn-sm" onClick={() => decidir(a, "denied")}>{t("Deny", "Negar")}</button>
            </div>
          ))}
        </div>
      )}

      {/* 1-2. Estimado y vendedor */}
      <div className="card">
        <h2>🔎 {t("Estimate", "Estimado")}</h2>
        <div className="grid g3">
          <div className="field">
            <label htmlFor="est-num">{t("Estimate #", "# de estimado")}</label>
            <div style={{ display: "flex", gap: 6 }}>
              <input id="est-num" value={draft.estimate_num} className={inv(!draft.estimate_num.trim())}
                onChange={(e) => set("estimate_num", e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") void buscar(); }} />
              <button className="btn btn-primary" data-buscar disabled={ocupado || !draft.estimate_num.trim() || baseDisponible === false} onClick={buscar}>
                {t("Search", "Buscar")}
              </button>
            </div>
          </div>
          <div className="field">
            <label>{t("Original sales rep", "Vendedor original")}</label>
            <div data-dueno style={{ padding: "8px 0", fontWeight: 600 }}>
              {estado === "sin-base" ? t("Cannot be checked", "No se puede comprobar")
                : !buscado ? t("Search the estimate first", "Busca primero el estimado")
                : hallado ? (hallado.owner_name ?? "?") : `${me.name} (${t("you", "tú")})`}
            </div>
          </div>
          <div className="field">
            <label>{t("Prepared by", "Preparada por")}</label>
            <div style={{ padding: "8px 0", fontWeight: 600 }}>{me.name}</div>
          </div>
        </div>
        {buscado && hallado && (estado === "sin-pedir" || estado === "denegada" || estado === "pendiente") && (
          <div className="est-acciones" data-aprobacion>
            <span>
              {estado === "pendiente" ? t("Waiting for the owner's approval.", "Esperando la aprobación del dueño.")
                : estado === "denegada" ? t("The owner denied your request.", "El dueño negó tu petición.")
                : t("You need the owner's approval.", "Necesitas la aprobación del dueño.")}
            </span>
            {estado !== "pendiente" && (
              <button className="btn btn-amber btn-sm" disabled={ocupado} onClick={pedirAprobacion}>
                {estado === "denegada" ? t("Ask again", "Volver a pedir") : t("Request approval", "Pedir aprobación")}
              </button>
            )}
          </div>
        )}
        <div className="grid g3">
          <div className="field">
            <label htmlFor="est-ext">{t("Your extension (customer sees “Ext. NNN”)", "Tu extensión (el cliente ve «Ext. NNN»)")}</label>
            <input id="est-ext" value={draft.sales_ext} className={inv(!draft.sales_ext.trim())}
              onChange={(e) => {
                set("sales_ext", e.target.value);
                try { localStorage.setItem(claveDeExtension(me.id), e.target.value); } catch { /* nada */ }
              }} />
          </div>
        </div>
      </div>

      {/* 1. Cliente */}
      <div className="card">
        <h2>👤 {t("Customer (internal)", "Cliente (interno)")}</h2>
        <div className="grid g4">
          <div className="field">
            <label htmlFor="est-trat">{t("Title", "Tratamiento")}</label>
            <select id="est-trat" value={draft.customer.salutation} onChange={(e) => setCliente({ salutation: e.target.value as Salutation })}>
              {SALUTATIONS.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
          <div className="field">
            <label htmlFor="est-nombre">{t("Full name", "Nombre completo")}</label>
            <input id="est-nombre" value={draft.customer.full_name} className={inv(!draft.customer.full_name.trim())}
              onChange={(e) => {
                const full_name = e.target.value;
                setCliente(draft.customer.last_name_edited ? { full_name } : { full_name, last_name: apellidoDe(full_name) });
              }} />
          </div>
          <div className="field">
            <label htmlFor="est-apellido">{t("Last name as printed", "Apellido que se imprime")}</label>
            <input id="est-apellido" value={draft.customer.last_name} className={inv(!draft.customer.last_name.trim())}
              onChange={(e) => setCliente({ last_name: e.target.value, last_name_edited: true })} />
          </div>
          <div className="field">
            <label htmlFor="est-empresa">{t("Company", "Empresa")}</label>
            <input id="est-empresa" value={draft.customer.company} onChange={(e) => setCliente({ company: e.target.value })} />
          </div>
          <div className="field">
            <label htmlFor="est-tel">{t("Phone", "Teléfono")}</label>
            <input id="est-tel" value={draft.customer.phone} onChange={(e) => setCliente({ phone: e.target.value })} />
          </div>
          <div className="field" style={{ gridColumn: "span 3" }}>
            <label htmlFor="est-dir">{t("Address", "Dirección")}</label>
            <input id="est-dir" value={draft.customer.address} onChange={(e) => setCliente({ address: e.target.value })} />
          </div>
        </div>
        <div className="est-ve-cliente" data-ve-cliente>
          {t("Customer sees only:", "El cliente solo ve:")} <b>{paraQuienSeImprime(draft.customer) || "—"}</b>.{" "}
          {t("Company, phone and address are never printed.", "Empresa, teléfono y dirección no se imprimen nunca.")}
        </div>
      </div>

      {/* 3. Productos */}
      <div className="card">
        <h2>🧱 {t("Products", "Productos")}</h2>
        {draft.lines.map((l, i) => {
          const res = catalogo[l.id];
          const tot = totalDeLinea(l);
          return (
            <div key={l.id} className="est-linea" data-linea={i}>
              <div className="est-linea-cab">
                <span>{t("Line", "Línea")} {i + 1} · {l.kind === "sf" ? t("by square foot", "por pie cuadrado") : t("no square feet (lot, each…)", "sin pies cuadrados (lote, pieza…)")}</span>
                <button className="btn btn-danger btn-sm" onClick={() => set("lines", draft.lines.filter((x) => x.id !== l.id))}>✕</button>
              </div>
              <div className="grid g4">
                <div className="field">
                  <label>{t("Item code", "Código")}</label>
                  <div style={{ display: "flex", gap: 6 }}>
                    <input value={l.item_code} data-codigo onChange={(e) => setLinea(l.id, { item_code: e.target.value })}
                      onKeyDown={(e) => { if (e.key === "Enter") void buscarProducto(l); }} />
                    <button className="btn btn-ghost btn-sm" title={t("Look up in catalog", "Buscar en el catálogo")} onClick={() => buscarProducto(l)}>🔍</button>
                  </div>
                </div>
                <div className="field" style={{ gridColumn: "span 3" }}>
                  <label>{t("Internal description", "Descripción interna")}</label>
                  <input value={l.internal_description} onChange={(e) => setLinea(l.id, { internal_description: e.target.value })} />
                </div>
              </div>
              {res === "nada" && (
                <p className="hint" style={{ margin: "0 0 8px" }}>
                  {t("Not found in the catalog (or you have no ERP access): type it in.", "No está en el catálogo (o no tienes el ERP): escríbelo a mano.")}
                </p>
              )}
              {Array.isArray(res) && (
                <div className="est-acciones" style={{ marginBottom: 8 }}>
                  {res.map((p) => (
                    <button key={p.sku} className="chip" onClick={() => elegirProducto(l, p)}>{p.sku} · {p.name}</button>
                  ))}
                </div>
              )}
              <div className="grid g4">
                <div className="field">
                  <label>{t("Customer category", "Categoría para el cliente")}</label>
                  <input value={l.customer_category} placeholder="24x48 Tile" className={inv(!l.customer_category.trim())}
                    onChange={(e) => setLinea(l.id, { customer_category: e.target.value })} />
                </div>
                <div className="field">
                  <label>{t("Customer note", "Nota para el cliente")}</label>
                  <input value={l.customer_note} placeholder="Main Floor" onChange={(e) => setLinea(l.id, { customer_note: e.target.value })} />
                </div>
                {l.kind === "sf" ? (
                  <>
                    <div className="field">
                      <label>{t("Requested SF", "SF pedidos")}</label>
                      <CampoDecimal value={l.requested_sf} data-requested
                        onValor={(n) => setLinea(l.id, { requested_sf: n })} />
                    </div>
                    <div className="field">
                      <label>{t("SF / box", "SF / caja")}</label>
                      <CampoDecimal value={l.sf_per_box} data-sfcaja
                        onValor={(n) => setLinea(l.id, { sf_per_box: n })} />
                    </div>
                    <div className="field">
                      <label>{t("Boxes", "Cajas")}</label>
                      <CampoDecimal inputMode="numeric" value={l.boxes} data-cajas
                        placeholder={String(cajasPorDefecto(l.requested_sf, l.sf_per_box) ?? "")}
                        onValor={(n) => setLinea(l.id, { boxes: n })} />
                    </div>
                    <div className="field">
                      <label>{t("Internal $/SF", "$/SF interno")}</label>
                      <CampoDecimal value={l.price_per_sf} data-precio
                        onValor={(n) => setLinea(l.id, { price_per_sf: n })} />
                    </div>
                  </>
                ) : (
                  <>
                    <div className="field">
                      <label>{t("Quantity", "Cantidad")}</label>
                      <CampoDecimal value={l.quantity} onValor={(n) => setLinea(l.id, { quantity: n })} />
                    </div>
                    <div className="field">
                      <label>{t("Unit", "Unidad")}</label>
                      <input value={l.unit} onChange={(e) => setLinea(l.id, { unit: e.target.value })} />
                    </div>
                    <div className="field">
                      <label>{t("Unit price", "Precio unitario")}</label>
                      <CampoDecimal value={l.unit_price} onValor={(n) => setLinea(l.id, { unit_price: n })} />
                    </div>
                  </>
                )}
              </div>
              <div className="est-calc" data-calc>
                {l.kind === "sf" && (
                  <>
                    <span>{t("Boxes", "Cajas")}: <b data-cajas-calc>{cajasDeLinea(l) ?? "—"}</b>{l.boxes === null && cajasDeLinea(l) !== null ? ` (${t("full boxes", "cajas completas")})` : ""}</span>
                    <span>{t("Actual SF", "SF real")}: <b data-sfreal>{sfReal(l) !== null ? numero(sfReal(l)!, 2) : "—"}</b></span>
                  </>
                )}
                <span>{t("Line total", "Total de línea")}: <b data-total-linea>{tot !== null ? dinero(tot) : "—"}</b></span>
              </div>
              {cortas.includes(l.id) && (
                <p className="hint" style={{ color: "var(--red)", margin: "6px 0 0" }}>
                  {t("These boxes cover less than the requested area.", "Estas cajas cubren menos que el área pedida.")}
                </p>
              )}
            </div>
          );
        })}
        <div className="est-acciones">
          <button className="btn btn-ghost btn-sm" data-anadir-sf onClick={() => set("lines", [...draft.lines, lineaSfVacia()])}>+ {t("Product by SF", "Producto por SF")}</button>
          <button className="btn btn-ghost btn-sm" data-anadir-lote onClick={() => set("lines", [...draft.lines, lineaUnidadVacia()])}>+ {t("Other line (lot, each…)", "Otra línea (lote, pieza…)")}</button>
        </div>
      </div>

      {/* 4. Entrega */}
      <div className="card">
        <h2>🚚 {t("Delivery", "Entrega")}</h2>
        <div className="est-radios" style={{ marginBottom: 10 }}>
          <label><input type="radio" name="entrega" checked={draft.delivery.mode === "pickup"} onChange={() => setEntrega({ mode: "pickup" })} /> {t("Pickup", "Recoge")}</label>
          <label><input type="radio" name="entrega" data-entrega checked={draft.delivery.mode === "delivery"} onChange={() => setEntrega({ mode: "delivery" })} /> {t("Delivery", "Entrega")}</label>
        </div>
        {draft.delivery.mode === "delivery" && (
          <>
            <div className="grid g4">
              <div className="field" style={{ gridColumn: "span 2" }}>
                <label>{t("Street", "Calle")}</label>
                <input value={draft.delivery.street} data-calle className={inv(!draft.delivery.street.trim())} onChange={(e) => setEntrega({ street: e.target.value })} />
              </div>
              <div className="field">
                <label>{t("City", "Ciudad")}</label>
                <input value={draft.delivery.city} data-ciudad className={inv(!draft.delivery.city.trim())} onChange={(e) => setEntrega({ city: e.target.value })} />
              </div>
              <div className="field">
                <label>{t("State", "Estado")}</label>
                <input value={draft.delivery.state} data-estado className={inv(!draft.delivery.state.trim())} onChange={(e) => setEntrega({ state: e.target.value })} />
              </div>
              <div className="field">
                <label>ZIP</label>
                <input value={draft.delivery.zip} data-zip className={inv(!draft.delivery.zip.trim())} onChange={(e) => setEntrega({ zip: e.target.value })} />
              </div>
              <div className="field">
                <label>{t("Delivery charge (internal)", "Cargo de entrega (interno)")}</label>
                <CampoDecimal value={draft.delivery.charge} data-cargo onValor={(n) => setEntrega({ charge: n })} />
              </div>
            </div>
            <p className="hint" style={{ margin: 0 }}>
              {t("The address is not printed and the charge is NOT added to the total. The customer reads: “Delivery: Available upon request…”.", "La dirección no se imprime y el cargo NO se suma al total. El cliente lee: «Delivery: Available upon request…».")}
            </p>
          </>
        )}
      </div>

      {/* Interno: el estimado de la competencia. Fuera de la hoja del cliente, y escondido al imprimir. */}
      <SeccionCompetencia almacen={almacenCompetencia} quoteId={quoteId} me={me} baseCotizaciones={baseDisponible} t={t} lang={lang} />

      {/* 5-7. La copia del cliente */}
      <div className="card">
        <h2>🖨️ {t("Customer copy", "Copia del cliente")}</h2>
        <div className="field">
          <label>{t("Customer display level", "Nivel de detalle para el cliente")}</label>
          <div className="est-radios">
            {([
              ["basic", t("Basic — total + requested area", "Basic — total + área pedida")],
              ["standard", t("Standard — + boxes", "Standard — + cajas")],
              ["detailed", t("Detailed — + boxes + coverage (SF/box)", "Detailed — + cajas + cobertura (SF/caja)")],
            ] as [DisplayLevel, string][]).map(([k, txt]) => (
              <label key={k}><input type="radio" name="nivel" data-nivel={k} checked={draft.display_level === k} onChange={() => set("display_level", k)} /> {txt}</label>
            ))}
          </div>
        </div>
        <div className="grid g3">
          <div className="field">
            <label htmlFor="est-valida">{t("Valid through", "Válida hasta")}</label>
            <input id="est-valida" type="date" value={draft.valid_through} onChange={(e) => set("valid_through", e.target.value)} />
          </div>
          <div className="field" style={{ gridColumn: "span 2" }}>
            <label htmlFor="est-resumen">{t("Project summary (optional, printed)", "Resumen del proyecto (opcional, se imprime)")}</label>
            <input id="est-resumen" value={draft.project_summary} onChange={(e) => set("project_summary", e.target.value)} />
          </div>
        </div>
        <div className="est-acciones" style={{ justifyContent: "space-between" }}>
          <div>
            <div className="est-total" data-total>{t("Estimated Material Total", "Total estimado de materiales")}: {dinero(total)}</div>
            {draft.delivery.mode === "delivery" && draft.delivery.charge !== null && (
              <div className="hint" data-cargo-fuera>{t("Delivery charge, not included", "Cargo de entrega, no incluido")}: {dinero(draft.delivery.charge)}</div>
            )}
          </div>
          <div className="est-acciones">
            {estado !== "sin-base" && (
              <button className="btn btn-ghost" data-guardar disabled={ocupado || !puedeGuardar(draft, estado)} onClick={() => void guardar()}>
                💾 {t("Save", "Guardar")}
              </button>
            )}
            <button className="btn btn-primary" data-generar disabled={ocupado || !sePuedePedirLaCopia(faltas)} onClick={abrirPolitica}>
              {t("Generate customer copy", "Generar copia del cliente")}
            </button>
          </div>
        </div>
        {faltas.length > 0 && (
          <ul className="est-faltas" data-faltas>
            {faltas.map((f) => <li key={f}>{lang === "es" ? TEXTO_DE_FALTA[f].es : TEXTO_DE_FALTA[f].en}</li>)}
          </ul>
        )}
      </div>

      {/* 6. La política, con casilla obligatoria */}
      {politicaAbierta && (
        <div className="overlay" onClick={() => setPoliticaAbierta(false)}>
          <div className="modal est-politica" style={{ maxWidth: 560 }} onClick={(e) => e.stopPropagation()} data-politica>
            <h3>{POLITICA_TITULO}</h3>
            {POLITICA_PARRAFOS.map((p, i) => (
              <p key={i}>{p}{lang === "es" && <><br /><span className="hint">{POLITICA_PARRAFOS_ES[i]}</span></>}</p>
            ))}
            <label className="check">
              <input type="checkbox" data-casilla checked={politicaMarcada} onChange={(e) => setPoliticaMarcada(e.target.checked)} />
              <span>{POLITICA_CASILLA}</span>
            </label>
            <div className="modal-actions">
              <button className="btn btn-ghost" onClick={() => setPoliticaAbierta(false)}>{t("Cancel", "Cancelar")}</button>
              <button className="btn btn-primary" data-continuar disabled={!sePuedeGenerar(faltas, politicaMarcada)} onClick={() => void generar()}>
                {t("Continue", "Continuar")}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 7. La hoja, lista para imprimir */}
      {vistaPrevia && (
        <div className="est-vista-previa" data-vista-previa>
          <div className="est-barra">
            <button className="btn btn-primary" data-imprimir onClick={() => window.print()}>🖨️ {t("Print", "Imprimir")}</button>
            <button className="btn btn-ghost" style={{ background: "#fff" }} onClick={() => setVistaPrevia(false)}>◂ {t("Back to edit", "Volver a editar")}</button>
          </div>
          <HojaCliente hoja={hoja} />
        </div>
      )}
    </div>
  );
}
