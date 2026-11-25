"use client";

import { TablaEstandar } from "@/components/TablaEstandar";
import { useContextoDeAyuda } from "@/lib/ayuda-ubicacion-hook";
import { contextoDeLeads } from "@/lib/ayuda-contextos";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { HUECO_DE_LA_BARRA } from "@/components/BarraDeApp";
import { usePrefs } from "@/lib/prefs";
import { createClient } from "@/lib/supabase/client";
import { type ClienteCruzado, almacenDeLaBase, type AlmacenDeLeads, type Res } from "@/lib/leads/almacen";
import { ALCANCE_SIN_REGLA, codigoDeTiendaDelPerfil, conCruzadosDeMiTienda, eligeTienda, esCruzadoDeMiTienda, leadsDelBanco, privadosVisibles, veElPoolPrivado, type Alcance } from "@/lib/leads/alcance";
import { almacenDemo, PERSONAS_DEMO, personaDeLaPractica } from "@/lib/leads/demo";
import {
  cuantosVistosMasDeUna, cuentaPorEtapa, delExcel, dinero, enlaceSeguro, etapaDe, etapaIcono, etapaLabel, etapaTono, eventoLabel, fecha, filtrar,
  filtroDePool, categoriaBuena, coincideConCliente, esPrivado, ETAPAS, mapsUrl, negativaTexto, notaLimpia, NOTA_MAX, numero, ordenar, poolInicial, poolLabel,
  poolsDe, POOL_TODAS, resumenDeTodas, tableroPorTienda, tableroPorVendedor, telUrl, TIPOS_DE_ACCION, type TipoDeAccion, type Etapa, valoresDe, vecesVisto,
  ORDEN_INICIAL, vigentes, enTodasLasEtapas, type EventoLead, type FiltroCategoria, type Lead, type Orden, type Persona, puedeVerEstadisticas,
  vendedoresDeLeads, leadsDeLaVista, type VistaDePool,
} from "@/lib/leads/reglas";
// 337: las llamadas de RingCentral de la ficha y la pestaña de estadísticas (admin y gerente).
import type { LlamadaDeLead } from "@/lib/leads/llamadas-rc";
import { Estadisticas } from "./Estadisticas";
import { LlamadasDelLead } from "./LlamadasDelLead";
import { etiquetaDeSemana, semanaInicial, semanasDelPool } from "@/lib/leads/semanas";
import { cotizacionesPorLead, enlaceACotizacion, enlaceACotizar, idDeParametro, puedeCotizarLead, type CotizacionDeLead } from "@/lib/leads/cotizar";
import { enlaceDeLaBase, enlaceDemo, type AlmacenDelEnlace } from "@/lib/leads/enlace";
// D-850: los teléfonos se enseñan en la forma única del hub; el Excel los trae de mil maneras («956.555.0123», «956-555-0123»).
import { telefonoEstandar } from "@/lib/recruiting/formato";
// 335: teléfono a mano, sugerencias de otro permiso o del cliente, búsqueda y las cuentas de la pestaña del admin.
import { enlaceDeBusqueda, sinTelefono, sinTelefonoPorPool, sugerenciaDeTelefono, telefonoDeContratista, telefonoDeOtro, telefonoParaMostrar, telefonosAMano, tieneTelefono, validaTelefono, type Sugerencia } from "@/lib/leads/telefonos";
import { terminoLabel } from "@/lib/customers/terminos";

type Estado = { tipo: "cargando" } | { tipo: "sinTabla" } | { tipo: "error"; texto: string } | { tipo: "listo" };
type Pestana = "banco" | "admin" | "privado" | "estadisticas";
type Dialogo =
  | { tipo: "nota"; lead: Lead }
  | { tipo: "cliente"; lead: Lead; cliente: ClienteCruzado };

/** La semana del STXP Pool que eligió cada persona, en ESTE navegador (como los avisos ocultos del Gestor). */
const claveSemanaSTXP = (id: string) => `rtg_leads_stxp_semana_${id}`;
function leeSemanaSTXP(id: string): string | null {
  try { return localStorage.getItem(claveSemanaSTXP(id)); } catch { return null; }
}
function guardaSemanaSTXP(id: string, valor: string): void {
  try { localStorage.setItem(claveSemanaSTXP(id), valor); } catch { /* sin almacenamiento: no se recuerda, y ya */ }
}

/** Cuántas tarjetas se pintan de entrada y cuántas más con cada «ver más»: en un teléfono, 140 tarjetas de golpe pesan. */
const TANDA = 30;

/**
 * «Leads» (migración 162; por etapas desde la 328): el banco de leads por tienda (en la pantalla, «GOV Pool»), el
 * STXP Pool y lo del admin. Quién alcanza los leads de qué tienda lo decide la base (migración 163) y aquí solo se pinta.
 *
 * Desde la 328 nadie toma un lead: quien lo ve anota una nota de avance con una etapa, y la etapa es lo que el lead es.
 * Todas las reglas viven en `lib/leads/reglas` y están probadas sin navegador; la base las vuelve a exigir. Este
 * componente lee, filtra y pinta, y cada acción va por el almacén, que devuelve el lead como quedó en la base.
 */
