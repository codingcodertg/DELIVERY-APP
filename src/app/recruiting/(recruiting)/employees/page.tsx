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
  etiquetaMotivoBaja, filtraPorEstado, puedeDarDeBaja, puedeEditarGrupoDirectorio, puedeElegirTienda,
  resumenDeCuenta, saleEnDirectorio, telefonoDeFicha, tiendaVisible,
  type FiltroEstado, type HechosDeCuenta,
} from "@/lib/recruiting/employee-file";
import { AgregarDialog, BajaDialog, ReactivarDialog, faltaMigracion } from "./acciones";

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
  const { me } = useData();
  const [rows, setRows] = useState<Fila[]>([]);
  // ¿Tiene la tabla las columnas de la 159? Sin ellas los campos nuevos salen apagados.
  const [con159, setCon159] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [cargando, setCargando] = useState(true);
  const [abierto, setAbierto] = useState<string | null>(null);
  const [buscar, setBuscar] = useState("");
  const [soloFaltan, setSoloFaltan] = useState(false);
  const [soloIncompletos, setSoloIncompletos] = useState(false);
  // Por defecto los ACTIVOS: una baja no debe estorbar en la lista de todos los días.
  const [estado, setEstado] = useState<FiltroEstado>("activos");
  const [baja, setBaja] = useState<string | null>(null);
  const [reactivar, setReactivar] = useState<string | null>(null);
  const [agregando, setAgregando] = useState(false);
  // `me.role` es el rol de RR. HH. (el layout del módulo lo monta así). La barrera de verdad está
  // en las acciones de servidor; esto es para no ofrecer un botón que va a fallar.
  const puedeBaja = puedeDarDeBaja(me?.role);

  const load = useCallback(async () => {
    const r = await listEmployeeFiles();
    if (!r.ok) setErr(r.message);
    else { setErr(null); setRows(r.rows); setCon159(r.campos159); }
    setCargando(false);
  }, []);

  useEffect(() => { void load(); }, [load]);

  const faltan = (r: { docKinds: string[] }) => REQUIRED_FORMS.filter((f) => !r.docKinds.includes(f.key));

  const cuenta = cuentaPorEstado(rows);
  const delEstado = filtraPorEstado(rows, estado);
  const incompletos = cuentaIncompletos(delEstado, con159);
  const visibles = delEstado
    .filter((r) => !buscar || r.full_name.toLowerCase().includes(buscar.toLowerCase()))
    .filter((r) => !soloFaltan || faltan(r).length > 0)
    .filter((r) => !soloIncompletos || camposQueFaltan(r, con159).length > 0);

  const porId = (id: string | null) => rows.find((r) => r.id === id) ?? null;
  const abiertaFila = porId(abierto);
  const bajaFila = porId(baja);
  const reactivarFila = porId(reactivar);
  const soloAdmin = t("Only an HR admin can do this.", "Solo un admin de RR. HH. puede hacer esto.");

  const ESTADOS: { key: FiltroEstado; en: string; es: string }[] = [
    { key: "activos", en: "Active", es: "Activos" },
    { key: "bajas", en: "Left", es: "Bajas" },
    { key: "todos", en: "All", es: "Todos" },
  ];

  return (
    <>
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
            placeholder={t("Search a person…", "Buscar una persona…")}
            style={{ width: "auto", minWidth: 220 }}
          />
          <button className={"chip" + (soloIncompletos ? " on" : "")} data-filtro="incompletos"
            onClick={() => setSoloIncompletos(!soloIncompletos)}>
            {t("Incomplete files", "Expedientes incompletos")} · {incompletos}
          </button>
          <button className={"chip" + (soloFaltan ? " on" : "")} onClick={() => setSoloFaltan(!soloFaltan)}>
            {t("Only missing paperwork", "Solo con papeles pendientes")}
          </button>
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
          <table className="cmp-tbl">
            <thead>
              <tr>
                <th>{t("Name", "Nombre")}</th>
                <th>{t("Position", "Puesto")}</th>
                <th>{t("Department", "Departamento")}</th>
                <th>{t("Office phone", "Tel. de oficina")}</th>
                <th>{t("Ext.", "Ext.")}</th>
                <th>{t("Hired", "Ingreso")}</th>
                <th>{t("File", "Expediente")}</th>
                <th>{t("Paperwork", "Papeles")}</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {visibles.map((r) => {
                const pend = faltan(r);
                const sinLlenar = camposQueFaltan(r, con159);
                const deBaja = estadoEmpleado(r) === "baja";
                return (
                  <tr key={r.id} data-fila={r.id} style={deBaja ? { opacity: 0.75 } : undefined}>
                    <td style={{ fontWeight: 700 }}>
                      {r.full_name}
                      {deBaja && (
                        <span className="badge" data-insignia="baja"
                          style={{ marginLeft: 8, background: "var(--tint-red-strong)", color: "var(--red)" }}
                          title={[r.date_left, etiquetaMotivoBaja(r.left_reason, lang)].filter(Boolean).join(" · ")}>
                          {etiquetaEstado("baja", lang)} {r.date_left}
                        </span>
                      )}
                    </td>
                    <td>{r.job_title || "—"}</td>
                    <td>{r.department || "—"}</td>
                    <td>{r.phone || "—"}</td>
                    <td>{r.ringcentral_ext || "—"}</td>
                    <td>{r.date_hired || "—"}</td>
                    <td>
                      {/* Qué campos le faltan a la ficha, no cuántos tiene: es lo único que se viene a buscar. */}
                      {sinLlenar.length === 0 ? (
                        <span className="badge" style={{ background: "var(--tint-green)", color: "var(--green)" }}>
                          {t("complete", "completo")}
                        </span>
                      ) : (
                        <span className="badge" data-insignia="incompleto"
                          style={{ background: "var(--tint-warn)", color: "var(--ink)", border: "1px solid var(--tint-warn-line)" }}
                          title={sinLlenar.map((c) => ETIQUETAS_CAMPO[c][lang]).join(", ")}>
                          {t("incomplete", "incompleto")} · {sinLlenar.length}
                        </span>
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
                    <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                      <button className="btn btn-ghost btn-sm" data-accion="editar" onClick={() => setAbierto(r.id)}>
                        ✏️ {t("Edit", "Editar")}
                      </button>
                      {deBaja ? (
                        <button className="btn btn-ghost btn-sm" style={{ marginLeft: 6 }} data-accion="reactivar"
                          disabled={!puedeBaja} title={puedeBaja ? undefined : soloAdmin}
                          onClick={() => setReactivar(r.id)}>
                          {t("Reactivate", "Reactivar")}
                        </button>
                      ) : (
                        <button className="btn btn-danger btn-sm" style={{ marginLeft: 6 }} data-accion="baja"
                          disabled={!puedeBaja} title={puedeBaja ? undefined : soloAdmin}
                          onClick={() => setBaja(r.id)}>
                          {t("Deactivate", "Dar de baja")}
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {abiertaFila && (
        <Ficha key={abiertaFila.id} persona={abiertaFila} con159={con159} puedeBaja={puedeBaja}
          onSaved={load} onClose={() => setAbierto(null)}
          onBaja={() => setBaja(abiertaFila.id)} onReactivar={() => setReactivar(abiertaFila.id)} />
      )}
      {/* Las ventanas de acción van DESPUÉS de la ficha: se abren también desde dentro de ella y
          tienen que quedar encima. */}
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

/** El expediente de una persona: datos, contacto, emergencia, estado, y debajo HR y FORMS. */
function Ficha({
  persona, con159, puedeBaja, onSaved, onClose, onBaja, onReactivar,
}: {
  persona: EmployeeFile; con159: boolean; puedeBaja: boolean;
  onSaved: () => void; onClose: () => void; onBaja: () => void; onReactivar: () => void;
}) {
  const { t, lang } = usePrefs();
  const { notify, settings, me } = useData();
  // El grupo del directorio es solo del admin de RR. HH. (D-261). `me.role` es el rol de RR. HH.
  // (el layout del módulo lo monta así); la barrera de verdad está en la acción de guardar.
  const editaGrupo = puedeEditarGrupoDirectorio(me?.role);
  const [info, setInfo] = useState({
    full_name: persona.full_name ?? "",
    employee_code: persona.employee_code ?? "",
    birthday: persona.birthday ?? "",
    date_hired: persona.date_hired ?? "",
    phone: persona.phone ?? "",
    ringcentral_ext: persona.ringcentral_ext ?? "",
    email: persona.email ?? "",
    department: persona.department ?? "",
    store: persona.store ?? "",
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
  });
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

  async function guardaInfo() {
    setBusy(true);
    // La tienda y el nombre solo se mandan si la persona NO tiene cuenta. Con cuenta, el servidor los
    // rechazaría —mandan `profiles.store` y el nombre del perfil— y el «Guardar» fallaría por un
    // campo que ni se puede tocar desde aquí.
    const {
      store, directory_group, full_name,
      job_title, personal_phone, personal_email, emergency_name, emergency_relation, emergency_phone,
      ...resto
    } = info;
    const r = await saveEmployeeFile(persona.id, {
      ...resto,
      ...(puedeElegirTienda(persona) ? { store, full_name } : {}),
      // Solo un admin manda el grupo: a un gerente el servidor se lo rechazaría, y «Guardar
      // datos» fallaría por un campo que ni siquiera ve.
      ...(editaGrupo ? { directory_group } : {}),
      // Los campos de la 159 solo viajan si la tabla los tiene: sin ella, mandarlos tumbaría el
      // guardado entero de los que sí existen.
      ...(con159 ? { job_title, personal_phone, personal_email, emergency_name, emergency_relation, emergency_phone } : {}),
      days_off: info.days_off === "" ? null : Number(info.days_off),
    });
    setBusy(false);
    notify(r.ok ? t("Saved ✓", "Guardado ✓") : "Error: " + (r.message ?? ""));
    if (r.ok) onSaved();
  }

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

  return (
    /* En ventana, no como panel al final de la página (D-149).
       ---------------------------------------------------------------------
       Se dibujaba DEBAJO de la tabla entera: con la plantilla completa en
       pantalla, "Abrir ficha" abría algo a treinta filas de distancia y desde
       arriba no se veía pasar nada. Parecía que el botón no hacía nada.
       Es además como abre todo lo demás en este módulo (ModalHost). */
    <div className="overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 760 }} data-dialogo="ficha">
        <div style={{ display: "flex", alignItems: "flex-start", gap: 10, flexWrap: "wrap" }}>
          <h3 style={{ margin: 0, flex: 1 }}>
            {persona.full_name}{" "}
            <span className="badge" data-insignia="estado"
              style={deBaja
                ? { background: "var(--tint-red-strong)", color: "var(--red)" }
                : { background: "var(--tint-green)", color: "var(--green)" }}>
              {etiquetaEstado(estadoEmpleado(persona), lang)}
            </span>
          </h3>
          {deBaja ? (
            <button className="btn btn-primary btn-sm" data-accion="reactivar" disabled={!puedeBaja}
              title={puedeBaja ? undefined : soloAdmin} onClick={onReactivar}>
              {t("Reactivate", "Reactivar")}
            </button>
          ) : (
            <button className="btn btn-danger btn-sm" data-accion="baja" disabled={!puedeBaja}
              title={puedeBaja ? undefined : soloAdmin} onClick={onBaja}>
              {t("Deactivate", "Dar de baja")}
            </button>
          )}
          <button className="btn btn-ghost btn-sm" onClick={onClose}>✕</button>
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

      <div className="sec-head">
        <span className="sec-title">INFO</span>
      </div>
      <div className="grid g3">
        {/* El nombre (con cuenta manda el del perfil, que se cambia en Usuarios). */}
        <div>
          <label>{t("Full name", "Nombre completo")}</label>
          <input value={puedeElegirTienda(persona) ? info.full_name : persona.full_name}
            disabled={!puedeElegirTienda(persona)}
            title={puedeElegirTienda(persona) ? undefined : t("This person has an account: change their name in Users.", "Esta persona tiene cuenta: su nombre se cambia en Usuarios.")}
            onChange={(e) => setInfo({ ...info, full_name: e.target.value })} />
        </div>
        {campo159("job_title", t("Position", "Puesto"))}
        {campo("employee_code", "ID")}
        {campo("date_hired", t("Date hired", "Fecha de ingreso"), "date")}
        {campo("birthday", t("Birthday", "Cumpleaños"), "date")}
        {/* Tienda (D-258). Con cuenta se ENSEÑA la de la cuenta y no se edita: esa tienda decide
            qué ve la persona en Entregas y se cambia en Usuarios. Sin cuenta se elige de la lista
            de tiendas, y es la que usa el directorio. */}
        <div>
          <label>{t("Store", "Tienda")}</label>
          {puedeElegirTienda(persona) ? (
            <select value={info.store} onChange={(e) => setInfo({ ...info, store: e.target.value })}>
              <option value="">{t("— none —", "— sin tienda —")}</option>
              {tiendas.map((n) => <option key={n} value={n}>{n}</option>)}
              {/* Una tienda guardada que ya no está en Ajustes no se pierde al abrir la ficha. */}
              {info.store && !tiendas.includes(info.store) && (
                <option value={info.store}>{info.store}</option>
              )}
            </select>
          ) : (
            <input
              value={tiendaVisible(persona) ?? ""}
              placeholder={t("— none —", "— sin tienda —")}
              readOnly
              disabled
              title={t("This person has an account: change their store in Users.", "Esta persona tiene cuenta: su tienda se cambia en Usuarios.")}
            />
          )}
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

      {/* CONTACTO. Dos teléfonos y dos correos, y no se mezclan: los «de oficina» son los que enseña el
          directorio de la compañía a todo el que tenga sesión; los personales solo los ve RR. HH. */}
      <div className="sec-head">
        <span className="sec-title">{t("CONTACT", "CONTACTO")}</span>
        <span className="sec-sub" data-aviso="directorio">
          {directorio.sale
            ? t("Shows in the company phone book.", "Sale en el directorio de la compañía.")
            : t("Not in the company phone book: ", "No sale en el directorio de la compañía: ")
              + directorio.falta.map((f) => PORQUE_NO_SALE[f]).join(", ") + "."}
        </span>
      </div>
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

      <div className="sec-head">
        <span className="sec-title">{t("EMERGENCY CONTACT", "CONTACTO DE EMERGENCIA")}</span>
      </div>
      <div className="grid g3">
        {campo159("emergency_name", t("Name", "Nombre"))}
        {campo159("emergency_relation", t("Relationship", "Parentesco"))}
        {campo159("emergency_phone", t("Phone", "Teléfono"), { placeholder: "956-555-0123", onBlur: alSalirTel("emergency_phone") })}
      </div>

      <div style={{ marginTop: 12 }}>
        <label>{t("Address", "Dirección")}</label>
        <input value={info.address} onChange={(e) => setInfo({ ...info, address: e.target.value })} />
      </div>
      <div style={{ marginTop: 12 }}>
        <label>{t("Notes", "Notas")}</label>
        <textarea rows={2} value={info.notes} onChange={(e) => setInfo({ ...info, notes: e.target.value })} />
      </div>
      <button className="btn btn-primary" style={{ marginTop: 12 }} disabled={busy} onClick={guardaInfo} data-accion="guardar">
        {t("Save info", "Guardar datos")}
      </button>

      {/* LA CUENTA DEL HUB. Estado leído de Auth, y el botón que quita o devuelve el acceso. Reactivar a
          alguien no lo devuelve: este es el único sitio que lo hace. */}
      <div className="sec-head">
        <span className="sec-title">{t("HUB ACCOUNT", "CUENTA DEL HUB")}</span>
      </div>
      <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }} data-bloque="cuenta">
        {!persona.profile_id ? (
          <span className="hint" style={{ marginTop: 0 }}>
            {t("No hub account. Accounts are created in Users.", "Sin cuenta del hub. Las cuentas se crean en Usuarios.")}
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

      <Bloque grupo="hr" titulo="HR" docs={docs} employeeId={persona.id}
        onChange={() => { void cargaDocs(); onSaved(); }} />
      <Bloque grupo="forms" titulo="FORMS" docs={docs} employeeId={persona.id}
        onChange={() => { void cargaDocs(); onSaved(); }} />

        <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 16 }}>
          <button className="btn btn-ghost" onClick={onClose}>{t("Close", "Cerrar")}</button>
        </div>
      </div>
    </div>
  );
}

/** Un grupo de documentos (HR o FORMS), una línea por tipo. */
function Bloque({
  grupo, titulo, docs, employeeId, onChange,
}: {
  grupo: "hr" | "forms";
  titulo: string;
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
      <div className="sec-head">
        <span className="sec-title">{titulo}</span>
      </div>
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
