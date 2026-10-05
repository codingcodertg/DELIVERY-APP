"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { usePrefs } from "@/lib/prefs";
import { createClient } from "@/lib/supabase/client";
import { almacenDeLaBase, type AlmacenDeLeads, type Res } from "@/lib/leads/almacen";
import { ALCANCE_SIN_REGLA, eligeTienda, leadsDelBanco, type Alcance } from "@/lib/leads/alcance";
import { almacenDemo, PERSONAS_DEMO } from "@/lib/leads/demo";
import {
  abiertosDe, bloqueado, colaDeRevision, consecuencia, delExcel, dinero, enlaceSeguro, estadoLabel, eventoLabel, fecha, filtrar,
  mapsUrl, negativaTexto, notaLimpia, numero, ordenar, poolInicial, poolLabel, poolsDe, puedeTomar, puestosLibres, RESULTADOS,
  resultadoLabel, sinTocar, tableroPorVendedor, telUrl, valoresDe, veContacto, ventasDe, NOTA_MAX,
  type EventoLead, type FiltroCategoria, type Lead, type Orden, type Persona, type Resultado, type Vista,
} from "@/lib/leads/reglas";

type Estado = { tipo: "cargando" } | { tipo: "sinTabla" } | { tipo: "error"; texto: string } | { tipo: "listo" };
type Pestana = "banco" | "mio" | "admin";
type Dialogo =
  | { tipo: "cerrar"; lead: Lead }
  | { tipo: "nota"; lead: Lead }
  | { tipo: "admin"; lead: Lead };

/** Cuántas tarjetas se pintan de entrada y cuántas más con cada «ver más»: en un teléfono, 140 tarjetas de golpe pesan. */
const TANDA = 30;
/** Los «sin tocar hace N días» que ofrece el tablero. */
const DIAS_SIN_TOCAR = [7, 14, 30];

/**
 * «Leads» (migración 162): el banco de leads por tienda (en la pantalla, «Pool General»), el pool personal con tope,
 * y lo del admin. Quién alcanza los leads de qué tienda lo decide la base (migración 163) y aquí solo se pinta.
 *
 * Todas las reglas viven en `lib/leads/reglas` y están probadas sin navegador; la base las vuelve a exigir (las
 * funciones de la 162). Este componente lee, filtra y pinta, y cada acción va por el almacén, que devuelve el lead
 * como quedó en la base: eso es lo que se pinta.
 */
