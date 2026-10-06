"use client";

import RoutesPage from "@/app/(app)/routes/page";
import { SoloLectura } from "@/lib/gestor/solo-lectura";

// ============================================================
// «Ruta de hoy» / «Today's route» (D-467; antes, «Mapa»).
//
// D-NEXT (el dueño, 2026-10-06, dictado): «today srotue is an exact duplicate of routes manager but without any actionable
// buttom or action». Hasta aquí era el bloque de arriba del Gestor (panel y mapa) con un resumen propio. Ahora ES el Gestor
// de Rutas —las mismas tarjetas por chofer, la misma tabla de paradas, el mismo mapa, Cuadrícula y Horario, el mismo filtro
// de chofer— en SOLO LECTURA: ni asignar, ni mover, ni optimizar, ni deshacer, ni casillas, ni arrastre, ni «Armar rutas».
//
// Lo que D-467 y D-469 decidieron sigue, dentro de la página del Gestor con `soloLectura`: las paradas salen de
// `useRutasDelDia` (la función `rutas_del_dia`, migración 160: rutas enteras con lo mínimo de cada parada) y se completan
// con la orden entera solo si esta persona ya la lee; el día se acota a la ventana de D-239 y al ±7 de la función; Ayer, Hoy
// y Mañana; los camiones en vivo (no para ventas); la leyenda; los colores de chofer (los cambia gerente o admin); y la orden
// entera solo se abre si la persona ya puede leerla (y un vendedor, solo las suyas).
// ============================================================
export default function MapPage() {
  return (
    <SoloLectura>
      <RoutesPage />
    </SoloLectura>
  );
}
