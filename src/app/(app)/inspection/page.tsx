"use client";

import { useState } from "react";
import { useData } from "@/lib/data-provider";
import { usePrefs } from "@/lib/prefs";
import { revisaLasDelEquipo } from "@/lib/inspeccion/reglas";
import { FormularioDeInspeccion } from "@/components/inspeccion/FormularioDeInspeccion";
import { InspeccionesDelDia } from "@/components/inspeccion/InspeccionesDelDia";

// ============================================================
// «Pre-trip inspection checklist» / «Inspección pre-viaje» (D-NEXT).
//
// El dueño, 2026-10-11: «AGREGA UN NUEVO VIEW QUE SE LLAMARA PRE TRIP INSPECTION CHECKLIST Y INVESTIGAME ALGO PARA
// HACER UN FIRST DRAFT».
//
// Una pantalla, dos caras: el chofer llena la suya (una por día y por vehículo); logística y el admin ven las del día
// de todos, con los defectos abiertos arriba, y pueden pasar a «Hacer la mía». Quién entra lo decide `TABS` (D-240).
// ============================================================

export default function InspectionPage() {
  const { me } = useData();
  const { t } = usePrefs();
  const [vista, setVista] = useState<"equipo" | "mia">("equipo");
  if (!me) return null;
  if (!revisaLasDelEquipo(me.role)) return <FormularioDeInspeccion />;
  return (
    <>
      <div className="viewtoggle" data-vista-de-inspeccion style={{ marginBottom: 12 }}>
        <button className={`vt${vista === "equipo" ? " on" : ""}`} onClick={() => setVista("equipo")}>{t("Everyone's inspections", "Inspecciones del día")}</button>
        <button className={`vt${vista === "mia" ? " on" : ""}`} onClick={() => setVista("mia")}>{t("Do mine", "Hacer la mía")}</button>
      </div>
      {vista === "equipo" ? <InspeccionesDelDia /> : <FormularioDeInspeccion />}
    </>
  );
}
