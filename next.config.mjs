import { withSentryConfig } from "@sentry/nextjs";

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,

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