export function Leads({ demo, yo: yoReal, cotiza = false }: {
  demo: boolean; yo: Persona | null;
  /** Tiene el Quote Builder (D-558): se ofrece «Crear cotización» y se cuentan las cotizaciones de cada lead. */
  cotiza?: boolean;
}) {
  const { t, lang } = usePrefs();

  // En el demo sin sesión se elige quién se es, para poder enseñar la parte del admin y las otras tiendas. Con sesión
  // (modo enseñanza), la práctica enseña a la persona de verdad: lo que vería sin el modo (D-770, `personaDeLaPractica`).
  const [idDemo, setIdDemo] = useState(PERSONAS_DEMO[0].id);
  const yo: Persona | null = demo ? personaDeLaPractica(yoReal, idDemo) : yoReal;
  const quien = useRef<Persona>(PERSONAS_DEMO[0]);
  useEffect(() => { if (yo) quien.current = yo; });
  const almacen: AlmacenDeLeads = useMemo(() => (demo ? almacenDemo(() => quien.current) : almacenDeLaBase(createClient())), [demo]);

  const [leads, setLeads] = useState<Lead[]>([]);
  const [alcance, setAlcance] = useState<Alcance>(ALCANCE_SIN_REGLA);
  const [estado, setEstado] = useState<Estado>({ tipo: "cargando" });
  const [pestana, setPestana] = useState<Pestana>("banco");
  // El hueco de la barra de arriba (junto a la casa): los controles de la fila 1 suben ahí por un portal. Se busca después de montar.
  const [hueco, setHueco] = useState<HTMLElement | null>(null);
  useEffect(() => { setHueco(document.getElementById(HUECO_DE_LA_BARRA)); }, []);
  const [pool, setPool] = useState<string | null>(null);
  // Mientras nadie elige a mano, la entrada se recalcula: el alcance y los leads llegan después del primer pintado (D-631).
  const [poolAMano, setPoolAMano] = useState(false);
  // D-798 (el dueño): «todas las categorías que sea default». Antes, «Sirve + podría servir».
  const [categoria, setCategoria] = useState<FiltroCategoria>("todas");
  // Las etapas son los filtros (328): una a la vez, «» = todas.
  const [etapa, setEtapa] = useState<Etapa | "">("");
  const [buena, setBuena] = useState(false);
  const [tipo, setTipo] = useState("");
  const [ciudad, setCiudad] = useState("");
  const [busca, setBusca] = useState("");
  const [orden, setOrden] = useState<Orden>(ORDEN_INICIAL);
  const [cuantos, setCuantos] = useState(TANDA);
  const [ocupado, setOcupado] = useState<string | null>(null);
  const [aviso, setAviso] = useState<{ tono: "rojo" | "verde"; texto: string } | null>(null);
  const [dialogo, setDialogo] = useState<Dialogo | null>(null);
  const [historial, setHistorial] = useState<{ id: string; eventos: EventoLead[] | null } | null>(null);
  // 337: las llamadas de RingCentral a los teléfonos del lead (arriba, con los demás estados: no después de un return).
  const [llamadasDe, setLlamadasDe] = useState<{ id: string; lista: LlamadaDeLead[] | null } | null>(null);
  // Lo que una solicitud de ayuda dirá de esta pantalla (D-901). Del lead no se nombra a la persona.
  useContextoDeAyuda("leads", contextoDeLeads({
    pestana, pool, etapa, buscando: !!busca.trim(), dialogo: dialogo?.tipo ?? null, historialAbierto: historial !== null, demo,
  }));

  const cargar = useCallback(async () => {
    const r = await almacen.leer();
    if (!r.ok) { setEstado(r.sinTabla ? { tipo: "sinTabla" } : { tipo: "error", texto: r.error }); return; }
    setLeads(r.valor.leads);
    setAlcance(r.valor.alcance);
    setEstado({ tipo: "listo" });
  }, [almacen]);
  // En el demo, cambiar de persona es cambiar de sesión: se relee, porque cada una alcanza leads distintos.
  useEffect(() => { void cargar(); }, [cargar, idDemo]);

  // Las cotizaciones de cada lead (D-558): las que quien mira VE en el Quote Builder (RLS de la 148) y salieron de un
  // lead (`lead_id`, 175). Sin el módulo no se piden; sin la 175 vuelven cero, y no es un error.
  const enlace: AlmacenDelEnlace = useMemo(() => (demo ? enlaceDemo() : enlaceDeLaBase(createClient())), [demo]);
  const [cotizaciones, setCotizaciones] = useState<Map<string, CotizacionDeLead[]>>(() => new Map());
  useEffect(() => {
    if (!cotiza) return;
    void enlace.cotizacionesConLead().then((r) => { if (r.ok) setCotizaciones(cotizacionesPorLead(r.valor)); });
  }, [cotiza, enlace]);
  // `?lead=<id>` (el enlace «De lead» de una cotización): ese lead se enseña arriba, si quien mira lo alcanza.
  const [enfocado, setEnfocado] = useState<string | null>(null);
  useEffect(() => { setEnfocado(idDeParametro(new URLSearchParams(window.location.search).get("lead"))); }, []);

  // El banco que se enseña: todas las tiendas a quien las alcanza; a los demás, SOLO la suya.
  // D-760 (218): el «STXP Pool» (leads de la fuente privada) es una pestaña aparte, solo para quien tiene la casilla y el
  // admin. Reusa los mismos filtros, orden y tarjetas que el GOV Pool.
  const veStxp = !!yo && veElPoolPrivado(yo);
  const privadosBase = useMemo(() => (yo ? privadosVisibles(leads, yo) : []), [leads, yo]);
  // D-762: de los cruzados, el cliente (enlace a su ficha) y el vendedor que lo lleva. Una lectura por tanda de ids.
  const [clientes, setClientes] = useState<Map<number, ClienteCruzado>>(() => new Map());
  const idsCruzados = useMemo(() => leads.map((l) => l.customer_match_id).filter((n): n is number => n != null).sort().join(","), [leads]);
  useEffect(() => {
    if (!idsCruzados) { setClientes(new Map()); return; }
    let vivo = true;
    void almacen.clientesCruzados(idsCruzados.split(",").map(Number)).then((r) => { if (vivo && r.ok) setClientes(r.valor); });
    return () => { vivo = false; };
  }, [almacen, idsCruzados]);
  // D-763: la búsqueda también encuentra por el cliente cruzado y su vendedor.
  const textoExtra = useCallback((l: Lead) => {
    const c = l.customer_match_id != null ? clientes.get(l.customer_match_id) : undefined;
    return c ? [c.account, c.rep_name, c.contact_name].filter(Boolean).join(" · ") : "";
  }, [clientes]);
  const [coinciden, setCoinciden] = useState(false);
  // 335: el filtro «Sin teléfono» (sin teléfono de contratista, ni de mano ni del Excel).
  const [sinTel, setSinTel] = useState(false);
  // D-1145 (D-1145, reunión del 23 nov 2026): el filtro «Vendedor» (quien hizo el último contacto de cada lead). "" = todos.
  const [vendedorElegido, setVendedorElegido] = useState("");
  // El tablero de estadísticas (la pestaña del admin) enseña un pool o los dos. Al entrar, el del pool en el que estabas.
  const [vistaStats, setVistaStats] = useState<VistaDePool>("gov");
  // D-799 (225): lo cruzado con un cliente de MI tienda también se ve, aunque su pool sea otra tienda.
  const miCodigo = codigoDeTiendaDelPerfil(yo?.store);
  const cruzadoDeMiTienda = useCallback((l: Lead) => esCruzadoDeMiTienda(l, clientes, miCodigo), [clientes, miCodigo]);
  const privados = useMemo(
    () => (veStxp ? conCruzadosDeMiTienda(privadosBase, leads.filter((l) => l.source === "privado"), cruzadoDeMiTienda) : privadosBase),
    [privadosBase, leads, cruzadoDeMiTienda, veStxp],
  );
  // Los filtros como al entrar: al cambiar de pestaña y con «Quitar filtros». El orden no es un filtro y se queda.
  const limpiaFiltros = () => {
    setCategoria("todas"); setEtapa(""); setBuena(false); setTipo(""); setCiudad(""); setBusca(""); setCoinciden(false); setSinTel(false); setVendedorElegido("");
  };
  const cambiaPestana = (p: Pestana) => {
    if (p === "admin") setVistaStats(veStxp && pestana === "privado" ? "stxp" : "gov");
    setPestana(p);
    limpiaFiltros();
  };
  // El STXP Pool se parte por semanas (un import = una semana, ver semanas.ts). Se enseña la más nueva, salvo que la
  // persona haya elegido otra: esa elección se recuerda por persona en este navegador.
  const yoId = yo?.id ?? null;
  const semanasSTXP = useMemo(() => semanasDelPool(leads), [leads]);
  const [semanaGuardada, setSemanaGuardada] = useState<string | null>(null);
  useEffect(() => { setSemanaGuardada(yoId ? leeSemanaSTXP(yoId) : null); }, [yoId]);
  const semanaActiva = semanaInicial(semanaGuardada, semanasSTXP.semanas);
  const eligeSemana = (valor: string) => {
    setSemanaGuardada(valor);
    if (yoId) guardaSemanaSTXP(yoId, valor);
  };
  const semanaFiltro = pestana === "privado" && semanaActiva !== "todas" ? semanaActiva : null;
  const delBanco = useMemo(
    () => (pestana === "privado"
      ? privados.filter((l) => semanaFiltro === null || semanasSTXP.semanaDeLead.get(l.id) === semanaFiltro)
      : conCruzadosDeMiTienda(leadsDelBanco(leads, alcance), leads.filter((l) => l.source !== "privado"), cruzadoDeMiTienda)),
    [leads, alcance, pestana, privados, cruzadoDeMiTienda, semanaFiltro, semanasSTXP],
  );
  const pools = useMemo(() => poolsDe(delBanco), [delBanco]);
  const elige = eligeTienda(alcance);
  // Se entra en el pool de SU tienda; cambiar de persona en el demo vuelve a elegirlo.
  const tienda = yo?.store ?? null;
  // El admin entra en «Todas las tiendas» (D-631); quien solo tiene una, en la suya.
  const todasPorDefecto = !!yo?.admin && elige;
  useEffect(() => {
    setPool((p) => (poolAMano && p && ((p === POOL_TODAS && elige && pools.length > 1) || pools.some((x) => x.pool === p))
      ? p : poolInicial(pools, tienda, todasPorDefecto)));
  }, [pools, tienda, todasPorDefecto, elige, poolAMano]);

  // D-770: en el STXP Pool de quien no elige tienda, el pool no filtra: ve su tienda y la cercana que le tocó.
  const poolFiltro = pestana === "privado" && !elige ? null : filtroDePool(pool);
  // 225: el cruzado con mi tienda pasa el filtro de pool aunque su pool sea otro.
  const delPool = useMemo(() => delBanco.filter((l) => poolFiltro === null || l.pool === poolFiltro || cruzadoDeMiTienda(l)), [delBanco, poolFiltro, cruzadoDeMiTienda]);
  // Los números de cada filtro cuentan lo que hay en el pool elegido (sin el filtro de etapa, para que se vea el total).
  const porEtapa = useMemo(() => cuentaPorEtapa(delPool), [delPool]);
  const buenas = useMemo(() => vigentes(delPool).filter((l) => categoriaBuena(l.category)).length, [delPool]);
  const visibles = useMemo(
    () => ordenar(filtrar(delBanco, { pool: poolFiltro, categoria, tipo, ciudad, busca, etapa, buena, coinciden, sinTelefono: sinTel, textoExtra, quien: vendedorElegido }), orden),
    [delBanco, poolFiltro, categoria, tipo, ciudad, busca, etapa, buena, coinciden, sinTel, textoExtra, orden, vendedorElegido],
  );
  // Las personas que han hecho algún último contacto en el banco que se ve (para el filtro «Vendedor»).
  const vendedoresBanco = useMemo(() => vendedoresDeLeads(delBanco), [delBanco]);
  useEffect(() => { setCuantos(TANDA); }, [pool, categoria, tipo, ciudad, busca, etapa, buena, coinciden, sinTel, orden, semanaFiltro, vendedorElegido]);

  if (!yo) return <div className="ld-wrap leads-app"><p className="hint">{t("No session.", "Sin sesión.")}</p></div>;

  /** Lo que devolvió la base se pone en su sitio; un rechazo se dice con sus palabras y se relee. */
  const tras = async (id: string, r: Res<Lead>, hecho: string): Promise<boolean> => {
    setOcupado(null);
    if (r.ok) {
      setLeads((prev) => prev.map((l) => (l.id === r.valor.id ? r.valor : l)));
      setAviso({ tono: "verde", texto: hecho });
      if (historial?.id === id) setHistorial(null);
      return true;
    }
    setAviso({ tono: "rojo", texto: r.motivo ? negativaTexto(r.motivo, lang) : `${t("Could not save", "No se pudo guardar")}: ${r.error}` });
    void cargar();
    return false;
  };

  /** 335: pone (o quita) el teléfono a mano; la base devuelve el lead y se pone en su sitio, como las notas. */
  const guardaTelefono = async (l: Lead, quien: "owner" | "tenant", telefono: string | null, ext: string | null, contacto: string | null): Promise<boolean> => {
    setOcupado(l.id);
    const r = await almacen.guardarTelefono(l.id, quien, telefono, ext, contacto);
    return tras(l.id, r, telefono ? t("Phone saved.", "Teléfono guardado.") : t("Phone removed.", "Teléfono quitado."));
  };

  const verHistorial = async (l: Lead) => {
    if (historial?.id === l.id) { setHistorial(null); return; }
    setHistorial({ id: l.id, eventos: null });
    const r = await almacen.historial(l.id);
    setHistorial({ id: l.id, eventos: r.ok ? r.valor : [] });
  };
  const verLlamadas = async (l: Lead) => {
    if (llamadasDe?.id === l.id) { setLlamadasDe(null); return; }
    setLlamadasDe({ id: l.id, lista: null });
    const r = await almacen.llamadasDeLead(l.id);
    setLlamadasDe({ id: l.id, lista: r.ok ? r.valor : [] });
  };

  const tarjeta = (l: Lead) => (
    <Tarjeta
      key={l.id} lead={l} ocupado={ocupado === l.id} almacen={almacen}
      historial={historial?.id === l.id ? historial.eventos : undefined}
      llamadas={llamadasDe?.id === l.id ? llamadasDe.lista : undefined}
      onNota={() => setDialogo({ tipo: "nota", lead: l })}
      onHistorial={() => void verHistorial(l)}
      onLlamadas={() => void verLlamadas(l)}
      cotizar={puedeCotizarLead(cotiza)} cotizaciones={cotiza ? (cotizaciones.get(l.id) ?? []) : []}
      semana={semanasSTXP.semanaDeLead.get(l.id)}
      cliente={l.customer_match_id != null ? clientes.get(l.customer_match_id) : undefined}
      onCliente={(c) => setDialogo({ tipo: "cliente", lead: l, cliente: c })}
      sugerencia={sinTelefono(l) ? sugerenciaDeTelefono(l, leads, clientes) : null}
      onTelefono={(quien, tel, ext, contacto) => guardaTelefono(l, quien, tel, ext, contacto)}
    />
  );
  const leadEnfocado = enfocado ? leads.find((l) => l.id === enfocado) ?? null : null;

  // Los controles de la fila 1: las pestañas, la tienda (o la fija) y la semana. Con la barra de arriba, suben a ella por un
  // portal (ver `hueco`); sin barra se quedan en su fila de siempre. Mismo bloque en los dos sitios.
  const enPoolTab = pestana === "banco" || (pestana === "privado" && veStxp);
  const bloque = (
    <div className="ld-en-la-barra" data-leads-en-la-barra>
      <div className="ld-pestanas" role="tablist">
        {/* D-1015 (Roberto, 12 nov): el STXP Pool (South Texas Permit) va PRIMERO; después GOV y lo demás. */}
        {veStxp && (
          <button type="button" role="tab" aria-selected={pestana === "privado"} className={`chip${pestana === "privado" ? " on" : ""}`} data-pestana="privado" onClick={() => cambiaPestana("privado")}>
            🏪 {t("STXP Pool", "STXP Pool")} <span className="cnt" data-privados>{vigentes(privados).length}</span>
          </button>
        )}
        <button type="button" role="tab" aria-selected={pestana === "banco"} className={`chip${pestana === "banco" ? " on" : ""}`} data-pestana="banco" onClick={() => cambiaPestana("banco")}>
          🏦 {t("GOV Pool", "GOV Pool")}
        </button>
        {yo.admin && (
          <button type="button" role="tab" aria-selected={pestana === "admin"} className={`chip${pestana === "admin" ? " on" : ""}`} data-pestana="admin" onClick={() => cambiaPestana("admin")}>
            🛠 Admin
          </button>
        )}
        {puedeVerEstadisticas(yo) && (
          <button type="button" role="tab" aria-selected={pestana === "estadisticas"} className={`chip${pestana === "estadisticas" ? " on" : ""}`} data-pestana="estadisticas" onClick={() => cambiaPestana("estadisticas")}>
            📊 {t("Stats", "Estadísticas")}
          </button>
        )}
      </div>
      <div className="ld-en-la-barra-selectores">
        {enPoolTab && (
          <>
            {elige ? (
              <label className="ld-selector" title={t("GOV Pool (nearest store)", "GOV Pool (tienda más cercana)")}>
                <span aria-hidden="true">🏬</span>
                <select data-pool value={pool ?? ""} aria-label={t("GOV Pool (nearest store)", "GOV Pool (tienda más cercana)")} onChange={(e) => { setPool(e.target.value); setPoolAMano(true); }}>
                  {pools.length > 1 && (() => {
                    const todas = resumenDeTodas(pools);
                    return (
                      <option value={POOL_TODAS}>
                        {t("All stores", "Todas las tiendas")} — {todas.total} {t("leads", "leads")}
                      </option>
                    );
                  })()}
                  {pools.map((p) => (
                    <option key={p.pool} value={p.pool}>
                      {poolLabel(p.pool, lang)} — {p.total} {t("leads", "leads")}
                    </option>
                  ))}
                </select>
              </label>
            ) : pestana === "privado" ? (
              /* D-770: su tienda y, agotada, la más cercana: se nombran las que le tocan, en orden. */
              <p className="ld-selector ld-fijo" data-pool-stxp>
                {t("STXP Pool: your store and, when it runs out, the nearest one", "STXP Pool: tu tienda y, agotada, la más cercana")}
                <br />
                <b>{pools.length ? pools.map((p) => `${poolLabel(p.pool, lang)} (${p.total})`).join(" → ") : "—"}</b>
              </p>
            ) : (
              /* Solo su tienda: no hay nada que elegir, y los otros bancos ni se nombran ni se cuentan. */
              <p className="ld-selector ld-fijo" data-pool-fijo>
                {t("GOV Pool of your store", "GOV Pool de tu tienda")}
                <br />
                <b>{alcance.tienda ? poolLabel(alcance.tienda, lang) : "—"}</b>
                {pools[0] ? <> — {pools[0].total} {t("leads", "leads")}</> : null}
              </p>
            )}
            {pestana === "privado" && semanasSTXP.semanas.length > 0 && (
              <label className="ld-selector" data-semana-stxp title={t("Week", "Semana")}>
                <select data-semana value={String(semanaActiva)} aria-label={t("Week", "Semana")} onChange={(e) => eligeSemana(e.target.value)}>
                  <option value="todas">{t("All weeks", "Todas las semanas")} ({privados.length})</option>
                  {semanasSTXP.semanas.map((s) => (
                    <option key={s.numero} value={String(s.numero)}>{etiquetaDeSemana(s, lang)} ({s.cuenta})</option>
                  ))}
                </select>
              </label>
            )}
          </>
        )}
      </div>
    </div>
  );
  const refrescar = (
    <button type="button" className="btn btn-ghost btn-sm ld-releer" onClick={() => void cargar()}>↻ {t("Refresh", "Actualizar")}</button>
  );

  return (
    <div className="ld-wrap leads-app">
      {/* Sin cabecera grande (Dueño, estilo de Merma): el nombre de la app ya está en la barra de arriba. Solo queda,
          si hay demo, su aviso y el «Demo: eres». */}
      {demo && (
        <div className="ld-cabecera">
          <span className="hint">{t("Demo data (invented).", "Datos de demostración (inventados).")}</span>
          {!yoReal && (
            <label className="ld-demo">
              {t("Demo: you are", "Demo: eres")}
              <select data-persona-demo value={idDemo} onChange={(e) => {
                const p = PERSONAS_DEMO.find((x) => x.id === e.target.value) ?? PERSONAS_DEMO[0];
                quien.current = p;
                setIdDemo(p.id); setPool(null); setPoolAMano(false); setPestana("banco"); setAviso(null);
              }}>
                {PERSONAS_DEMO.map((p) => <option key={p.id} value={p.id}>{p.name} ({p.role}{p.store ? ` · ${p.store}` : ""})</option>)}
              </select>
            </label>
          )}
        </div>
      )}

      {estado.tipo === "sinTabla" && (
        <div className="ld-aviso ambar" data-aviso-sin-tabla>
          {t(
            "The leads tables are not in the database yet (migration 162 is not applied). Nothing to show.",
            "Las tablas de leads aún no están en la base (falta aplicar la migración 162). No hay nada que enseñar.",
          )}
        </div>
      )}
      {estado.tipo === "error" && (
        <div className="ld-aviso rojo" data-aviso-error>{t("Could not read the leads", "No se pudieron leer los leads")}: {estado.texto}</div>
      )}
      {estado.tipo === "cargando" && <p className="hint">{t("Loading…", "Cargando…")}</p>}

      {estado.tipo === "listo" && (
        <>
          {/* Con la barra de arriba a la vista, los controles van a ella (portal); la fila queda solo con Actualizar, en
              Admin y Estadísticas. Sin barra (primer pintado, o una página sin ella), la fila lleva los controles de siempre. */}
          {hueco && createPortal(bloque, hueco)}
          {(!hueco || !enPoolTab) && (
            <div className="ld-fila-de-filtros" data-fila-de-filtros>
              {!hueco && bloque}
              {refrescar}
            </div>
          )}

          {aviso && <div className={`ld-aviso ${aviso.tono}`} data-aviso={aviso.tono} role="status">{aviso.texto}</div>}

          {/* El lead de una cotización (D-558): llega por `?lead=`. Solo si quien mira lo alcanza (la RLS ya lo filtró). */}
          {enfocado && (
            <div className="card" data-lead-enfocado={leadEnfocado ? "si" : "no"}>
              <h2 className="ld-h2">🧮 {t("Lead of the quote", "Lead de la cotización")}</h2>
              {leadEnfocado
                ? <div className="ld-lista">{tarjeta(leadEnfocado)}</div>
                : <p className="hint">{t("That lead is not visible to you.", "Ese lead no lo puedes ver.")}</p>}
            </div>
          )}

          {(pestana === "banco" || (pestana === "privado" && veStxp)) && (
            <>
              <div className="ld-filtros">
                {/* Fila 2 (como Merma): el título de la lista y su cuenta. Con la barra a la vista, Actualizar va al final de esta fila. */}
                <div className="ld-titulo-fila">
                  <h3 className="ld-titulo-de-lista">
                    {t("Leads in this pool", "Leads en este pool")} <span className="count-tag" data-cuenta-banco>{visibles.length}</span>
                  </h3>
                  {hueco && refrescar}
                </div>
                {/* Las etapas son el filtro: una por chip, con cuántos leads hay en cada una en este pool. Todas en una línea. */}
                <div className="ld-etapas filters-oneline" role="group" aria-label={t("Stage", "Etapa")} data-etapas>
                  <button type="button" className={`chip${etapa === "" ? " on" : ""}`} data-etapa="" onClick={() => setEtapa("")}
                    title={t("Every stage except Lost and Not a good lead", "Todas las etapas menos Perdido y No es buen lead")}>
                    {t("All stages", "Todas las etapas")} <span className="ld-cuenta">{delPool.filter((l) => l.status !== "archived" && enTodasLasEtapas(l)).length}</span>
                  </button>
                  {ETAPAS.map((e) => (
                    <button key={e} type="button" className={`chip ${etapaTono(e)}${etapa === e ? " on" : ""}`} data-etapa={e} aria-pressed={etapa === e}
                      onClick={() => setEtapa(etapa === e ? "" : e)}>
                      {etapaIcono(e)} {etapaLabel(e, lang)} <span className="ld-cuenta">{porEtapa[e]}</span>
                    </button>
                  ))}
                  <button type="button" className={`chip${buena ? " on" : ""}`} data-buena aria-pressed={buena} onClick={() => setBuena((v) => !v)}>
                    {t("Good category", "Categoría buena")} <span className="ld-cuenta">{buenas}</span>
                  </button>
                  {/* 335: los que no tienen teléfono de contratista (ni de mano ni del Excel): para trabajarlos. */}
                  <button type="button" className={`chip${sinTel ? " on" : ""}`} data-sin-telefono aria-pressed={sinTel} onClick={() => setSinTel((v) => !v)}>
                    📵 {t("No phone", "Sin teléfono")} <span className="ld-cuenta" data-cuenta-sin-telefono>{delPool.filter((l) => l.status !== "archived" && sinTelefono(l)).length}</span>
                  </button>
                  {/* D-760: el cruce con Clientes (lo pone el importador); solo tiene sentido donde hay cruzados. */}
                  {delPool.some(coincideConCliente) && (
                    <button type="button" className={`chip${coinciden ? " on" : ""}`} data-coinciden onClick={() => setCoinciden((v) => !v)}>
                      🤝 {t("Match customers", "Coinciden con clientes")} <span className="ld-cuenta">{delPool.filter(coincideConCliente).length}</span>
                    </button>
                  )}
                </div>
                {/* Fila 3 (como Merma): el buscador a la izquierda; los filtros, compactos y en línea (cada uno dice
                    su nombre en el título y en la primera opción); «Quitar filtros» a la derecha. */}
                <div className="ld-barra" data-barra>
                  <input
                    type="search" data-busca value={busca} onChange={(e) => setBusca(e.target.value)}
                    placeholder={t("Search anything: project, address, owner, phone, sales rep, customer…", "Buscar lo que sea: proyecto, dirección, dueño, teléfono, vendedor, cliente…")}
                    aria-label={t("Search", "Buscar")}
                  />
                  <select data-vendedor value={vendedorElegido} onChange={(e) => setVendedorElegido(e.target.value)} aria-label={t("Rep", "Vendedor")} title={t("Rep", "Vendedor")}>
                    <option value="">{t("👤 All reps", "👤 Todos los vendedores")}</option>
                    {vendedoresBanco.map((v) => <option key={v.id} value={v.id}>{v.nombre}</option>)}
                  </select>
                  <select data-categoria value={categoria} onChange={(e) => setCategoria(e.target.value)} aria-label={t("Category", "Categoría")} title={t("Category", "Categoría")}>
                    <option value="utiles">{t("Useful + might be useful", "Sirve + podría servir")}</option>
                    <option value="todas">{t("All categories", "Todas las categorías")}</option>
                    {valoresDe(delPool, "category").map((c) => <option key={c} value={c}>{delExcel(c, lang)}</option>)}
                  </select>
                  <select data-tipo value={tipo} onChange={(e) => setTipo(e.target.value)} aria-label={t("Project type", "Tipo de proyecto")} title={t("Project type", "Tipo de proyecto")}>
                    <option value="">{t("All project types", "Todos los tipos")}</option>
                    {valoresDe(delPool, "project_type").map((c) => <option key={c} value={c}>{delExcel(c, lang)}</option>)}
                  </select>
                  <select data-ciudad value={ciudad} onChange={(e) => setCiudad(e.target.value)} aria-label={t("Site city", "Ciudad de la obra")} title={t("Site city", "Ciudad de la obra")}>
                    <option value="">{t("All cities", "Todas las ciudades")}</option>
                    {valoresDe(delPool, "site_city").map((c) => <option key={c} value={c}>{c}</option>)}
                  </select>
                  <select data-orden value={orden} onChange={(e) => setOrden(e.target.value as Orden)} aria-label={t("Sort by", "Ordenar por")} title={t("Sort by", "Ordenar por")}>
                    <option value="pies">↕ {t("Square feet (largest first)", "Pies² (lo más grande)")}</option>
                    <option value="distancia">↕ {t("Distance (nearest first)", "Distancia (lo más cerca)")}</option>
                    <option value="costo">↕ {t("Estimated cost (highest first)", "Costo estimado (lo más alto)")}</option>
                    <option value="fecha">↕ {t("Registered (newest first)", "Registro (lo más nuevo)")}</option>
                    <option value="nombre">↕ {t("Builder / customer (A–Z)", "Constructor / cliente (A–Z)")}</option>
                  </select>
                  <button type="button" className="btn btn-ghost btn-sm" data-quitar-filtros onClick={limpiaFiltros}>
                    ✕ {t("Reset filters", "Quitar filtros")}
                  </button>
                </div>
              </div>
              {!elige && !alcance.tienda && (
                <div className="ld-aviso ambar" data-aviso-sin-tienda>
                  {t(
                    "Your user has no store assigned, so there is no GOV Pool to show you. Ask an admin to set your store.",
                    "Tu usuario no tiene tienda asignada, así que no hay GOV Pool que enseñarte. Pide a un admin que te ponga tu tienda.",
                  )}
                </div>
              )}
              {visibles.length === 0 && (
                /* Vacío con su porqué: o el pool no tiene nada, o lo esconden los filtros (y se ofrece quitarlos). */
                <div className="ld-vacio" data-vacio={delPool.length === 0 ? "pool" : "filtros"}>
                  <p className="hint">{t("No leads with these filters.", "No hay leads con estos filtros.")}</p>
                  {delPool.length === 0
                    ? <span>{t("This pool has no leads yet: they arrive with the next import.", "Este pool todavía no tiene leads: llegan con el próximo import.")}</span>
                    : <span>
                        {t(`This pool has ${delPool.length}, but the stage, filters or search hide them all.`, `Este pool tiene ${delPool.length}, pero la etapa, los filtros o la búsqueda los esconden todos.`)}{" "}
                        <button type="button" className="ld-enlace" data-vacio-quitar onClick={limpiaFiltros}>{t("Reset filters", "Quitar filtros")}</button>
                      </span>}
                </div>
              )}
              <div className="ld-lista" data-lista-banco>{visibles.slice(0, cuantos).map((l) => tarjeta(l))}</div>
              {visibles.length > cuantos && (
                <button type="button" className="btn btn-ghost ld-mas" data-ver-mas onClick={() => setCuantos((n) => n + TANDA)}>
                  {t("Show more", "Ver más")} ({visibles.length - cuantos})
                </button>
              )}
            </>
          )}

          {pestana === "admin" && yo.admin && (
            <Admin
              leads={leads} almacen={almacen} demo={demo}
              vista={veStxp ? vistaStats : "gov"} puedeStxp={veStxp} onVista={setVistaStats}
            />
          )}

          {pestana === "estadisticas" && puedeVerEstadisticas(yo) && <Estadisticas almacen={almacen} leads={leads} puedeStxp={veStxp} />}
        </>
      )}

      {dialogo?.tipo === "cliente" && <FichaCruzada dialogo={dialogo} onCerrar={() => setDialogo(null)} />}
      {dialogo && dialogo.tipo !== "cliente" && (
        <Accion
          dialogo={dialogo} almacen={almacen}
          onCerrar={() => setDialogo(null)}
          onHecho={async (id, r, texto) => { if (await tras(id, r, texto)) setDialogo(null); }}
        />
      )}
    </div>
  );
}

