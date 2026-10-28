"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePrefs } from "@/lib/prefs";
import { useData } from "@/lib/recruiting-data-provider";
import {
  createEmployeeFile, deactivateEmployee, listStoreNames, reactivateEmployee,
  type EmployeeFile,
} from "@/app/recruiting/actions/hr";
import {
  MOTIVOS_BAJA, casillaQuitarAcceso, estadoEmpleado, hoyLocalISO, telefonoDeFicha,
} from "@/lib/recruiting/employee-file";

/**
 * Las ventanas de los botones del expediente: «Dar de baja», «Reactivar» y «＋ Agregar empleado».
 *
 * Las acciones de servidor ya existían desde D-251 (`deactivateEmployee`, `reactivateEmployee`) y ninguna
 * pantalla las llamaba: la baja solo se podía hacer por SQL. Esto es el botón que faltaba.
 */

/** El texto que llevan los campos de la 159 mientras la migración no esté aplicada. */
export function faltaMigracion(t: (en: string, es: string) => string, n: 159 | 207 = 159): string {
  if (n === 207) return t("migration 207 pending", "falta la migración 207");
  return t("migration 159 pending", "falta la migración 159");
}

const pie: React.CSSProperties = { display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 16 };

// ---------------------------------------------------------------------------------------------
// Dar de baja (y corregir una baja)
// ---------------------------------------------------------------------------------------------

