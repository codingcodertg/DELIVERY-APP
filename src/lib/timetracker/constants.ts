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
  { id: "account", href: "/timetracker/account" },
  // Fichaje, la otra mitad de la app (fase 3 de la fusión). UNA entrada y no las
  // diecinueve pantallas del módulo: la barra de un admin ya lleva quince, y volcarle
  // el otro módulo encima la vuelve un buscador de pestañas. Desde aquí se entra y la
  // navegación propia de fichaje sigue haciendo el resto.
  { id: "clockin", href: "/timetracker/clock-in/clock" },
];

// An admin sees this instead of TABS — manager screens first, then the same
// personal ones every employee gets (an admin can track their own time too;
// the original's "View as employee" toggle covered the same ground, just
// as a mode switch instead of separate routes).
export const MANAGER_TABS: { id: string; href: string }[] = [
  { id: "insights", href: "/timetracker/insights" },
  { id: "live", href: "/timetracker/live" },
  { id: "reports", href: "/timetracker/reports" },
  // Las horas de las DOS mitades por periodo (fase 4). Va junto a Reports/Pay porque
  // es lo mismo que se mira, con las dos fuentes al lado en vez de una sola.
  { id: "payroll", href: "/timetracker/payroll" },
  // Ya no son solo las solicitudes de horas: desde la fusión de vistas #2 esta pantalla
  // lleva también las ausencias y las excepciones de fichaje. El nombre lo dice para que
  // nadie siga buscando las otras dos en el módulo de fichaje.
  { id: "team-requests", href: "/timetracker/team-requests" },
  { id: "projects", href: "/timetracker/projects" },
  { id: "assignments", href: "/timetracker/assignments" },
  { id: "people", href: "/timetracker/people" },
  // Va justo detrás de Employees porque programar es una cosa que se le hace a la gente: se
  // abre la lista, se ve quién falta esta semana y se le pone turno. Bajó del módulo de
  // fichaje en D-121.
  { id: "schedule", href: "/timetracker/schedule" },
  { id: "team-diary", href: "/timetracker/team-diary" },
  { id: "audit", href: "/timetracker/audit" },
  { id: "settings", href: "/timetracker/settings" },
  { id: "track", href: "/timetracker" },
  { id: "week", href: "/timetracker/week" },
  { id: "requests", href: "/timetracker/requests" },
  { id: "diary", href: "/timetracker/diary" },
  { id: "account", href: "/timetracker/account" },
  // Al admin le lleva al panel de fichaje, no a la pantalla de fichar: lo que necesita
  // de ese módulo es ver a la cuadrilla, no marcar su propia entrada.
  { id: "clockin", href: "/timetracker/clock-in/clock" },
];