/** La etapa de un lead, como píldora de color. «New» (sin etapa) es gris. */
function PildoraEtapa({ e }: { e: Etapa }) {
  const { lang } = usePrefs();
  return <span className={`ld-pildora ${etapaTono(e)}`} data-pildora-etapa={e}>{etapaIcono(e)} {etapaLabel(e, lang)}</span>;
}

function Tarjeta({ lead: l, ocupado, almacen, historial, llamadas, onNota, onHistorial, onLlamadas, cotizar, cotizaciones, cliente, onCliente, semana, sugerencia, onTelefono }: {
  lead: Lead; ocupado: boolean; almacen: AlmacenDeLeads;
  historial: EventoLead[] | null | undefined;
  /** 337: las llamadas de RingCentral a los teléfonos del lead (null = cargando; undefined = cerrada). */
  llamadas: LlamadaDeLead[] | null | undefined;
  onNota: () => void; onHistorial: () => void; onLlamadas: () => void;
  /** 335: un teléfono que este lead no tiene y otro lead (o el cliente) sí. Solo si el contratista no tiene ninguno. */
  sugerencia: Sugerencia | null;
  /** 335: pone (o quita, con telefono null) el teléfono a mano de un lado. Devuelve si se guardó. */
  onTelefono: (quien: "owner" | "tenant", telefono: string | null, ext: string | null, contacto: string | null) => Promise<boolean>;
  /** `puedeCotizarLead` (D-558): se ofrece «Crear cotización». */
  cotizar: boolean;
  /** Las cotizaciones de este lead que quien mira ve en el Quote Builder (D-558). */
  cotizaciones: CotizacionDeLead[];
  /** D-762: el cliente con el que coincide (218), si ya se leyó: para el enlace y el vendedor. */
  cliente?: ClienteCruzado;
  /** D-763: abre la tarjeta del cliente aquí mismo (el dueño no quiere saltar a la app de Clientes). */
  onCliente: (c: ClienteCruzado) => void;
  /** El número de semana del STXP Pool de este lead (un import = una semana); solo los privados la tienen. */
  semana?: number;
}) {
  const { t, lang } = usePrefs();
  const mapa = mapsUrl(l);
  const tdlr = enlaceSeguro(l.tdlr_link);
  const etapa = etapaDe(l);
  const veces = vecesVisto(l);
  // Ya trabajado: quien hizo el último contacto y cuándo (`last_by` y `last_at` van juntos desde la nota de avance).
  const trabajado = !!l.last_by && !!l.last_at;
  return (
    <article className="ld-tarjeta" data-lead={l.id} data-estado={l.status} data-etapa={etapa}>
      {/* Ya trabajado: una franja de color arriba (quién, cuándo y la etapa en texto). Sin trabajar, la cabecera de siempre. */}
      {trabajado && (
        <div className="ld-franja" data-franja-vendedor data-etapa-franja={etapa}>
          <b data-ultimo-contacto>👤 {l.last_by_name ?? "—"}</b>
          <span className="ld-franja-der">
            <span>{fecha(l.last_at)}</span>
            <span data-pildora-etapa-texto={etapa}>{etapaIcono(etapa)} {etapaLabel(etapa, lang)}</span>
          </span>
        </div>
      )}
      <header>
        <h3>{l.project_name ?? l.facility_name ?? l.tabs_project}</h3>
        {/* Sin trabajar: la etapa y, si la hay, quién hizo el último contacto, en la misma fila que el título. */}
        {!trabajado && (
          <div className="ld-cabeza-der">
            <PildoraEtapa e={etapa} />
            {l.last_at && (
              <span className="ld-ultimo" data-ultimo-contacto>👤 {l.last_by_name ?? "—"} · {fecha(l.last_at)}</span>
            )}
          </div>
        )}
      </header>
      <p className="ld-meta">
        {semana != null && <><span className="badge ld-semana" data-semana-lead>{t("Week", "Semana")} {semana}</span>{" "}</>}
        <span className="ld-dist">{l.distance_miles === null ? "—" : `${l.distance_miles.toFixed(1)} mi`}</span>{" · "}
        <span className="badge ld-cat">{delExcel(l.category, lang)}</span> {delExcel(l.project_type, lang)}
        {l.type_of_work ? ` · ${l.type_of_work}` : ""}
      </p>
      {veces > 1 && (
        <p className="ld-visto" data-visto={veces} title={`${t("Last import that had it", "Última carga que lo trajo")}: ${fecha(l.last_seen_at ?? l.imported_at ?? null)}`}>
          🔁 {t(`seen in ${veces} imports`, `visto en ${veces} importaciones`)}
        </p>
      )}
      {l.customer_match_note && (
        <p className="ld-cliente" data-cliente={l.customer_match_id ?? ""}>
          🤝 {t("Customer", "Cliente")}:{" "}
          {cliente
            ? <button type="button" className="ld-enlace" data-ficha-cliente onClick={() => onCliente(cliente)}>{cliente.account} ({cliente.store})</button>
            : l.customer_match_note}
          {cliente && <> · {t("Sales rep", "Vendedor")}: <b data-vendedor-cliente>{cliente.rep_name ?? t("Unassigned", "Sin asignar")}</b></>}
          {cliente && <span className="hint"> · {l.customer_match_note}</span>}
        </p>
      )}

      {l.follow_up_note && (
        <p className="ld-avance" data-avance>
          📝 {l.follow_up_note}{" "}
          <span className="hint">· {fecha(l.follow_up_at)}</span>
        </p>
      )}

      <p className="ld-dir">
        📍 {mapa ? <a href={mapa} target="_blank" rel="noopener noreferrer" data-mapa>{[l.site_address, l.site_city, l.site_zip].filter(Boolean).join(", ")}</a> : "—"}
      </p>
      <div className="ld-contacto" data-contacto>
        {/* D-760: en un lead privado el que va aquí es el CONTRATISTA (a quien se le vende); el propietario, abajo. */}
        <p>{esPrivado(l) ? <>🏗 {t("Contractor", "Contratista")}: </> : "👤 "}{l.owner_name ?? "—"}{l.owner_contact ? ` · ${l.owner_contact}` : ""}</p>
        <FilaTelefono
          quien="owner" lead={l} ocupado={ocupado} sugerencia={sugerencia}
          numero={telefonoDeContratista(l)} deMano={!!(l.owner_phone_manual ?? "").trim()}
          contacto={l.owner_phone_manual_contact ?? null} porNombre={l.owner_phone_manual_by_name ?? null} cuando={l.owner_phone_manual_at ?? null}
          busqueda={sinTelefono(l) ? enlaceDeBusqueda(l) : null}
          onGuardar={(tel, ext, contacto) => onTelefono("owner", tel, ext, contacto)}
        />
        {l.tenant_name && (
          <>
            <p>{esPrivado(l) ? <>🏠 {t("Owner", "Propietario")}</> : <>🏪 {t("Tenant", "Inquilino")}</>}: {l.tenant_name}</p>
            <FilaTelefono
              quien="tenant" lead={l} ocupado={ocupado} sugerencia={null}
              numero={telefonoDeOtro(l)} deMano={!!(l.tenant_phone_manual ?? "").trim()}
              contacto={l.tenant_phone_manual_contact ?? null} porNombre={l.tenant_phone_manual_by_name ?? null} cuando={l.tenant_phone_manual_at ?? null}
              busqueda={null}
              onGuardar={(tel, ext, contacto) => onTelefono("tenant", tel, ext, contacto)}
            />
          </>
        )}
        {l.design_firm_name && (
          <p>📐 {t("Design firm", "Despacho")}: {l.design_firm_name}{l.design_firm_phone ? <> · {telUrl(l.design_firm_phone) ? <a href={telUrl(l.design_firm_phone)!}>📞 {telefonoEstandar(l.design_firm_phone)}</a> : telefonoEstandar(l.design_firm_phone)}</> : null}</p>
        )}
      </div>
      <dl className="ld-datos">
        <div><dt>{t("Est. cost", "Costo est.")}</dt><dd>{dinero(l.estimated_cost)}</dd></div>
        <div><dt>{t("Sq ft", "Pies²")}</dt><dd>{numero(l.square_footage)}</dd></div>
        <div><dt>{t("Start", "Inicio")}</dt><dd>{fecha(l.est_start_date)}</dd></div>
        <div><dt>{t("Completion", "Fin")}</dt><dd>{fecha(l.est_completion_date)}</dd></div>
        <div><dt>{t("Registered", "Registro")}</dt><dd>{fecha(l.registered_date)}</dd></div>
      </dl>
      {l.scope_of_work && <p className="ld-alcance">{l.scope_of_work}</p>}
      {l.reason && <p className="hint">💬 {l.reason}</p>}
      {cotizaciones.length > 0 && (
        <p className="ld-cotizaciones" data-cotizaciones={cotizaciones.length}>
          🧮 {cotizaciones.length === 1 ? t("1 quote", "1 cotización") : t(`${cotizaciones.length} quotes`, `${cotizaciones.length} cotizaciones`)}:{" "}
          {cotizaciones.map((c, i) => (
            <span key={c.id}>{i > 0 ? " · " : ""}<Link href={enlaceACotizacion(c.id)} data-cotizacion={c.id}>#{c.estimate_num}</Link></span>
          ))}
        </p>
      )}

      <footer>
        <button type="button" className="btn btn-primary" data-nota disabled={ocupado} onClick={onNota}>📝 {t("Add note / stage", "Anotar / etapa")}</button>
        {cotizar && (
          <Link className="btn btn-ghost btn-sm" href={enlaceACotizar(l.id)} data-crear-cotizacion>🧮 {t("Create quote", "Crear cotización")}</Link>
        )}
        <button type="button" className="btn btn-ghost btn-sm" data-historial onClick={onHistorial}>🕘 {t("History", "Historial")}</button>
        <button type="button" className="btn btn-ghost btn-sm" data-llamadas onClick={onLlamadas}>📞 {t("Calls", "Llamadas")}</button>
        {tdlr && <a className="btn btn-ghost btn-sm" href={tdlr} target="_blank" rel="noopener noreferrer" data-tdlr>TDLR ↗</a>}
        <span className="hint ld-tabs">{l.tabs_project}</span>
      </footer>
      {historial !== undefined && (
        <ul className="ld-historial" data-historial-lista>
          {historial === null && <li className="hint">{t("Loading…", "Cargando…")}</li>}
          {historial?.length === 0 && <li className="hint">{t("No history yet.", "Sin historial todavía.")}</li>}
          {historial?.map((e) => (
            <li key={e.id}>
              <b>{eventoLabel(e, lang)}</b> · {e.actor_name ?? e.subject_name ?? "—"} · {fecha(e.at)}
              {e.note ? <> — «{e.note}»</> : null}
            </li>
          ))}
        </ul>
      )}
      {llamadas !== undefined && <LlamadasDelLead lead={l} lista={llamadas} almacen={almacen} />}
    </article>
  );
}

