"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { usePrefs } from "@/lib/prefs";
import { createClient } from "@/lib/supabase/client";
import { fmtDateTime } from "@/lib/utils";
import { BotonesDeFoto } from "./BotonesDeFoto";
import { detalleParaConsola, leerFotoDelTelefono, mensajeDeFotoFallida } from "@/lib/almacen-ops/foto-del-telefono";
import { enlacesDeFotos, subirFoto } from "@/lib/almacen-ops/datos";
import { fmtDia, hoyEnTexas } from "@/lib/almacen-ops/fecha-del-dano";
import {
  CLASES_DE_EQUIPO, CLASES_DE_PIEZA, ESTADOS_DE_EQUIPO, INFO_DE_CLASE, INFO_DE_CLASE_DE_PIEZA, INFO_DE_ESTADO, INFO_DE_ESTADO_DE_PIEZA, INFO_DE_RESULTADO,
  RESULTADOS, bajoMinimo, duracionDeUso, equipoEnBlanco, equipoParaEditar, estadoTrasLaLista, filtrarPiezas, gestionaAlguna, huecosDeLaLista,
  listaCompleta, listaDelDia, motivoDeEquipo, nombreDePunto, numeroDelCampo, ordenarEquipo, ordenarPiezas, plantillaDe, puedeCerrarUso,
  puedeEmpezarUso, puedeGestionar, puedeOperar, puntosParaEnviar, resultadoDeLaLista, transicionesDePieza, usoAbierto, validarEquipo,
  type ClaseDePieza, type Contestaciones, type Equipo, type EquipoEditable, type EstadoDePieza, type FiltroDePieza, type Lista, type Pieza, type Resultado, type Uso,
} from "@/lib/almacen-ops/mantenimiento";
import { colorDelPct, kpiDeMantenimiento, totalDelKpi } from "@/lib/almacen-ops/mantenimiento-kpi";
import {
  DEMO_MANTENIMIENTO, empezarUso, enviarLista, faltaLa273, guardarEquipo, guardarPieza, leerMantenimiento, pedirPieza, terminarUso,
  type Mantenimiento as Datos,
} from "@/lib/almacen-ops/mantenimiento-datos";
import type { Contexto } from "./Operaciones";

/**
 * La sección «Mantenimiento» de Operaciones de almacén (273): el equipo de la tienda con su estado, la lista diaria
 * por equipo (desde el teléfono: tocar Bien / Falla / N/A por punto), quién usa qué ahora, y las refacciones. El
 * gerente ve además el KPI de la semana y da de alta / edita. Todo se abre en su sitio, como tarjeta (regla de la casa).
 */

type Carga = { estado: "cargando" } | { estado: "falta-273" } | { estado: "error"; mensaje: string } | { estado: "listo"; datos: Datos };
type Pestana = "equipo" | "refacciones";
const mensajeDeError = (e: unknown) => (e instanceof Error ? e.message : String((e as { message?: string })?.message ?? e));

