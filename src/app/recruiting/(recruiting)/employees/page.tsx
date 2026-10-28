"use client";

import { useCallback, useEffect, useState } from "react";
import { usePrefs } from "@/lib/prefs";
import { useData } from "@/lib/recruiting-data-provider";
import {
  accountFactsFor, listEmployeeFiles, getEmployeeDocs, saveEmployeeFile, saveEmployeeDoc, deleteEmployeeDoc,
  listStoreNames, setHubAccess, signDocUrl, uploadDocFile,
  type EmployeeDoc, type EmployeeFile,
} from "@/app/recruiting/actions/hr";
import { DOC_KINDS, REQUIRED_FORMS } from "@/lib/recruiting/hr";
import {
  ETIQUETAS_CAMPO, camposQueFaltan, cuentaIncompletos, cuentaPorEstado, estadoEmpleado, etiquetaEstado,
  etiquetaMotivoBaja, filtraPorEstado, hoyLocalISO, puedeDarDeBaja, puedeEditarGrupoDirectorio,
  resumenDeCuenta, saleEnDirectorio, telefonoDeFicha, tiendaVisible,
  type FiltroEstado, type HechosDeCuenta,
} from "@/lib/recruiting/employee-file";
import { UsuariosPorCrear } from "@/components/recruiting/UsuariosPorCrear";
import { cuentaPorCuenta, filtraPorCuenta, tieneUsuario, type FiltroCuenta } from "@/lib/recruiting/usuarios-rrhh";
import { AgregarDialog, BajaDialog, ReactivarDialog, faltaMigracion } from "./acciones";
import { BloqueTimeTracker } from "./time-tracker";
import { useOrdenYFiltro } from "@/lib/use-orden-y-filtro";
import { CabeceraConMenu, FiltrosPuestos, MenuDeColumnaAbierto } from "@/components/CabeceraConMenu";
import { anchoDeTabla, useColWidthMap } from "@/lib/use-col-widths";
import { downloadCSV, toCSV } from "@/lib/utils";
import { exportaTablaExcel } from "@/lib/export-tabla";
import { COLUMNAS_DE_EMPLEADOS, coincideBusqueda, tablaParaExportar, valorDeEmpleado } from "@/lib/recruiting/tabla-de-empleados";
import { COLUMNAS_207, OPCIONES_1PW, TIENDA_REMOTA, costoMensual, dinero, hayCambios, parcheDeTienda, tiendaDelSelector } from "@/lib/recruiting/employee-file";
import { PermisosDelEmpleado } from "@/components/recruiting/PermisosDelEmpleado";

/**
 * El expediente de RR. HH. (D-145).
 *
 * Tres bloques, como se pidieron: **INFO**, **HR** y **FORMS**. Pero no se pintan como tres
 * columnas de una tabla, y esa es la única decisión de forma que importa aquí: dieciocho
 * columnas por treinta personas es un mural que no se lee y que nadie rellena.
 *
 * La lista enseña solo lo que se mira de un vistazo —quién es y **qué le falta**— y el
 * expediente entero se abre por persona. Porque la pregunta de RR. HH. no es "enséñamelo todo",
 * es *"¿a quién le falta algo?"*.
 *
 * Y lleva los botones: «＋ Agregar empleado», «Editar», «Dar de baja» y «Reactivar», y el filtro
 * Activos / Bajas / Todos. Las acciones de baja existían desde D-251 sin ningún botón que las llamara.
 */

type Fila = EmployeeFile & { docKinds: string[] };

