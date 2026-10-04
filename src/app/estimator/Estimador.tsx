"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { usePrefs } from "@/lib/prefs";
import { CampoDecimal } from "@/components/CampoDecimal";
import { createClient } from "@/lib/supabase/client";
import { createClient as createErpClient } from "@/lib/erp/supabase/client";
import {
  borradorVacio, cajasDeLinea, cajasPorDefecto, claveDeEstimado, dinero, extensionDePartida, lineaSfVacia, lineaUnidadVacia,
  estadoDelPrecioBajo, numero, paraQuienSeImprime, porcentajeDeDescuento, preciosDeLinea, resumenDeTotales, SALUTATIONS,
  sfReal, telefonoAlEscribir, telefonoLimpio, totalDeLinea, totalRegularDeLinea,
  type DisplayLevel, type QuoteDraft, type QuoteLine, type Salutation,
} from "@/lib/estimator/modelo";
import { tiendaDePartida, type AjustesDeEntrega } from "@/lib/estimator/entrega";
import { hojaDelCliente, tiendaDeLaHoja } from "@/lib/estimator/hoja";
import {
  estadoDelEstimado, trasComprobar, lineasCortas, loQueFalta, puedeGuardar, puedeTrabajar, TEXTO_DE_FALTA, type EstimadoHallado,
} from "@/lib/estimator/validar";
import {
  almacenDeLaBase, buscarEnCatalogo, type AlmacenDeCotizaciones, type AprobacionPendiente, type ProductoDelCatalogo,
} from "@/lib/estimator/almacen";
import { almacenDeCompetenciaDemo, almacenDeLecturasDemo, almacenDemo, buscarEnCatalogoDemo, extensionDemo } from "@/lib/estimator/demo";
import { almacenDeCompetenciaDeLaBase, type AlmacenDeCompetencia } from "@/lib/estimator/competencia";
import { almacenDeLecturasDeLaBase, lineasPropias, type AlmacenDeLecturas } from "@/lib/estimator/lectura";
import {
  POLITICA_CASILLA, POLITICA_PARRAFOS, POLITICA_PARRAFOS_ES, POLITICA_TITULO, sePuedeGenerar, sePuedePedirLaCopia,
} from "@/lib/estimator/politica";
import { HojaCliente } from "./HojaCliente";
import { SeccionCompetencia } from "./Competencia";
import { EntregaCotizacion } from "./EntregaCotizacion";
import { EstimadosCompetencia } from "./EstimadosCompetencia";

/** Donde el modo demo guarda quién eres: la misma clave que escribe «Ver como» (y que lee promos). */
const ME_DEMO = "rtg_deliveries_local_me";
const claveDeExtension = (id: string) => `rtg_estimator_ext_${id}`;
/** La pausa tras la última tecla del # de estimado antes de comprobarlo solo (D-432: sin botón «Search»). */
const ESPERA_COMPROBACION_MS = 600;

