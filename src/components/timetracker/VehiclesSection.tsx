"use client";

import { TablaEstandar } from "@/components/TablaEstandar";
import { useCallback, useEffect, useState } from "react";
import { listVehicles, addVehicle, setVehicleActive } from "@/app/timetracker/clock-in/actions/vehicles";
import { useT } from "@/lib/timetracker/i18n";

/**
 * La flota, dentro de Ajustes de Time Tracker (D-137).
 *
 * Vivía en la pantalla de "equipo" del módulo de fichaje, que a estas alturas ya solo servía
 * para esto: la configuración de personas se mudó al diálogo de Usuarios del hub en D-095, y lo
 * único que quedaba en aquella pantalla era la lista de camiones. Ajustes ya enlazaba aquí, así
 * que el sitio estaba elegido desde antes.
 *
 * Un camión **no se borra, se apaga**. Los viajes ya registrados lo apuntan, y borrarlo dejaría
 * kilometraje colgando de un vehículo que no existe. Apagado deja de ofrecerse al empezar un
 * viaje y su historial sigue en pie.
 *
 * G-9 (D-202): textos por claves mgr.veh.*. Nombre y placa de cada vehículo son dato.
 */
export function VehiclesSection() {
  const t = useT();
  const [flota, setFlota] = useState<{ id: string; name: string; plate: string | null; active: boolean }[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [nombre, setNombre] = useState("");
  const [placa, setPlaca] = useState("");

  const load = useCallback(async () => {
    const r = await listVehicles();
    if (!r.ok) { setErr(r.message); return; }
    setErr(null);
    setFlota(r.vehicles);
  }, []);

  useEffect(() => { void load(); }, [load]);

  async function corre(fn: () => Promise<{ ok: boolean; message?: string }>) {
    setBusy(true);
    const r = await fn();
    setBusy(false);
    if (!r.ok) { setErr(r.message ?? t("mgr.veh.saveFail")); return; }
    setErr(null);
    await load();
  }

  return (
    <>
      <div className="hr" />
      <h3 style={{ color: "var(--tt-muted)" }}>{t("mgr.veh.title")}</h3>
      <p className="small muted" style={{ marginTop: 0 }}>
        {t("mgr.veh.note")}
      </p>

      {err && <div className="banner err">{err}</div>}

      <div className="row">
        <input value={nombre} onChange={(e) => setNombre(e.target.value)} placeholder={t("mgr.veh.namePh")} />
        <input value={placa} onChange={(e) => setPlaca(e.target.value)} placeholder={t("mgr.veh.platePh")} style={{ maxWidth: 160 }} />
        <button
          disabled={busy || !nombre.trim()}
          onClick={async () => {
            await corre(() => addVehicle({ name: nombre.trim(), plate: placa.trim() || undefined }));
            setNombre(""); setPlaca("");
          }}
        >
          {t("mgr.veh.add")}
        </button>
      </div>

      {!flota ? (
        <div className="hint">{t("mgr.veh.loading")}</div>
      ) : flota.length === 0 ? (
        <p className="small muted">{t("mgr.veh.none")}</p>
      ) : (
        <div style={{ marginTop: 12 }}>
          <TablaEstandar id="tt-vehiculos" filas={flota} claveDe={(v) => String(v.id)} anchoDeAcciones={150}
            claseDeFila={(v) => (v.active ? undefined : "atenuado")}
            columnas={[
              { key: "vehiculo", en: t("mgr.veh.colVehicle"), es: t("mgr.veh.colVehicle"), ancho: 260, fija: true, valor: (v) => v.name },
              { key: "placa", en: t("mgr.veh.colPlate"), es: t("mgr.veh.colPlate"), ancho: 150, clase: "small muted", valor: (v) => v.plate || null },
              { key: "estado", en: t("mgr.veh.colStatus"), es: t("mgr.veh.colStatus"), ancho: 150, valor: (v) => (v.active ? t("mgr.veh.active") : t("mgr.veh.off")),
                celda: (v) => (v.active ? <span className="pill on">{t("mgr.veh.active")}</span> : <span className="pill off">{t("mgr.veh.off")}</span>) },
            ]}
            acciones={(v) => (
              <button className="btn-ghost btn-sm" disabled={busy}
                onClick={() => corre(() => setVehicleActive(v.id, !v.active))}>
                {v.active ? t("mgr.veh.turnOff") : t("mgr.veh.turnOn")}
              </button>
            )} />
        </div>
      )}
    </>
  );
}