/**
 * 335: la línea del teléfono de un lado (contratista o propietario). Con teléfono: el número con su enlace de llamada, la
 * marca ✍ si lo puso una persona (quién y cuándo al tocarla) y el lápiz para corregirlo. Sin teléfono: «Añadir», la
 * sugerencia («Usar este») si la hay, y «Buscar» en Google (solo del contratista).
 */
function FilaTelefono({ quien, lead, ocupado, sugerencia, numero, deMano, contacto, porNombre, cuando, busqueda, onGuardar }: {
  quien: "owner" | "tenant"; lead: Lead; ocupado: boolean; sugerencia: Sugerencia | null;
  numero: string | null; deMano: boolean; contacto: string | null; porNombre: string | null; cuando: string | null;
  busqueda: string | null;
  onGuardar: (telefono: string | null, ext: string | null, contacto: string | null) => Promise<boolean>;
}) {
  const { t } = usePrefs();
  const [modo, setModo] = useState<"ver" | "editar">("ver");
  const [quienVerla, setQuienVerla] = useState(false);
  const tieneNum = tieneTelefono(numero);
  const url = tieneNum ? telUrl(numero) : null;
  const sugiere = !tieneNum && sugerencia && quien === "owner" ? sugerencia : null;
  const sugerenciaValida = sugiere ? validaTelefono(sugiere.telefono) : null;

  if (modo === "editar") {
    return (
      <FormaTelefono
        quien={quien} numeroInicial={numero && deMano ? numero : ""} contactoInicial={contacto ?? ""} puedeQuitar={deMano}
        ocupado={ocupado}
        onGuardar={async (tel, ext, c) => { const ok = await onGuardar(tel, ext, c); if (ok) setModo("ver"); return ok; }}
        onCancelar={() => setModo("ver")}
      />
    );
  }

  return (
    <div className="ld-tel-fila" data-telefono-fila={quien}>
      {tieneNum ? (
        <>
          {url
            ? <a href={url} data-tel data-telefono-de={quien}>📞 {telefonoParaMostrar(numero)}</a>
            : <span data-telefono-de={quien}>📞 {telefonoParaMostrar(numero)}</span>}
          {deMano && (
            <>
              <button type="button" className="ld-mano" data-telefono-a-mano aria-expanded={quienVerla} title={t("Added by hand: tap for who and when", "Añadido a mano: toca para ver quién y cuándo")}
                onClick={() => setQuienVerla((v) => !v)}>✍</button>
              {quienVerla && (
                <span className="hint" data-quien-telefono>
                  {t("Added by", "Añadido por")} {porNombre ?? "—"}{cuando ? ` · ${fecha(cuando)}` : ""}{contacto ? ` · ${contacto}` : ""}
                </span>
              )}
            </>
          )}
          <button type="button" className="btn btn-ghost btn-sm" data-editar-telefono disabled={ocupado} onClick={() => setModo("editar")}>
            ✏️ {t("Edit", "Editar")}
          </button>
        </>
      ) : sugiere && sugerenciaValida?.ok ? (
        <>
          <span data-sugerencia={sugiere.origen.tipo}>
            💡 {telefonoParaMostrar(sugiere.telefono)}{" "}
            <span className="hint">
              {sugiere.origen.tipo === "permiso"
                ? `· ${t("phone from another permit of this contractor", "teléfono de otro permiso de este contratista")} (${sugiere.origen.tabs})`
                : `· ${t("phone from the customer record", "teléfono de la ficha del cliente")} (${sugiere.origen.cuenta})`}
            </span>
          </span>
          <button type="button" className="btn btn-sm" data-usar-sugerencia disabled={ocupado}
            onClick={() => void onGuardar(sugerenciaValida.valor.telefono, sugerenciaValida.valor.ext, null)}>
            {t("Use this", "Usar este")}
          </button>
        </>
      ) : sugiere ? (
        <span className="hint" data-sugerencia-sin-formato>💡 {sugiere.telefono}</span>
      ) : (
        // Roberto (16 nov, ayuda): «some leads dont have phone #». El aviso se ve, no en gris.
        <span className="ld-aviso-sin-telefono" data-sin-telefono-de={quien}>📵 {t("No phone", "Sin teléfono")}</span>
      )}
      {!tieneNum && (
        <button type="button" className="btn btn-primary btn-sm" data-anadir-telefono={quien} disabled={ocupado} onClick={() => setModo("editar")}>
          ➕ {t("Add phone", "Añadir teléfono")}
        </button>
      )}
      {!tieneNum && busqueda && (
        <a className="ld-buscar" href={busqueda} target="_blank" rel="noopener noreferrer" data-buscar-telefono>🔎 {t("Search", "Buscar")}</a>
      )}
    </div>
  );
}