export default function EmployeeFilesPage() {
  const { t, lang } = usePrefs();
  const { me, notify } = useData();
  const [rows, setRows] = useState<Fila[]>([]);
  // ¿Tiene la tabla las columnas de la 159? Sin ellas los campos nuevos salen apagados.
  const [con159, setCon159] = useState(false);
  // La 207 (D-719): herramientas y costo. Igual que la 159: sin ella, la sección se apaga y dice por qué.
  const [con207, setCon207] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [cargando, setCargando] = useState(true);
  const [abierto, setAbierto] = useState<string | null>(null);
  // D-703: de quién se está enseñando «qué falta» (al pulsar la insignia «incompleto»).
  const [queFalta, setQueFalta] = useState<string | null>(null);
  const [buscar, setBuscar] = useState("");
  const [soloFaltan, setSoloFaltan] = useState(false);
  const [soloIncompletos, setSoloIncompletos] = useState(false);
  // Por defecto los ACTIVOS: una baja no debe estorbar en la lista de todos los días.
  const [estado, setEstado] = useState<FiltroEstado>("activos");
  const [baja, setBaja] = useState<string | null>(null);
  const [reactivar, setReactivar] = useState<string | null>(null);
  const [agregando, setAgregando] = useState(false);
  // «User created» (D-694): quién tiene ya cuenta del hub y quién no.
  const [filtroCuenta, setFiltroCuenta] = useState<FiltroCuenta>("todos");
  // `me.role` es el rol de RR. HH. (el layout del módulo lo monta así). La barrera de verdad está
  // en las acciones de servidor; esto es para no ofrecer un botón que va a fallar.
  const puedeBaja = puedeDarDeBaja(me?.role);

  const load = useCallback(async () => {
    const r = await listEmployeeFiles();
    if (!r.ok) setErr(r.message);
    else { setErr(null); setRows(r.rows); setCon159(r.campos159); setCon207(r.campos207); }
    setCargando(false);
  }, []);

  useEffect(() => { void load(); }, [load]);

  const faltan = (r: { docKinds: string[] }) => REQUIRED_FORMS.filter((f) => !r.docKinds.includes(f.key));

  const cuenta = cuentaPorEstado(rows);
  const delEstado = filtraPorEstado(rows, estado);
  const incompletos = cuentaIncompletos(delEstado, con159);
  const visibles = delEstado
    .filter((r) => coincideBusqueda({ ...r, store: tiendaVisible(r) }, buscar))
    .filter((r) => !soloFaltan || faltan(r).length > 0)
    .filter((r) => !soloIncompletos || camposQueFaltan(r, con159).length > 0)
    .filter((r) => filtraPorCuenta([r], filtroCuenta).length > 0);
  const porCuenta = cuentaPorCuenta(delEstado);

  // D-706: la tabla como la de Órdenes: menú ▾ por columna (ordenar + filtrar), anchos que se arrastran y se
  // guardan en este navegador, y exportar lo que se ve (las filas que la RLS dejó cargar, con los filtros puestos).
  const valorDe = useCallback((clave: string, r: Fila) => valorDeEmpleado(clave, { ...r, store: tiendaVisible(r) }, {
    sinLlenar: camposQueFaltan(r, con159).length,
    papelesQueFaltan: REQUIRED_FORMS.filter((f) => !r.docKinds.includes(f.key)).length,
  }, (en, es) => (lang === "es" ? es : en)), [con159, lang]);
  const orden = useOrdenYFiltro(visibles, valorDe);
  const colw = useColWidthMap("rrhh-empleados-anchos", 130, { minimo: 60 });
  const ancho = (c: { key: string; ancho: number }) => colw.widthOf(c.key, c.ancho);
  const exporta = (como: "csv" | "excel") => {
    const tabla = tablaParaExportar(COLUMNAS_DE_EMPLEADOS, orden.visibles, valorDe, lang);
    const nombre = "empleados_" + (estado === "bajas" ? "dados_de_baja_" : "") + hoyLocalISO();
    if (como === "csv") downloadCSV(nombre + ".csv", toCSV(tabla.cabeceras, tabla.filas));
    else exportaTablaExcel(nombre + ".xlsx", t("Employees", "Empleados"), tabla.cabeceras, tabla.filas)
      .catch((e: unknown) => notify(t("Could not export: ", "No se pudo exportar: ") + ((e as { message?: string })?.message ?? "")));
  };

  const porId = (id: string | null) => rows.find((r) => r.id === id) ?? null;
  const abiertaFila = porId(abierto);
  const bajaFila = porId(baja);
  const queFaltaFila = porId(queFalta);
  const reactivarFila = porId(reactivar);
  const soloAdmin = t("Only an HR admin can do this.", "Solo un admin de RR. HH. puede hacer esto.");

  const ESTADOS: { key: FiltroEstado; en: string; es: string }[] = [
    { key: "activos", en: "Active", es: "Activos" },
    { key: "bajas", en: "Terminated", es: "Dados de baja" },
    { key: "todos", en: "All", es: "Todos" },
  ];

  return (
    <>
      <UsuariosPorCrear />
      <div className="card">
        <div className="sec-head" style={{ marginTop: 0 }}>
          <span className="sec-title">👤 {t("Employee files", "Expedientes")}</span>
          <span className="sec-sub">
            {t("Everyone in the company, their details and their paperwork.",
               "Toda la plantilla, sus datos y sus papeles.")}
          </span>
          <button className="btn btn-primary" style={{ marginLeft: "auto" }} data-accion="agregar"
            onClick={() => setAgregando(true)}>
            ＋ {t("Add employee", "Agregar empleado")}
          </button>
        </div>

        {!cargando && !err && !con159 && (
          <div className="hint" data-aviso="159"
            style={{ background: "var(--tint-warn)", border: "1px solid var(--tint-warn-line)", borderRadius: 8, padding: "8px 12px", marginBottom: 10 }}>
            {t("Migration 159 is not applied yet: position, personal phone, personal email, emergency contact and the reason for leaving are switched off until it is.",
               "Falta aplicar la migración 159: puesto, teléfono personal, correo personal, contacto de emergencia y motivo de baja salen apagados hasta entonces.")}
          </div>
        )}

        <div className="filters">
          {ESTADOS.map((e) => (
            <button key={e.key} className={"chip" + (estado === e.key ? " on" : "")} data-estado={e.key}
              onClick={() => setEstado(e.key)}>
              {t(e.en, e.es)} · {cuenta[e.key]}
            </button>
          ))}
          <input
            value={buscar}
            onChange={(e) => setBuscar(e.target.value)}
            placeholder={t("Search name, position, phone, email…", "Buscar nombre, puesto, teléfono, correo…")}
            style={{ width: "auto", minWidth: 220 }}
          />
          <button className={"chip" + (soloIncompletos ? " on" : "")} data-filtro="incompletos"
            onClick={() => setSoloIncompletos(!soloIncompletos)}>
            {t("Incomplete files", "Expedientes incompletos")} · {incompletos}
          </button>
          <button className={"chip" + (soloFaltan ? " on" : "")} onClick={() => setSoloFaltan(!soloFaltan)}>
            {t("Only missing paperwork", "Solo con papeles pendientes")}
          </button>
          {(["con", "sin"] as const).map((k) => (
            <button key={k} className={"chip" + (filtroCuenta === k ? " on" : "")} data-filtro-cuenta={k}
              onClick={() => setFiltroCuenta(filtroCuenta === k ? "todos" : k)}>
              {k === "con" ? t("User created", "Con usuario") : t("No user", "Sin usuario")} · {porCuenta[k]}
            </button>
          ))}
        </div>

        {err && <div className="hint" style={{ color: "var(--red)" }}>{err}</div>}

        {cargando ? (
          <div className="hint">{t("Loading…", "Cargando…")}</div>
        ) : visibles.length === 0 ? (
          <div className="empty">
            {soloFaltan
              ? t("Nobody has paperwork pending.", "No hay papeles pendientes de nadie.")
              : estado === "bajas" && !buscar && !soloIncompletos
                ? t("Nobody has left.", "No hay ninguna baja.")
                : t("Nobody matches.", "Nadie coincide.")}
          </div>
        ) : (
          <>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", margin: "6px 0" }}>
            <FiltrosPuestos estado={orden} columnas={COLUMNAS_DE_EMPLEADOS} lang={lang} t={t} />
            <span style={{ marginLeft: "auto" }} />
            <button className="btn btn-ghost btn-sm" data-exporta="excel" disabled={!orden.visibles.length} onClick={() => exporta("excel")}>📊 Excel</button>
            <button className="btn btn-ghost btn-sm" data-exporta="csv" disabled={!orden.visibles.length} onClick={() => exporta("csv")}>⬇ CSV</button>
          </div>
          <div className="tbl-scroll tbl-fit">
          <table className="cmp-tbl tbl-resize" style={anchoDeTabla([...COLUMNAS_DE_EMPLEADOS.map(ancho), 170])} data-tabla-de-empleados>
            <colgroup>
              {COLUMNAS_DE_EMPLEADOS.map((c) => <col key={c.key} style={{ width: ancho(c) }} />)}
              <col style={{ width: 170 }} />
            </colgroup>
            <thead>
              <tr>
                {COLUMNAS_DE_EMPLEADOS.map((c) => (
                  <th key={c.key}>
                    <CabeceraConMenu estado={orden} col={c} lang={lang} t={t} />
                    <span className="col-resizer" onMouseDown={colw.startResize(c.key, c.ancho)} onDoubleClick={() => colw.resetCol(c.key)}
                      title={t("Drag to change the width; double-click to reset", "Arrastra para cambiar el ancho; doble clic para restablecer")} data-asa-de={c.key} />
                  </th>
                ))}
                <th />
              </tr>
            </thead>
            <tbody>
              {orden.visibles.length === 0 && (
                <tr><td colSpan={COLUMNAS_DE_EMPLEADOS.length + 1} className="hint">{t("Nobody matches these column filters.", "Nadie coincide con los filtros de columna.")}</td></tr>
              )}
              {orden.visibles.map((r) => {
                const pend = faltan(r);
                const sinLlenar = camposQueFaltan(r, con159);
                const deBaja = estadoEmpleado(r) === "baja";
                return (
                  // D-705: la fila entera abre el expediente (antes solo «✏️ Editar»: la fila no tenía manejador, y
                  // la celda «Expediente» era una insignia sin clic). Con teclado: Tab hasta la fila y Enter o espacio.
                  <tr key={r.id} data-fila={r.id} className={"fila-abre" + (deBaja ? " atenuado" : "")} tabIndex={0}
                    aria-label={t("Open file of ", "Abrir expediente de ") + r.full_name}
                    onClick={() => setAbierto(r.id)}
                    onKeyDown={(e) => { if (e.target === e.currentTarget && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); setAbierto(r.id); } }}>
                    <td style={{ fontWeight: 700 }} title={r.full_name}>
                      {r.full_name}
                      {deBaja && (
                        <span className="badge" data-insignia="baja"
                          style={{ marginLeft: 8, background: "var(--tint-red-strong)", color: "var(--red)" }}
                          title={[r.date_left, etiquetaMotivoBaja(r.left_reason, lang)].filter(Boolean).join(" · ")}>
                          {etiquetaEstado("baja", lang)}
                        </span>
                      )}
                    </td>
                    <td>{r.job_title || "—"}</td>
                    <td>{r.department || "—"}</td>
                    <td>{tiendaVisible(r) || "—"}</td>
                    <td>{r.phone || "—"}</td>
                    <td>{r.ringcentral_ext || "—"}</td>
                    <td>{r.date_hired || "—"}</td>
                    <td>{r.date_left || "—"}</td>
                    <td>
                      {tieneUsuario(r) ? (
                        <span className="badge" data-insignia="usuario" style={{ background: "var(--tint-green)", color: "var(--green)" }}>
                          {t("User created", "Con usuario")}
                        </span>
                      ) : <span className="hint" style={{ marginTop: 0 }}>{t("No user", "Sin usuario")}</span>}
                    </td>
                    <td>
                      {/* Qué campos le faltan a la ficha, no cuántos tiene: es lo único que se viene a buscar. */}
                      {sinLlenar.length === 0 ? (
                        <span className="badge" style={{ background: "var(--tint-green)", color: "var(--green)" }}>
                          {t("complete", "completo")}
                        </span>
                      ) : (
                        /* D-703: se pulsa y dice qué falta. stopPropagation por si la fila gana un onClick. */
                        <button type="button" className="badge" data-insignia="incompleto"
                          style={{ background: "var(--tint-warn)", color: "var(--ink)", border: "1px solid var(--tint-warn-line)", cursor: "pointer", font: "inherit" }}
                          title={sinLlenar.map((c) => ETIQUETAS_CAMPO[c][lang]).join(", ")}
                          aria-haspopup="dialog"
                          onClick={(e) => { e.stopPropagation(); setQueFalta(r.id); }}>
                          {t("incomplete", "incompleto")} · {sinLlenar.length}
                        </button>
                      )}
                    </td>
                    <td>
                      {/* Lo que FALTA, no lo que hay: un expediente completo no hace falta
                          mirarlo, y listar los cinco papeles presentes escondería el que no
                          está, que es lo único que se venía a buscar. */}
                      {pend.length === 0 ? (
                        <span className="badge" style={{ background: "var(--tint-green)", color: "var(--green)" }}>
                          {t("complete", "completo")}
                        </span>
                      ) : (
                        <span
                          className="badge"
                          style={{ background: "var(--tint-red-strong)", color: "var(--red)" }}
                          title={pend.map((p) => (lang === "es" ? p.label_es : p.label)).join(", ")}
                        >
                          {pend.length} {t("missing", "faltan")}
                        </span>
                      )}
                    </td>
                    <td style={{ textAlign: "right", whiteSpace: "nowrap" }} onClick={(e) => e.stopPropagation()}>
                      {/* D-705: «Dar de baja» y «Reactivar» ya no están en la fila: se dan desde dentro del expediente.
                          D-720: «Crear usuario» tampoco: es «Permisos», dentro del expediente. */}
                      <button className="btn btn-ghost btn-sm" data-accion="editar" onClick={() => setAbierto(r.id)}>
                        📂 {t("Open", "Abrir")}
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          </div>
          <MenuDeColumnaAbierto estado={orden} columnas={COLUMNAS_DE_EMPLEADOS} lang={lang} t={t} />
          </>
        )}
      </div>

      {abiertaFila && (
        <Ficha key={abiertaFila.id} persona={abiertaFila} con159={con159} con207={con207} puedeBaja={puedeBaja}
          onSaved={load} onClose={() => setAbierto(null)}
          onBaja={() => setBaja(abiertaFila.id)} onReactivar={() => setReactivar(abiertaFila.id)} />
      )}
      {/* Las ventanas de acción van DESPUÉS de la ficha: se abren también desde dentro de ella y
          tienen que quedar encima. */}
      {queFaltaFila && (
        <QueFaltaDialog persona={queFaltaFila} con159={con159} papeles={faltan(queFaltaFila)}
          onClose={() => setQueFalta(null)}
          onAbrir={() => { setQueFalta(null); setAbierto(queFaltaFila.id); }} />
      )}
      {bajaFila && (
        <BajaDialog key={"b" + bajaFila.id} persona={bajaFila} con159={con159}
          onDone={() => { setBaja(null); void load(); }} onClose={() => setBaja(null)} />
      )}
      {reactivarFila && (
        <ReactivarDialog key={"r" + reactivarFila.id} persona={reactivarFila}
          onDone={() => { setReactivar(null); void load(); }} onClose={() => setReactivar(null)} />
      )}
      {agregando && (
        <AgregarDialog con159={con159} onClose={() => setAgregando(false)}
          onDone={(id) => { setAgregando(false); void load().then(() => setAbierto(id)); }} />
      )}
    </>
  );
}

/**
 * El expediente de una persona (D-720, antes D-145/D-149).
 *
 * El dueño, el 2026-10-27: la parte de arriba «va a estar frozen, donde dice el nombre, activo, dar de baja, y ahí
 * también va a haber un botón que dice guardar»; «toda la información que está ahí no se puede cambiar, al menos
 * que se apriete el botón de edit que va a estar al lado de guardar»; «cuando uno quiere salir y cambió algo y no lo
 * ha guardado, tiene que ponerle guardar»; «un botón en la parte de arriba que va a decir permisos […] abrir una
 * window donde van a estar todos los permisos»; y «todas las categorías como solo datos va a estar display, […]
 * contacto de emergencia, herramientas y costos, punto de acción, cuenta del hub, time tracker […] collapse».
 *
 * Así que: la cabecera es `position: sticky`; los campos viven en un `<fieldset disabled>` hasta pulsar «Editar»;
 * «Guardar» se enciende solo con cambios (`hayCambios` contra lo último guardado); cerrar con cambios pregunta; y
 * cada categoría es un `<details>`: DATOS abierto, lo demás plegado.
 */
function Ficha({
  persona, con159, con207, puedeBaja, onSaved, onClose, onBaja, onReactivar,
}: {
  persona: EmployeeFile; con159: boolean; con207: boolean; puedeBaja: boolean;
  onSaved: () => void; onClose: () => void; onBaja: () => void; onReactivar: () => void;
}) {
  const { t, lang } = usePrefs();
  const { notify, settings, me, hub } = useData();
  // El grupo del directorio es solo del admin de RR. HH. (D-261). `me.role` es el rol de RR. HH.
  // (el layout del módulo lo monta así); la barrera de verdad está en la acción de guardar.
  const editaGrupo = puedeEditarGrupoDirectorio(me?.role);
  const inicial = () => ({
    full_name: persona.full_name ?? "",
    employee_code: persona.employee_code ?? "",
    birthday: persona.birthday ?? "",
    date_hired: persona.date_hired ?? "",
    phone: persona.phone ?? "",
    ringcentral_ext: persona.ringcentral_ext ?? "",
    email: persona.email ?? "",
    department: persona.department ?? "",
    // D-NEXT: con cuenta arranca con la tienda de la cuenta, que es la que se ve y la que se sincroniza al guardar.
    store: tiendaVisible(persona) ?? "",
    directory_group: persona.directory_group ?? "",
    address: persona.address ?? "",
    days_off: persona.days_off != null ? String(persona.days_off) : "",
    notes: persona.notes ?? "",
    // ---- 159 ----
    job_title: persona.job_title ?? "",
    personal_phone: persona.personal_phone ?? "",
    personal_email: persona.personal_email ?? "",
    emergency_name: persona.emergency_name ?? "",
    emergency_relation: persona.emergency_relation ?? "",
    emergency_phone: persona.emergency_phone ?? "",
    // ---- 207 (D-719) ----
    email_plan: persona.email_plan != null ? String(persona.email_plan) : "",
    email_cost_year: persona.email_cost_year != null ? String(persona.email_cost_year) : "",
    email_renewal_date: persona.email_renewal_date != null ? String(persona.email_renewal_date) : "",
    second_email: persona.second_email != null ? String(persona.second_email) : "",
    app_username: persona.app_username != null ? String(persona.app_username) : "",
    onepassword: persona.onepassword != null ? String(persona.onepassword) : "",
    previous_phone: persona.previous_phone != null ? String(persona.previous_phone) : "",
    device_serial: persona.device_serial != null ? String(persona.device_serial) : "",
    qb_initials: persona.qb_initials != null ? String(persona.qb_initials) : "",
    remote_pc_name: persona.remote_pc_name != null ? String(persona.remote_pc_name) : "",
    remote_pc_status: persona.remote_pc_status != null ? String(persona.remote_pc_status) : "",
    rc_user_created: persona.rc_user_created != null ? String(persona.rc_user_created) : "",
    rc_device_assigned: persona.rc_device_assigned != null ? String(persona.rc_device_assigned) : "",
    risk_score: persona.risk_score != null ? String(persona.risk_score) : "",
    performance_score: persona.performance_score != null ? String(persona.performance_score) : "",
    score_status: persona.score_status != null ? String(persona.score_status) : "",
    score_action: persona.score_action != null ? String(persona.score_action) : "",
    tools_cost_year: persona.tools_cost_year != null ? String(persona.tools_cost_year) : "",
    tools_note: persona.tools_note != null ? String(persona.tools_note) : "",
  });
  const [info, setInfo] = useState(inicial);
  // Lo último guardado: «Guardar» se enciende cuando `info` difiere de esto, y «salir» pregunta.
  const [guardado, setGuardado] = useState(inicial);
  const sucio = hayCambios(info, guardado);
  // Nada se edita hasta pulsar «Editar» (D-720).
  const [editando, setEditando] = useState(false);
  // Quiso cerrar con cambios sin guardar: se le pregunta en la propia cabecera.
  const [saliendo, setSaliendo] = useState(false);
  // La ventana de permisos (la cuenta del hub y sus apps), encima del expediente.
  const [permisos, setPermisos] = useState(false);
  const [docs, setDocs] = useState<EmployeeDoc[] | null>(null);
  // Las tiendas para elegir (D-258). Vienen de `store_names()` y no de los Ajustes de Entregas,
  // porque RR. HH. no tiene por qué tener Entregas. Si falla, la lista queda vacía y el campo
  // conserva el valor guardado: no se puede elegir, pero tampoco se borra nada.
  const [tiendas, setTiendas] = useState<string[]>([]);
  useEffect(() => {
    let vivo = true;
    void listStoreNames().then((r) => { if (vivo && r.ok) setTiendas(r.names); });
    return () => { vivo = false; };
  }, []);
  const [busy, setBusy] = useState(false);

  // La cuenta del hub: si existe y si está deshabilitada. Se LEE de Auth al abrir la ficha y no se
  // guarda (D-251). `null` = todavía no se sabe, o no se pudo preguntar.
  const [hechos, setHechos] = useState<HechosDeCuenta | null>(null);
  const cargaCuenta = useCallback(async () => {
    if (!persona.profile_id) return;
    const r = await accountFactsFor([persona.profile_id]);
    setHechos(r.ok ? (r.facts[0] ?? null) : null);
  }, [persona.profile_id]);
  useEffect(() => { void cargaCuenta(); }, [cargaCuenta]);
  const cuenta = resumenDeCuenta(persona, hechos);

  async function cambiaAcceso(encendida: boolean) {
    setBusy(true);
    const r = await setHubAccess(persona.id, encendida);
    setBusy(false);
    notify(r.ok
      ? (encendida ? t("Hub access restored ✓", "Acceso al hub devuelto ✓") : t("Hub access removed ✓", "Acceso al hub quitado ✓"))
      : "Error: " + (r.message ?? ""));
    if (r.ok) void cargaCuenta();
  }

  const cargaDocs = useCallback(async () => {
    const r = await getEmployeeDocs(persona.id);
    // Si falla se deja la lista VACÍA, no en null: null significa "cargando", y dejarlo
    // ahí pinta un "Cargando…" eterno que se lee como que la pantalla está rota. El
    // error se dice aparte, con su motivo.
    setDocs(r.ok ? r.docs : []);
    if (!r.ok) notify("Error: " + r.message);
  }, [persona.id, notify]);

  useEffect(() => { void cargaDocs(); }, [cargaDocs]);

  /** Guarda y dice si pudo: el aviso de «salir sin guardar» cierra solo si pudo. */
  async function guardaInfo(): Promise<boolean> {
    setBusy(true);
    // La tienda y el nombre solo se mandan si la persona NO tiene cuenta. Con cuenta, el servidor los
    // rechazaría —mandan `profiles.store` y el nombre del perfil— y el «Guardar» fallaría por un
    // campo que ni se puede tocar desde aquí.
    const {
      store, directory_group, full_name,
      job_title, personal_phone, personal_email, emergency_name, emergency_relation, emergency_phone,
      ...restoCon207
    } = info;
    // Los campos de la 207 solo viajan si la tabla los tiene (igual que los de la 159).
    const de207 = Object.fromEntries(COLUMNAS_207.map((k) => [k, restoCon207[k]]));
    const resto = Object.fromEntries(Object.entries(restoCon207).filter(([k]) => !(COLUMNAS_207 as readonly string[]).includes(k)));
    const r = await saveEmployeeFile(persona.id, {
      ...resto,
      // D-NEXT: la tienda y el nombre viajan siempre; con cuenta, el servidor los copia al perfil (solo admin de RR. HH.).
      store, full_name,
      // Solo un admin manda el grupo: a un gerente el servidor se lo rechazaría, y «Guardar
      // datos» fallaría por un campo que ni siquiera ve.
      ...(editaGrupo ? { directory_group } : {}),
      ...(con207 ? de207 : {}),
      // Los campos de la 159 solo viajan si la tabla los tiene: sin ella, mandarlos tumbaría el
      // guardado entero de los que sí existen.
      ...(con159 ? { job_title, personal_phone, personal_email, emergency_name, emergency_relation, emergency_phone } : {}),
      days_off: info.days_off === "" ? null : Number(info.days_off),
    });
    setBusy(false);
    notify(r.ok ? t("Saved ✓", "Guardado ✓") : "Error: " + (r.message ?? ""));
    if (r.ok) { setGuardado(info); setEditando(false); setSaliendo(false); onSaved(); }
    return r.ok;
  }

  /** Cerrar: con cambios sin guardar se pregunta, no se pierde nada en silencio. */
  const pideCerrar = useCallback(() => {
    if (sucio) setSaliendo(true); else onClose();
  }, [sucio, onClose]);
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === "Escape" && !permisos) pideCerrar(); };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [pideCerrar, permisos]);

  type Clave = keyof typeof info;
  const campo = (k: Clave, label: string, tipo = "text") => (
    <div>
      <label>{label}</label>
      <input type={tipo} value={info[k]} onChange={(e) => setInfo({ ...info, [k]: e.target.value })} />
    </div>
  );
  /** Un campo de la 159: apagado, y diciendo por qué, mientras la migración no esté aplicada. */
  const campo159 = (k: Clave, label: string, extra: React.InputHTMLAttributes<HTMLInputElement> = {}) => (
    <div>
      <label>{label}</label>
      <input value={info[k]} disabled={!con159} data-campo159={k}
        title={con159 ? undefined : faltaMigracion(t)}
        onChange={(e) => setInfo({ ...info, [k]: e.target.value })}
        {...extra}
        placeholder={con159 ? extra.placeholder : faltaMigracion(t)} />
    </div>
  );
  /** Un campo de la 207 (D-719): apagado, y diciendo por qué, mientras la migración no esté aplicada. */
  const campo207 = (k: Clave, label: string, extra: React.InputHTMLAttributes<HTMLInputElement> = {}) => (
    <div>
      <label>{label}</label>
      <input value={info[k]} disabled={!con207} data-campo207={k}
        title={con207 ? undefined : faltaMigracion(t, 207)}
        onChange={(e) => setInfo({ ...info, [k]: e.target.value })}
        {...extra}
        placeholder={con207 ? extra.placeholder : faltaMigracion(t, 207)} />
    </div>
  );
  /** Un teléfono: al salir del campo toma la forma de la app, 956-xxx-xxxx (D-432). */
  const alSalirTel = (k: Clave) => () => setInfo((a) => ({ ...a, [k]: telefonoDeFicha(a[k]) ?? "" }));

  const deBaja = estadoEmpleado(persona) === "baja";
  const sinLlenar = camposQueFaltan(persona, con159);
  const directorio = saleEnDirectorio(persona);
  const soloAdmin = t("Only an HR admin can do this.", "Solo un admin de RR. HH. puede hacer esto.");
  const PORQUE_NO_SALE = {
    baja: t("left the company", "está de baja"),
    ext: t("no extension", "no tiene extensión"),
    phone: t("no office phone", "no tiene teléfono de oficina"),
  };
  // «Permisos» es la pantalla de Usuarios del hub: solo la abre el admin del hub (/api/invite y las escrituras de
  // permisos lo exigen igual, D-050/D-056). Al gerente de RR. HH. no se le enseña una puerta que va a fallar.
  const puedePermisos = hub?.role === "admin";
  const alDocs = () => { void cargaDocs(); onSaved(); };

  return (
    /* En ventana, no como panel al final de la página (D-149).
       ---------------------------------------------------------------------
       Se dibujaba DEBAJO de la tabla entera: con la plantilla completa en
       pantalla, "Abrir ficha" abría algo a treinta filas de distancia y desde
       arriba no se veía pasar nada. Parecía que el botón no hacía nada.
       Es además como abre todo lo demás en este módulo (ModalHost). */
    <div className="overlay" onClick={pideCerrar}>
      <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 760 }} data-dialogo="ficha">
        {/* La cabecera fija (D-720): nombre y estado, Permisos, Dar de baja / Reactivar, Editar, Guardar, cerrar. */}
        <div className="ficha-cabecera" data-cabecera="ficha">
          <h3>
            {persona.full_name}{" "}
            <span className="badge" data-insignia="estado"
              style={deBaja
                ? { background: "var(--tint-red-strong)", color: "var(--red)" }
                : { background: "var(--tint-green)", color: "var(--green)" }}>
              {etiquetaEstado(estadoEmpleado(persona), lang)}
            </span>
          </h3>
          {puedePermisos && (
            <button className="btn btn-ghost btn-sm" data-accion="permisos" onClick={() => setPermisos(true)}
              title={persona.profile_id
                ? t("Role, store and apps of this person's hub account", "Rol, tienda y apps de la cuenta del hub de esta persona")
                : t("Create this person's hub account", "Crear la cuenta del hub de esta persona")}>
              🔑 {t("Permissions", "Permisos")}
            </button>
          )}
          {deBaja ? (
            <button className="btn btn-danger btn-sm" data-accion="reactivar" disabled={!puedeBaja}
              title={puedeBaja ? undefined : soloAdmin} onClick={onReactivar}>
              {t("Reactivate", "Reactivar")}
            </button>
          ) : (
            <button className="btn btn-danger btn-sm" data-accion="baja" disabled={!puedeBaja}
              title={puedeBaja ? undefined : soloAdmin} onClick={onBaja}>
              {t("Deactivate", "Dar de baja")}
            </button>
          )}
          <button className={"btn btn-sm " + (editando ? "btn-primary" : "btn-ghost")} data-accion="editar-ficha"
            aria-pressed={editando} onClick={() => setEditando((v) => !v)}>
            ✏️ {t("Edit", "Editar")}
          </button>
          <button className="btn btn-primary btn-sm" data-accion="guardar" disabled={busy || !sucio} onClick={() => void guardaInfo()}
            title={sucio ? undefined : t("Nothing changed", "No hay cambios")}>
            💾 {t("Save", "Guardar")}
          </button>
          <button className="btn btn-ghost btn-sm" onClick={pideCerrar} aria-label={t("Close", "Cerrar")}>✕</button>
          {saliendo && (
            <div className="hint" data-aviso="sin-guardar" role="alertdialog"
              style={{ flexBasis: "100%", marginTop: 4, background: "var(--tint-warn)", border: "1px solid var(--tint-warn-line)", borderRadius: 8, padding: "8px 12px", display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
              <b>{t("Unsaved changes.", "Hay cambios sin guardar.")}</b>
              <button className="btn btn-primary btn-sm" data-accion="guardar-y-salir" disabled={busy}
                onClick={async () => { if (await guardaInfo()) onClose(); }}>
                {t("Save and close", "Guardar y salir")}
              </button>
              <button className="btn btn-danger btn-sm" data-accion="salir-sin-guardar" onClick={onClose}>
                {t("Discard and close", "Salir sin guardar")}
              </button>
              <button className="btn btn-ghost btn-sm" onClick={() => setSaliendo(false)}>
                {t("Keep editing", "Seguir editando")}
              </button>
            </div>
          )}
        </div>

        {/* Qué falta llenar, con nombres: el contador de arriba dice cuántos, esto dice cuáles. */}
        {sinLlenar.length > 0 && (
          <div className="hint" data-aviso="incompleto"
            style={{ background: "var(--tint-warn)", border: "1px solid var(--tint-warn-line)", borderRadius: 8, padding: "8px 12px", marginTop: 10 }}>
            <b>{t("Incomplete file", "Expediente incompleto")}:</b>{" "}
            {t("missing", "falta")} {sinLlenar.map((c) => ETIQUETAS_CAMPO[c][lang]).join(", ")}.
          </div>
        )}

        {deBaja && (
          <div className="hint" data-bloque="baja"
            style={{ background: "var(--tint-red)", borderRadius: 8, padding: "8px 12px", marginTop: 10 }}>
            <b>{t("Left on", "Baja el")} {persona.date_left}</b>
            {persona.left_reason ? ` · ${etiquetaMotivoBaja(persona.left_reason, lang)}` : ""}
            {persona.left_note ? ` · ${persona.left_note}` : ""}
            {persona.left_by_name ? ` · ${t("recorded by", "la registró")} ${persona.left_by_name}` : ""}
            {!con159 ? ` · ${t("reason", "motivo")}: ${faltaMigracion(t)}` : ""}
            <button className="btn btn-ghost btn-sm" style={{ marginLeft: 8 }} data-accion="corregir-baja"
              disabled={!puedeBaja} title={puedeBaja ? undefined : soloAdmin} onClick={onBaja}>
              {t("Edit", "Corregir")}
            </button>
          </div>
        )}

      {/* Los campos: bloqueados hasta «Editar». Un fieldset apagado apaga todo lo que lleva dentro, sin tocar campo
          por campo; los botones (cuenta del hub, papeles) quedan fuera a propósito y siempre funcionan. */}
      <fieldset className="ficha-campos" disabled={!editando} data-editando={editando}>
      <Seccion id="datos" titulo={t("INFO", "DATOS")} abierta>
      <div className="grid g3">
        {/* El nombre (D-NEXT: también con cuenta; al guardar se copia al perfil). */}
        <div>
          <label>{t("Full name", "Nombre completo")}</label>
          <input value={info.full_name} data-campo="full_name"
            onChange={(e) => setInfo({ ...info, full_name: e.target.value })} />
        </div>
        {campo159("job_title", t("Position", "Puesto"))}
        {campo("employee_code", "ID")}
        {campo("date_hired", t("Date hired", "Fecha de ingreso"), "date")}
        {campo("birthday", t("Birthday", "Cumpleaños"), "date")}
        {/* Tienda (D-258, D-NEXT). Se elige siempre, con o sin cuenta: con cuenta, al guardar se copia a
            `profiles.store`, que es lo que decide qué ve la persona en Entregas. «Remoto» no es una tienda:
            pone el grupo «remote» del directorio (D-261), y por eso solo lo ofrece quien puede cambiar el grupo. */}
        <div>
          <label>{t("Store", "Tienda")}</label>
          <select value={tiendaDelSelector(info)} data-campo="store"
            onChange={(e) => setInfo({ ...info, ...parcheDeTienda(e.target.value, info.directory_group) })}>
            <option value="">{t("— none —", "— sin tienda —")}</option>
            {tiendas.map((n) => <option key={n} value={n}>{n}</option>)}
            {editaGrupo && <option value={TIENDA_REMOTA}>{t("Remote", "Remoto")}</option>}
            {/* Una tienda guardada que ya no está en Ajustes no se pierde al abrir la ficha. */}
            {info.store && !tiendas.includes(info.store) && (
              <option value={info.store}>{info.store}</option>
            )}
          </select>
        </div>
        {editaGrupo && (
          <div>
            <label>{t("Directory", "Directorio")}</label>
            <select
              value={info.directory_group}
              onChange={(e) => setInfo({ ...info, directory_group: e.target.value })}
            >
              <option value="">{t("Normal", "Normal")}</option>
              <option value="remote">{t("Remote", "Remoto")}</option>
              <option value="sin_tienda">{t("No store", "Sin tienda")}</option>
            </select>
          </div>
        )}
        {/* Departamento (D-256): se ELIGE de la lista de Ajustes en vez de escribirse, porque
            de esto vive el directorio de la compañía y «Almacen», «almacén» y «Almacén» serían
            tres departamentos distintos en la cascada. La opción vacía existe a propósito:
            «sin departamento» es un estado válido y el directorio lo agrupa aparte. */}
        <div>
          <label>{t("Department", "Departamento")}</label>
          <select
            value={info.department}
            onChange={(e) => setInfo({ ...info, department: e.target.value })}
          >
            <option value="">{t("— none —", "— sin departamento —")}</option>
            {(settings.departments ?? []).map((d) => (
              <option key={d} value={d}>{d}</option>
            ))}
            {/* El que ya tuviera guardado y ya no esté en la lista NO se pierde al abrir la
                ficha: sin esto, el selector no lo encontraría, caería en la opción vacía y el
                primer «Guardar datos» lo borraría sin que nadie lo tocara. */}
            {info.department && !(settings.departments ?? []).includes(info.department) && (
              <option value={info.department}>{info.department}</option>
            )}
          </select>
        </div>
        {campo("days_off", t("Attendance — days off", "Asistencia — días libres"), "number")}
      </div>
      <div style={{ marginTop: 12 }}>
        <label>{t("Address", "Dirección")}</label>
        <input value={info.address} onChange={(e) => setInfo({ ...info, address: e.target.value })} />
      </div>
      <div style={{ marginTop: 12 }}>
        <label>{t("Notes", "Notas")}</label>
        <textarea rows={2} value={info.notes} onChange={(e) => setInfo({ ...info, notes: e.target.value })} />
      </div>
      </Seccion>

      {/* CONTACTO. Dos teléfonos y dos correos, y no se mezclan: los «de oficina» son los que enseña el
          directorio de la compañía a todo el que tenga sesión; los personales solo los ve RR. HH. */}
      <Seccion id="contacto" titulo={t("CONTACT", "CONTACTO")} extra={
        <span className="sec-sub" data-aviso="directorio">
          {directorio.sale
            ? t("Shows in the company phone book.", "Sale en el directorio de la compañía.")
            : t("Not in the company phone book: ", "No sale en el directorio de la compañía: ")
              + directorio.falta.map((f) => PORQUE_NO_SALE[f]).join(", ") + "."}
        </span>
      }>
      <div className="grid g3">
        <div>
          <label>{t("Office phone (phone book)", "Teléfono de oficina (directorio)")}</label>
          <input value={info.phone} placeholder="956-555-0123" data-campo="phone"
            onBlur={alSalirTel("phone")} onChange={(e) => setInfo({ ...info, phone: e.target.value })} />
        </div>
        <div>
          <label>{t("Extension (phone book)", "Extensión (directorio)")}</label>
          <input value={info.ringcentral_ext} inputMode="numeric" data-campo="ringcentral_ext"
            onChange={(e) => setInfo({ ...info, ringcentral_ext: e.target.value })} />
        </div>
        {campo("email", t("Work email (phone book)", "Correo de trabajo (directorio)"), "email")}
        {campo159("personal_phone", t("Personal phone (HR only)", "Teléfono personal (solo RR. HH.)"),
          { placeholder: "956-555-0123", onBlur: alSalirTel("personal_phone") })}
        {campo159("personal_email", t("Personal email (HR only)", "Correo personal (solo RR. HH.)"), { type: "email" })}
      </div>
      </Seccion>

      <Seccion id="emergencia" titulo={t("EMERGENCY CONTACT", "CONTACTO DE EMERGENCIA")}>
      <div className="grid g3">
        {campo159("emergency_name", t("Name", "Nombre"))}
        {campo159("emergency_relation", t("Relationship", "Parentesco"))}
        {campo159("emergency_phone", t("Phone", "Teléfono"), { placeholder: "956-555-0123", onBlur: alSalirTel("emergency_phone") })}
      </div>
      </Seccion>

      {/* HERRAMIENTAS Y COSTO (207, D-719): el correo y su plan, RingCentral, Remote PC, 1Password, QuickBooks, y lo que
          cuesta todo al año. El costo mensual se calcula aquí, no se guarda: (correo + otras) / 12. */}
      <Seccion id="herramientas" titulo={t("TOOLS & COST", "HERRAMIENTAS Y COSTO")} extra={
        <span className="badge" data-costo-mensual style={{ marginLeft: 8, background: "var(--tint-blue)", color: "var(--blue)" }}
          title={t("Email + other tools per year, divided by 12", "Correo + otras herramientas al año, entre 12")}>
          {t("per month", "al mes")}: {dinero(costoMensual({ email_cost_year: Number(info.email_cost_year) || null, tools_cost_year: Number(info.tools_cost_year) || null }))}
        </span>
      }>
      <div className="grid g3">
        {campo207("email_plan", t("Email plan (Microsoft 365)", "Plan del correo (Microsoft 365)"))}
        {campo207("email_cost_year", t("Email cost / year (USD)", "Costo del correo al año (USD)"), { inputMode: "decimal", placeholder: "259.80" })}
        {campo207("email_renewal_date", t("Email renewal date", "Renovación del correo"), { type: "date" })}
        {campo207("second_email", t("Second work email", "Segundo correo de trabajo"), { type: "email" })}
        {campo207("app_username", t("Hub username (if not the email)", "Usuario del hub (si no es el correo)"))}
        <div>
          <label>1Password</label>
          <select value={info.onepassword} disabled={!con207} data-campo207="onepassword"
            title={con207 ? undefined : faltaMigracion(t, 207)}
            onChange={(e) => setInfo({ ...info, onepassword: e.target.value })}>
            <option value="">{con207 ? t("— unknown —", "— no se sabe —") : faltaMigracion(t, 207)}</option>
            {OPCIONES_1PW.map((o) => <option key={o} value={o}>{o}</option>)}
          </select>
        </div>
        {campo207("previous_phone", t("Previous office number", "Número de oficina anterior"), { placeholder: "956-555-0123", onBlur: alSalirTel("previous_phone") })}
        {campo207("device_serial", t("Desk phone serial", "Serie del teléfono de escritorio"))}
        {campo207("qb_initials", t("QuickBooks initials", "Iniciales en QuickBooks"))}
        {campo207("remote_pc_name", t("Remote PC name", "PC de Remote PC"))}
        {campo207("remote_pc_status", t("Remote PC password", "Clave de Remote PC"), { placeholder: "DONE / DNE / SWITCH TO SITE" })}
        {campo207("rc_user_created", t("RingCentral user", "Usuario de RingCentral"), { placeholder: "YES / LATER / N/A" })}
        {campo207("rc_device_assigned", t("RingCentral device", "Teléfono de RingCentral"), { placeholder: "YES / LATER / N/A" })}
        {campo207("tools_cost_year", t("Other tools / year (USD)", "Otras herramientas al año (USD)"), { inputMode: "decimal" })}
        {campo207("tools_note", t("Which tools", "Qué herramientas"))}
      </div>
      </Seccion>

      <Seccion id="puntuacion" titulo={t("HR SCORE", "PUNTUACIÓN DE RR. HH.")}>
      <div className="grid g3">
        {campo207("risk_score", t("Risk", "Riesgo"), { inputMode: "decimal" })}
        {campo207("performance_score", t("Performance", "Desempeño"), { inputMode: "decimal" })}
        {campo207("score_status", t("Status", "Estado"))}
        {campo207("score_action", t("Action", "Acción"))}
      </div>
      </Seccion>
      </fieldset>

      {/* LA CUENTA DEL HUB. Estado leído de Auth, y el botón que quita o devuelve el acceso. Reactivar a
          alguien no lo devuelve: este es el único sitio que lo hace. */}
      <Seccion id="cuenta" titulo={t("HUB ACCOUNT", "CUENTA DEL HUB")}>
      <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }} data-bloque="cuenta">
        {!persona.profile_id ? (
          <span className="hint" style={{ marginTop: 0 }}>
            {t("No hub account. Create it with «Permissions», up top.", "Sin cuenta del hub. Se crea con «Permisos», arriba.")}
          </span>
        ) : !cuenta.tieneCuenta ? (
          <span className="hint" style={{ marginTop: 0 }}>
            {t("Has a hub account (its status could not be read).", "Tiene cuenta del hub (no se pudo leer su estado).")}
          </span>
        ) : (
          <>
            <span className="badge" data-insignia="acceso"
              style={cuenta.deshabilitada
                ? { background: "var(--tint-red-strong)", color: "var(--red)" }
                : { background: "var(--tint-green)", color: "var(--green)" }}>
              {cuenta.deshabilitada ? t("access removed", "acceso quitado") : t("can sign in", "puede entrar")}
            </span>
            {cuenta.deshabilitada ? (
              <button className="btn btn-ghost btn-sm" data-accion="devolver-acceso" disabled={busy || !puedeBaja}
                title={puedeBaja ? undefined : soloAdmin} onClick={() => cambiaAcceso(true)}>
                {t("Restore hub access", "Devolver acceso al hub")}
              </button>
            ) : (
              <button className="btn btn-danger btn-sm" data-accion="quitar-acceso" disabled={busy || !puedeBaja}
                title={puedeBaja ? undefined : soloAdmin} onClick={() => cambiaAcceso(false)}>
                {t("Remove hub access", "Quitar acceso al hub")}
              </button>
            )}
            {deBaja && !cuenta.deshabilitada && (
              <span className="hint" style={{ marginTop: 0, color: "var(--red)" }}>
                {t("Left the company but can still sign in.", "Está de baja pero todavía puede entrar.")}
              </span>
            )}
          </>
        )}
      </div>
      </Seccion>

      <Seccion id="time-tracker" titulo="TIME TRACKER">
        <BloqueTimeTracker profileId={persona.profile_id} />
      </Seccion>

      <Seccion id="hr" titulo="HR">
        <Bloque grupo="hr" docs={docs} employeeId={persona.id} onChange={alDocs} />
      </Seccion>
      <Seccion id="forms" titulo="FORMS">
        <Bloque grupo="forms" docs={docs} employeeId={persona.id} onChange={alDocs} />
      </Seccion>

        {/* Encima del expediente, dentro de su ventana: el clic en el fondo de esta no cierra aquella. */}
        {permisos && hub && (
          <PermisosDelEmpleado persona={persona} hub={hub} onClose={() => setPermisos(false)} onEnlazado={onSaved} />
        )}
      </div>
    </div>
  );
}

