import type { Metadata, Viewport } from "next";
import "./globals.css";
import { PrefsProvider } from "@/lib/prefs";
import { VersionStamp } from "@/components/VersionStamp";

// Runs before paint to apply the saved theme immediately (no flash). The
// timetracker desktop shell (window.ttDesktop, injected by its Electron
// preload script — available synchronously here, before any page script)
// has no way to have ever saved a preference of its own the first time it
// runs, so it defaulted to light unconditionally like every other fresh
// browser profile — wrong for a dedicated, always-dark-by-design client
// (D-080). Defaults to dark there when nothing's been explicitly chosen yet;
// an explicit choice (light or dark, saved once toggled) always wins.
const themeScript = `try{var p=JSON.parse(localStorage.getItem('rtg_prefs')||'{}');var isDesktop=!!(window.ttDesktop&&window.ttDesktop.isDesktop);var theme=p.theme==='dark'||p.theme==='light'?p.theme:(isDesktop?'dark':'light');document.documentElement.setAttribute('data-theme',theme);if(p.lang){document.documentElement.setAttribute('lang',p.lang);}}catch(e){}`;

export const metadata: Metadata = {
  title: "RDZ Deliveries | Order & Dispatch",
  description: "Delivery order management: sales create orders, the office manager approves, the warehouse fulfills.",
  manifest: "/manifest.webmanifest",
  appleWebApp: { capable: true, statusBarStyle: "default", title: "RDZ Deliveries" },
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
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link
          href="https://fonts.googleapis.com/css2?family=Archivo:wght@500;600;700;800&family=Inter:wght@400;500;600;700&display=swap"
          rel="stylesheet"
        />
      </head>
      <body>
        <PrefsProvider>{children}</PrefsProvider>
        {/* Una sola vez, aquí: es el único layout por el que pasan las cinco apps y el hub. */}
        <VersionStamp />
      </body>
    </html>
  );
}