export function Mantenimiento({ ctx }: { ctx: Contexto }) {
  const { t } = usePrefs();
  const [carga, setCarga] = useState<Carga>(ctx.demo ? { estado: "listo", datos: DEMO_MANTENIMIENTO } : { estado: "cargando" });
  const [tienda, setTienda] = useState(() => (ctx.yo.store && ctx.tiendas.includes(ctx.yo.store) ? ctx.yo.store : ctx.tiendas[0] ?? ""));
  const [pestana, setPestana] = useState<Pestana>("equipo");

  useEffect(() => {
    if (ctx.demo) return;
    let vivo = true;
    leerMantenimiento(createClient())
      .then((d) => { if (vivo) setCarga({ estado: "listo", datos: d }); })
      .catch((e) => { if (vivo) setCarga(faltaLa273(e) ? { estado: "falta-273" } : { estado: "error", mensaje: mensajeDeError(e) }); });
    return () => { vivo = false; };
  }, [ctx.demo]);

  const pon = (f: (d: Datos) => Datos) => setCarga((c) => (c.estado === "listo" ? { estado: "listo", datos: f(c.datos) } : c));

  return (
    <section className="ops-mantenimiento" data-mantenimiento>
      <header className="ops-asistente-barra ops-mant-cabeza">
        <h2>🔧 {t("Maintenance", "Mantenimiento")}</h2>
        <Link href="/operaciones" className="ops-boton ops-boton-chico" data-accion="volver">← {t("Back", "Volver")}</Link>
      </header>
      {ctx.tiendas.length > 1 && (
        <label className="ops-tienda ops-tienda-arriba">
          <span>{t("Store", "Tienda")}</span>
          <select value={tienda} onChange={(e) => setTienda(e.target.value)} data-campo="tienda-mantenimiento">
            {ctx.tiendas.map((x) => <option key={x} value={x}>{x}</option>)}
          </select>
        </label>
      )}
      {carga.estado === "cargando" && <p className="hint">{t("Loading…", "Cargando…")}</p>}
      {carga.estado === "error" && <p className="ops-aviso ops-aviso-error">{t("Could not load: ", "No se pudo cargar: ")}{carga.mensaje}</p>}
      {carga.estado === "falta-273" && (
        <div className="ops-aviso" data-aviso="273">
          <h3>{t("Coming soon", "Muy pronto")}</h3>
          <p>{t("Maintenance needs one setup step before it can save equipment (database migration 273). Ask the admin to finish the setup.",
            "Mantenimiento necesita un paso de instalación antes de guardar equipo (la migración 273 de la base). Pide al admin que termine la instalación.")}</p>
        </div>
      )}
      {carga.estado === "listo" && (
        <>
          {gestionaAlguna(ctx.yo, [tienda]) && <Kpi datos={carga.datos} tienda={tienda} />}
          <nav className="ops-pestanas" aria-label={t("Sections", "Secciones")}>
            <button type="button" className={`btn btn-sm${pestana === "equipo" ? " btn-primary" : ""}`} onClick={() => setPestana("equipo")} data-pestana="equipo">
              {t("Equipment", "Equipo")} <span className="ops-cuenta">{carga.datos.equipos.filter((e) => e.store === tienda && e.active).length}</span>
            </button>
            <button type="button" className={`btn btn-sm${pestana === "refacciones" ? " btn-primary" : ""}`} onClick={() => setPestana("refacciones")} data-pestana="refacciones">
              {t("Parts & tools", "Refacciones y herramientas")}
              {carga.datos.piezas.some((p) => p.store === tienda && p.status === "needed") && <span className="ops-cuenta ops-cuenta-roja">{carga.datos.piezas.filter((p) => p.store === tienda && p.status === "needed").length}</span>}
            </button>
          </nav>
          {pestana === "equipo" && <Equipos ctx={ctx} datos={carga.datos} tienda={tienda} pon={pon} />}
          {pestana === "refacciones" && <Refacciones ctx={ctx} datos={carga.datos} tienda={tienda} pon={pon} />}
        </>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
// KPI (gerentes)
// ---------------------------------------------------------------------------
function Kpi({ datos, tienda }: { datos: Datos; tienda: string }) {
  const { t } = usePrefs();
  const hoy = hoyEnTexas();
  const k = useMemo(() => kpiDeMantenimiento(datos.equipos, datos.listas, hoy, [tienda]).filter((x) => x.tienda === tienda), [datos.equipos, datos.listas, hoy, tienda]);
  const tot = totalDelKpi(k);
  const color = colorDelPct(tot.pct);
  return (
    <div className="ops-merma-totales ops-kpi" data-kpi data-kpi-pct={tot.pct ?? ""} data-kpi-color={color}>
      <div className="ops-merma-total">
        <span>{t("Checklists this week", "Listas esta semana")}</span>
        <span className={`ops-merma-cifra ops-kpi-${color}`}>{tot.pct === null ? "—" : `${tot.pct}%`}</span>
        <span>{tot.hechas} / {tot.esperadas} · {t(`${tot.enServicio} in service`, `${tot.enServicio} en servicio`)}</span>
      </div>
      <div className="ops-merma-total">
        <span>{t("Need repair", "Necesitan reparación")}</span>
        <span className={`ops-merma-cifra ${tot.necesitanReparacion > 0 ? "ops-kpi-ambar" : "ops-kpi-verde"}`}>{tot.necesitanReparacion}</span>
        <span>{t(`${tot.fueraDeServicio} out of service`, `${tot.fueraDeServicio} fuera de servicio`)}</span>
      </div>
      <div className="ops-merma-total">
        <span>{t("Without checklist today", "Sin lista hoy")}</span>
        <span className={`ops-merma-cifra ${k[0] && k[0].sinListaHoy.length > 0 ? "ops-kpi-rojo" : "ops-kpi-verde"}`}>{k[0]?.sinListaHoy.length ?? 0}</span>
        <span>{t("in-service units", "equipos en servicio")}</span>
      </div>
      <div className="ops-merma-total">
        <span>{t("Parts needed", "Refacciones que se necesitan")}</span>
        <span className={`ops-merma-cifra ${datos.piezas.some((p) => p.store === tienda && p.status === "needed") ? "ops-kpi-rojo" : "ops-kpi-verde"}`}>{datos.piezas.filter((p) => p.store === tienda && p.status === "needed").length}</span>
        <span>{t(`${datos.piezas.filter((p) => p.store === tienda && p.status === "ordered").length} ordered`, `${datos.piezas.filter((p) => p.store === tienda && p.status === "ordered").length} pedidas`)}</span>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Equipo
// ---------------------------------------------------------------------------
function InsigniaDeEstado({ e }: { e: Pick<Equipo, "status"> }) {
  const { lang } = usePrefs();
  const i = INFO_DE_ESTADO[e.status];
  return <span className="ops-etapa" style={{ "--etapa": i.color } as React.CSSProperties} data-estado={e.status}><span className="ops-etapa-nombre">{lang === "es" ? i.es : i.en}</span></span>;
}

function Equipos({ ctx, datos, tienda, pon }: { ctx: Contexto; datos: Datos; tienda: string; pon: (f: (d: Datos) => Datos) => void }) {
  const { t, lang } = usePrefs();
  const [abierto, setAbierto] = useState<string | null>(null);
  const [nuevo, setNuevo] = useState(false);
  const hoy = hoyEnTexas();
  const gestiona = puedeGestionar(ctx.yo, tienda);
  const lista = useMemo(() => ordenarEquipo(datos.equipos.filter((e) => e.store === tienda && (e.active || gestiona))), [datos.equipos, tienda, gestiona]);
  const elegido = abierto ? datos.equipos.find((e) => e.id === abierto) ?? null : null;
  return (
    <>
      {gestiona && (
        <div className="ops-exportar">
          <button type="button" className="btn btn-sm" onClick={() => setNuevo(true)} data-accion="nuevo-equipo">＋ {t("Add equipment", "Dar de alta equipo")}</button>
        </div>
      )}
      {lista.length === 0 && (
        <p className="ops-aviso" data-sin-equipo>
          {gestiona
            ? t("No equipment in this store yet. Add the forklifts and pallet jacks so the team can do the daily checklist.", "Esta tienda aún no tiene equipo. Da de alta los montacargas y patines para que el equipo haga la lista diaria.")
            : t("No equipment in this store yet. Ask your manager to add it.", "Esta tienda aún no tiene equipo. Pide a tu gerente que lo dé de alta.")}
        </p>
      )}
      <ul className="ops-lista-equipo">
        {lista.map((e) => {
          const uso = usoAbierto(datos.usos, e.id);
          const hecha = listaDelDia(datos.listas, e.id, hoy);
          return (
            <li key={e.id}>
              <button type="button" className={`ops-equipo${e.active ? "" : " ops-equipo-baja"}`} onClick={() => setAbierto(e.id)} data-equipo={e.id} data-estado={e.status}>
                <span className="ops-equipo-icono" aria-hidden>{INFO_DE_CLASE[e.kind].emoji}</span>
                <span className="ops-equipo-texto">
                  <span className="ops-equipo-nombre">{e.name}{!e.active && <span className="ops-insignia"> {t("Retired", "De baja")}</span>}</span>
                  <span className="ops-equipo-meta">
                    {lang === "es" ? INFO_DE_CLASE[e.kind].es : INFO_DE_CLASE[e.kind].en}
                    {e.brand || e.model ? ` · ${[e.brand, e.model].filter(Boolean).join(" ")}` : ""}
                    {e.hour_meter != null ? ` · ${e.hour_meter} h` : ""}
                  </span>
                  <span className="ops-equipo-insignias">
                    <InsigniaDeEstado e={e} />
                    {hecha
                      ? <span className="ops-insignia ops-insignia-ok" data-lista-hoy="si">✓ {t("Checked today", "Revisado hoy")}</span>
                      : e.active && e.status !== "out_of_service" && <span className="ops-insignia ops-insignia-sin-foto" data-lista-hoy="no">{t("Checklist pending", "Lista pendiente")}</span>}
                    {uso && <span className="ops-insignia ops-insignia-uso" data-en-uso={uso.user_id}>▶ {uso.user_id === ctx.yo.id ? t("You have it", "Lo tienes tú") : (uso.user_name ?? t("In use", "En uso"))}</span>}
                  </span>
                </span>
              </button>
            </li>
          );
        })}
      </ul>
      {elegido && <TarjetaEquipo e={elegido} ctx={ctx} datos={datos} pon={pon} onCerrar={() => setAbierto(null)} />}
      {nuevo && <FormEquipo inicial={equipoEnBlanco(tienda)} ctx={ctx} onCerrar={() => setNuevo(false)}
        onGuardado={(e) => { pon((d) => ({ ...d, equipos: [...d.equipos, e] })); setNuevo(false); setAbierto(e.id); }} />}
    </>
  );
}

/** La tarjeta de un equipo, encima de la lista: datos, fotos, lista diaria, uso, refacciones ligadas, editar. */
function TarjetaEquipo({ e, ctx, datos, pon, onCerrar }: { e: Equipo; ctx: Contexto; datos: Datos; pon: (f: (d: Datos) => Datos) => void; onCerrar: () => void }) {
  const { t, lang } = usePrefs();
  const [fotos, setFotos] = useState<string[]>([]);
  const [modo, setModo] = useState<"ver" | "lista" | "editar" | "pedir" | "terminar">("ver");
  const [error, setError] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const gestiona = puedeGestionar(ctx.yo, e.store);
  const opera = puedeOperar(ctx.yo, e.store);
  const uso = usoAbierto(datos.usos, e.id);
  const hoy = hoyEnTexas();
  const listas = useMemo(() => datos.listas.filter((l) => l.equipment_id === e.id).slice(0, 5), [datos.listas, e.id]);
  const piezas = useMemo(() => ordenarPiezas(datos.piezas.filter((p) => p.equipment_id === e.id && p.status !== "ok")), [datos.piezas, e.id]);
  const ultimaFallida = listas.find((l) => l.result === "fail");
  useEffect(() => {
    if (ctx.demo || e.photos.length === 0) { setFotos([]); return; }
    let vivo = true;
    void enlacesDeFotos(createClient(), e.photos).then((u) => { if (vivo) setFotos(u); });
    return () => { vivo = false; };
  }, [e.photos, ctx.demo]);

  const empezar = async () => {
    setOcupado(true); setError(null);
    try {
      const id = ctx.demo ? `u-${Date.now()}` : await empezarUso(createClient(), e.id, null);
      const nuevo: Uso = { id, equipment_id: e.id, user_id: ctx.yo.id, user_name: ctx.yo.full_name, started_at: new Date().toISOString(), ended_at: null, hour_meter_start: e.hour_meter, hour_meter_end: null, notes: null };
      pon((d) => ({ ...d, usos: [nuevo, ...d.usos] }));
    } catch (x) { setError(mensajeDeError(x)); } finally { setOcupado(false); }
  };

  if (modo === "lista") {
    return <FormLista e={e} ctx={ctx} onCerrar={() => setModo("ver")} onGuardada={(l, estado) => {
      pon((d) => ({ ...d, listas: [l, ...d.listas], equipos: d.equipos.map((x) => (x.id === e.id ? { ...x, status: estado, hour_meter: l.hour_meter ?? x.hour_meter } : x)) }));
      setModo("ver");
    }} />;
  }
  if (modo === "editar") {
    return <FormEquipo inicial={equipoParaEditar(e)} ctx={ctx} onCerrar={() => setModo("ver")}
      onGuardado={(n) => { pon((d) => ({ ...d, equipos: d.equipos.map((x) => (x.id === n.id ? n : x)) })); setModo("ver"); }} />;
  }
  if (modo === "pedir") {
    return <FormPedirPieza ctx={ctx} tienda={e.store} equipos={[e]} equipoId={e.id} onCerrar={() => setModo("ver")}
      onGuardada={(p) => { pon((d) => ({ ...d, piezas: [...d.piezas.filter((x) => x.id !== p.id), p] })); setModo("ver"); }} />;
  }
  if (modo === "terminar" && uso) {
    return <FormTerminarUso uso={uso} e={e} ctx={ctx} onCerrar={() => setModo("ver")} onCerrado={(u, h) => {
      pon((d) => ({ ...d, usos: d.usos.map((x) => (x.id === u.id ? u : x)), equipos: d.equipos.map((x) => (x.id === e.id && h != null ? { ...x, hour_meter: h } : x)) }));
      setModo("ver");
    }} />;
  }

  return (
    <div className="overlay" onClick={onCerrar}>
      <div className="modal ops-tarjeta-reporte" onClick={(x) => x.stopPropagation()} role="dialog" aria-modal="true" data-tarjeta-equipo={e.id}>
        <h3>{INFO_DE_CLASE[e.kind].emoji} {e.name} <InsigniaDeEstado e={e} /></h3>
        <p className="sub">{lang === "es" ? INFO_DE_CLASE[e.kind].es : INFO_DE_CLASE[e.kind].en} · {e.store}{!e.active && <> · <strong>{t("Retired", "De baja")}</strong></>}</p>
        {ultimaFallida && e.status === "needs_repair" && (
          <p className="ops-aviso ops-aviso-pendiente" role="status" data-fallos>
            ⚠️ {t("Failed on the checklist of", "Falló en la lista del")} {fmtDia(ultimaFallida.shift_date, lang)}: {ultimaFallida.failed_items.map((id) => nombreDePunto(e.kind, id, lang)).join(", ")}
            {ultimaFallida.items.filter((x) => x.result === "fail" && x.note).map((x) => <span key={x.id} className="ops-nota-fallo"> · {x.note}</span>)}
          </p>
        )}
        <dl className="ops-tarjeta-datos">
          {(e.brand || e.model) && <><dt>{t("Brand / model", "Marca / modelo")}</dt><dd>{[e.brand, e.model].filter(Boolean).join(" ")}</dd></>}
          {e.serial && <><dt>{t("Serial", "Serie")}</dt><dd>{e.serial}</dd></>}
          {e.year != null && <><dt>{t("Year", "Año")}</dt><dd>{e.year}</dd></>}
          <dt>{t("Hour meter", "Horómetro")}</dt><dd data-horometro={e.hour_meter ?? ""}>{e.hour_meter == null ? "—" : `${e.hour_meter} h`}</dd>
          <dt>{t("In use now", "En uso ahora")}</dt>
          <dd data-uso-abierto={uso?.id ?? ""}>{uso ? <>{uso.user_id === ctx.yo.id ? t("You", "Tú") : (uso.user_name ?? "—")} · {t("since", "desde")} {fmtDateTime(uso.started_at)} ({duracionDeUso(uso, lang)})</> : t("Nobody", "Nadie")}</dd>
          {e.notes && <><dt>{t("Notes", "Notas")}</dt><dd>{e.notes}</dd></>}
        </dl>
        {fotos.length > 0 && (
          <div className="ops-fotos-lista">
            {fotos.map((u, n) => (
              // eslint-disable-next-line @next/next/no-img-element
              <a key={n} href={u} target="_blank" rel="noreferrer"><img src={u} alt={t(`Photo ${n + 1}`, `Foto ${n + 1}`)} className="ops-foto-mini" /></a>
            ))}
          </div>
        )}
        {error && <p className="ops-aviso ops-aviso-error" role="alert">{error}</p>}

        {opera && e.active && (
          <div className="ops-etapa-acciones" data-acciones-equipo>
            {e.status !== "out_of_service" && (
              <button type="button" className="ops-boton ops-boton-primario" onClick={() => setModo("lista")} data-accion="lista-diaria">
                ✅ {listaDelDia(datos.listas, e.id, hoy) ? t("Checklist again", "Otra lista") : t("Daily checklist", "Lista diaria")}
              </button>
            )}
            {puedeEmpezarUso(e, uso) && <button type="button" className="ops-boton" onClick={empezar} disabled={ocupado} data-accion="empezar-uso">▶ {t("Start using", "Empezar a usar")}</button>}
            {uso && puedeCerrarUso(uso, ctx.yo.id, gestiona) && <button type="button" className="ops-boton" onClick={() => setModo("terminar")} data-accion="terminar-uso">■ {uso.user_id === ctx.yo.id ? t("Stop using", "Dejar de usar") : t("Close their use", "Cerrar su uso")}</button>}
            <button type="button" className="ops-boton" onClick={() => setModo("pedir")} data-accion="pedir-pieza">🧩 {t("Request a part", "Pedir refacción")}</button>
            {gestiona && <button type="button" className="ops-boton" onClick={() => setModo("editar")} data-accion="editar-equipo">✏️ {t("Edit", "Editar")}</button>}
          </div>
        )}
        {!e.active && gestiona && <div className="ops-etapa-acciones"><button type="button" className="ops-boton" onClick={() => setModo("editar")} data-accion="editar-equipo">✏️ {t("Edit", "Editar")}</button></div>}

        {piezas.length > 0 && (
          <section className="ops-etapas" data-piezas-del-equipo>
            <h4>{t("Parts for this unit", "Refacciones de este equipo")}</h4>
            <ul className="ops-linea-de-etapas">
              {piezas.map((p) => <li key={p.id} className="ops-etapa-texto"><InsigniaDePieza p={p} /> {p.name}{p.notes ? <span className="hint"> · {p.notes}</span> : null}</li>)}
            </ul>
          </section>
        )}

        <section className="ops-etapas" data-listas-del-equipo>
          <h4>{t("Recent checklists", "Últimas listas")}</h4>
          {listas.length === 0 ? <p className="hint">{t("None yet.", "Aún ninguna.")}</p> : (
            <ul className="ops-linea-de-etapas">
              {listas.map((l) => (
                <li key={l.id} className="ops-etapa-texto" data-lista={l.id} data-resultado={l.result}>
                  <span className={`ops-insignia ${l.result === "ok" ? "ops-insignia-ok" : "ops-insignia-repetida"}`}>{l.result === "ok" ? t("OK", "Bien") : t("Fail", "Falla")}</span>
                  <span>{fmtDia(l.shift_date, lang)} · {l.done_by_name ?? "—"}{l.hour_meter != null ? ` · ${l.hour_meter} h` : ""}</span>
                  {l.failed_items.length > 0 && <span className="hint">{l.failed_items.map((id) => nombreDePunto(e.kind, id, lang)).join(", ")}</span>}
                </li>
              ))}
            </ul>
          )}
        </section>
        <div className="modal-actions"><button type="button" className="btn" onClick={onCerrar} data-accion="cerrar">{t("Close", "Cerrar")}</button></div>
      </div>
    </div>
  );
}

/** Alta / edición de un equipo (gestor). */
function FormEquipo({ inicial, ctx, onCerrar, onGuardado }: { inicial: EquipoEditable; ctx: Contexto; onCerrar: () => void; onGuardado: (e: Equipo) => void }) {
  const { t, lang } = usePrefs();
  const [e, setE] = useState<EquipoEditable>(inicial);
  const [guardando, setGuardando] = useState(false);
  const [leyendo, setLeyendo] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const val = validarEquipo(e);
  const pon = <K extends keyof EquipoEditable>(k: K, v: EquipoEditable[K]) => setE((x) => ({ ...x, [k]: v }));
  const foto = async (f: File, origen: "camara" | "galeria") => {
    setLeyendo(true); setError(null);
    try {
      if (ctx.demo) { pon("photos", [...e.photos, `demo/${crypto.randomUUID()}.jpg`]); return; }
      const leida = await leerFotoDelTelefono(f);
      if (!leida.ok) { console.error(detalleParaConsola(leida, f, navigator.userAgent, origen)); setError(mensajeDeFotoFallida(leida.motivo, lang)); return; }
      const ruta = await subirFoto(createClient(), ctx.yo.id, leida.jpg);
      setE((x) => ({ ...x, photos: [...x.photos, ruta] }));
    } catch (x) { setError(mensajeDeError(x)); } finally { setLeyendo(false); }
  };
  const guardar = async () => {
    if (!val.ok) return;
    setGuardando(true); setError(null);
    try {
      const ahora = new Date().toISOString();
      const id = ctx.demo ? (e.id ?? `e-${Date.now()}`) : await guardarEquipo(createClient(), e);
      onGuardado({
        id, store: e.store, kind: e.kind, name: e.name.trim(), brand: e.brand.trim() || null, model: e.model.trim() || null, serial: e.serial.trim() || null,
        year: numeroDelCampo(e.year, 0), status: e.status, hour_meter: numeroDelCampo(e.hour_meter, 1), notes: e.notes.trim() || null, photos: e.photos, active: e.active,
        created_by: ctx.yo.id, created_at: ahora, updated_by: ctx.yo.id, updated_at: ahora,
      });
    } catch (x) { setError(mensajeDeError(x)); } finally { setGuardando(false); }
  };
  return (
    <div className="overlay" onClick={onCerrar}>
      <div className="modal ops-tarjeta-reporte" onClick={(x) => x.stopPropagation()} role="dialog" aria-modal="true" data-form-equipo={e.id ?? "nuevo"}>
        <h3>{e.id ? t("Edit equipment", "Editar equipo") : t("Add equipment", "Dar de alta equipo")}</h3>
        <p className="sub">{e.store}</p>
        <div className="ops-formulario">
          <label className="ops-cantidad"><span>{t("Type", "Tipo")}</span>
            <div className="ops-opciones ops-dos">
              {CLASES_DE_EQUIPO.map((k) => <button type="button" key={k} className={`ops-opcion${e.kind === k ? " elegida" : ""}`} aria-pressed={e.kind === k} onClick={() => pon("kind", k)} data-opcion={k}>{INFO_DE_CLASE[k].emoji} {lang === "es" ? INFO_DE_CLASE[k].es : INFO_DE_CLASE[k].en}</button>)}
            </div>
          </label>
          <label className="ops-cantidad"><span>{t("Name", "Nombre")}</span><input className="ops-campo" value={e.name} onChange={(x) => pon("name", x.target.value)} placeholder={t("Forklift #1", "Montacargas #1")} data-campo="nombre" autoFocus /></label>
          <div className="ops-dos ops-opciones">
            <label className="ops-cantidad"><span>{t("Brand", "Marca")}</span><input className="ops-campo" value={e.brand} onChange={(x) => pon("brand", x.target.value)} data-campo="marca" /></label>
            <label className="ops-cantidad"><span>{t("Model", "Modelo")}</span><input className="ops-campo" value={e.model} onChange={(x) => pon("model", x.target.value)} data-campo="modelo" /></label>
            <label className="ops-cantidad"><span>{t("Serial", "Serie")}</span><input className="ops-campo" value={e.serial} onChange={(x) => pon("serial", x.target.value)} data-campo="serie" /></label>
            <label className="ops-cantidad"><span>{t("Year", "Año")}</span><input className="ops-campo" inputMode="numeric" value={e.year} onChange={(x) => pon("year", x.target.value)} data-campo="anio" /></label>
            <label className="ops-cantidad"><span>{t("Hour meter", "Horómetro")}</span><input className="ops-campo" inputMode="decimal" value={e.hour_meter} onChange={(x) => pon("hour_meter", x.target.value)} data-campo="horometro" /></label>
          </div>
          <label className="ops-cantidad"><span>{t("Status", "Estado")}</span>
            <div className="ops-opciones">
              {ESTADOS_DE_EQUIPO.map((s) => <button type="button" key={s} className={`ops-opcion${e.status === s ? " elegida" : ""}`} aria-pressed={e.status === s} onClick={() => pon("status", s)} data-opcion={s}>{lang === "es" ? INFO_DE_ESTADO[s].es : INFO_DE_ESTADO[s].en}</button>)}
            </div>
          </label>
          <label className="ops-cantidad"><span>{t("Notes", "Notas")}</span><textarea className="ops-campo" rows={3} value={e.notes} onChange={(x) => pon("notes", x.target.value)} data-campo="notas" /></label>
          <div className="ops-fotos">
            <span className="ops-cantidad">{t("Photos", "Fotos")} ({e.photos.length})</span>
            {e.photos.length > 0 && <ul className="ops-fotos-lista">{e.photos.map((p) => <li key={p} className="ops-insignia">{p.split("/").pop()} <button type="button" className="btn btn-sm" onClick={() => pon("photos", e.photos.filter((x) => x !== p))} data-accion="quitar-foto">✕</button></li>)}</ul>}
            {e.photos.length < 3 && <BotonesDeFoto onFoto={foto} leyendo={leyendo} etiquetaCamara={t("Take a photo", "Tomar foto")} primario={false} />}
          </div>
          {e.id && <label className="ops-fila"><input type="checkbox" checked={!e.active} onChange={(x) => pon("active", !x.target.checked)} data-campo="baja" /> {t("Retired (hide from the list)", "Dado de baja (ocultar de la lista)")}</label>}
        </div>
        {!val.ok && e.name && <p className="hint" data-motivo={val.motivo}>{motivoDeEquipo(val.motivo, lang)}</p>}
        {error && <p className="ops-aviso ops-aviso-error" role="alert">{error}</p>}
        <div className="modal-actions">
          <button type="button" className="btn" onClick={onCerrar} disabled={guardando}>{t("Cancel", "Cancelar")}</button>
          <button type="button" className="btn btn-primary" onClick={guardar} disabled={!val.ok || guardando || leyendo} data-accion="guardar-equipo">{guardando ? t("Saving…", "Guardando…") : t("Save", "Guardar")}</button>
        </div>
      </div>
    </div>
  );
}

/** La lista diaria desde el teléfono: un renglón por punto con Bien / Falla / N/A; la falla pide nota. */
function FormLista({ e, ctx, onCerrar, onGuardada }: { e: Equipo; ctx: Contexto; onCerrar: () => void; onGuardada: (l: Lista, estado: Equipo["status"]) => void }) {
  const { t, lang } = usePrefs();
  const plantilla = plantillaDe(e.kind);
  const [c, setC] = useState<Contestaciones>({});
  const [horometro, setHorometro] = useState(e.hour_meter == null ? "" : String(e.hour_meter));
  const [fotos, setFotos] = useState<string[]>([]);
  const [leyendo, setLeyendo] = useState(false);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const huecos = huecosDeLaLista(e.kind, c);
  const completa = listaCompleta(e.kind, c);
  const h = numeroDelCampo(horometro, 1);
  const horometroMal = h !== null && Number.isNaN(h);
  const marca = (id: string, r: Resultado) => setC((x) => ({ ...x, [id]: { ...x[id], result: r } }));
  const nota = (id: string, n: string) => setC((x) => ({ ...x, [id]: { ...x[id], note: n } }));
  const todoBien = () => setC(Object.fromEntries(plantilla.map((q) => [q.id, { result: "ok" as Resultado, note: c[q.id]?.note }])));
  const foto = async (f: File, origen: "camara" | "galeria") => {
    setLeyendo(true); setError(null);
    try {
      if (ctx.demo) { setFotos((x) => [...x, `demo/${crypto.randomUUID()}.jpg`]); return; }
      const leida = await leerFotoDelTelefono(f);
      if (!leida.ok) { console.error(detalleParaConsola(leida, f, navigator.userAgent, origen)); setError(mensajeDeFotoFallida(leida.motivo, lang)); return; }
      const ruta = await subirFoto(createClient(), ctx.yo.id, leida.jpg);
      setFotos((x) => [...x, ruta]);
    } catch (x) { setError(mensajeDeError(x)); } finally { setLeyendo(false); }
  };
  const enviar = async () => {
    if (!completa || horometroMal) return;
    setGuardando(true); setError(null);
    try {
      const items = puntosParaEnviar(e.kind, c);
      const dia = hoyEnTexas();
      const id = ctx.demo ? `l-${Date.now()}` : await enviarLista(createClient(), { equipoId: e.id, dia, items, horometro: h, fotos });
      const resultado = resultadoDeLaLista(items);
      onGuardada({
        id, equipment_id: e.id, store: e.store, done_by: ctx.yo.id, done_by_name: ctx.yo.full_name, done_at: new Date().toISOString(), shift_date: dia,
        items, result: resultado, failed_items: items.filter((x) => x.result === "fail").map((x) => x.id), hour_meter: h, photos: fotos,
      }, estadoTrasLaLista(e.status, resultado));
    } catch (x) { setError(mensajeDeError(x)); } finally { setGuardando(false); }
  };
  return (
    <div className="overlay" onClick={onCerrar}>
      <div className="modal ops-tarjeta-reporte" onClick={(x) => x.stopPropagation()} role="dialog" aria-modal="true" data-form-lista={e.id}>
        <h3>✅ {t("Daily checklist", "Lista diaria")} · {e.name}</h3>
        <p className="sub">{fmtDia(hoyEnTexas(), lang)} · {t("Tap OK, Fail or N/A on each item. A fail needs a note.", "Toca Bien, Falla o N/A en cada punto. Una falla necesita nota.")}</p>
        <div className="ops-exportar"><button type="button" className="btn btn-sm" onClick={todoBien} data-accion="todo-bien">{t("All OK", "Todo bien")}</button></div>
        <ol className="ops-puntos">
          {plantilla.map((q, n) => {
            const r = c[q.id];
            return (
              <li key={q.id} className="ops-punto" data-punto={q.id} data-resultado={r?.result ?? ""}>
                <span className="ops-punto-nombre">{n + 1}. {lang === "es" ? q.es : q.en}</span>
                <div className="ops-punto-botones">
                  {RESULTADOS.map((x) => (
                    <button type="button" key={x} className={`ops-opcion ops-opcion-chica ops-res-${x}${r?.result === x ? " elegida" : ""}`} aria-pressed={r?.result === x} onClick={() => marca(q.id, x)} data-res={x}>
                      {lang === "es" ? INFO_DE_RESULTADO[x].es : INFO_DE_RESULTADO[x].en}
                    </button>
                  ))}
                </div>
                {r?.result === "fail" && (
                  <input className="ops-campo ops-campo-nota" value={r.note ?? ""} onChange={(x) => nota(q.id, x.target.value)} placeholder={t("What is wrong? (required)", "¿Qué falla? (obligatorio)")} data-campo={`nota-${q.id}`} autoFocus />
                )}
              </li>
            );
          })}
        </ol>
        <label className="ops-cantidad"><span>{t("Hour meter reading (optional)", "Lectura del horómetro (opcional)")}</span>
          <input className="ops-campo" inputMode="decimal" value={horometro} onChange={(x) => setHorometro(x.target.value)} data-campo="horometro-lista" />
        </label>
        <div className="ops-fotos">
          <span className="ops-cantidad">{t("Photo (optional)", "Foto (opcional)")} {fotos.length > 0 && `(${fotos.length})`}</span>
          {fotos.length < 2 && <BotonesDeFoto onFoto={foto} leyendo={leyendo} etiquetaCamara={t("Take a photo", "Tomar foto")} primario={false} />}
        </div>
        {!completa && (
          <p className="hint" data-huecos={huecos.sinContestar.length + huecos.sinNota.length}>
            {huecos.sinContestar.length > 0 && t(`${huecos.sinContestar.length} item(s) left. `, `Faltan ${huecos.sinContestar.length} punto(s). `)}
            {huecos.sinNota.length > 0 && t("A failed item needs a note.", "Un punto que falló necesita nota.")}
          </p>
        )}
        {horometroMal && <p className="hint">{motivoDeEquipo("horometro", lang)}</p>}
        {error && <p className="ops-aviso ops-aviso-error" role="alert">{error}</p>}
        <div className="modal-actions">
          <button type="button" className="btn" onClick={onCerrar} disabled={guardando}>{t("Cancel", "Cancelar")}</button>
          <button type="button" className="btn btn-primary" onClick={enviar} disabled={!completa || horometroMal || guardando || leyendo} data-accion="enviar-lista">{guardando ? t("Sending…", "Enviando…") : t("Submit", "Enviar")}</button>
        </div>
      </div>
    </div>
  );
}

function FormTerminarUso({ uso, e, ctx, onCerrar, onCerrado }: { uso: Uso; e: Equipo; ctx: Contexto; onCerrar: () => void; onCerrado: (u: Uso, horometro: number | null) => void }) {
  const { t, lang } = usePrefs();
  const [horometro, setHorometro] = useState(e.hour_meter == null ? "" : String(e.hour_meter));
  const [notas, setNotas] = useState("");
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const h = numeroDelCampo(horometro, 1);
  const mal = h !== null && Number.isNaN(h);
  const cerrar = async () => {
    if (mal) return;
    setGuardando(true); setError(null);
    try {
      if (!ctx.demo) await terminarUso(createClient(), uso.id, h, notas);
      onCerrado({ ...uso, ended_at: new Date().toISOString(), hour_meter_end: h, notes: notas.trim() || null }, h);
    } catch (x) { setError(mensajeDeError(x)); } finally { setGuardando(false); }
  };
  return (
    <div className="overlay" onClick={onCerrar}>
      <div className="modal ops-tarjeta-reporte" onClick={(x) => x.stopPropagation()} role="dialog" aria-modal="true" data-form-terminar={uso.id}>
        <h3>■ {t("Stop using", "Dejar de usar")} · {e.name}</h3>
        <p className="sub">{t("Since", "Desde")} {fmtDateTime(uso.started_at)} · {duracionDeUso(uso, lang)}</p>
        <label className="ops-cantidad"><span>{t("Hour meter now (optional)", "Horómetro ahora (opcional)")}</span><input className="ops-campo" inputMode="decimal" value={horometro} onChange={(x) => setHorometro(x.target.value)} data-campo="horometro-fin" autoFocus /></label>
        <label className="ops-cantidad"><span>{t("Notes (optional)", "Notas (opcional)")}</span><textarea className="ops-campo" rows={2} value={notas} onChange={(x) => setNotas(x.target.value)} data-campo="notas-uso" /></label>
        {mal && <p className="hint">{motivoDeEquipo("horometro", lang)}</p>}
        {error && <p className="ops-aviso ops-aviso-error" role="alert">{error}</p>}
        <div className="modal-actions">
          <button type="button" className="btn" onClick={onCerrar} disabled={guardando}>{t("Cancel", "Cancelar")}</button>
          <button type="button" className="btn btn-primary" onClick={cerrar} disabled={mal || guardando} data-accion="confirmar-terminar">{t("Stop", "Terminar")}</button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Refacciones y herramientas
// ---------------------------------------------------------------------------
function InsigniaDePieza({ p }: { p: Pick<Pieza, "status"> }) {
  const { lang } = usePrefs();
  const i = INFO_DE_ESTADO_DE_PIEZA[p.status];
  return <span className="ops-etapa" style={{ "--etapa": i.color } as React.CSSProperties} data-estado-pieza={p.status}><span className="ops-etapa-nombre">{lang === "es" ? i.es : i.en}</span></span>;
}

const FILTROS: FiltroDePieza[] = ["atencion", "todas", "needed", "ordered", "received", "ok"];

function Refacciones({ ctx, datos, tienda, pon }: { ctx: Contexto; datos: Datos; tienda: string; pon: (f: (d: Datos) => Datos) => void }) {
  const { t, lang } = usePrefs();
  const [filtro, setFiltro] = useState<FiltroDePieza>("atencion");
  const [abierta, setAbierta] = useState<string | null>(null);
  const [pidiendo, setPidiendo] = useState(false);
  const [nueva, setNueva] = useState(false);
  const gestiona = puedeGestionar(ctx.yo, tienda);
  const opera = puedeOperar(ctx.yo, tienda);
  const equipos = useMemo(() => datos.equipos.filter((e) => e.store === tienda && e.active), [datos.equipos, tienda]);
  const lista = useMemo(() => ordenarPiezas(filtrarPiezas(datos.piezas.filter((p) => p.store === tienda), filtro)), [datos.piezas, tienda, filtro]);
  const elegida = abierta ? datos.piezas.find((p) => p.id === abierta) ?? null : null;
  const nombreDelFiltro = (f: FiltroDePieza) => f === "todas" ? t("All", "Todas") : f === "atencion" ? t("Needs attention", "Atención") : (lang === "es" ? INFO_DE_ESTADO_DE_PIEZA[f].es : INFO_DE_ESTADO_DE_PIEZA[f].en);
  const guardada = (p: Pieza) => pon((d) => ({ ...d, piezas: [...d.piezas.filter((x) => x.id !== p.id), p] }));
  return (
    <>
      <div className="ops-filtros-campos">
        {FILTROS.map((f) => <button type="button" key={f} className={`btn btn-sm${filtro === f ? " btn-primary" : ""}`} onClick={() => setFiltro(f)} data-filtro={f}>{nombreDelFiltro(f)}</button>)}
        <span className="ops-filtros-espacio" />
        {opera && <button type="button" className="btn btn-sm" onClick={() => setPidiendo(true)} data-accion="pedir-pieza">🧩 {t("Request a part", "Pedir refacción")}</button>}
        {gestiona && <button type="button" className="btn btn-sm" onClick={() => setNueva(true)} data-accion="nueva-pieza">＋ {t("Add part / tool", "Dar de alta")}</button>}
      </div>
      {lista.length === 0 && <p className="hint" data-sin-piezas>{t("Nothing here.", "Nada por aquí.")}</p>}
      <ul className="ops-lista-equipo">
        {lista.map((p) => {
          const eq = p.equipment_id ? datos.equipos.find((e) => e.id === p.equipment_id) : null;
          return (
            <li key={p.id}>
              <button type="button" className="ops-equipo" onClick={() => setAbierta(p.id)} data-pieza={p.id} data-estado-pieza={p.status}>
                <span className="ops-equipo-icono" aria-hidden>{p.kind === "tool" ? "🔧" : p.kind === "consumable" ? "🛢️" : "⚙️"}</span>
                <span className="ops-equipo-texto">
                  <span className="ops-equipo-nombre">{p.name}</span>
                  <span className="ops-equipo-meta">
                    {lang === "es" ? INFO_DE_CLASE_DE_PIEZA[p.kind].es : INFO_DE_CLASE_DE_PIEZA[p.kind].en}
                    {eq ? ` · ${eq.name}` : ""} · {t("on hand", "existencia")} {p.qty_on_hand}{p.min_qty > 0 ? ` / ${t("min", "mín")} ${p.min_qty}` : ""}
                  </span>
                  <span className="ops-equipo-insignias">
                    <InsigniaDePieza p={p} />
                    {bajoMinimo(p) && <span className="ops-insignia ops-insignia-sin-foto" data-bajo-minimo>{t("Below minimum", "Bajo mínimo")}</span>}
                    {p.status === "needed" && p.requested_by_name && <span className="hint">{t("asked by", "la pidió")} {p.requested_by_name}</span>}
                  </span>
                </span>
              </button>
            </li>
          );
        })}
      </ul>
      {elegida && <TarjetaPieza p={elegida} ctx={ctx} equipos={equipos} onCerrar={() => setAbierta(null)} onCambio={guardada} />}
      {pidiendo && <FormPedirPieza ctx={ctx} tienda={tienda} equipos={equipos} equipoId={null} onCerrar={() => setPidiendo(false)} onGuardada={(p) => { guardada(p); setPidiendo(false); }} />}
      {nueva && <FormPieza inicial={null} tienda={tienda} ctx={ctx} equipos={equipos} onCerrar={() => setNueva(false)} onGuardada={(p) => { guardada(p); setNueva(false); }} />}
    </>
  );
}

function TarjetaPieza({ p, ctx, equipos, onCerrar, onCambio }: { p: Pieza; ctx: Contexto; equipos: Equipo[]; onCerrar: () => void; onCambio: (p: Pieza) => void }) {
  const { t, lang } = usePrefs();
  const [editando, setEditando] = useState(false);
  const [pidiendo, setPidiendo] = useState(false);
  const [ocupado, setOcupado] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const gestiona = puedeGestionar(ctx.yo, p.store);
  const opera = puedeOperar(ctx.yo, p.store);
  const eq = p.equipment_id ? equipos.find((e) => e.id === p.equipment_id) ?? null : null;
  const transiciones = transicionesDePieza(p.status, gestiona);
  const mover = async (estado: EstadoDePieza) => {
    setOcupado(true); setError(null);
    try {
      const ahora = new Date().toISOString();
      if (!ctx.demo) {
        if (gestiona) await guardarPieza(createClient(), { id: p.id, tienda: p.store, equipoId: p.equipment_id, nombre: p.name, clase: p.kind, existencia: p.qty_on_hand, minimo: p.min_qty, estado, notas: p.notes ?? "" });
        else await pedirPieza(createClient(), { id: p.id, tienda: p.store, equipoId: p.equipment_id, nombre: p.name, clase: p.kind, nota: "" });
      }
      const pedida = estado === "needed" && p.status !== "needed";
      onCambio({ ...p, status: estado, updated_by: ctx.yo.id, updated_at: ahora, ...(pedida ? { requested_by: ctx.yo.id, requested_by_name: ctx.yo.full_name, requested_at: ahora } : {}) });
    } catch (x) { setError(mensajeDeError(x)); } finally { setOcupado(false); }
  };
  if (editando) return <FormPieza inicial={p} tienda={p.store} ctx={ctx} equipos={equipos} onCerrar={() => setEditando(false)} onGuardada={(n) => { onCambio(n); setEditando(false); }} />;
  if (pidiendo) return <FormPedirPieza ctx={ctx} tienda={p.store} equipos={equipos} equipoId={p.equipment_id} pieza={p} onCerrar={() => setPidiendo(false)} onGuardada={(n) => { onCambio(n); setPidiendo(false); }} />;
  return (
    <div className="overlay" onClick={onCerrar}>
      <div className="modal ops-tarjeta-reporte" onClick={(x) => x.stopPropagation()} role="dialog" aria-modal="true" data-tarjeta-pieza={p.id}>
        <h3>{p.name} <InsigniaDePieza p={p} /></h3>
        <p className="sub">{lang === "es" ? INFO_DE_CLASE_DE_PIEZA[p.kind].es : INFO_DE_CLASE_DE_PIEZA[p.kind].en} · {p.store}{eq ? ` · ${eq.name}` : ""}</p>
        <dl className="ops-tarjeta-datos">
          <dt>{t("On hand", "Existencia")}</dt><dd>{p.qty_on_hand}{p.min_qty > 0 ? ` (${t("min", "mín")} ${p.min_qty})` : ""}{bajoMinimo(p) && <> · <span className="ops-insignia ops-insignia-sin-foto">{t("Below minimum", "Bajo mínimo")}</span></>}</dd>
          {p.requested_at && <><dt>{t("Requested", "Pedida")}</dt><dd>{fmtDateTime(p.requested_at)} · {p.requested_by_name ?? "—"}</dd></>}
          {p.notes && <><dt>{t("Notes", "Notas")}</dt><dd>{p.notes}</dd></>}
          <dt>{t("Updated", "Actualizada")}</dt><dd>{fmtDateTime(p.updated_at)}</dd>
        </dl>
        {error && <p className="ops-aviso ops-aviso-error" role="alert">{error}</p>}
        {opera && (
          <div className="ops-etapa-acciones" data-transiciones={transiciones.join(",")}>
            {transiciones.map((s) => (
              s === "needed" && !gestiona
                ? <button type="button" key={s} className="ops-boton ops-boton-primario" onClick={() => setPidiendo(true)} disabled={ocupado} data-mover={s}>🧩 {t("Mark as needed", "Marcar «se necesita»")}</button>
                : <button type="button" key={s} className={`ops-boton${s === "ordered" || s === "received" ? " ops-boton-primario" : ""}`} onClick={() => mover(s)} disabled={ocupado} data-mover={s}>
                    → {lang === "es" ? INFO_DE_ESTADO_DE_PIEZA[s].es : INFO_DE_ESTADO_DE_PIEZA[s].en}
                  </button>
            ))}
            {gestiona && <button type="button" className="ops-boton" onClick={() => setEditando(true)} data-accion="editar-pieza">✏️ {t("Edit", "Editar")}</button>}
          </div>
        )}
        <div className="modal-actions"><button type="button" className="btn" onClick={onCerrar}>{t("Close", "Cerrar")}</button></div>
      </div>
    </div>
  );
}

/** El personal pide una refacción: nueva (nombre + tipo + nota) o una existente (solo la nota). */
function FormPedirPieza({ ctx, tienda, equipos, equipoId, pieza, onCerrar, onGuardada }: {
  ctx: Contexto; tienda: string; equipos: Equipo[]; equipoId: string | null; pieza?: Pieza; onCerrar: () => void; onGuardada: (p: Pieza) => void;
}) {
  const { t, lang } = usePrefs();
  const [nombre, setNombre] = useState(pieza?.name ?? "");
  const [clase, setClase] = useState<ClaseDePieza>(pieza?.kind ?? "part");
  const [equipo, setEquipo] = useState<string>(equipoId ?? pieza?.equipment_id ?? "");
  const [nota, setNota] = useState("");
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const valido = nombre.trim().length >= 2 && nota.trim().length >= 3;
  const pedir = async () => {
    if (!valido) return;
    setGuardando(true); setError(null);
    try {
      const ahora = new Date().toISOString();
      const eqId = equipo || null;
      const id = ctx.demo ? (pieza?.id ?? `pz-${Date.now()}`) : await pedirPieza(createClient(), { id: pieza?.id ?? null, tienda, equipoId: eqId, nombre, clase, nota });
      onGuardada({
        id, store: tienda, equipment_id: pieza?.equipment_id ?? eqId, name: pieza?.name ?? nombre.trim(), kind: pieza?.kind ?? clase,
        qty_on_hand: pieza?.qty_on_hand ?? 0, min_qty: pieza?.min_qty ?? 0, status: "needed",
        requested_by: ctx.yo.id, requested_by_name: ctx.yo.full_name, requested_at: ahora, notes: nota.trim() || pieza?.notes || null,
        created_at: pieza?.created_at ?? ahora, updated_by: ctx.yo.id, updated_at: ahora,
      });
    } catch (x) { setError(mensajeDeError(x)); } finally { setGuardando(false); }
  };
  return (
    <div className="overlay" onClick={onCerrar}>
      <div className="modal ops-tarjeta-reporte" onClick={(x) => x.stopPropagation()} role="dialog" aria-modal="true" data-form-pedir={pieza?.id ?? "nueva"}>
        <h3>🧩 {t("Request a part", "Pedir refacción")}</h3>
        <p className="sub">{tienda} · {t("Your manager will see it as “Needed”.", "Tu gerente la verá como «Se necesita».")}</p>
        <div className="ops-formulario">
          {!pieza && (
            <>
              <label className="ops-cantidad"><span>{t("What do you need?", "¿Qué se necesita?")}</span><input className="ops-campo" value={nombre} onChange={(x) => setNombre(x.target.value)} placeholder={t("Hydraulic hose, propane tank…", "Manguera hidráulica, tanque de propano…")} data-campo="nombre-pieza" autoFocus /></label>
              <div className="ops-opciones ops-dos">
                {CLASES_DE_PIEZA.map((k) => <button type="button" key={k} className={`ops-opcion ops-opcion-chica${clase === k ? " elegida" : ""}`} aria-pressed={clase === k} onClick={() => setClase(k)} data-opcion={k}>{lang === "es" ? INFO_DE_CLASE_DE_PIEZA[k].es : INFO_DE_CLASE_DE_PIEZA[k].en}</button>)}
              </div>
              {equipos.length > 0 && (
                <label className="ops-cantidad"><span>{t("For which unit? (optional)", "¿Para qué equipo? (opcional)")}</span>
                  <select className="ops-campo" value={equipo} onChange={(x) => setEquipo(x.target.value)} data-campo="equipo-pieza">
                    <option value="">{t("None / general", "Ninguno / general")}</option>
                    {equipos.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
                  </select>
                </label>
              )}
            </>
          )}
          {pieza && <p><strong>{pieza.name}</strong></p>}
          <label className="ops-cantidad"><span>{t("Why / details (required)", "Por qué / detalles (obligatorio)")}</span><textarea className="ops-campo" rows={3} value={nota} onChange={(x) => setNota(x.target.value)} data-campo="nota-pieza" autoFocus={!!pieza} /></label>
        </div>
        {error && <p className="ops-aviso ops-aviso-error" role="alert">{error}</p>}
        <div className="modal-actions">
          <button type="button" className="btn" onClick={onCerrar} disabled={guardando}>{t("Cancel", "Cancelar")}</button>
          <button type="button" className="btn btn-primary" onClick={pedir} disabled={!valido || guardando} data-accion="confirmar-pedir">{guardando ? t("Sending…", "Enviando…") : t("Request", "Pedir")}</button>
        </div>
      </div>
    </div>
  );
}

/** Alta / edición completa de una refacción (gestor). */
function FormPieza({ inicial, tienda, ctx, equipos, onCerrar, onGuardada }: { inicial: Pieza | null; tienda: string; ctx: Contexto; equipos: Equipo[]; onCerrar: () => void; onGuardada: (p: Pieza) => void }) {
  const { t, lang } = usePrefs();
  const [nombre, setNombre] = useState(inicial?.name ?? "");
  const [clase, setClase] = useState<ClaseDePieza>(inicial?.kind ?? "part");
  const [equipo, setEquipo] = useState(inicial?.equipment_id ?? "");
  const [existencia, setExistencia] = useState(inicial ? String(inicial.qty_on_hand) : "0");
  const [minimo, setMinimo] = useState(inicial ? String(inicial.min_qty) : "0");
  const [estado, setEstado] = useState<EstadoDePieza>(inicial?.status ?? "ok");
  const [notas, setNotas] = useState(inicial?.notes ?? "");
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ex = numeroDelCampo(existencia, 2); const mi = numeroDelCampo(minimo, 2);
  const valido = nombre.trim().length >= 2 && ex !== null && !Number.isNaN(ex) && mi !== null && !Number.isNaN(mi);
  const guardar = async () => {
    if (!valido) return;
    setGuardando(true); setError(null);
    try {
      const ahora = new Date().toISOString();
      const id = ctx.demo ? (inicial?.id ?? `pz-${Date.now()}`) : await guardarPieza(createClient(), { id: inicial?.id ?? null, tienda, equipoId: equipo || null, nombre, clase, existencia: ex, minimo: mi, estado, notas });
      const pedida = estado === "needed" && inicial?.status !== "needed";
      onGuardada({
        id, store: tienda, equipment_id: equipo || null, name: nombre.trim(), kind: clase, qty_on_hand: ex!, min_qty: mi!, status: estado,
        requested_by: pedida ? ctx.yo.id : inicial?.requested_by ?? null, requested_by_name: pedida ? ctx.yo.full_name : inicial?.requested_by_name ?? null, requested_at: pedida ? ahora : inicial?.requested_at ?? null,
        notes: notas.trim() || null, created_at: inicial?.created_at ?? ahora, updated_by: ctx.yo.id, updated_at: ahora,
      });
    } catch (x) { setError(mensajeDeError(x)); } finally { setGuardando(false); }
  };
  return (
    <div className="overlay" onClick={onCerrar}>
      <div className="modal ops-tarjeta-reporte" onClick={(x) => x.stopPropagation()} role="dialog" aria-modal="true" data-form-pieza={inicial?.id ?? "nueva"}>
        <h3>{inicial ? t("Edit part / tool", "Editar refacción / herramienta") : t("Add part / tool", "Dar de alta refacción / herramienta")}</h3>
        <p className="sub">{tienda}</p>
        <div className="ops-formulario">
          <label className="ops-cantidad"><span>{t("Name", "Nombre")}</span><input className="ops-campo" value={nombre} onChange={(x) => setNombre(x.target.value)} data-campo="nombre-pieza" autoFocus /></label>
          <div className="ops-opciones ops-dos">
            {CLASES_DE_PIEZA.map((k) => <button type="button" key={k} className={`ops-opcion ops-opcion-chica${clase === k ? " elegida" : ""}`} aria-pressed={clase === k} onClick={() => setClase(k)} data-opcion={k}>{lang === "es" ? INFO_DE_CLASE_DE_PIEZA[k].es : INFO_DE_CLASE_DE_PIEZA[k].en}</button>)}
          </div>
          <label className="ops-cantidad"><span>{t("For which unit? (optional)", "¿Para qué equipo? (opcional)")}</span>
            <select className="ops-campo" value={equipo} onChange={(x) => setEquipo(x.target.value)} data-campo="equipo-pieza">
              <option value="">{t("None / general", "Ninguno / general")}</option>
              {equipos.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
            </select>
          </label>
          <div className="ops-opciones ops-dos">
            <label className="ops-cantidad"><span>{t("On hand", "Existencia")}</span><input className="ops-campo" inputMode="decimal" value={existencia} onChange={(x) => setExistencia(x.target.value)} data-campo="existencia" /></label>
            <label className="ops-cantidad"><span>{t("Minimum", "Mínimo")}</span><input className="ops-campo" inputMode="decimal" value={minimo} onChange={(x) => setMinimo(x.target.value)} data-campo="minimo" /></label>
          </div>
          <label className="ops-cantidad"><span>{t("Status", "Estado")}</span>
            <div className="ops-opciones ops-dos">
              {(["ok", "needed", "ordered", "received"] as EstadoDePieza[]).map((s) => <button type="button" key={s} className={`ops-opcion ops-opcion-chica${estado === s ? " elegida" : ""}`} aria-pressed={estado === s} onClick={() => setEstado(s)} data-opcion={s}>{lang === "es" ? INFO_DE_ESTADO_DE_PIEZA[s].es : INFO_DE_ESTADO_DE_PIEZA[s].en}</button>)}
            </div>
          </label>
          <label className="ops-cantidad"><span>{t("Notes", "Notas")}</span><textarea className="ops-campo" rows={2} value={notas} onChange={(x) => setNotas(x.target.value)} data-campo="notas-pieza" /></label>
        </div>
        {error && <p className="ops-aviso ops-aviso-error" role="alert">{error}</p>}
        <div className="modal-actions">
          <button type="button" className="btn" onClick={onCerrar} disabled={guardando}>{t("Cancel", "Cancelar")}</button>
          <button type="button" className="btn btn-primary" onClick={guardar} disabled={!valido || guardando} data-accion="guardar-pieza">{guardando ? t("Saving…", "Guardando…") : t("Save", "Guardar")}</button>
        </div>
      </div>
    </div>
  );
}
