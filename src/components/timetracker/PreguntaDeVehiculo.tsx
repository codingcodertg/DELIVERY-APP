"use client";

import { useT } from "@/lib/timetracker/i18n";
import type { Vehiculo } from "@/lib/clockin/visitas";

/**
 * «¿Vas en tu vehículo personal o en uno de la empresa?» (D-NEXT).
 *
 * La misma pregunta en los dos sitios donde empieza una salida: la ventana de «Voy a salir» y el
 * panel «Visitas, mandados y viajes». Dos respuestas del tamaño de un pulgar (las `.motivo` de
 * D-163: se contestan de pie y con prisa), y con «empresa» el vehículo y el cuentakilómetros de
 * salida. Con «personal», nada más: la regla del dueño es «si es su carro personal, no need».
 *
 * Si la empresa no tiene ningún vehículo activo, «de la empresa» sale DESHABILITADO —de verdad,
 * con `disabled`— y la línea de debajo dice por qué. Es el único caso en que se ve apagado.
 */
export function PreguntaDeVehiculo({
  nombre, valor, onValor, vehiculos, vehiculoId, onVehiculoId, odometro, onOdometro,
}: {
  /** El `name` de las dos opciones. Distinto en cada sitio: la ventana y el panel de viajes pueden
   *  estar a la vez en pantalla, y dos grupos de radios con el mismo nombre son UNO solo. */
  nombre: string;
  valor: Vehiculo | null;
  onValor: (v: Vehiculo) => void;
  vehiculos: { id: string; name: string }[];
  vehiculoId: string | null;
  onVehiculoId: (id: string) => void;
  odometro: string;
  onOdometro: (s: string) => void;
}) {
  const t = useT();
  const sinFlota = vehiculos.length === 0;
  const elegido = vehiculos.find((v) => v.id === vehiculoId) ?? null;
  return (
    <div data-pregunta-vehiculo>
      <p style={{ fontWeight: 700, margin: "6px 0" }}>{t("emp.out.vehicleAsk")}</p>
      <div className="motivos">
        <label className={"motivo" + (valor === "personal" ? " on" : "")}>
          <input type="radio" name={nombre} checked={valor === "personal"} onChange={() => onValor("personal")} />
          🚗 {t("emp.out.personal")}
        </label>
        <label className={"motivo" + (valor === "empresa" ? " on" : "")}>
          <input type="radio" name={nombre} disabled={sinFlota} checked={valor === "empresa"} onChange={() => onValor("empresa")} />
          🚚 {t("emp.out.company")}
        </label>
      </div>
      {sinFlota && <div className="hint">{t("emp.out.noFleet")}</div>}
      {valor === "empresa" && !sinFlota && (
        <div className="grid g2" style={{ marginTop: 8 }}>
          <div>
            <label>{t("emp.trip.vehicle")}</label>
            <select value={vehiculoId ?? ""} onChange={(e) => onVehiculoId(e.target.value)}>
              {vehiculos.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
            </select>
          </div>
          <div>
            <label>{elegido ? t("emp.visit.odoOf", { v: elegido.name }) : t("emp.trip.odoOut")}</label>
            <input inputMode="numeric" value={odometro} onChange={(e) => onOdometro(e.target.value)} placeholder={t("emp.trip.miles")} />
          </div>
        </div>
      )}
    </div>
  );
}