export function Leads({ demo, yo: yoReal }: { demo: boolean; yo: Persona | null }) {
  const { t, lang } = usePrefs();

  // En el demo no hay sesión: se elige quién se es, para poder enseñar «lo tiene otra persona» y la parte del admin.
  const [idDemo, setIdDemo] = useState(PERSONAS_DEMO[0].id);
  const yo: Persona | null = demo ? (PERSONAS_DEMO.find((p) => p.id === idDemo) ?? PERSONAS_DEMO[0]) : yoReal;
  const quien = useRef<Persona>(PERSONAS_DEMO[0]);
  useEffect(() => { if (yo) quien.current = yo; });
  const almacen: AlmacenDeLeads = useMemo(() => (demo ? almacenDemo(() => quien.current) : almacenDeLaBase(createClient())), [demo]);

  const [leads, setLeads] = useState<Lead[]>([]);
  const [tope, setTope] = useState(10);
  const [alcance, setAlcance] = useState<Alcance>(ALCANCE_SIN_REGLA);
  const [estado, setEstado] = useState<Estado>({ tipo: "cargando" });
  const [pestana, setPestana] = useState<Pestana>("banco");
  const [pool, setPool] = useState<string | null>(null);
  const [vista, setVista] = useState<Vista>("libres");
  const [categoria, setCategoria] = useState<FiltroCategoria>("utiles");
  const [tipo, setTipo] = useState("");
  const [ciudad, setCiudad] = useState("");
  const [busca, setBusca] = useState("");
  const [orden, setOrden] = useState<Orden>("distancia");
  const [cuantos, setCuantos] = useState(TANDA);
  const [ocupado, setOcupado] = useState<string | null>(null);
  const [aviso, setAviso] = useState<{ tono: "rojo" | "verde"; texto: string } | null>(null);
  const [dialogo, setDialogo] = useState<Dialogo | null>(null);
  const [historial, setHistorial] = useState<{ id: string; eventos: EventoLead[] | null } | null>(null);

  const cargar = useCallback(async () => {
    const r = await almacen.leer();
    if (!r.ok) { setEstado(r.sinTabla ? { tipo: "sinTabla" } : { tipo: "error", texto: r.error }); return; }
    setLeads(r.valor.leads);
    setTope(r.valor.tope);
    setAlcance(r.valor.alcance);
    setEstado({ tipo: "listo" });
  }, [almacen]);
  // En el demo, cambiar de persona es cambiar de sesión: se relee, porque cada una alcanza leads distintos.
  useEffect(() => { void cargar(); }, [cargar, idDemo]);

  // El banco que se enseña: todas las tiendas a quien las alcanza; a los demás, SOLO la suya. Sus leads de otra
  // tienda (los que le asignó un admin) están en «Mi pool», y no traen aquí el banco de esa tienda ni su contador.
  const delBanco = useMemo(() => leadsDelBanco(leads, alcance), [leads, alcance]);
  const pools = useMemo(() => poolsDe(delBanco), [delBanco]);
  const elige = eligeTienda(alcance);
  // Se entra en el pool de SU tienda; cambiar de persona en el demo vuelve a elegirlo.
  const tienda = yo?.store ?? null;
  useEffect(() => { setPool((p) => (p && pools.some((x) => x.pool === p) ? p : poolInicial(pools, tienda))); }, [pools, tienda]);

  const delPool = useMemo(() => delBanco.filter((l) => l.pool === pool), [delBanco, pool]);
  const visibles = useMemo(
    () => ordenar(filtrar(delBanco, { pool, vista, categoria, tipo, ciudad, busca }), orden),
    [delBanco, pool, vista, categoria, tipo, ciudad, busca, orden],
  );
  useEffect(() => { setCuantos(TANDA); }, [pool, vista, categoria, tipo, ciudad, busca, orden]);

  if (!yo) return <div className="ld-wrap"><p className="hint">{t("No session.", "Sin sesión.")}</p></div>;

  const mios = abiertosDe(leads, yo.id);
  const misVentas = ventasDe(leads, yo.id);
  const libres = puestosLibres(leads, yo.id, tope);

  /** Lo que devolvió la base se pone en su sitio; un rechazo se dice con sus palabras y se relee (otro pudo adelantarse). */
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

  const tomar = async (l: Lead) => {
    setOcupado(l.id);
    setAviso(null);
    await tras(l.id, await almacen.tomar(l.id), t("Taken: it is in your pool now.", "Tomado: ya está en tu pool."));
  };

  const verHistorial = async (l: Lead) => {
    if (historial?.id === l.id) { setHistorial(null); return; }
    setHistorial({ id: l.id, eventos: null });
    const r = await almacen.historial(l.id);
    setHistorial({ id: l.id, eventos: r.ok ? r.valor : [] });
  };

  const tarjeta = (l: Lead, donde: "banco" | "mio" | "admin") => (
    <Tarjeta
      key={l.id} lead={l} yo={yo} donde={donde} ocupado={ocupado === l.id}
      puede={puedeTomar(l, leads, yo.id, tope)}
      historial={historial?.id === l.id ? historial.eventos : undefined}
      onTomar={() => void tomar(l)} onNota={() => setDialogo({ tipo: "nota", lead: l })}
      onCerrar={() => setDialogo({ tipo: "cerrar", lead: l })} onAdmin={() => setDialogo({ tipo: "admin", lead: l })}
      onHistorial={() => void verHistorial(l)}
    />
  );

  return (
    <div className="ld-wrap">
      <div className="ld-cabecera">
        <div>
          <Link href="/home" className="btn btn-ghost btn-sm">◂ {t("Back to hub", "Volver al hub")}</Link>
          <h1>🎯 Leads</h1>
          <p className="hint ld-sub">
            {t("Building-permit leads, by nearest store.", "Leads de permisos de obra, por tienda más cercana.")}
            {demo ? ` ${t("Demo data (invented).", "Datos de demostración (inventados).")}` : ""}
          </p>
        </div>
        {demo && (
          <label className="ld-demo">
            {t("Demo: you are", "Demo: eres")}
            <select data-persona-demo value={idDemo} onChange={(e) => {
              const p = PERSONAS_DEMO.find((x) => x.id === e.target.value) ?? PERSONAS_DEMO[0];
              quien.current = p;
              setIdDemo(p.id); setPool(null); setPestana("banco"); setAviso(null);
            }}>
              {PERSONAS_DEMO.map((p) => <option key={p.id} value={p.id}>{p.name} ({p.role}{p.store ? ` · ${p.store}` : ""})</option>)}
            </select>
          </label>
        )}
      </div>

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
          <div className="ld-pestanas" role="tablist">
            <button type="button" role="tab" aria-selected={pestana === "banco"} className={`chip${pestana === "banco" ? " on" : ""}`} data-pestana="banco" onClick={() => setPestana("banco")}>
              🏦 {t("General Pool", "Pool General")}
            </button>
            <button type="button" role="tab" aria-selected={pestana === "mio"} className={`chip${pestana === "mio" ? " on" : ""}`} data-pestana="mio" onClick={() => setPestana("mio")}>
              ⭐ {t("My pool", "Mi pool")} <span className="cnt" data-mi-cuenta>{mios.length}/{tope}</span>
            </button>
            {yo.admin && (
              <button type="button" role="tab" aria-selected={pestana === "admin"} className={`chip${pestana === "admin" ? " on" : ""}`} data-pestana="admin" onClick={() => setPestana("admin")}>
                🛠 Admin{colaDeRevision(leads).length > 0 ? <span className="cnt">{colaDeRevision(leads).length}</span> : null}
              </button>
            )}
            <button type="button" className="btn btn-ghost btn-sm ld-releer" onClick={() => void cargar()}>↻ {t("Refresh", "Actualizar")}</button>
          </div>

          {aviso && <div className={`ld-aviso ${aviso.tono}`} data-aviso={aviso.tono} role="status">{aviso.texto}</div>}

          {pestana === "banco" && (
            <>
              <div className="card ld-filtros">
                <div className="ld-fila">
                  {elige ? (
                    <label className="ld-ancho">
                      {t("General Pool (nearest store)", "Pool General (tienda más cercana)")}
                      <select data-pool value={pool ?? ""} onChange={(e) => setPool(e.target.value)}>
                        {pools.map((p) => (
                          <option key={p.pool} value={p.pool}>
                            {poolLabel(p.pool, lang)} — {p.libres} {t("free", "libres")} / {p.total}
                          </option>
                        ))}
                      </select>
                    </label>
                  ) : (
                    /* Solo su tienda: no hay nada que elegir, y los otros bancos ni se nombran ni se cuentan. */
                    <p className="ld-ancho" data-pool-fijo>
                      {t("General Pool of your store", "Pool General de tu tienda")}
                      <br />
                      <b>{alcance.tienda ? poolLabel(alcance.tienda, lang) : "—"}</b>
                      {pools[0] ? <> — {pools[0].libres} {t("free", "libres")} / {pools[0].total}</> : null}
                    </p>
                  )}
                  <div className="ld-vistas" role="group" aria-label={t("View", "Vista")}>
                    <button type="button" className={`chip${vista === "libres" ? " on" : ""}`} data-vista="libres" onClick={() => setVista("libres")}>{t("Free", "Libres")}</button>
                    <button type="button" className={`chip${vista === "todas" ? " on" : ""}`} data-vista="todas" onClick={() => setVista("todas")}>{t("All", "Todas")}</button>
                  </div>
                </div>
                <div className="ld-fila">
                  <label>
                    {t("Category", "Categoría")}
                    <select data-categoria value={categoria} onChange={(e) => setCategoria(e.target.value)}>
                      <option value="utiles">{t("Useful + might be useful", "Sirve + podría servir")}</option>
                      <option value="todas">{t("All categories", "Todas las categorías")}</option>
                      {valoresDe(delPool, "category").map((c) => <option key={c} value={c}>{delExcel(c, lang)}</option>)}
                    </select>
                  </label>
                  <label>
                    {t("Project type", "Tipo de proyecto")}
                    <select data-tipo value={tipo} onChange={(e) => setTipo(e.target.value)}>
                      <option value="">{t("All", "Todos")}</option>
                      {valoresDe(delPool, "project_type").map((c) => <option key={c} value={c}>{delExcel(c, lang)}</option>)}
                    </select>
                  </label>
                  <label>
                    {t("Site city", "Ciudad de la obra")}
                    <select data-ciudad value={ciudad} onChange={(e) => setCiudad(e.target.value)}>
                      <option value="">{t("All", "Todas")}</option>
                      {valoresDe(delPool, "site_city").map((c) => <option key={c} value={c}>{c}</option>)}
                    </select>
                  </label>
                  <label>
                    {t("Sort by", "Ordenar por")}
                    <select data-orden value={orden} onChange={(e) => setOrden(e.target.value as Orden)}>
                      <option value="distancia">{t("Distance (nearest first)", "Distancia (lo más cerca)")}</option>
                      <option value="costo">{t("Estimated cost (highest first)", "Costo estimado (lo más alto)")}</option>
                      <option value="fecha">{t("Registered (newest first)", "Registro (lo más nuevo)")}</option>
                    </select>
                  </label>
                </div>
                <input
                  type="search" data-busca value={busca} onChange={(e) => setBusca(e.target.value)}
                  placeholder={t("Search project, address, owner, TABS #…", "Buscar proyecto, dirección, dueño, TABS #…")}
                  aria-label={t("Search", "Buscar")}
                />
                <p className="hint" data-cuenta-banco>
                  {visibles.length} {t("leads", "leads")} · {t("you have", "te quedan")} <b>{libres}</b> {t("of", "de")} {tope} {t("slots free", "puestos")}
                </p>
              </div>
              {!elige && !alcance.tienda && (
                <div className="ld-aviso ambar" data-aviso-sin-tienda>
                  {t(
                    "Your user has no store assigned, so there is no General Pool to show you. Ask an admin to set your store. The leads you already hold are in My pool.",
                    "Tu usuario no tiene tienda asignada, así que no hay Pool General que enseñarte. Pide a un admin que te ponga tu tienda. Los leads que ya tienes están en Mi pool.",
                  )}
                </div>
              )}
              {libres === 0 && (
                <div className="ld-aviso ambar" data-aviso-lleno>
                  {t(
                    "Your pool is full. Close a lead with its result and a note to free a slot.",
                    "Tu pool está lleno. Cierra un lead con su resultado y una nota para liberar un puesto.",
                  )}
                </div>
              )}
              {visibles.length === 0 && <p className="hint">{t("No leads with these filters.", "No hay leads con estos filtros.")}</p>}
              <div className="ld-lista" data-lista-banco>{visibles.slice(0, cuantos).map((l) => tarjeta(l, "banco"))}</div>
              {visibles.length > cuantos && (
                <button type="button" className="btn btn-ghost ld-mas" data-ver-mas onClick={() => setCuantos((n) => n + TANDA)}>
                  {t("Show more", "Ver más")} ({visibles.length - cuantos})
                </button>
              )}
            </>
          )}

          {pestana === "mio" && (
            <>
              <p className="hint">
                {t(
                  `You can hold up to ${tope} open leads. A progress note keeps the lead open; only closing it with a result frees its slot.`,
                  `Puedes tener hasta ${tope} leads abiertos. Una nota de avance deja el lead abierto; solo cerrarlo con un resultado libera su puesto.`,
                )}
              </p>
              {mios.length === 0 && <p className="hint">{t("Your pool is empty. Take leads from the General Pool.", "Tu pool está vacío. Toma leads del Pool General.")}</p>}
              <div className="ld-lista" data-lista-mia>{ordenar(mios, "distancia").map((l) => tarjeta(l, "mio"))}</div>
              {misVentas.length > 0 && (
                <>
                  <h2 className="ld-h2">🏆 {t("My sales", "Mis ventas")} ({misVentas.length})</h2>
                  <div className="ld-lista" data-lista-ventas>{misVentas.map((l) => tarjeta(l, "mio"))}</div>
                </>
              )}
            </>
          )}

          {pestana === "admin" && yo.admin && (
            <Admin
              leads={leads} tope={tope} almacen={almacen} tarjeta={tarjeta} demo={demo}
              onTope={async (n) => {
                const r = await almacen.ponerTope(n);
                if (r.ok) { setTope(r.valor); setAviso({ tono: "verde", texto: t("Limit saved.", "Tope guardado.") }); }
                else setAviso({ tono: "rojo", texto: r.motivo ? negativaTexto(r.motivo, lang) : r.error });
              }}
            />
          )}
        </>
      )}

      {dialogo && (
        <Accion
          dialogo={dialogo} almacen={almacen} admin={yo.admin}
          onCerrar={() => setDialogo(null)}
          onHecho={async (id, r, texto) => { if (await tras(id, r, texto)) setDialogo(null); }}
        />
      )}
    </div>
  );
}