/**
 * Una categoría del expediente (D-720): un `<details>` con el título como `summary`. `abierta` es solo el estado
 * inicial (DATOS abierto, lo demás plegado); después manda quien pulsa.
 */
function Seccion({ id, titulo, abierta = false, extra, children }: {
  id: string; titulo: string; abierta?: boolean; extra?: React.ReactNode; children: React.ReactNode;
}) {
  return (
    <details className="seccion" open={abierta} data-seccion={id}>
      <summary className="sec-head">
        <span className="sec-title">{titulo}</span>
        {extra}
      </summary>
      {children}
    </details>
  );
}

/** Un grupo de documentos (HR o FORMS), una línea por tipo. El título lo pone la Seccion que lo envuelve (D-720). */
function Bloque({
  grupo, docs, employeeId, onChange,
}: {
  grupo: "hr" | "forms";
  docs: EmployeeDoc[] | null;
  employeeId: string;
  onChange: () => void;
}) {
  const { t, lang } = usePrefs();
  const { notify } = useData();
  const [busy, setBusy] = useState(false);
  const [nuevo, setNuevo] = useState<string | null>(null);
  const [fecha, setFecha] = useState("");
  const [vence, setVence] = useState("");
  const [nota, setNota] = useState("");
  const [archivo, setArchivo] = useState<File | null>(null);
  const tipos = DOC_KINDS.filter((d) => d.group === grupo);

  /**
   * Sube un fichero y devuelve su ruta (D-158).
   *
   * Va en FormData porque un File no se puede serializar como argumento de una acción de
   * servidor: hay que mandarlo como lo que es, un formulario multiparte.
   */
  async function sube(kind: string, f: File): Promise<string | null> {
    const fd = new FormData();
    fd.set("file", f);
    fd.set("employeeId", employeeId);
    fd.set("kind", kind);
    const r = await uploadDocFile(fd);
    if (!r.ok) { notify("Error: " + (r.message ?? "")); return null; }
    return r.path ?? null;
  }

  async function corre(fn: () => Promise<{ ok: boolean; message?: string }>) {
    setBusy(true);
    const r = await fn();
    setBusy(false);
    if (!r.ok) { notify("Error: " + (r.message ?? "")); return false; }
    onChange();
    return true;
  }

  async function abre(path: string) {
    const url = await signDocUrl(path);
    if (url) window.open(url, "_blank", "noopener");
  }

  return (
    <>
      {docs === null ? (
        <div className="hint">{t("Loading…", "Cargando…")}</div>
      ) : (
        <table className="cmp-tbl">
          <tbody>
            {tipos.map((k) => {
              const suyos = docs.filter((d) => d.kind === k.key);
              const uno = suyos[0];
              return (
                <tr key={k.key}>
                  <td className="rowh">{lang === "es" ? k.label_es : k.label}</td>
                  <td>
                    {/* Los de lista se enumeran; los únicos llevan su fecha editable ahí mismo,
                        porque marcar "firmado el día X" ES la acción de esta pantalla. */}
                    {k.many ? (
                      suyos.length === 0 ? (
                        <span className="hint" style={{ marginTop: 0 }}>{t("none", "ninguno")}</span>
                      ) : (
                        suyos.map((d) => (
                          <div key={d.id} className="mini-row" style={{ marginBottom: 6 }}>
                            <span>
                              {d.signed_at || t("no date", "sin fecha")}
                              {d.expires_at ? ` · ${t("expires", "vence")} ${d.expires_at}` : ""}
                              {d.note ? ` · ${d.note}` : ""}
                            </span>
                            <span>
                              {d.file_path && (
                                <button className="btn btn-ghost btn-sm" onClick={() => abre(d.file_path!)}>
                                  {t("View", "Ver")}
                                </button>
                              )}
                              <button className="btn btn-danger btn-sm" style={{ marginLeft: 6 }} disabled={busy}
                                onClick={() => corre(() => deleteEmployeeDoc(d.id))}>
                                {t("Delete", "Borrar")}
                              </button>
                            </span>
                          </div>
                        ))
                      )
                    ) : (
                      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                        <input
                          type="date"
                          value={uno?.signed_at ?? ""}
                          disabled={busy}
                          style={{ width: "auto" }}
                          onChange={(e) =>
                            corre(() => saveEmployeeDoc({
                              id: uno?.id, employeeId, kind: k.key, signedAt: e.target.value || null,
                              expiresAt: uno?.expires_at ?? null, filePath: uno?.file_path ?? null,
                            }))
                          }
                        />
                        {k.expires && (
                          <input
                            type="date"
                            value={uno?.expires_at ?? ""}
                            disabled={busy || !uno}
                            title={t("Expires", "Vence")}
                            style={{ width: "auto" }}
                            onChange={(e) =>
                              corre(() => saveEmployeeDoc({
                                id: uno?.id, employeeId, kind: k.key, signedAt: uno?.signed_at ?? null,
                                expiresAt: e.target.value || null, filePath: uno?.file_path ?? null,
                              }))
                            }
                          />
                        )}
                        {uno?.file_path && (
                          <button className="btn btn-ghost btn-sm" onClick={() => abre(uno.file_path!)}>
                            {t("View", "Ver")}
                          </button>
                        )}
                        {/* Adjuntar el papel escaneado. El <input> va escondido dentro del
                            <label> porque el control que pinta el navegador ("Examinar… /
                            Ningún archivo seleccionado") no se puede estilar y desentona en
                            una fila de botones. */}
                        <label className="btn btn-ghost btn-sm" style={{ cursor: "pointer" }}>
                          📎 {uno?.file_path ? t("Replace", "Reemplazar") : t("Attach", "Adjuntar")}
                          <input
                            type="file"
                            hidden
                            accept="application/pdf,image/*"
                            disabled={busy}
                            onChange={async (e) => {
                              const f = e.target.files?.[0];
                              // El input se limpia SIEMPRE, subida o no: si no, elegir el
                              // mismo fichero otra vez tras un fallo no dispara el evento.
                              e.target.value = "";
                              if (!f) return;
                              setBusy(true);
                              const ruta = await sube(k.key, f);
                              setBusy(false);
                              if (!ruta) return;
                              await corre(() => saveEmployeeDoc({
                                id: uno?.id, employeeId, kind: k.key,
                                signedAt: uno?.signed_at ?? null, expiresAt: uno?.expires_at ?? null,
                                filePath: ruta,
                              }));
                            }}
                          />
                        </label>
                        {uno && (
                          <button className="btn btn-danger btn-sm" disabled={busy}
                            onClick={() => corre(() => deleteEmployeeDoc(uno.id))}>
                            {t("Clear", "Quitar")}
                          </button>
                        )}
                      </div>
                    )}
                  </td>
                  <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                    {k.many && (nuevo === k.key ? (
                      <span style={{ display: "inline-flex", gap: 6, flexWrap: "wrap", justifyContent: "flex-end" }}>
                        <input type="date" value={fecha} onChange={(e) => setFecha(e.target.value)} style={{ width: "auto" }} />
                        {k.expires && (
                          <input type="date" value={vence} onChange={(e) => setVence(e.target.value)}
                            title={t("Expires", "Vence")} style={{ width: "auto" }} />
                        )}
                        <input value={nota} onChange={(e) => setNota(e.target.value)}
                          placeholder={t("Note", "Nota")} style={{ width: "auto", minWidth: 120 }} />
                        <label className="btn btn-ghost btn-sm" style={{ cursor: "pointer" }}>
                          📎 {archivo ? archivo.name.slice(0, 18) : t("File", "Archivo")}
                          <input type="file" hidden accept="application/pdf,image/*"
                            onChange={(e) => setArchivo(e.target.files?.[0] ?? null)} />
                        </label>
                        <button className="btn btn-primary btn-sm" disabled={busy}
                          onClick={async () => {
                            // El fichero PRIMERO: si la subida falla, no queda una fila de
                            // amonestación sin el papel que la sostiene.
                            let ruta: string | null = null;
                            if (archivo) {
                              setBusy(true);
                              ruta = await sube(k.key, archivo);
                              setBusy(false);
                              if (!ruta) return;
                            }
                            const ok = await corre(() => saveEmployeeDoc({
                              employeeId, kind: k.key, signedAt: fecha || null,
                              expiresAt: vence || null, note: nota || null, filePath: ruta,
                            }));
                            if (ok) { setNuevo(null); setFecha(""); setVence(""); setNota(""); setArchivo(null); }
                          }}>
                          {t("Add", "Añadir")}
                        </button>
                        <button className="btn btn-ghost btn-sm" onClick={() => { setNuevo(null); setArchivo(null); }}>
                          {t("Cancel", "Cancelar")}
                        </button>
                      </span>
                    ) : (
                      <button className="btn btn-ghost btn-sm"
                        onClick={() => { setNuevo(k.key); setFecha(""); setVence(""); setNota(""); }}>
                        + {t("Add", "Añadir")}
                      </button>
                    ))}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </>
  );
}

/**
 * D-703: «qué le falta» a un expediente, al pulsar la insignia «incompleto».
 * La lista de campos sale de `camposQueFaltan`, la MISMA función que pinta la insignia y su número:
 * no pueden discrepar. Los papeles son los mismos que cuenta la columna «Papeles» (`faltan`).
 */
function QueFaltaDialog({
  persona, con159, papeles, onClose, onAbrir,
}: {
  persona: Fila; con159: boolean; papeles: { key: string; label: string; label_es: string }[];
  onClose: () => void; onAbrir: () => void;
}) {
  const { t, lang } = usePrefs();
  const campos = camposQueFaltan(persona, con159);
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [onClose]);
  return (
    <div className="overlay" onClick={onClose}>
      <div className="modal" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}
        style={{ maxWidth: 440 }} data-dialogo="que-falta">
        <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
          <b style={{ flex: 1 }}>{t("What's missing", "Qué falta")} · {persona.full_name}</b>
          <button className="btn btn-ghost btn-sm" onClick={onClose} aria-label={t("Close", "Cerrar")}>✕</button>
        </div>
        <div style={{ marginTop: 10 }}>
          <b>{t("Fields to fill", "Campos por llenar")}</b>
          {campos.length === 0 ? (
            <p className="hint">{t("None.", "Ninguno.")}</p>
          ) : (
            <ul data-lista="campos" style={{ margin: "6px 0 0 18px" }}>
              {campos.map((c) => <li key={c}>{ETIQUETAS_CAMPO[c][lang]}</li>)}
            </ul>
          )}
        </div>
        {papeles.length > 0 && (
          <div style={{ marginTop: 10 }}>
            <b>{t("Missing paperwork", "Papeles que faltan")}</b>
            <ul data-lista="papeles" style={{ margin: "6px 0 0 18px" }}>
              {papeles.map((p) => <li key={p.key}>{lang === "es" ? p.label_es : p.label}</li>)}
            </ul>
          </div>
        )}
        <div style={{ marginTop: 14, textAlign: "right" }}>
          <button className="btn btn-sm" data-accion="abrir-ficha" onClick={onAbrir} autoFocus>
            {t("Open file to fill it", "Abrir el expediente para llenarlo")}
          </button>
        </div>
      </div>
    </div>
  );
}