type Yo = { id: string; name: string; admin: boolean; store?: string | null };
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
export function Estimador({ me: meServidor, demo, extension: extensionServidor, ajustes }: {
  me: Yo | null;
  demo: boolean;
  /** La del expediente de RR. HH. de quien prepara, leída en el servidor (page.tsx). En demo, `extensionDemo`. */
  extension: string | null;
  /** Tiendas, ciudades locales y recargo de Ajustes: lo que pide la calculadora de tarifa de Entregas (D-442). */
  ajustes: AjustesDeEntrega;
}) {
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
          ? { id: m.id, name: typeof m.full_name === "string" ? m.full_name : m.id, admin: m.role === "admin", store: typeof m.store === "string" ? m.store : null }
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
  const [sin156Demo, setSin156Demo] = useState(false);
  /** `?sin161=1` y `?sinLlave=1`: el demo como la base sin la 161, o como el servidor sin `ANTHROPIC_API_KEY`. */
  const [sin161Demo, setSin161Demo] = useState(false);
  const [sinLlaveDemo, setSinLlaveDemo] = useState(false);
  useEffect(() => {
    if (!demo) return;
    const q = new URLSearchParams(window.location.search);
    setSinTablaDemo(q.get("sinTabla") === "1");
    setSin156Demo(q.get("sin156") === "1");
    setSin161Demo(q.get("sin161") === "1");
    setSinLlaveDemo(q.get("sinLlave") === "1");
  }, [demo]);
  const almacen: AlmacenDeCotizaciones = useMemo(
    () => (demo ? almacenDemo(() => meRef.current, sinTablaDemo) : almacenDeLaBase(createClient())),
    [demo, sinTablaDemo],
  );
  // El estimado de la competencia (D-425): su propia tabla y su cubo (153), con la misma pareja base/demo.
  const almacenCompetencia: AlmacenDeCompetencia = useMemo(
    () => (demo ? almacenDeCompetenciaDemo(() => meRef.current, sinTablaDemo, sin156Demo) : almacenDeCompetenciaDeLaBase(createClient())),
    [demo, sinTablaDemo, sin156Demo],
  );
  // Los productos del estimado de la competencia (D-NEXT): su tabla (161) y la ruta que los lee, o el demo en memoria.
  const almacenLecturas: AlmacenDeLecturas = useMemo(
    () => (demo ? almacenDeLecturasDemo(() => meRef.current, { sin161: sin161Demo, sinLlave: sinLlaveDemo }) : almacenDeLecturasDeLaBase(createClient())),
    [demo, sin161Demo, sinLlaveDemo],
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
  /** Las dos pestañas (D-451): la cotización de siempre, y todos los estimados de la competencia. */
  const [pestana, setPestana] = useState<"cotizacion" | "competencia">("cotizacion");

  // La extensión sale sola (D-432, «should be automatic»): la del expediente de quien prepara; si no tiene, la que
  // escribió la última vez en este navegador. Se reemplaza mientras nadie la toque (en demo «Ver como» cambia de
  // persona sin recargar); si la escribió a mano, se respeta.
  const [origenExt, setOrigenExt] = useState<"expediente" | "navegador" | "ninguno">("ninguno");
  const extAuto = useRef("");
  useEffect(() => {
    if (!me) return;
    let recordada: string | null = null;
    try { recordada = localStorage.getItem(claveDeExtension(me.id)); } catch { /* sin almacenamiento: se escribe a mano */ }
    const p = extensionDePartida(demo ? extensionDemo(me.id) : extensionServidor, recordada);
    setOrigenExt(p.origen);
    setDraft((d) => (!d.sales_ext.trim() || d.sales_ext === extAuto.current ? { ...d, sales_ext: p.valor } : d));
    extAuto.current = p.valor;
  }, [me, demo, extensionServidor]);

  // La tienda de salida de la entrega nace con la del perfil (D-442), como la extensión: solo si nadie eligió otra.
  useEffect(() => {
    if (!me) return;
    const tienda = tiendaDePartida(me.store, ajustes.stores);
    if (tienda) setDraft((d) => (d.delivery.store ? d : { ...d, delivery: { ...d.delivery, store: tienda } }));
  }, [me, ajustes.stores]);

  const set = <K extends keyof QuoteDraft>(k: K, v: QuoteDraft[K]) => setDraft((d) => ({ ...d, [k]: v }));
  const setCliente = (patch: Partial<QuoteDraft["customer"]>) => setDraft((d) => ({ ...d, customer: { ...d.customer, ...patch } }));
  const setEntrega = (patch: Partial<QuoteDraft["delivery"]>) => setDraft((d) => ({ ...d, delivery: { ...d.delivery, ...patch } }));
  const ponEntrega = (delivery: QuoteDraft["delivery"]) => setDraft((d) => ({ ...d, delivery }));
  const setLinea = (id: string, patch: Partial<QuoteLine>) =>
    setDraft((d) => ({ ...d, lines: d.lines.map((l) => (l.id === id ? ({ ...l, ...patch } as QuoteLine) : l)) }));

  // Lo que las comprobaciones asíncronas leen AHORA, no lo que había cuando se lanzaron.
  const draftRef = useRef(draft);
  useEffect(() => { draftRef.current = draft; }, [draft]);
  const quoteIdRef = useRef<string | null>(null);
  /** La tienda de la cotización guardada que está abierta (148); null si es nueva. Sale en la hoja (D-451). */
  const [tiendaGuardada, setTiendaGuardada] = useState<string | null>(null);
  const ponerQuoteId = (id: string | null) => { quoteIdRef.current = id; setQuoteId(id); if (!id) setTiendaGuardada(null); };
  const [comprobando, setComprobando] = useState(false);
  /** Una cotización guardada de este estimado que se puede abrir pero no se abrió sola (había trabajo tecleado). */
  const [ofertaAbrir, setOfertaAbrir] = useState<string | null>(null);
  const enCurso = useRef<string | null>(null);

  const buscado = busqueda !== null && claveDeEstimado(busqueda.num) === claveDeEstimado(draft.estimate_num);
  const hallado = buscado ? busqueda!.hallado : null;
  const estado = estadoDelEstimado({
    baseDisponible: baseDisponible !== false, buscado, hallado, meId: me?.id ?? null, esAdmin: me?.admin ?? false,
  });
  const faltas = loQueFalta(draft, estado);
  const cortas = lineasCortas(draft);
  // Subtotal regular → ahorro → impuesto → total (D-442), el mismo cálculo que la hoja. Solo líneas: sin entrega.
  const totales = resumenDeTotales(draft.lines);

  // ---- acciones -------------------------------------------------------------------------------------
  const abrirGuardada = async (id: string): Promise<boolean> => {
    const c = await almacen.cargar(id);
    if (!c.ok) { setAviso({ tipo: "rojo", texto: `${t("Could not open the quote", "No se pudo abrir la cotización")}: ${c.error}` }); return false; }
    setDraft(c.valor.draft);
    ponerQuoteId(c.valor.id);
    setTiendaGuardada(c.valor.store);
    setPrintCount(c.valor.print_count);
    setOfertaAbrir(null);
    setAviso({ tipo: "verde", texto: t("Saved quote opened. Changes replace it: one quote per estimate.", "Cotización guardada abierta. Los cambios la reemplazan: una cotización por estimado.") });
    return true;
  };

  /**
   * Comprueba de quién es el estimado. **Sin botón** (D-432, «No need to search first»): la lanzan la pausa al
   * teclear, salir del campo, Enter y el propio guardado. La regla de D-413 sigue igual: si es de otro, se dice y se
   * pide su aprobación. `abrirSola`: si la guardada es mía (o aprobada) y el borrador está en blanco, se abre; con
   * trabajo tecleado, se ofrece y no se pisa.
   */
  const comprobar = async (num: string, abrirSola = true): Promise<{ ok: true; hallado: EstimadoHallado | null } | { ok: false }> => {
    const n = num.trim();
    if (!n) return { ok: false };
    const clave = claveDeEstimado(n);
    enCurso.current = clave;
    setComprobando(true);
    const r = await almacen.buscar(n);
    if (enCurso.current === clave) { enCurso.current = null; setComprobando(false); }
    // La respuesta de un número que ya no es el escrito no vale: se tecleó otro mientras volvía.
    if (claveDeEstimado(draftRef.current.estimate_num) !== clave) return { ok: false };
    if (!r.ok) {
      if (r.sinTabla) { setBaseDisponible(false); return { ok: false }; }
      setAviso({ tipo: "rojo", texto: `${t("Could not check the estimate", "No se pudo comprobar el estimado")}: ${r.error}` });
      return { ok: false };
    }
    setBusqueda({ num: n, hallado: r.valor });
    const h = r.valor;
    const que = trasComprobar({
      hallado: h, meId: me?.id ?? null, esAdmin: me?.admin ?? false,
      quoteIdAbierto: quoteIdRef.current, borrador: draftRef.current, abrirSola,
    });
    if (que === "nueva") {
      // Nadie la tiene: al guardar, quien la prepara queda como dueño («Original sales rep» ya lo dice).
      if (quoteIdRef.current) { ponerQuoteId(null); setPrintCount(0); }
      setOfertaAbrir(null);
      setAviso(null);
    } else if (que === "ajena") {
      ponerQuoteId(null);
      setOfertaAbrir(null);
      setAviso({ tipo: "ambar", texto: t(`This estimate belongs to ${h?.owner_name ?? "another rep"}. You need their approval before you prepare a quote for it.`, `Este estimado es de ${h?.owner_name ?? "otro vendedor"}. Necesitas su aprobación antes de preparar una cotización.`) });
    } else if (que === "abrir" && h) {
      await abrirGuardada(h.quote_id);
    } else if (que === "ofrecer" && h) {
      setOfertaAbrir(h.quote_id);
      setAviso({ tipo: "ambar", texto: t("A quote is already saved for this estimate. Open it to keep working on it: what you typed here will be replaced.", "Ya hay una cotización guardada para este estimado. Ábrela para seguir con ella: lo que escribiste aquí se reemplaza.") });
    }
    return { ok: true, hallado: h };
  };
  const comprobarRef = useRef(comprobar);
  useEffect(() => { comprobarRef.current = comprobar; });

  // La comprobación sola: una pausa después de la última tecla del número.
  useEffect(() => {
    const n = draft.estimate_num.trim();
    if (!me || baseDisponible === false || !n || buscado) return;
    const id = setTimeout(() => { if (enCurso.current !== claveDeEstimado(n)) void comprobarRef.current(n); }, ESPERA_COMPROBACION_MS);
    return () => clearTimeout(id);
  }, [draft.estimate_num, buscado, baseDisponible, me]);

  /** Salir del campo o Enter: sin esperar la pausa. */
  const comprobarYa = () => {
    const n = draft.estimate_num.trim();
    if (!n || buscado || baseDisponible === false || enCurso.current === claveDeEstimado(n)) return;
    void comprobar(n);
  };

  const guardar = async (): Promise<string | null> => {
    if (!me || !puedeGuardar(draft, estado)) return null;
    // Siempre se comprueba antes de guardar (D-432): si la pausa aún no lo hizo, se hace aquí y se para si es de otro.
    let h = hallado;
    if (estado === "sin-buscar") {
      setOcupado(true);
      const c = await comprobar(draft.estimate_num, false);
      setOcupado(false);
      if (!c.ok) return null;
      h = c.hallado;
      const est = estadoDelEstimado({ baseDisponible: true, buscado: true, hallado: h, meId: me.id, esAdmin: me.admin });
      if (!puedeTrabajar(est)) return null; // el aviso ámbar ya dice de quién es
    }
    // Hay una guardada de este estimado y no es la abierta: guardar encima sin haberla visto, no. Se ofrece abrirla.
    if (h && h.quote_id !== quoteIdRef.current) {
      setOfertaAbrir(h.quote_id);
      setAviso({ tipo: "ambar", texto: t("A quote is already saved for this estimate. Open it first: one quote per estimate.", "Ya hay una cotización guardada para este estimado. Ábrela primero: una cotización por estimado.") });
      return null;
    }
    setOcupado(true);
    const r = await almacen.guardar(quoteIdRef.current, draft);
    setOcupado(false);
    if (!r.ok) {
      if (r.sinTabla) { setBaseDisponible(false); return null; }
      if (r.duplicado) {
        // Se vuelve a comprobar solo (la pausa lo lanza al quedar sin comprobar).
        setBusqueda(null);
        setAviso({ tipo: "rojo", texto: t("Someone else just saved a quote for this estimate. Checking who owns it…", "Alguien acaba de guardar una cotización para este estimado. Comprobando de quién es…") });
        return null;
      }
      setAviso({ tipo: "rojo", texto: `${t("Not saved", "No se guardó")}: ${r.error}` });
      return null;
    }
    ponerQuoteId(r.valor);
    if (!h) {
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
    await comprobar(draft.estimate_num);
    setAviso({ tipo: "ambar", texto: t(`Approval requested from ${hallado.owner_name ?? "the owner"}. Press “Check again” once they approve.`, `Aprobación pedida a ${hallado.owner_name ?? "el dueño"}. Pulsa «Comprobar otra vez» cuando la dé.`) });
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

  // La tienda donde se creó (D-451): la de la cotización guardada; si es nueva, la del perfil de quien la prepara.
  const tiendaHoja = tiendaDeLaHoja(tiendaGuardada, me?.store);
  const hoja = useMemo(() => hojaDelCliente(draft, tiendaHoja), [draft, tiendaHoja]);
  // Las líneas propias, para ponerlas al lado de las del competidor que el vendedor empareje. Nunca van a la hoja.
  const propias = useMemo(() => lineasPropias(draft.lines), [draft.lines]);

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

      <div className="est-pestanas" role="tablist">
        <button type="button" role="tab" aria-selected={pestana === "cotizacion"} data-pestana="cotizacion"
          className={"btn btn-sm " + (pestana === "cotizacion" ? "btn-primary" : "btn-ghost")} onClick={() => setPestana("cotizacion")}>
          🧮 {t("Quote", "Cotización")}
        </button>
        <button type="button" role="tab" aria-selected={pestana === "competencia"} data-pestana="competencia"
          className={"btn btn-sm " + (pestana === "competencia" ? "btn-primary" : "btn-ghost")} onClick={() => setPestana("competencia")}>
          🕵️ {t("Competitor estimates", "Estimados de la competencia")}
        </button>
      </div>

      {pestana === "competencia" && (
        <EstimadosCompetencia almacen={almacenCompetencia} lecturas={almacenLecturas} me={me} t={t} lang={lang}
          tiendas={ajustes.stores.map((s) => s.name)} tiendaDePartida={tiendaDePartida(me.store, ajustes.stores)} />
      )}

      {pestana === "cotizacion" && (<>
      {/* 1-2. Estimado y vendedor */}
      <div className="card">
        <h2>🔎 {t("Estimate", "Estimado")}</h2>
        <div className="grid g3">
          <div className="field">
            <label htmlFor="est-num">{t("Estimate #", "# de estimado")}</label>
            {/* Sin botón «Search» (D-432): se comprueba solo tras una pausa, al salir del campo y antes de guardar. */}
            <input id="est-num" value={draft.estimate_num} className={inv(!draft.estimate_num.trim())}
              onChange={(e) => set("estimate_num", e.target.value)}
              onBlur={comprobarYa}
              onKeyDown={(e) => { if (e.key === "Enter") comprobarYa(); }} />
          </div>
          <div className="field">
            <label>{t("Original sales rep", "Vendedor original")}</label>
            <div data-dueno style={{ padding: "8px 0", fontWeight: 600 }}>
              {estado === "sin-base" ? t("Cannot be checked", "No se puede comprobar")
                : hallado ? (hallado.owner_name ?? "?")
                : buscado || !draft.estimate_num.trim() ? `${me.name} (${t("you", "tú")})`
                : <span className="hint" data-comprobando>{t("Checking…", "Comprobando…")}</span>}
            </div>
          </div>
          <div className="field">
            <label>{t("Prepared by", "Preparada por")}</label>
            <div style={{ padding: "8px 0", fontWeight: 600 }}>{me.name}</div>
          </div>
          <div className="field">
            <label>{t("Store (printed on the quote)", "Tienda (sale en la cotización)")}</label>
            <div data-tienda style={{ padding: "8px 0", fontWeight: 600 }}>{tiendaHoja ?? <span className="hint">{t("No store on your profile", "Tu perfil no tiene tienda")}</span>}</div>
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
            {estado === "pendiente" && (
              <button className="btn btn-ghost btn-sm" data-comprobar-otra-vez disabled={ocupado || comprobando} onClick={() => void comprobar(draft.estimate_num)}>
                {t("Check again", "Comprobar otra vez")}
              </button>
            )}
          </div>
        )}
        {ofertaAbrir && (
          <div className="est-acciones" data-oferta-abrir>
            <button className="btn btn-amber btn-sm" disabled={ocupado} onClick={() => void abrirGuardada(ofertaAbrir)}>
              {t("Open the saved quote", "Abrir la cotización guardada")}
            </button>
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
            <span className="hint" data-origen-ext={origenExt}>
              {origenExt === "expediente" ? t("From your HR record (the same as the directory).", "De tu expediente de RR. HH. (la misma del directorio).")
                : origenExt === "navegador" ? t("The one you typed last time on this browser.", "La que escribiste la última vez en este navegador.")
                : t("Not on your HR record: type it once, this browser remembers it.", "No está en tu expediente: escríbela una vez, este navegador la recuerda.")}
            </span>
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
              onChange={(e) => setCliente({ full_name: e.target.value })} />
          </div>
          <div className="field">
            <label htmlFor="est-empresa">{t("Company", "Empresa")}</label>
            <input id="est-empresa" value={draft.customer.company} onChange={(e) => setCliente({ company: e.target.value })} />
          </div>
          <div className="field">
            <label htmlFor="est-tel">{t("Phone", "Teléfono")}</label>
            {/* 956-555-0123 al completar los 10 dígitos o al salir (D-432); lo que no es un número completo se deja y se marca. */}
            <input id="est-tel" value={draft.customer.phone} inputMode="tel" placeholder="956-555-0123"
              className={inv(!!draft.customer.phone.trim() && telefonoLimpio(draft.customer.phone) === null)}
              onChange={(e) => setCliente({ phone: telefonoAlEscribir(e.target.value) })}
              onBlur={(e) => setCliente({ phone: telefonoAlEscribir(e.target.value) })} />
            {!!draft.customer.phone.trim() && telefonoLimpio(draft.customer.phone) === null && (
              <span className="hint" data-tel-mal style={{ color: "var(--red)" }}>{t("Not a 10-digit US number.", "No es un número de EE. UU. de 10 dígitos.")}</span>
            )}
          </div>
          {/* Sin «Dirección» del cliente (D-451, «remove dirrecion en estimador»): repetía la de entrega, que es la que
              usa la calculadora de tarifa y vive en la sección Entrega. */}
        </div>
        <div className="est-ve-cliente" data-ve-cliente>
          {t("Customer sees only:", "El cliente solo ve:")} <b>{paraQuienSeImprime(draft.customer) || "—"}</b>.{" "}
          {t("Company and phone are never printed.", "Empresa y teléfono no se imprimen nunca.")}
        </div>
      </div>

      {/* 3. Productos */}
      <div className="card">
        <h2>🧱 {t("Products", "Productos")}</h2>
        {draft.lines.map((l, i) => {
          const res = catalogo[l.id];
          const tot = totalDeLinea(l);
          const regularTot = totalRegularDeLinea(l);
          const { regular, bajo } = preciosDeLinea(l);
          const estadoBajo = estadoDelPrecioBajo(regular, bajo);
          const pct = porcentajeDeDescuento(regular, bajo);
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
                      <label>{t("Regular $/SF", "$/SF regular")}</label>
                      <CampoDecimal value={l.price_per_sf} data-precio
                        onValor={(n) => setLinea(l.id, { price_per_sf: n })} />
                    </div>
                    <div className="field">
                      <label>{t("Discount price $/SF (optional)", "Precio con descuento $/SF (opcional)")}</label>
                      <CampoDecimal value={l.lower_price_per_sf} data-precio-bajo
                        onValor={(n) => setLinea(l.id, { lower_price_per_sf: n })} />
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
                      <label>{t("Regular unit price", "Precio unitario regular")}</label>
                      <CampoDecimal value={l.unit_price} data-precio-unidad onValor={(n) => setLinea(l.id, { unit_price: n })} />
                    </div>
                    <div className="field">
                      <label>{t("Discount unit price (optional)", "Precio unitario con descuento (opcional)")}</label>
                      <CampoDecimal value={l.lower_unit_price} data-precio-bajo onValor={(n) => setLinea(l.id, { lower_unit_price: n })} />
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
                {/* El total de la línea a precio REGULAR y, si hay, el PRECIO con descuento: los dos salen en la hoja (D-451).
                    El % queda solo aquí, como dato para el vendedor: la hoja ya no lo imprime. */}
                <span>{t("Line total", "Total de línea")}: <b data-total-linea>{regularTot !== null ? dinero(regularTot) : "—"}</b></span>
                {pct !== null && tot !== null && (
                  <span data-descuento-calc>
                    {t("Discount price", "Precio con descuento")}: <b data-total-bajo>{dinero(tot)}</b> <span className="hint">({numero(pct)}% {t("off", "menos")})</span>
                  </span>
                )}
              </div>
              {(estadoBajo === "no-menor" || estadoBajo === "sin-regular") && (
                <p className="hint" data-sin-descuento style={{ color: "var(--red)", margin: "6px 0 0" }}>
                  {estadoBajo === "no-menor"
                    ? t("The discount price is not below the regular price: no discount applied.", "El precio con descuento no es menor que el regular: no se aplica descuento.")
                    : t("Enter the regular price first: the discount is calculated from it.", "Escribe primero el precio regular: el descuento se calcula sobre él.")}
                </p>
              )}
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
        {/* Búsqueda de dirección, pin y calculadora de tarifa de la ficha de Entregas (D-442). Solo para el vendedor. */}
        {draft.delivery.mode === "delivery" && (
          <EntregaCotizacion entrega={draft.delivery} onEntrega={ponEntrega} ajustes={ajustes} admin={me.admin} t={t} />
        )}
      </div>

      {/* Interno: el estimado de la competencia. Fuera de la hoja del cliente, y escondido al imprimir. */}
      <SeccionCompetencia almacen={almacenCompetencia} quoteId={quoteId} me={me} baseCotizaciones={baseDisponible} t={t} lang={lang}
        lecturas={almacenLecturas} propias={propias}
        guardarCotizacion={{ puede: !ocupado && puedeGuardar(draft, estado), hacer: () => void guardar() }} />

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
            <div className="hint" data-subtotal>{t("Subtotal (regular prices)", "Subtotal (precios regulares)")}: {dinero(totales.subtotal)}</div>
            {totales.ahorro > 0 && <div className="hint" data-ahorro>{t("Savings", "Ahorro")}: −{dinero(totales.ahorro)}</div>}
            <div className="hint" data-impuesto>{t("Tax", "Impuesto")} {numero(totales.tasa)}%: {dinero(totales.impuesto)}</div>
            <div className="est-total" data-total>{t("Estimated Material Total", "Total estimado de materiales")}: {dinero(totales.total)}</div>
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
      </>)}
    </div>
  );
}