function Tarjeta({ lead: l, yo, donde, puede, ocupado, historial, onTomar, onNota, onCerrar, onAdmin, onHistorial }: {
  lead: Lead; yo: Persona; donde: "banco" | "mio" | "admin"; puede: ReturnType<typeof puedeTomar>; ocupado: boolean;
  historial: EventoLead[] | null | undefined;
  onTomar: () => void; onNota: () => void; onCerrar: () => void; onAdmin: () => void; onHistorial: () => void;
}) {
  const { t, lang } = usePrefs();
  // En la pestaña del admin (cola de revisión, sin tocar) las tarjetas se leen enteras: ahí son trabajo suyo.
  const apagado = donde !== "admin" && bloqueado(l, yo);
  const contacto = veContacto(l, yo);
  const mapa = mapsUrl(l);
  const tdlr = enlaceSeguro(l.tdlr_link);
  const mio = l.holder === yo.id;
  return (
    <article className={`ld-tarjeta${apagado ? " apagado" : ""}`} data-lead={l.id} data-estado={l.status} data-bloqueado={apagado ? "si" : "no"}>
      <header>
        <h3>{l.project_name ?? l.facility_name ?? l.tabs_project}</h3>
        <span className="ld-dist">{l.distance_miles === null ? "—" : `${l.distance_miles.toFixed(1)} mi`}</span>
      </header>
      <p className="ld-meta">
        <span className="badge ld-cat">{delExcel(l.category, lang)}</span> {delExcel(l.project_type, lang)}
        {l.type_of_work ? ` · ${l.type_of_work}` : ""}
      </p>

      {l.status !== "free" && (
        <p className={`ld-dueno ${l.status}`} data-dueno>
          {l.status === "won" ? "🏆" : l.status === "taken" ? "🔒" : "⏸"} {estadoLabel(l.status, lang)}
          {l.holder_name ? ` · ${mio ? t("you", "tú") : l.holder_name}` : ""}
          {l.taken_at && l.status === "taken" ? ` · ${t("since", "desde")} ${fecha(l.taken_at)}` : ""}
        </p>
      )}
      {l.last_outcome && l.last_note && (
        <p className={`ld-etiqueta ${l.last_outcome}`} data-etiqueta={l.last_outcome}>
          <b>{resultadoLabel(l.last_outcome, lang)}</b> — «{l.last_note}»
          <span className="hint"> · {l.last_by_name ?? "—"} · {fecha(l.last_at)}</span>
        </p>
      )}
      {l.follow_up_note && (mio || yo.admin) && (
        <p className="ld-avance" data-avance>📝 {l.follow_up_note} <span className="hint">· {fecha(l.follow_up_at)}</span></p>
      )}

      <p className="ld-dir">
        📍 {mapa ? <a href={mapa} target="_blank" rel="noopener noreferrer" data-mapa>{[l.site_address, l.site_city, l.site_zip].filter(Boolean).join(", ")}</a> : "—"}
      </p>
      {contacto ? (
        <div className="ld-contacto" data-contacto>
          <p>
            👤 {l.owner_name ?? "—"}{l.owner_contact ? ` · ${l.owner_contact}` : ""}
            {l.owner_phone ? <> · {telUrl(l.owner_phone) ? <a href={telUrl(l.owner_phone)!} data-tel>📞 {l.owner_phone}</a> : l.owner_phone}</> : null}
          </p>
          {l.tenant_name && (
            <p>🏪 {t("Tenant", "Inquilino")}: {l.tenant_name}{l.tenant_phone ? <> · {telUrl(l.tenant_phone) ? <a href={telUrl(l.tenant_phone)!}>📞 {l.tenant_phone}</a> : l.tenant_phone}</> : null}</p>
          )}
          {l.design_firm_name && (
            <p>📐 {t("Design firm", "Despacho")}: {l.design_firm_name}{l.design_firm_phone ? <> · {telUrl(l.design_firm_phone) ? <a href={telUrl(l.design_firm_phone)!}>📞 {l.design_firm_phone}</a> : l.design_firm_phone}</> : null}</p>
          )}
        </div>
      ) : (
        <p className="hint" data-sin-contacto>{t("Contact hidden: someone else has this lead.", "Contacto oculto: este lead lo tiene otra persona.")}</p>
      )}
      <dl className="ld-datos">
        <div><dt>{t("Est. cost", "Costo est.")}</dt><dd>{dinero(l.estimated_cost)}</dd></div>
        <div><dt>{t("Sq ft", "Pies²")}</dt><dd>{numero(l.square_footage)}</dd></div>
        <div><dt>{t("Start", "Inicio")}</dt><dd>{fecha(l.est_start_date)}</dd></div>
        <div><dt>{t("Completion", "Fin")}</dt><dd>{fecha(l.est_completion_date)}</dd></div>
        <div><dt>{t("Registered", "Registro")}</dt><dd>{fecha(l.registered_date)}</dd></div>
      </dl>
      {l.scope_of_work && <p className="ld-alcance">{l.scope_of_work}</p>}
      {l.reason && <p className="hint">💬 {l.reason}</p>}

      <footer>
        {donde !== "mio" && l.status === "free" && (
          <button type="button" className="btn btn-primary" data-tomar disabled={ocupado || !puede.ok} title={puede.ok ? undefined : negativaTexto(puede.motivo, lang)} onClick={onTomar}>
            {puede.ok ? t("Take", "Tomar") : t("Pool full", "Pool lleno")}
          </button>
        )}
        {mio && l.status === "taken" && (
          <>
            <button type="button" className="btn btn-ghost" data-nota disabled={ocupado} onClick={onNota}>📝 {t("Progress note", "Nota de avance")}</button>
            <button type="button" className="btn btn-green" data-cerrar disabled={ocupado} onClick={onCerrar}>✓ {t("Close with result", "Cerrar con resultado")}</button>
          </>
        )}
        {yo.admin && <button type="button" className="btn btn-ghost btn-sm" data-admin-lead onClick={onAdmin}>🛠 Admin</button>}
        <button type="button" className="btn btn-ghost btn-sm" data-historial onClick={onHistorial}>🕘 {t("History", "Historial")}</button>
        {tdlr && <a className="btn btn-ghost btn-sm" href={tdlr} target="_blank" rel="noopener noreferrer" data-tdlr>TDLR ↗</a>}
        <span className="hint ld-tabs">{l.tabs_project}</span>
      </footer>
      {historial !== undefined && (
        <ul className="ld-historial" data-historial-lista>
          {historial === null && <li className="hint">{t("Loading…", "Cargando…")}</li>}
          {historial?.length === 0 && <li className="hint">{t("No history yet.", "Sin historial todavía.")}</li>}
          {historial?.map((e) => (
            <li key={e.id}>
              <b>{eventoLabel(e, lang)}</b> · {e.subject_name ?? e.actor_name ?? "—"} · {fecha(e.at)}
              {e.actor && e.subject && e.actor !== e.subject ? ` · ${t("by", "por")} ${e.actor_name ?? "—"}` : ""}
              {e.note ? <> — «{e.note}»</> : null}
            </li>
          ))}
        </ul>
      )}
    </article>
  );
}

