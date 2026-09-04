// Tabs for timetracker's own TopBar. Hrefs are prefixed /timetracker — this
// module lives under that prefix, a sibling of (app) and recruiting's
// (recruiting), never nested (D-064).
//
// Etapa 2 landed screen by screen (D-066 through D-071) — see DECISIONS.md
// for the pass-by-pass history. Both employee and manager sides are now
// complete: 5 employee screens, 10 manager screens.
// Las etiquetas NO viven aquí desde D-122. Vivían escritas a mano en inglés, así que la barra
// —lo único que se ve en todas las pantallas— no cambiaba nunca de idioma por mucho que se
// pulsara el botón. Ahora son claves `tab.<id>` del diccionario y la pinta TopBar con t().
export const TABS: { id: string; href: string }[] = [
  { id: "track", href: "/timetracker" },
  { id: "week", href: "/timetracker/week" },
  { id: "requests", href: "/timetracker/requests" },
  { id: "diary", href: "/timetracker/diary" },
  // "Mi cuenta" ya no es pestaña (D-160): se llega tocando el propio nombre en la barra,
  // que es donde la gente lo busca. La ruta /timetracker/account no cambia.
  // La pestaña de Fichaje se retiró en D-137: el módulo ya no tiene pantallas. Fichar,
  // el almuerzo, las salidas y los viajes están en "Registrar tiempo"; lo de gerente, en
  // Payroll, Auditoría, Horario y Empleados.
];

// An admin sees this instead of TABS — manager screens first, then the same
// personal ones every employee gets (an admin can track their own time too;
// the original's "View as employee" toggle covered the same ground, just
// as a mode switch instead of separate routes).
export const MANAGER_TABS: { id: string; href: string }[] = [
  { id: "insights", href: "/timetracker/insights" },
  { id: "live", href: "/timetracker/live" },
  // "Informes y pago" ya no es pestaña (D-164): es la vista 💵 Pago dentro de Nómina, que
  // es la misma pregunta —cuánto se le paga a quién este periodo— y estaba partida en dos
  // pantallas con dos calendarios propios. La ruta /timetracker/reports redirige.
  // Las horas de las DOS mitades por periodo (fase 4). Va junto a Reports/Pay porque
  // es lo mismo que se mira, con las dos fuentes al lado en vez de una sola.
  { id: "payroll", href: "/timetracker/payroll" },
  // Ya no son solo las solicitudes de horas: desde la fusión de vistas #2 esta pantalla
  // lleva también las ausencias y las excepciones de fichaje. El nombre lo dice para que
  // nadie siga buscando las otras dos en el módulo de fichaje.
  { id: "team-requests", href: "/timetracker/team-requests" },
  { id: "projects", href: "/timetracker/projects" },
  // Lleva DOS cosas desde D-NEXT: las tarifas por proyecto y el horario semanal de la cuadrilla,
  // como dos secciones de la misma pantalla. El horario tenía pestaña propia ("schedule", que
  // bajó del módulo de fichaje en D-121) y el dueño pidió meterlo aquí. La ruta
  // /timetracker/schedule sigue existiendo y redirige.
  { id: "assignments", href: "/timetracker/assignments" },
  { id: "people", href: "/timetracker/people" },
  { id: "team-diary", href: "/timetracker/team-diary" },
  { id: "audit", href: "/timetracker/audit" },
  { id: "settings", href: "/timetracker/settings" },
  { id: "track", href: "/timetracker" },
  { id: "week", href: "/timetracker/week" },
  { id: "requests", href: "/timetracker/requests" },
  { id: "diary", href: "/timetracker/diary" },
  // Sin "Mi cuenta" (D-160). A un admin esta barra le pone catorce pestañas; la que menos
  // se abría no tenía por qué ser una de ellas. (Ese "catorce" ya no cuadraba cuando se escribió
  // esto: contadas el 2026-09-04 eran quince, y quedan catorce al entrar el horario en
  // Asignaciones, D-NEXT.)
];
