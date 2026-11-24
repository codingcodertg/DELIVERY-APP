import { fileURLToPath } from "node:url";
import { dirname } from "node:path";


/**
 * D-596 (2026-10-19): en el build de VERCEL no se repiten el type-check ni el lint. En el CI de GitHub
 * (`.github/workflows/ci.yml`) el type-check SÍ corre (`npx tsc --noEmit`) antes de fusionar un PR, junto con vitest y
 * `next build`. El lint NO está en ci.yml: en Vercel `ignoreDuringBuilds` lo salta, así que el lint solo se comprueba
 * a mano (`npm run lint`) o en local. En Vercel el paso «Linting and checking validity of types» se quedó sin memoria
 * (OOM, SIGKILL) en seis builds el 2026-10-19 —tres de un PR con dos decisiones, uno con un cambio de dos líneas de
 * texto— mientras el CI pasaba en 5 min. `process.env.VERCEL` solo existe en el contenedor de Vercel: en el CI y en
 * local, `next build` sigue comprobando tipos y lint como siempre.
 */
const enVercel = !!process.env.VERCEL;

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  typescript: { ignoreBuildErrors: enVercel },
  eslint: { ignoreDuringBuilds: enVercel },

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
  // Cabeceras de seguridad (auditoría de seguridad, PR 1). Hasta ahora no había ninguna.
  //
  // OJO con dos cosas del propio Hub, por eso NO van más estrictas:
  //  - La preview móvil (`VistaMovil.tsx`) mete el Hub en un iframe del MISMO origen. Por eso
  //    X-Frame-Options va `SAMEORIGIN` (no DENY) y el CSP solo pone `frame-ancestors 'self'`.
  //    El CSP de contenido completo va SOLO en Report-Only (abajo): el layout inyecta un script
  //    inline (el tema), usamos Google Maps y el realtime (wss) de Supabase, y un CSP enforced mal
  //    puesto tumba el Hub a las 7am. Cuando el log de violaciones salga limpio, se pasa a enforced.
  //  - Cámara y GPS se usan (fichaje, fotos de entrega), así que el Permissions-Policy los PERMITE
  //    a sí mismo; lo que no se usa (micrófono, pagos, USB...) va cerrado.
  //  - HSTS SIN `preload`: el dominio es *.vercel.app, que no se puede meter en la lista de precarga.
  //  - COOP `same-origin-allow-popups`: el login de Outlook/Microsoft es por REDIRECCIÓN (no popup),
  //    así que `same` estricto también valdría; se deja `allow-popups` para no romper ventanas que el
  //    Hub abre a propósito (Waze, WhatsApp, PDFs en otra pestaña).
  async headers() {
    // Hosts externos que carga el Hub, sacados de un grep de src/ y public/ (scripts, imágenes, fetch
    // desde el navegador, iframes, fuentes, workers). Lo que se pide desde el servidor (Google Routes,
    // Twilio, Resend, RingCentral...) NO entra aquí: CSP solo gobierna lo que pide el navegador.
    //  - img-src: mapas de Leaflet en CrewMap (server.arcgisonline.com) y OSM en LeafletMap.
    //  - frame-src: tutoriales (YouTube, Loom, Vimeo, Drive /preview) y el PDF de la orden de compra
    //    (URL firmada de Supabase). El iframe de VistaMovil es del mismo origen ('self').
    //  - media-src: los tutoriales en fichero de video (<video>); la URL la pone quien crea el tutorial,
    //    así que puede ser de cualquier host y ese caso quedará como violación en el log.
    const cspDeReporte = (imgExtra = []) => [
      "default-src 'self'",
      "script-src 'self' 'unsafe-inline' https://maps.googleapis.com",
      "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
      "font-src 'self' https://fonts.gstatic.com data:",
      `img-src 'self' data: blob: https://*.googleapis.com https://*.gstatic.com https://*.ggpht.com https://*.google.com https://*.supabase.co https://*.public.blob.vercel-storage.com https://tile.openstreetmap.org https://*.tile.openstreetmap.org https://server.arcgisonline.com${imgExtra.map((h) => " " + h).join("")}`,

      "connect-src 'self' https://*.supabase.co wss://*.supabase.co https://*.googleapis.com https://*.blob.vercel-storage.com",
      "frame-src 'self' blob: https://www.youtube.com https://www.youtube-nocookie.com https://player.vimeo.com https://www.loom.com https://drive.google.com https://*.supabase.co",
      "media-src 'self' blob: https://*.supabase.co https://*.public.blob.vercel-storage.com",
      "worker-src 'self' blob:",
      "manifest-src 'self'",
      "object-src 'none'",
      "base-uri 'self'",
      "form-action 'self'",
      "frame-ancestors 'self'",
    ].join("; ");

    // Las rutas de la tarjeta pública (`/tarjeta/...`, y en el dominio de las tarjetas, `/<slug>`; ver lib/tarjetas) sacan la
    // miniatura del vídeo de i.ytimg.com (`TarjetaPublica.tsx`, fondo del botón de vídeo). Es un host que el hub no usa,
    // así que va SOLO en la cabecera de esas rutas y el hub sigue con su política. El iframe del vídeo (www.youtube.com/embed)
    // ya está en frame-src de todos. Nada más cambia: la política de la tarjeta es la del hub con esa imagen añadida.
    const cspHub = cspDeReporte();
    const cspTarjetas = cspDeReporte(["https://i.ytimg.com"]);

    const seguridad = [
      { key: "X-Frame-Options", value: "SAMEORIGIN" },
      // Enforced: solo frame-ancestors (lo que ya había). El CSP completo va en Report-Only.
      { key: "Content-Security-Policy", value: "frame-ancestors 'self'" },
      { key: "Content-Security-Policy-Report-Only", value: cspHub },
      { key: "Cross-Origin-Opener-Policy", value: "same-origin-allow-popups" },
      { key: "X-Permitted-Cross-Domain-Policies", value: "none" },
      { key: "X-Content-Type-Options", value: "nosniff" },
      { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
      { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
      { key: "Permissions-Policy", value: "geolocation=(self), camera=(self), microphone=(), payment=(), usb=(), magnetometer=(), gyroscope=(), accelerometer=(self)" },
      { key: "X-DNS-Prefetch-Control", value: "on" },
    ];
    return [
      { source: "/:path*", headers: seguridad },
      // Mismo host que HOST_DE_TARJETAS en src/lib/tarjetas/host.ts (el .mjs no puede importarlo; lo fija un test).
      { source: "/:path*", has: [{ type: "host", value: "businesscard.rdztilegroup.com" }], headers: [{ key: "Content-Security-Policy-Report-Only", value: cspTarjetas }] },
      { source: "/tarjeta/:path*", headers: [{ key: "Content-Security-Policy-Report-Only", value: cspTarjetas }] },
    ];
  },

  async redirects() {
    return [
      // G-3 (D-201): un enlace viejo del fichaje daba TRES saltos —/clock-in/X → /timetracker/clock-in/X
      // (el comodín de abajo) → el destino final (la regla de esa pantalla, más abajo) → el login—,
      // justo lo que el comentario de la regla del horario decía querer evitar en el móvil. Las
      // pantallas fusionadas van EXPLÍCITAS aquí, antes del comodín, derivadas una a una de las
      // reglas /timetracker/clock-in/X de abajo (mismo destino), para que /clock-in/X llegue en un
      // salto de configuración: /clock-in/clock → /timetracker, /clock-in/photos → /timetracker/payroll?vista=fotos…
      // Medido sin sesión: /clock-in/clock, /clock-in y /clock-in/photos pasan de 3 a 2 saltos (el
      // segundo es la puerta del layout al login, que no es regla). /clock-in/week sigue en 1. Next
      // resuelve las redirecciones en orden: por eso van antes del comodín.
      { source: "/clock-in/account", destination: "/timetracker/account", permanent: false },
      { source: "/clock-in/settings", destination: "/timetracker/settings", permanent: false },
      { source: "/clock-in/sites", destination: "/timetracker/settings", permanent: false },
      { source: "/clock-in/exceptions", destination: "/timetracker/team-requests", permanent: false },
      { source: "/clock-in/photos", destination: "/timetracker/payroll?vista=fotos", permanent: false },
      { source: "/clock-in/time-off", destination: "/timetracker/requests", permanent: false },
      { source: "/clock-in/reports", destination: "/timetracker/payroll", permanent: false },
      { source: "/clock-in/schedule", destination: "/timetracker/assignments", permanent: false },
      { source: "/clock-in/coverage", destination: "/timetracker/people", permanent: false },
      { source: "/clock-in/dashboard", destination: "/timetracker/live", permanent: false },
      { source: "/clock-in/team", destination: "/timetracker/settings", permanent: false },
      { source: "/clock-in/me", destination: "/timetracker", permanent: false },
      { source: "/clock-in/my-schedule", destination: "/timetracker", permanent: false },
      { source: "/clock-in/notes", destination: "/timetracker", permanent: false },
      { source: "/clock-in/notifications", destination: "/timetracker", permanent: false },
      { source: "/clock-in/welcome", destination: "/timetracker", permanent: false },
      { source: "/clock-in/clock", destination: "/timetracker", permanent: false },
      // La raíz del fichaje: antes iba a /timetracker/clock-in/clock, que a su vez redirigía.
      { source: "/clock-in", destination: "/timetracker", permanent: false },
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
      // sus fotos está en Nómina, sección «Excepciones» (desde 2026-11-24; antes en Auditoría). Quien abría esta pantalla venía casi siempre a resolver,
      // así que el enlace viejo lleva a Pendientes.
      { source: "/timetracker/clock-in/exceptions", destination: "/timetracker/team-requests", permanent: false },
      // Las fotos se mudaron a Auditoría en D-109 y desde 2026-11-24 viven en Nómina, como sección
      // plegada: `?vista=fotos` la abre. Esta regla faltaba.
      { source: "/timetracker/clock-in/photos", destination: "/timetracker/payroll?vista=fotos", permanent: false },
      // Las capturas de escritorio ("Team Diary") pasaron a ser la cuarta vista de Auditoría
      // (D-194) y desde 2026-11-24 son la sección «Capturas de escritorio» de Nómina; quien tenga el enlace guardado aterriza ahí.
      { source: "/timetracker/team-diary", destination: "/timetracker/payroll?vista=capturas", permanent: false },
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

// Sin Sentry desde D-700: el dueño no lo usa, y su subida de source maps era lo último que corría antes de que el
// build de Vercel muriera por memoria (SIGKILL) con cualquier cambio un poco más grande.
export default nextConfig;
