"use client";

import { useCallback, useEffect, useState } from "react";
import { usePrefs } from "@/lib/prefs";
import { useData } from "@/lib/recruiting-data-provider";
import { assignAsset, listAssets, releaseAsset } from "@/app/recruiting/actions/activos";
import { etiquetaDeTipoDeTelefono, libres, losDe, textoDeTelefono, type Activo, type TipoDeActivo } from "@/lib/recruiting/activos";
import { ConfirmarConMotivo } from "@/components/recruiting/ConfirmarConMotivo";

/**
 * «Activos de la empresa» dentro del expediente (D-730): el correo y el número que tiene esta persona, con «Liberar»; y
 * para asignar, un desplegable con SOLO los disponibles de cada tipo. El dueño: «From an employee's profile I can pick an
 * available email and/or phone number and assign it. Only available assets show up when assigning».
 */
export function ActivosDelEmpleado({ employeeId, deBaja }: { employeeId: string; deBaja: boolean }) {
  const { t, lang } = usePrefs();
  const { notify } = useData();
  const [activos, setActivos] = useState<Activo[] | null>(null);
  const [sinTabla, setSinTabla] = useState(false);
  const [busy, setBusy] = useState(false);
  const [elegido, setElegido] = useState<Record<TipoDeActivo, string>>({ email: "", phone: "" });
  // D-734: liberar es deliberado: «¿Seguro? ¿Por qué?» antes, y el motivo al historial.
  const [liberando, setLiberando] = useState<Activo | null>(null);

  const cargar = useCallback(async () => {
    const r = await listAssets();
    if (!r.ok) { setSinTabla(r.sinTabla); setActivos([]); return; }
    setActivos(r.rows);
  }, []);
  useEffect(() => { void cargar(); }, [cargar]);

  const corre = async (fn: () => Promise<{ ok: boolean; message?: string }>) => {
    setBusy(true);
    const r = await fn();
    setBusy(false);
    if (!r.ok) { notify("Error: " + (r.message ?? "")); return; }
    await cargar();
  };

  if (activos === null) return <div className="hint">{t("Loading…", "Cargando…")}</div>;
  if (sinTabla) return <div className="hint" data-aviso="211">{t("Migration 211 is not applied yet.", "Falta aplicar la migración 211.")}</div>;
  const suyos = losDe(activos, employeeId);

  const fila = (kind: TipoDeActivo) => {
    const tiene = suyos.find((a) => a.kind === kind) ?? null;
    const disponibles = libres(activos, kind);
    return (
      <div key={kind} className="mini-row" data-activo-del-empleado={kind} style={{ alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <span style={{ minWidth: 90, fontWeight: 700 }}>{kind === "email" ? "✉️ " + t("Email", "Correo") : "📞 " + t("Line", "Línea")}</span>
        {tiene ? (
          <>
            <span data-asignado={tiene.id}>{kind === "phone" ? `${textoDeTelefono(tiene)} · ${etiquetaDeTipoDeTelefono(tiene.phone_type, lang)}` : tiene.value}</span>
            <button className="btn btn-ghost btn-sm" data-accion="liberar-activo" disabled={busy} onClick={() => setLiberando(tiene)}>
              {t("Release", "Liberar")}
            </button>
          </>
        ) : deBaja ? (
          <span className="hint" style={{ marginTop: 0 }}>{t("none", "ninguno")}</span>
        ) : (
          <>
            <select value={elegido[kind]} disabled={busy || disponibles.length === 0} data-elige-activo={kind} style={{ width: "auto", minWidth: 220 }}
              onChange={(e) => setElegido({ ...elegido, [kind]: e.target.value })}>
              <option value="">{disponibles.length === 0 ? t("— none available —", "— ninguno disponible —") : t("— choose an available one —", "— elige uno disponible —")}</option>
              {disponibles.map((a) => <option key={a.id} value={a.id}>{kind === "phone" ? `${textoDeTelefono(a)} · ${etiquetaDeTipoDeTelefono(a.phone_type, lang)}` : a.value}</option>)}
            </select>
            <button className="btn btn-primary btn-sm" data-accion="asignar-activo" disabled={busy || !elegido[kind]}
              onClick={() => void corre(() => assignAsset(elegido[kind], employeeId)).then(() => setElegido({ ...elegido, [kind]: "" }))}>
              {t("Assign", "Asignar")}
            </button>
          </>
        )}
      </div>
    );
  };

  return (
    <div data-bloque="activos">
      {fila("email")}
      {fila("phone")}
      <p className="hint">
        {t("Releasing an email leaves it pending backup; releasing a number makes it available. Deactivating someone does the same automatically. Everything is kept in the HR history.",
           "Liberar un correo lo deja pendiente de respaldo; liberar un número lo deja disponible. Dar de baja hace lo mismo solo. Todo queda en el historial de RR. HH.")}
      </p>
      {liberando && (
        <ConfirmarConMotivo
          titulo={`${t("Release", "Liberar")} ${liberando.kind === "phone" ? textoDeTelefono(liberando) : liberando.value}?`}
          texto={liberando.kind === "email"
            ? t("The email is left pending backup until someone marks it as backed up.", "El correo queda pendiente de respaldo hasta que alguien lo marque respaldado.")
            : t("The number becomes available for someone else.", "El número queda disponible para otra persona.")}
          boton={t("Release", "Liberar")} busy={busy} onClose={() => setLiberando(null)}
          onConfirm={async (motivo) => { await corre(() => releaseAsset(liberando.id, undefined, motivo)); setLiberando(null); }} />
      )}
    </div>
  );
}
