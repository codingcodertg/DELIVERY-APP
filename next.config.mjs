import { fileURLToPath } from "node:url";
import { dirname } from "node:path";

import { withSentryConfig } from "@sentry/nextjs";

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,

  // La raíz del workspace es ESTA carpeta, y hay que decirlo.
  // ---------------------------------------------------------------------------
  // Hay un package-lock.json suelto en la carpeta de usuario (C:\Users\andre), y al
  // detectar dos lockfiles Next elegía AQUEL como raíz. De ahí salía el aviso de cada
  // build, pero el aviso no es el problema: la raíz decide qué ficheros se rastrean y
  // se empaquetan para las funciones de servidor. Con la raíz puesta en la carpeta de
  // usuario, ese cálculo se hace sobre el árbol equivocado — hoy sale bien, y el día
  // que no salga faltará un fichero en producción sin que nada haya cambiado aquí.
  outputFileTracingRoot: dirname(fileURLToPath(import.meta.url)),

  // Fase 3b de la fusión: fichaje se mudó de /clock-in a /timetracker/clock-in.
  //
  // Las redirecciones no son cortesía. La cuadrilla tiene accesos directos en la pantalla
  // de inicio del móvil apuntando a /clock-in/clock, hay notificaciones ya enviadas con
  // esa url dentro, y marcadores. Sin esto, diez personas abren su icono de siempre y ven
  // un 404 a las siete de la mañana.
  //
  // `permanent: false` (307) a propósito, y no 308: un permanente lo cachea el navegador
  // para siempre, y si algún día hay que deshacer la mudanza no habría forma de decirle a
  // un teléfono que la olvide. Se puede endurecer a permanente cuando esto lleve meses en
  // pie y ya no queden accesos directos viejos.
  async redirects() {
    return [
      { source: "/clock-in", destination: "/timetracker/clock-in/clock", permanent: false },
      { source: "/clock-in/:path*", destination: "/timetracker/clock-in/:path*", permanent: false },

      // Cuenta y Ajustes de fichaje se fusionaron con las de Time Tracker (#1 de la
      // fusión de vistas). Las pantallas ya no existen, así que sin esto un marcador o
      // un enlace viejo da 404 — y el de Cuenta lo tenía a mano cualquiera que hubiera
      // entrado por el menú de fichaje. Van ANTES de la regla general de arriba no: el
      // orden lo resuelve Next por especificidad de la ruta.
      { source: "/timetracker/clock-in/account", destination: "/timetracker/account", permanent: false },
      { source: "/timetracker/clock-in/settings", destination: "/timetracker/settings", permanent: false },
      // Los sitios se editan ahora en Ajustes, con Google Maps. La pantalla de fichaje
      // era Leaflet y ya no existe; el enlace vivía en el menú del módulo, así que
      // alguien lo tendrá guardado.
      { source: "/timetracker/clock-in/sites", destination: "/timetracker/settings", permanent: false },
      // Las excepciones se partieron en dos por lo que se hace con ellas (D-115): lo que
      // falta por atender está en Pendientes, con el resto de la bandeja, y el historial con
      // sus fotos está en Auditoría. Quien abría esta pantalla venía casi siempre a resolver,
      // así que el enlace viejo lleva a Pendientes.
      { source: "/timetracker/clock-in/exceptions", destination: "/timetracker/team-requests", permanent: false },
      // Las fotos se mudaron a Auditoría en D-109; esta regla faltaba.
      { source: "/timetracker/clock-in/photos", destination: "/timetracker/audit", permanent: false },
      // Tiempo libre, partido igual que las excepciones (D-116): pedirlo y ver en qué quedó
      // está en My Requests; aprobarlo, en Pendientes. El enlace viejo lleva al lado del
      // EMPLEADO porque de las doce personas que lo abrían, once venían a pedir, no a aprobar.
      { source: "/timetracker/clock-in/time-off", destination: "/timetracker/requests", permanent: false },
      // La nómina de fichaje se fusionó con la de Time Tracker (D-117): mismas dos vistas,
      // mismo periodo. OJO: solo la PANTALLA. Las rutas de exportación viven en
      // /timetracker/clock-in/api/reports/* y siguen existiendo — esta regla no las toca
      // porque no empieza por /reports sino por /api.
      { source: "/timetracker/clock-in/reports", destination: "/timetracker/payroll", permanent: false },
      // El horario subió a Time Tracker (D-121), con lo que ahora además deja programar otras
      // semanas — la pantalla vieja solo sabía enseñar la actual. Después pasó a vivir dentro
      // de Asignaciones (D-186): se apunta DIRECTO ahí, y no a /timetracker/schedule, para
      // no encadenar dos redirecciones en un enlace que abre gente desde el móvil.
      { source: "/timetracker/clock-in/schedule", destination: "/timetracker/assignments", permanent: false },
      // Las dos últimas pantallas de gerente que quedaban en fichaje (D-135). El detalle por
      // persona vive ahora dentro de Empleados, desplegable desde su propia fila.
      { source: "/timetracker/clock-in/coverage", destination: "/timetracker/people", permanent: false },
      { source: "/timetracker/clock-in/dashboard", destination: "/timetracker/live", permanent: false },
      // El módulo de fichaje se retiró entero (D-137). Todo lo suyo vive en Time Tracker, así
      // que cualquier enlace guardado —incluida la pantalla de fichar, que es la que más gente
      // tenía a mano— aterriza donde ahora se hace eso mismo.
      { source: "/timetracker/clock-in/team", destination: "/timetracker/settings", permanent: false },
      { source: "/timetracker/clock-in/me", destination: "/timetracker", permanent: false },
      { source: "/timetracker/clock-in/my-schedule", destination: "/timetracker", permanent: false },
      { source: "/timetracker/clock-in/notes", destination: "/timetracker", permanent: false },
      { source: "/timetracker/clock-in/notifications", destination: "/timetracker", permanent: false },
      { source: "/timetracker/clock-in/welcome", destination: "/timetracker", permanent: false },
      { source: "/timetracker/clock-in/clock", destination: "/timetracker", permanent: false },
    ];
  },
};

// org/project/authToken come from SENTRY_ORG / SENTRY_PROJECT / SENTRY_AUTH_TOKEN
// (Vercel env, build-time only) rather than being written here — same rule as
// every other credential in this project.
export default withSentryConfig(nextConfig, {
  widenClientFileUpload: true,
  tunnelRoute: "/monitoring",
  silent: !process.env.CI,
});