/** 335: el formulario del teléfono a mano: número (teclado numérico), extensión opcional, nombre de contacto opcional. */
function FormaTelefono({ quien, numeroInicial, contactoInicial, puedeQuitar, ocupado, onGuardar, onCancelar }: {
  quien: "owner" | "tenant"; numeroInicial: string; contactoInicial: string; puedeQuitar: boolean; ocupado: boolean;
  onGuardar: (telefono: string | null, ext: string | null, contacto: string | null) => Promise<boolean>;
  onCancelar: () => void;
}) {
  const { t } = usePrefs();
  const [numero, setNumero] = useState(numeroInicial);
  const [ext, setExt] = useState("");
  const [contacto, setContacto] = useState(contactoInicial);
  const [error, setError] = useState<string | null>(null);
  const motivos: Record<"vacio" | "digitos" | "ext", string> = {
    vacio: t("Type the phone number.", "Escribe el teléfono."),
    digitos: t("A US phone has 10 digits (area code first).", "Un teléfono de EE. UU. tiene 10 dígitos (primero el área)."),
    ext: t("The extension is up to 6 digits.", "La extensión es de hasta 6 dígitos."),
  };
  const enviar = async () => {
    const v = validaTelefono(numero, ext);
    if (!v.ok) { setError(motivos[v.motivo]); return; }
    setError(null);
    const ok = await onGuardar(v.valor.telefono, v.valor.ext, contacto.trim() || null);
    if (!ok) setError(t("It was not saved. See the message above.", "No se guardó. Mira el aviso de arriba."));
  };
  return (
    <form className="ld-telefono-form" data-forma-telefono={quien} onSubmit={(e) => { e.preventDefault(); void enviar(); }}>
      <div className="ld-tel-campos">
        <label>
          {t("Phone", "Teléfono")}
          <input type="tel" inputMode="tel" autoComplete="tel" value={numero} onChange={(e) => setNumero(e.target.value)}
            placeholder="(956) 555-0123" data-telefono-numero />
        </label>
        <label className="ld-ext">
          {t("Ext.", "Ext.")}
          <input type="text" inputMode="numeric" maxLength={6} value={ext} onChange={(e) => setExt(e.target.value.replace(/\D/g, ""))} data-telefono-ext />
        </label>
      </div>
      <label>
        {t("Contact name (optional)", "Nombre de contacto (opcional)")}
        <input type="text" maxLength={80} value={contacto} onChange={(e) => setContacto(e.target.value)} data-telefono-contacto />
      </label>
      {error && <p className="ld-telefono-error" role="alert" data-telefono-error>{error}</p>}
      <div className="ld-tel-botones">
        <button type="submit" className="btn btn-primary" disabled={ocupado} data-guardar-telefono>{t("Save", "Guardar")}</button>
        <button type="button" className="btn btn-ghost" onClick={onCancelar} data-cancelar-telefono>{t("Cancel", "Cancelar")}</button>
        {puedeQuitar && (
          <button type="button" className="btn btn-danger btn-sm" disabled={ocupado} data-quitar-telefono
            onClick={() => void onGuardar(null, null, null)}>
            {t("Remove the phone added by hand", "Quitar el teléfono a mano")}
          </button>
        )}
      </div>
    </form>
  );
}

