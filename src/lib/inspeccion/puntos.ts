/**
 * La lista de la inspección pre-viaje (D-NEXT). **Es el único sitio donde vive**: la pantalla del chofer, la de
 * logística, el progreso y la regla de «seguro para salir» la leen de aquí. Para cambiar un punto, se cambia aquí.
 *
 * El dueño (2026-10-11): «AGREGA UN NUEVO VIEW QUE SE LLAMARA PRE TRIP INSPECTION CHECKLIST Y INVESTIGAME ALGO PARA HACER
 * UN FIRST DRAFT». Es un PRIMER BORRADOR: la lista sale de la base federal (49 CFR §392.7 y §396.11, la lista mínima
 * de piezas que el chofer revisa y reporta; §393.95, el equipo de emergencia) y de las listas de CDL, agrupada por
 * zonas del camión, más lo propio de RTG (plataforma, correas, pallet jack). Detalle y enlaces en DECISIONS.md.
 *
 * Reglas para editarla sin romper lo ya guardado:
 *   · **El `id` de un punto no se cambia ni se reutiliza.** Las respuestas se guardan por `id`; renombrar el texto está
 *     bien, cambiar el `id` deja huérfanas las respuestas viejas (se pintan por su `id`, sin texto).
 *   · Si se quita o se añade un punto, se sube `VERSION_DE_LA_LISTA`: cada inspección guarda con qué versión se hizo.
 *   · `critico: true` = si el chofer lo marca «Defecto», el camión **no es seguro para salir** (`esSeguroParaSalir`).
 *     Un punto crítico tampoco admite «No aplica»: un camión sin frenos que «no aplican» no es un camión seguro.
 *   · `puedeNoAplicar` solo en lo que de verdad falta en algunos camiones (la plataforma, el pallet jack…).
 */

export type IdDeSeccion = "cabina" | "motor" | "luces" | "llantas" | "carga" | "seguridad";

export interface Punto {
  id: string;
  en: string;
  es: string;
  /** Un defecto aquí deja el camión «no seguro para salir». */
  critico?: boolean;
  /** Se puede contestar «No aplica» (equipo que no todos los camiones llevan). */
  puedeNoAplicar?: boolean;
}

export interface Seccion {
  id: IdDeSeccion;
  en: string;
  es: string;
  icono: string;
  puntos: Punto[];
}

/** Se sube al quitar o añadir puntos. Cada inspección la guarda (`checklist_version`). */
export const VERSION_DE_LA_LISTA = "2026-10-11";