export function BajaDialog({
  persona, con159, onDone, onClose,
}: { persona: EmployeeFile; con159: boolean; onDone: () => void; onClose: () => void }) {
  const { t, lang } = usePrefs();
  const { notify } = useData();
  const yaDeBaja = estadoEmpleado(persona) === "baja";
  const casilla = casillaQuitarAcceso(persona);
  const [fecha, setFecha] = useState(persona.date_left || hoyLocalISO());
  const [motivo, setMotivo] = useState(persona.left_reason ?? "");
  const [nota, setNota] = useState(persona.left_note ?? "");
  const [busy, setBusy] = useState(false);

  // Con la 159 el motivo es obligatorio: una baja sin motivo es justo el expediente incompleto que esta
  // pantalla intenta que no exista. Sin la 159 no hay dónde guardarlo, y no se puede exigir.
  const listo = !!fecha && (!con159 || !!motivo);

  async function confirma() {
    setBusy(true);
    const r = await deactivateEmployee(persona.id, { fecha, motivo: con159 ? motivo : null, nota: con159 ? nota : null });
    setBusy(false);
    if (!r.ok) { notify("Error: " + (r.message ?? "")); if (r.message?.startsWith("Marked as left")) onDone(); return; }
    const partes = [yaDeBaja ? t("Leaving details saved ✓", "Baja corregida ✓") : t("Marked as left ✓", "Dado de baja ✓")];
    if (casilla.visible) {
      partes.push(r.accesoQuitado
        ? t("hub access removed", "acceso al hub quitado")
        : t("hub access NOT changed", "el acceso al hub NO se tocó"));
    }
    if (r.liberadas) {
      const que = [r.liberadas.email, r.liberadas.username].filter(Boolean).join(" / ");
      if (que) partes.push(t(`freed: ${que}`, `liberado: ${que}`));
    }
    if (r.sinMotivo) partes.push(t("reason not saved: migration 159 pending", "el motivo no se guardó: falta la migración 159"));
    notify(partes.join(" · "));
    onDone();
  }

  return (
    <div className="overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 520 }} data-dialogo="baja">
        <h3>
          {yaDeBaja ? t("Edit leaving details", "Corregir la baja") : t("Deactivate employee", "Dar de baja")}
          {" — "}{persona.full_name}
        </h3>
        <div className="grid g2">
          <div>
            <label>{t("Last day", "Fecha de baja")}</label>
            <input type="date" value={fecha} onChange={(e) => setFecha(e.target.value)} />
          </div>
          <div>
            <label>{t("Reason", "Motivo")}</label>
            <select value={motivo} disabled={!con159} onChange={(e) => setMotivo(e.target.value)}
              title={con159 ? undefined : faltaMigracion(t)}>
              <option value="">{con159 ? t("— choose —", "— elegir —") : faltaMigracion(t)}</option>
              {MOTIVOS_BAJA.map((m) => <option key={m.key} value={m.key}>{m[lang]}</option>)}
            </select>
          </div>
        </div>
        <div style={{ marginTop: 12 }}>
          <label>{t("Note", "Nota")}</label>
          <textarea rows={2} value={nota} disabled={!con159} onChange={(e) => setNota(e.target.value)}
            placeholder={con159 ? t("Optional: what happened", "Opcional: qué pasó") : faltaMigracion(t)} />
        </div>

        {casilla.visible ? (
          <div style={{ marginTop: 14 }} data-aviso="quita-acceso">
            <b>{t("Their hub access is removed and their email/username are freed", "Se le quita el acceso al hub y se liberan su correo y su usuario")}</b>
            <span className="hint" style={{ display: "block", marginTop: 2 }}>
              {t("The account is disabled, not deleted: nothing they did is lost. Their email and username can be given to someone else; the old ones are kept in the leaving note and in Users.",
                 "La cuenta se deshabilita, no se borra: no se pierde nada de lo que hizo. Su correo y su usuario se pueden dar a otra persona; los que tenía quedan en la nota de la baja y en Usuarios.")}
            </span>
          </div>
        ) : (
          <div className="hint" style={{ marginTop: 14 }}>
            {t("This person has no hub account: there is no access to remove.",
               "Esta persona no tiene cuenta del hub: no hay acceso que quitar.")}
          </div>
        )}

        <div className="hint" style={{ marginTop: 10 }}>
          {t("They stop showing in the company phone book. Their file and paperwork are kept.",
             "Deja de salir en el directorio de la compañía. Su expediente y sus papeles se conservan.")}
        </div>

        <div style={pie}>
          <button className="btn btn-ghost" onClick={onClose}>{t("Cancel", "Cancelar")}</button>
          <button className="btn btn-danger" disabled={busy || !listo} onClick={confirma}>
            {yaDeBaja ? t("Save", "Guardar") : t("Confirm deactivation", "Confirmar baja")}
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------------------------
// Reactivar
// ---------------------------------------------------------------------------------------------

export function ReactivarDialog({
  persona, onDone, onClose,
}: { persona: EmployeeFile; onDone: () => void; onClose: () => void }) {
  const { t } = usePrefs();
  const { notify } = useData();
  const [busy, setBusy] = useState(false);

  async function confirma() {
    setBusy(true);
    const r = await reactivateEmployee(persona.id);
    setBusy(false);
    if (!r.ok) { notify("Error: " + (r.message ?? "")); return; }
    notify(r.tieneCuenta
      ? t("Reactivated ✓ · set a new email/username in Users: the old ones were freed", "Reactivado ✓ · pon un correo/usuario nuevo en Usuarios: los anteriores se liberaron")
      : t("Reactivated ✓", "Reactivado ✓"));
    onDone();
  }

  return (
    <div className="overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 480 }} data-dialogo="reactivar">
        <h3>{t("Reactivate", "Reactivar")} — {persona.full_name}</h3>
        <p style={{ margin: 0 }}>
          {t("They go back to Active and the leaving date and reason are cleared.",
             "Vuelve a Activos y se borran la fecha y el motivo de la baja.")}
        </p>
        {persona.profile_id && (
          <p className="hint" style={{ marginTop: 10 }} data-aviso="acceso">
            {t("Reactivating re-enables their account but does NOT give back their email or username (they may belong to someone else now). Set a new email/username in Users.",
               "Reactivar vuelve a habilitar su cuenta pero NO le devuelve el correo ni el usuario (pueden ser ya de otra persona). Pon un correo/usuario nuevo en Usuarios.")}
          </p>
        )}
        <div style={pie}>
          <button className="btn btn-ghost" onClick={onClose}>{t("Cancel", "Cancelar")}</button>
          <button className="btn btn-primary" disabled={busy} onClick={confirma}>{t("Reactivate", "Reactivar")}</button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------------------------
// ＋ Agregar empleado
// ---------------------------------------------------------------------------------------------

export function AgregarDialog({
  con159, onDone, onClose,
}: { con159: boolean; onDone: (id: string) => void; onClose: () => void }) {
  const { t } = usePrefs();
  const { notify, settings } = useData();
  const [modo, setModo] = useState<"sin" | "con">("sin");
  const [f, setF] = useState({
    full_name: "", date_hired: "", department: "", store: "", phone: "", ringcentral_ext: "", job_title: "", personal_phone: "",
  });
  const [tiendas, setTiendas] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let vivo = true;
    void listStoreNames().then((r) => { if (vivo && r.ok) setTiendas(r.names); });
    return () => { vivo = false; };
  }, []);

  const pon = (k: keyof typeof f, v: string) => setF((a) => ({ ...a, [k]: v }));
  // Al salir del campo el teléfono toma la forma de la app, 956-xxx-xxxx (D-432).
  const alSalir = (k: "phone" | "personal_phone") => () => pon(k, telefonoDeFicha(f[k]) ?? "");

  async function agrega() {
    setBusy(true);
    const r = await createEmployeeFile(f);
    setBusy(false);
    if (!r.ok) { notify("Error: " + r.message); return; }
    notify(t("Employee added ✓ — finish their file", "Empleado agregado ✓ — completa su ficha"));
    onDone(r.id);
  }

  return (
    <div className="overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 620 }} data-dialogo="agregar">
        <h3>＋ {t("Add employee", "Agregar empleado")}</h3>
        <div className="filters" style={{ marginBottom: 12 }}>
          <button className={"chip" + (modo === "sin" ? " on" : "")} onClick={() => setModo("sin")}>
            {t("Without a hub account", "Sin cuenta del hub")}
          </button>
          <button className={"chip" + (modo === "con" ? " on" : "")} onClick={() => setModo("con")}>
            {t("With a hub account", "Con cuenta del hub")}
          </button>
        </div>

        {modo === "con" ? (
          <div data-modo="con">
            <p style={{ margin: 0 }}>
              {t("Add the employee first; then open their file and press «Permissions» to create the hub account (role, store and apps are chosen there).",
                 "Agrega primero al empleado; después abre su expediente y pulsa «Permisos» para crearle la cuenta del hub (ahí se eligen el rol, la tienda y las apps).")}
            </p>
            <div style={pie}>
              <button className="btn btn-ghost" onClick={onClose}>{t("Close", "Cerrar")}</button>
              <button className="btn btn-primary" data-accion="seguir-sin-cuenta" onClick={() => setModo("sin")}>{t("Add the employee", "Agregar al empleado")}</button>
            </div>
          </div>
        ) : (
          <div data-modo="sin">
            <div className="grid g2">
              <div>
                <label>{t("Full name", "Nombre completo")} *</label>
                <input value={f.full_name} autoFocus onChange={(e) => pon("full_name", e.target.value)} />
              </div>
              <div>
                <label>{t("Position", "Puesto")}</label>
                <input value={f.job_title} disabled={!con159} placeholder={con159 ? "" : faltaMigracion(t)}
                  onChange={(e) => pon("job_title", e.target.value)} />
              </div>
              <div>
                <label>{t("Date hired", "Fecha de ingreso")}</label>
                <input type="date" value={f.date_hired} onChange={(e) => pon("date_hired", e.target.value)} />
              </div>
              <div>
                <label>{t("Department", "Departamento")}</label>
                <select value={f.department} onChange={(e) => pon("department", e.target.value)}>
                  <option value="">{t("— none —", "— sin departamento —")}</option>
                  {(settings.departments ?? []).map((d) => <option key={d} value={d}>{d}</option>)}
                </select>
              </div>
              <div>
                <label>{t("Store", "Tienda")}</label>
                <select value={f.store} onChange={(e) => pon("store", e.target.value)}>
                  <option value="">{t("— none —", "— sin tienda —")}</option>
                  {tiendas.map((n) => <option key={n} value={n}>{n}</option>)}
                </select>
              </div>
              <div>
                <label>{t("Extension", "Extensión")}</label>
                <input value={f.ringcentral_ext} inputMode="numeric" onChange={(e) => pon("ringcentral_ext", e.target.value)} />
              </div>
              <div>
                <label>{t("Office phone", "Teléfono de oficina")}</label>
                <input value={f.phone} placeholder="956-555-0123" onBlur={alSalir("phone")} onChange={(e) => pon("phone", e.target.value)} />
              </div>
              <div>
                <label>{t("Personal phone", "Teléfono personal")}</label>
                <input value={f.personal_phone} disabled={!con159} placeholder={con159 ? "956-555-0123" : faltaMigracion(t)}
                  onBlur={alSalir("personal_phone")} onChange={(e) => pon("personal_phone", e.target.value)} />
              </div>
            </div>
            <div className="hint" style={{ marginTop: 10 }}>
              {t("The rest (emergency contact, address, paperwork) is filled in their file, which opens next.",
                 "Lo demás (contacto de emergencia, dirección, papeles) se llena en su ficha, que se abre a continuación.")}
            </div>
            <div style={pie}>
              <button className="btn btn-ghost" onClick={onClose}>{t("Cancel", "Cancelar")}</button>
              <button className="btn btn-primary" disabled={busy || !f.full_name.trim()} onClick={agrega}>
                {t("Add employee", "Agregar empleado")}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