/** D-763: la tarjeta del cliente con el que coincide un lead cruzado, dentro de Leads. Solo lectura. */
function FichaCruzada({ dialogo, onCerrar }: { dialogo: Extract<Dialogo, { tipo: "cliente" }>; onCerrar: () => void }) {
  const { t } = usePrefs();
  const c = dialogo.cliente;
  const filas: [string, string | null][] = [
    [t("Store", "Tienda"), c.store],
    [t("Sales rep", "Vendedor"), c.rep_name ?? t("Unassigned", "Sin asignar")],
    [t("Contact", "Contacto"), [c.contact_name, c.contact_title].filter(Boolean).join(" · ") || null],
    [t("Phone", "Teléfono"), telefonoEstandar(c.phone) || null],
    [t("Email", "Correo"), c.email],
    [t("Address", "Dirección"), c.address],
    [t("Account no.", "N.º de cuenta"), c.account_no],
    // Los términos con su etiqueta de Clientes («30 days» / «30 días»); uno viejo, tal cual.
    [t("Terms", "Términos"), c.terms?.trim() ? terminoLabel(c.terms, t) : null],
    [t("Credit limit", "Límite de crédito"), c.credit_limit == null ? null : dinero(c.credit_limit)],
    [t("Status", "Estado"), [c.activity_status, c.status_store].filter(Boolean).join(" · ") || null],
    [t("Notes", "Notas"), c.notes],
    [t("Why it matched", "Por qué coincide"), dialogo.lead.customer_match_note ?? null],
  ];
  return (
    <div className="ld-velo" role="dialog" aria-modal="true" data-dialogo="cliente" onClick={onCerrar}>
      <div className="ld-dialogo" onClick={(e) => e.stopPropagation()}>
        <h2>🤝 {c.account}</h2>
        <dl className="ld-ficha" data-ficha-cruzada={c.id}>
          {filas.map(([k, v]) => v ? <div key={k}><dt>{k}</dt><dd>{v}</dd></div> : null)}
        </dl>
        <div className="ld-botones">
          <Link className="btn btn-ghost" href={`/customers/${c.id}`} data-abrir-en-clientes>{t("Open in Customers", "Abrir en Clientes")} ↗</Link>
          <button type="button" className="btn" onClick={onCerrar} data-cerrar-ficha>{t("Close", "Cerrar")}</button>
        </div>
      </div>
    </div>
  );
}

