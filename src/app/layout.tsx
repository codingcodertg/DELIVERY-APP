import type { Metadata, Viewport } from "next";
import "./globals.css";
import { PrefsProvider } from "@/lib/prefs";
import { VersionStamp } from "@/components/VersionStamp";
import { ImpersonationBanner } from "@/components/ImpersonationBanner";
import { CierreDiario } from "@/components/CierreDiario";
import { HelpButton } from "@/components/HelpButton";
import { ChatFlotante } from "@/components/ChatFlotante";
import { BotonGeneral } from "@/components/BotonGeneral";
import { AvisoDeEnsenanza } from "@/components/AvisoDeEnsenanza";
import { GUION_DE_TEMA } from "@/lib/tema";

// Runs before paint to apply the saved theme immediately (no flash). The
// timetracker desktop shell (window.ttDesktop, injected by its Electron
// preload script — available synchronously here, before any page script)
// has no way to have ever saved a preference of its own the first time it
// runs, so it defaulted to light unconditionally like every other fresh
// browser profile — wrong for a dedicated, always-dark-by-design client
// (D-080). Defaults to dark there when nothing's been explicitly chosen yet;
// an explicit choice (light or dark, saved once toggled) always wins.
// D-490: el guion vive en `lib/tema.ts` (GUION_DE_TEMA) porque ahora hay una tercera opción, «el del
// equipo» (`system`), que pregunta a `matchMedia`; allí una prueba lo ejecuta contra `temaEfectivo`.
const themeScript = GUION_DE_TEMA;

export const metadata: Metadata = {
  title: "RTG Hub | Order & Dispatch",
  description: "Delivery order management: sales create orders, the office manager approves, the warehouse fulfills.",
  manifest: "/manifest.webmanifest",
  appleWebApp: { capable: true, statusBarStyle: "default", title: "RTG Hub" },
  icons: { icon: "/icon.svg", apple: "/icon.svg" },
};

export const viewport: Viewport = {
  themeColor: "#152238",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
        {/* `crossOrigin` en los dos, y no por costumbre (D-513): la foto rápida de Ayuda clona la
            página e incrusta las fuentes leyendo las reglas `@font-face` de esta hoja. Una hoja de
            otro dominio cargada SIN crossorigin no deja leer sus reglas, y entonces la foto sale con
            la fuente del sistema, más ancha: medido en el demo, las pastillas partían el texto en dos
            líneas («57 with no / plan») donde la pantalla lo tenía en una. Google Fonts manda
            `Access-Control-Allow-Origin: *` en la hoja y en los .woff2 (medido el 2026-10-10). El
            preconnect lo lleva también porque una conexión anónima y una con credenciales van por
            piscinas distintas: sin él, el preconnect no serviría a esta hoja. */}
        <link rel="preconnect" href="https://fonts.googleapis.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Archivo:wght@500;600;700;800&family=Inter:wght@400;500;600;700&display=swap"
          rel="stylesheet"
          crossOrigin="anonymous"
        />
      </head>
      <body>
        {/* Antes que nada, y FUERA de `PrefsProvider` a propósito: no usa `usePrefs` porque quien
            lee esto necesita entenderlo aunque la preferencia de idioma cargada sea la de la
            persona en la que se entró, no la suya (D-243). Desde D-516 habla el idioma del
            admin que entró, que le dice `/api/impersonate/state` (D-483 lo había dejado en
            español fijo). Que uno de los dos avisos vaya fuera y el otro dentro no es descuido:
            es que preguntan cosas distintas. */}
        <ImpersonationBanner />
        <PrefsProvider>
          {/* El aviso del modo enseñanza (D-626), encima de todo en las apps que no tienen el suyo: el mismo interruptor
              de la burbuja vale para todas. Dentro de `PrefsProvider` porque habla en el idioma de la persona. */}
          <AvisoDeEnsenanza />
          {children}
          {/* El aviso del cierre de las 18:30 (D-248), aquí por lo mismo que `VersionStamp`:
              es el único layout por el que pasan las cinco apps. No cierra nada — la barrera
              es el middleware.

              DENTRO de `PrefsProvider` y no al lado, que fue mi primer intento: usa `usePrefs`
              para hablar en los dos idiomas, y colgado fuera reventaba el prerender de
              `/recruiting` y `/erp/analytics` con «usePrefs must be used within PrefsProvider».
              No es un detalle de estilo: el build entero fallaba. */}
          <CierreDiario />
          {/* La burbuja de Ayuda (D-530), aquí por lo mismo: es el único layout por el que pasan todas las
              apps, así que es UNA burbuja —el mismo componente, en el mismo sitio y con el mismo
              comportamiento— en Entregas, el hub, Time Tracker, RR. HH., el ERP, Quote Builder, Leads,
              Encuestas y Promociones. Hasta D-530 solo la montaba Entregas. Dentro de `PrefsProvider`
              porque habla en el idioma de la persona; dónde no sale (login, el enlace del cliente…) lo
              decide ella con `ayudaEnLaRuta`. */}
          <HelpButton sinBurbuja />
          {/* La burbuja del chat interno (D-609, 2026-10-20), por lo mismo que la de Ayuda: una en todas las apps, arriba a la
              derecha; dónde no sale lo decide `chatEnLaRuta` (las mismas pantallas sin sesión). Dentro de `PrefsProvider`. */}
          <ChatFlotante sinBurbuja />
          {/* La burbuja GENERAL (D-623, 2026-10-21): la única que se ve abajo a la derecha, en las mismas pantallas que la
              Ayuda. Al pulsarla salen hacia arriba Ayuda y Chat (para todos) y, solo para el admin real, Cambiar usuario,
              Vista móvil y Modo enseñanza. Por eso las dos de arriba van `sinBurbuja`: ella las abre por evento. */}
          <BotonGeneral />
        </PrefsProvider>
        {/* Una sola vez, aquí: es el único layout por el que pasan las cinco apps y el hub. */}
        <VersionStamp />
      </body>
    </html>
  );
}