/** El diálogo de una acción sobre un lead: nota de avance, cerrar con resultado, o lo del admin. */
function Accion({ dialogo, almacen, admin, onCerrar, onHecho }: {
  dialogo: Dialogo; almacen: AlmacenDeLeads; admin: boolean;
  onCerrar: () => void; onHecho: (id: string, r: Res<Lead>, texto: string) => Promise<void>;
}) {
  const { t, lang } = usePrefs();
  const l = dialogo.lead;
  const [nota, setNota] = useState("");
  const [resultado, setResultado] = useState<Resultado | null>(null);
  const [personas, setPersonas] = useState<Persona[]>([]);
  const [persona, setPersona] = useState("");
  const [enviando, setEnviando] = useState(false);
  const notaOk = notaLimpia(nota) !== null;

  useEffect(() => {
    if (dialogo.tipo !== "admin" || !admin) return;
    void almacen.personas().then((r) => { if (r.ok) setPersonas(r.valor); });
  }, [dialogo.tipo, admin, almacen]);

  const enviar = async (hace: () => Promise<Res<Lead>>, texto: string) => {
    setEnviando(true);
    await onHecho(l.id, await hace(), texto);
    setEnviando(false);
  };

  return (
    <div className="ld-velo" role="dialog" aria-modal="true" data-dialogo={dialogo.tipo}>
      <div className="ld-dialogo">
        <h2>{l.project_name ?? l.tabs_project}</h2>
        {dialogo.tipo === "cerrar" && (
          <>
            <p className="hint">{t("How did it end? Closing frees this slot in your pool.", "¿En qué quedó? Cerrarlo libera este puesto de tu pool.")}</p>
            <div className="ld-resultados" role="radiogroup">
              {RESULTADOS.map((r) => (
                <label key={r} className={`ld-resultado${resultado === r ? " on" : ""}`}>
                  <input type="radio" name="resultado" value={r} data-resultado={r} checked={resultado === r} onChange={() => setResultado(r)} />
                  <span><b>{resultadoLabel(r, lang)}</b><br /><small>{consecuencia(r, lang)}</small></span>
                </label>
              ))}
            </div>
          </>
        )}
        {dialogo.tipo === "nota" && (
          <p className="hint">
            {t(
              "Visited – following up. The lead stays open in your pool and keeps its slot.",
              "Visitado – en seguimiento. El lead sigue abierto en tu pool y sigue ocupando su puesto.",
            )}
          </p>
        )}
        {dialogo.tipo === "admin" && (
          <p className="hint">
            {estadoLabel(l.status, lang)}{l.holder_name ? ` · ${l.holder_name}` : ""}. {t("The note is optional here; with a note, it becomes the lead's tag.", "Aquí la nota es opcional; con nota, pasa a ser la etiqueta del lead.")}
          </p>
        )}
        <label className="ld-nota">
          {dialogo.tipo === "admin" ? t("Note (optional)", "Nota (opcional)") : t("Note (required)", "Nota (obligatoria)")}
          <textarea data-nota-texto value={nota} maxLength={NOTA_MAX} rows={4} onChange={(e) => setNota(e.target.value)}
            placeholder={t("What happened: who you spoke with, what they said, what is next…", "Qué pasó: con quién hablaste, qué dijeron, qué sigue…")} />
        </label>
        <div className="ld-botones">
          <button type="button" className="btn btn-ghost" data-cancelar onClick={onCerrar}>{t("Cancel", "Cancelar")}</button>
          {dialogo.tipo === "nota" && (
            <button type="button" className="btn btn-primary" data-guardar disabled={enviando || !notaOk}
              onClick={() => void enviar(() => almacen.anotar(l.id, nota), t("Note saved. The lead is still open.", "Nota guardada. El lead sigue abierto."))}>
              {t("Save note", "Guardar nota")}
            </button>
          )}
          {dialogo.tipo === "cerrar" && (
            <button type="button" className="btn btn-green" data-guardar disabled={enviando || !notaOk || !resultado}
              onClick={() => resultado && void enviar(() => almacen.cerrar(l.id, resultado, nota), t("Closed. You have a free slot.", "Cerrado. Tienes un puesto libre."))}>
              {t("Close lead", "Cerrar lead")}
            </button>
          )}
          {dialogo.tipo === "admin" && (
            <>
              <button type="button" className="btn btn-ghost" data-liberar disabled={enviando || l.status === "free"}
                onClick={() => void enviar(() => almacen.liberar(l.id, nota), t("Released to the General Pool.", "Liberado al Pool General."))}>
                {t("Release to General Pool", "Liberar al Pool General")}
              </button>
              <button type="button" className="btn btn-danger" data-archivar disabled={enviando || l.status === "archived"}
                onClick={() => void enviar(() => almacen.archivar(l.id, nota), t("Archived.", "Archivado."))}>
                {t("Archive", "Archivar")}
              </button>
            </>
          )}
        </div>
        {dialogo.tipo === "admin" && (
          <div className="ld-asignar">
            <label>
              {t("Assign to", "Asignar a")}
              <select data-asignar-a value={persona} onChange={(e) => setPersona(e.target.value)}>
                <option value="">—</option>
                {personas.map((p) => <option key={p.id} value={p.id}>{p.name}{p.store ? ` · ${p.store}` : ""}</option>)}
              </select>
            </label>
            <button type="button" className="btn btn-primary" data-asignar disabled={enviando || !persona}
              onClick={() => void enviar(() => almacen.asignar(l.id, persona, nota), t("Assigned.", "Asignado."))}>
              {t("Assign", "Asignar")}
            </button>
            <p className="hint">{t("Assigning ignores the limit: it is your call.", "Asignar no mira el tope: es decisión tuya.")}</p>
          </div>
        )}
      </div>
    </div>
  );
}