/** El diálogo de una acción sobre un lead: anotar, con etapa o solo con una nota. */
function Accion({ dialogo, almacen, onCerrar, onHecho }: {
  dialogo: Dialogo; almacen: AlmacenDeLeads;
  onCerrar: () => void; onHecho: (id: string, r: Res<Lead>, texto: string) => Promise<void>;
}) {
  const { t, lang } = usePrefs();
  const l = dialogo.lead;
  const [nota, setNota] = useState("");
  const [etapa, setEtapa] = useState<TipoDeAccion | null>(null);
  const [enviando, setEnviando] = useState(false);
  // Sin etapa, la nota es obligatoria (328); con etapa, puede ir vacía.
  const notaOk = notaLimpia(nota) !== null;
  const puedeAnotar = etapa !== null || notaOk;
  const enviar = async (hace: () => Promise<Res<Lead>>, texto: string) => {
    setEnviando(true);
    await onHecho(l.id, await hace(), texto);
    setEnviando(false);
  };

  return (
    <div className="ld-velo" role="dialog" aria-modal="true" data-dialogo={dialogo.tipo}>
      <div className="ld-dialogo">
        <h2>{l.project_name ?? l.tabs_project}</h2>
        {dialogo.tipo === "nota" && (
          <>
            <p className="hint">
              {t(
                "Pick the stage this lead is in now. Any note you add moves it to that stage. Choosing Closed means a sale.",
                "Elige la etapa en la que está ahora. Cualquier nota que añadas la mueve a esa etapa. Cerrado significa venta.",
              )}
            </p>
            <p className="hint">{t("Now", "Ahora")}: <b>{etapaLabel(etapaDe(l), lang)}</b></p>
            <div className="ld-acciones" role="radiogroup" aria-label={t("Stage", "Etapa")} data-acciones>
              {TIPOS_DE_ACCION.map((a) => (
                <button key={a} type="button" role="radio" aria-checked={etapa === a} data-accion={a} data-pildora-etapa={a}
                  className={`ld-pildora ${etapaTono(a)}${etapa === a ? " on" : ""}`} onClick={() => setEtapa(etapa === a ? null : a)}>
                  {etapaIcono(a)} {etapaLabel(a, lang)}
                </button>
              ))}
            </div>
          </>
        )}
        <label className="ld-nota">
          {etapa !== null ? t("Note (optional)", "Nota (opcional)") : t("Note (required when no stage is picked)", "Nota (obligatoria si no eliges etapa)")}
          <textarea data-nota-texto value={nota} maxLength={NOTA_MAX} rows={4} onChange={(e) => setNota(e.target.value)}
            placeholder={t("What happened: who you spoke with, what they said, what is next…", "Qué pasó: con quién hablaste, qué dijeron, qué sigue…")} />
        </label>
        <div className="ld-botones">
          <button type="button" className="btn btn-ghost" data-cancelar onClick={onCerrar}>{t("Cancel", "Cancelar")}</button>
          {dialogo.tipo === "nota" && (
            <button type="button" className="btn btn-primary" data-guardar disabled={enviando || !puedeAnotar}
              onClick={() => void enviar(() => almacen.anotar(l.id, nota, etapa), t("Note saved.", "Nota guardada."))}>
              {t("Save note", "Guardar nota")}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

/** La pestaña del admin: el tablero por tienda y por persona, los leads que volvieron en más de una carga, y cómo se importa. */
function Admin({ leads, almacen, demo, vista, puedeStxp, onVista }: {
  leads: Lead[]; almacen: AlmacenDeLeads; demo: boolean;
  /** Qué pool enseña el tablero (D-1145, reunión del 23 nov 2026). Sin STXP para quien no lo ve: siempre «gov». */
  vista: VistaDePool;
  /** ¿Puede ver el STXP Pool? Solo entonces hay interruptor y números de STXP. */
  puedeStxp: boolean;
  onVista: (v: VistaDePool) => void;
}) {
  const { t, lang } = usePrefs();
  const [eventos, setEventos] = useState<EventoLead[]>([]);
  // El historial se relee cuando cambian los leads: una nota nueva cambia el tablero.
  useEffect(() => { void almacen.eventos().then((r) => { if (r.ok) setEventos(r.valor); }); }, [almacen, leads]);

  // Todo el tablero cuenta solo los leads de la vista (y su historial): el pool que se eligió, o los dos.
  const leadsDeVista = useMemo(() => leadsDeLaVista(leads, vista), [leads, vista]);
  const eventosDeVista = useMemo(() => {
    const ids = new Set(leadsDeVista.map((l) => l.id));
    return eventos.filter((e) => ids.has(e.lead_id));
  }, [eventos, leadsDeVista]);
  const etiquetaVista = vista === "stxp" ? "STXP Pool" : vista === "gov" ? "GOV Pool" : t("Both", "Los dos");

  const porTienda = tableroPorTienda(leadsDeVista, eventosDeVista);
  const vendedores = tableroPorVendedor(eventosDeVista);
  const vistos = cuantosVistosMasDeUna(leadsDeVista);

  return (
    <div className="ld-admin">
      {puedeStxp && (
        <div className="card ld-ancho-total" data-bloque="vista">
          <div className="ld-segmento" role="tablist" aria-label={t("Pool of the numbers", "Pool de los números")}>
            {(["gov", "stxp", "ambos"] as const).map((v) => (
              <button key={v} type="button" role="tab" aria-selected={vista === v} className={`chip${vista === v ? " on" : ""}`}
                data-pool-de-numeros={v} onClick={() => onVista(v)}>
                {v === "gov" ? "GOV Pool" : v === "stxp" ? "STXP Pool" : t("Both", "Los dos")}
              </button>
            ))}
          </div>
          <p className="hint" data-pool-de-numeros-actual>{t("These numbers are for:", "Estos números son de:")} <b>{etiquetaVista}</b></p>
        </div>
      )}
      <div className="card ld-ancho-total" data-bloque="etapas">
        <h2>🏬 {t("By GOV Pool and stage", "Por GOV Pool y etapa")}</h2>
        <TablaEstandar id="leads-por-tienda" data-tabla="por-tienda" sinCaja filas={porTienda} claveDe={(p) => p.pool} columnas={[
          { key: "pool", en: "GOV Pool", es: "GOV Pool", ancho: 200, fija: true, valor: (p) => poolLabel(p.pool, lang) },
          ...ETAPAS.map((e) => ({ key: e, en: etapaLabel(e, "en"), es: etapaLabel(e, "es"), ancho: 120, numerico: true, valor: (p: (typeof porTienda)[number]) => p.porEtapa[e] })),
          { key: "cotizados", en: "Ever quoted", es: "Alguna vez cotizado", ancho: 130, numerico: true, valor: (p) => p.cotizadosAlgunaVez },
          { key: "total", en: "Total", es: "Total", ancho: 110, numerico: true, valor: (p) => p.total },
        ]} />
      </div>

      {/* 335: el hueco de teléfonos por pool, y los que se añadieron a mano este mes y quién los añadió. */}
      <div className="card" data-bloque="telefonos">
        <h2>📞 {t("Phones", "Teléfonos")}</h2>
        <p className="hint" data-sin-telefono-por-pool>
          <b>{t("No phone (contractor):", "Sin teléfono (contratista):")}</b>{" "}
          {sinTelefonoPorPool(leadsDeVista).map((p) => `${poolLabel(p.pool, lang)} ${p.n}`).join(" · ") || "—"}
        </p>
        <p className="hint" data-a-mano-este-mes>
          <b>{t("Added by hand this month:", "Añadidos a mano este mes:")} {telefonosAMano(eventosDeVista, new Date()).total}</b>
          {telefonosAMano(eventosDeVista, new Date()).porPersona.length > 0 && (
            <> — {telefonosAMano(eventosDeVista, new Date()).porPersona.map((x) => `${x.nombre} ${x.n}`).join(" · ")}</>
          )}
        </p>
      </div>

      <div className="card" data-bloque="vendedores">
        <h2>👥 {t("By person (from the history)", "Por persona (del historial)")}</h2>
        {vendedores.length === 0 ? <p className="hint">{t("Nobody has added a note yet.", "Nadie ha anotado todavía.")}</p> : (
          <TablaEstandar id="leads-por-persona" data-tabla="por-persona" sinCaja filas={vendedores} claveDe={(v) => String(v.id)} columnas={[
            { key: "nombre", en: "Person", es: "Persona", ancho: 220, fija: true, valor: (v) => v.nombre },
            { key: "notas", en: "Notes", es: "Notas", ancho: 110, numerico: true, valor: (v) => v.notas },
            { key: "cotizaciones", en: "Quotes", es: "Cotizaciones", ancho: 120, numerico: true, valor: (v) => v.cotizaciones },
            { key: "ventas", en: "Sales", es: "Ventas", ancho: 110, numerico: true, valor: (v) => v.ventas },
          ]} />
        )}
      </div>

      <div className="card" data-bloque="vistos">
        <h2>🔁 {t("Seen in more than one import", "Visto en más de una carga")}</h2>
        <p className="hint" data-vistos>
          <b>{vistos}</b> {t("leads came back in a new import. Each import that brings a lead back adds one to its count.", "leads volvieron en una carga nueva. Cada carga que trae un lead de vuelta le suma uno a su cuenta.")}
        </p>
      </div>

      <div className="card ld-ancho-total" data-bloque="importar">
        <h2>📥 {t("Import or update leads", "Importar o actualizar leads")}</h2>
        <p className="hint">
          {t(
            "Leads are loaded from the Excel by a script, not from this screen. A re-import updates the data of the leads already here, adds the new ones and counts each lead that came back. It never touches a lead's stage or its history.",
            "Los leads se cargan desde el Excel con un guion, no desde esta pantalla. Un re-import actualiza los datos de los leads que ya están, añade los nuevos y cuenta cada lead que volvió. Nunca toca la etapa de un lead ni su historial.",
          )}
        </p>
        <code className="ld-comando">node scripts/leads/importa-leads.mjs &lt;file.xlsx&gt; --aplicar</code>
        {demo && <p className="hint">{t("Not available in demo mode.", "No disponible en modo demo.")}</p>}
      </div>
    </div>
  );
}
