import type { Metadata } from "next";
import "./tarjeta.css";

// La tarjeta pública de presentación (NFC). Sin cuenta: la sirve `businesscard.rdztilegroup.com/<slug>` (ver
// `lib/tarjetas/host.ts`) y también `/tarjeta/<slug>` en el dominio del hub, para las pruebas.
export const metadata: Metadata = {
  title: "Rodriguez Tile Group",
  robots: { index: false, follow: false },
  // El layout raíz trae el manifest y la ficha de app iOS del hub: la tarjeta no es una app instalable.
  manifest: null,
  appleWebApp: null,
};

export default function TarjetaLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <link rel="preconnect" href="https://fonts.googleapis.com" />
      <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
      <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Archivo:wdth,wght@62..125,400..900&display=swap" precedence="tarjetas" />
      {children}
    </>
  );
}