export const SECCIONES: readonly Seccion[] = [
  {
    id: "cabina", icono: "🪪", en: "Documents & cab", es: "Documentos y cabina",
    puntos: [
      { id: "documentos", en: "License, registration and insurance in the truck", es: "Licencia, registro y seguro en el camión" },
      { id: "cinturon", en: "Seat belt works", es: "Cinturón de seguridad funciona" },
      { id: "espejos", en: "Mirrors clean, tight and adjusted", es: "Espejos limpios, firmes y ajustados" },
      { id: "parabrisas", en: "Windshield: no cracks that block the view", es: "Parabrisas sin grietas que tapen la vista" },
      { id: "limpiaparabrisas", en: "Wipers and washer fluid", es: "Limpiaparabrisas y líquido" },
      { id: "bocina", en: "Horn", es: "Bocina (claxon)" },
      { id: "tablero", en: "Dashboard: gauges work, no warning lights", es: "Tablero: indicadores funcionan, sin luces de alerta" },
      { id: "frenos", en: "Service brakes: firm pedal, stops straight", es: "Frenos: pedal firme, frena derecho", critico: true },
      { id: "freno_estacionamiento", en: "Parking brake holds the truck", es: "Freno de estacionamiento sostiene el camión", critico: true },
      { id: "direccion", en: "Steering: no excessive play", es: "Dirección: sin juego de más", critico: true },
    ],
  },
  {
    id: "motor", icono: "🛢", en: "Engine (quick look)", es: "Motor (vista rápida)",
    puntos: [
      { id: "aceite", en: "Engine oil level", es: "Nivel de aceite" },
      { id: "refrigerante", en: "Coolant level", es: "Nivel de anticongelante" },
      { id: "fugas", en: "No leaks under the truck (oil, coolant, fuel)", es: "Sin fugas bajo el camión (aceite, anticongelante, diésel)" },
      { id: "bandas", en: "Belts and hoses", es: "Bandas y mangueras" },
    ],
  },
  {
    id: "luces", icono: "💡", en: "Lights", es: "Luces",
    puntos: [
      { id: "faros", en: "Headlights (high and low beam)", es: "Faros (altas y bajas)" },
      { id: "direccionales", en: "Turn signals (front and rear)", es: "Direccionales (adelante y atrás)", critico: true },
      { id: "luces_freno", en: "Brake lights", es: "Luces de freno", critico: true },
      { id: "reversa", en: "Reverse lights and backup alarm", es: "Luces y alarma de reversa" },
      { id: "intermitentes", en: "Hazard flashers", es: "Intermitentes" },
      { id: "galibo", en: "Clearance lights and reflectors", es: "Luces de gálibo y reflejantes", puedeNoAplicar: true },
    ],
  },
  {
    id: "llantas", icono: "🛞", en: "Tires & wheels", es: "Llantas y ruedas",
    puntos: [
      { id: "inflado", en: "Tires inflated (none low or flat)", es: "Llantas infladas (ninguna baja ni ponchada)", critico: true },
      { id: "dibujo", en: "Enough tread on every tire", es: "Dibujo suficiente en todas", critico: true },
      { id: "cortes", en: "No cuts, bulges or cords showing", es: "Sin cortes, bultos ni cuerdas a la vista", critico: true },
      { id: "tuercas", en: "Lug nuts all there and tight", es: "Tuercas completas y apretadas", critico: true },
      { id: "rines", en: "Rims not cracked or bent", es: "Rines sin grietas ni golpes", critico: true },
    ],
  },
  {
    id: "carga", icono: "📦", en: "Cargo & equipment", es: "Carga y equipo",
    puntos: [
      { id: "plataforma", en: "Liftgate works", es: "Plataforma (liftgate) funciona", puedeNoAplicar: true },
      { id: "correas", en: "Straps and ratchets in good shape", es: "Correas y matracas en buen estado" },
      { id: "pallet_jack", en: "Pallet jack works", es: "Pallet jack (patín) funciona", puedeNoAplicar: true },
      { id: "piso_caja", en: "Box floor solid, no holes", es: "Piso de la caja firme, sin hoyos", puedeNoAplicar: true },
      { id: "puertas", en: "Doors and locks", es: "Puertas y cerraduras" },
    ],
  },
  {
    id: "seguridad", icono: "🧯", en: "Safety equipment", es: "Equipo de seguridad",
    puntos: [
      { id: "extintor", en: "Fire extinguisher charged and mounted", es: "Extintor cargado y sujeto" },
      { id: "triangulos", en: "3 reflective warning triangles", es: "3 triángulos reflejantes" },
      { id: "botiquin", en: "First-aid kit", es: "Botiquín" },
      { id: "chaleco", en: "Safety vest", es: "Chaleco reflejante" },
    ],
  },
];

/** Todos los puntos, en el orden de la pantalla. */
export const PUNTOS: readonly Punto[] = SECCIONES.flatMap((s) => s.puntos);

const PUNTO_POR_ID = new Map(PUNTOS.map((p) => [p.id, p]));

export const puntoPorId = (id: string): Punto | undefined => PUNTO_POR_ID.get(id);

/** El texto de un punto en el idioma pedido; un `id` que ya no está en la lista se enseña tal cual. */
export const textoDelPunto = (id: string, es: boolean): string => {
  const p = PUNTO_POR_ID.get(id);
  return p ? (es ? p.es : p.en) : id;
};