/** La pestaña del admin: el tope, la cola de revisión, el tablero y cómo se importa. */
function Admin({ leads, tope, almacen, tarjeta, demo, onTope }: {
  leads: Lead[]; tope: number; almacen: AlmacenDeLeads; demo: boolean;
  tarjeta: (l: Lead, donde: "banco" | "mio" | "admin") => React.ReactNode; onTope: (n: number) => Promise<void>;
}) {
  const { t, lang } = usePrefs();
  const [cierres, setCierres] = useState<EventoLead[]>([]);
  const [nuevoTope, setNuevoTope] = useState(String(tope));
  const [dias, setDias] = useState(DIAS_SIN_TOCAR[0]);
  // Los cierres se releen cuando cambian los leads: un cierre nuevo cambia el tablero.
  useEffect(() => { void almacen.cierres().then((r) => { if (r.ok) setCierres(r.valor); }); }, [almacen, leads]);
  useEffect(() => { setNuevoTope(String(tope)); }, [tope]);

  const cola = colaDeRevision(leads);
  const vendedores = tableroPorVendedor(leads, cierres);
  const viejos = sinTocar(leads, dias, new Date());
  const n = Number(nuevoTope);
  const topeOk = Number.isInteger(n) && n >= 1 && n <= 100;

  return (
    <>
      <div className="card">
        <h2>🔢 {t("Limit of open leads per person", "Tope de leads abiertos por persona")}</h2>
        <div className="ld-fila">
          <input type="number" min={1} max={100} inputMode="numeric" data-tope value={nuevoTope} onChange={(e) => setNuevoTope(e.target.value)} aria-label={t("Limit", "Tope")} />
          <button type="button" className="btn btn-primary" data-guardar-tope disabled={!topeOk || n === tope} onClick={() => void onTope(n)}>{t("Save", "Guardar")}</button>
        </div>
        <p className="hint">{t("Lowering it takes nothing away: whoever is above it cannot take another until they are below.", "Bajarlo no le quita nada a nadie: quien quede por encima no toma otro hasta bajar.")}</p>
      </div>

      <div className="card">
        <h2>🧐 {t("Needs review", "Ocupa revisión")} ({cola.length})</h2>
        {cola.length === 0 && <p className="hint">{t("Nothing waiting.", "Nada esperando.")}</p>}
        <div className="ld-lista" data-cola>{cola.map((l) => tarjeta(l, "admin"))}</div>
      </div>

      <div className="card">
        <h2>👥 {t("By salesperson", "Por vendedor")}</h2>
        {vendedores.length === 0 ? <p className="hint">{t("Nobody has taken a lead yet.", "Nadie ha tomado un lead todavía.")}</p> : (
          <div className="tbl-scroll">
            <table className="orders" data-por-vendedor>
              <thead><tr><th>{t("Salesperson", "Vendedor")}</th><th>{t("Open", "Abiertos")}</th><th>{t("Closed", "Cerrados")}</th><th>{t("Sales", "Ventas")}</th></tr></thead>
              <tbody>{vendedores.map((v) => <tr key={v.id}><td>{v.nombre}</td><td>{v.abiertos}</td><td>{v.cerrados}</td><td>{v.ventas}</td></tr>)}</tbody>
            </table>
          </div>
        )}
      </div>

      <div className="card">
        <h2>🏬 {t("By General Pool", "Por Pool General")}</h2>
        <div className="tbl-scroll">
          <table className="orders" data-por-pool>
            <thead><tr><th>{t("General Pool", "Pool General")}</th><th>{t("Free", "Libres")}</th><th>{t("Taken", "Tomados")}</th><th>Total</th></tr></thead>
            <tbody>{poolsDe(leads).map((p) => <tr key={p.pool}><td>{poolLabel(p.pool, lang)}</td><td>{p.libres}</td><td>{p.tomados}</td><td>{p.total}</td></tr>)}</tbody>
          </table>
        </div>
      </div>

      <div className="card">
        <h2>⏳ {t("Taken and untouched", "Tomados y sin tocar")} ({viejos.length})</h2>
        <div className="ld-vistas">
          {DIAS_SIN_TOCAR.map((d) => (
            <button key={d} type="button" className={`chip${dias === d ? " on" : ""}`} data-dias={d} onClick={() => setDias(d)}>{d}+ {t("days", "días")}</button>
          ))}
        </div>
        {viejos.length === 0 && <p className="hint">{t("None.", "Ninguno.")}</p>}
        <div className="ld-lista" data-sin-tocar>{viejos.map((l) => tarjeta(l, "admin"))}</div>
      </div>

      <div className="card">
        <h2>📥 {t("Import or update leads", "Importar o actualizar leads")}</h2>
        <p className="hint">
          {t(
            "Leads are loaded from the Excel by a script, not from this screen. A re-import updates the data of the leads already here and adds the new ones; it never touches who holds a lead, its tag or its history.",
            "Los leads se cargan desde el Excel con un guion, no desde esta pantalla. Un re-import actualiza los datos de los leads que ya están y añade los nuevos; nunca toca quién tiene un lead, su etiqueta ni su historial.",
          )}
        </p>
        <code className="ld-comando">node scripts/leads/importa-leads.mjs &lt;file.xlsx&gt; --aplicar</code>
        {demo && <p className="hint">{t("Not available in demo mode.", "No disponible en modo demo.")}</p>}
      </div>
    </>
  );
}
