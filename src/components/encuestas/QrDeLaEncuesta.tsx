"use client";

import { useEffect, useState } from "react";
import QRCode from "qrcode";
import { usePrefs } from "@/lib/prefs";
import { archivoDelQr, enlaceDeTienda } from "@/lib/encuestas/qr";

/**
 * El QR de un enlace, dibujado en el navegador (D-724). Hasta que está, un hueco del mismo tamaño para que nada salte.
 */
export function ImagenQr({ texto, alt, tamano = 96 }: { texto: string; alt: string; tamano?: number }) {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    let vivo = true;
    QRCode.toDataURL(texto, { width: 512, margin: 1, errorCorrectionLevel: "M" })
      .then((s) => { if (vivo) setSrc(s); })
      .catch(() => { if (vivo) setSrc(null); });
    return () => { vivo = false; };
  }, [texto]);
  if (!src) return <div aria-hidden="true" style={{ width: tamano, height: tamano, borderRadius: 8, border: "1px solid var(--line)", flex: "0 0 auto" }} />;
  return <img src={src} alt={alt} width={tamano} height={tamano} data-qr style={{ borderRadius: 8, border: "1px solid var(--line)", flex: "0 0 auto" }} />;
}

/**
 * Una tarjeta por enlace: el QR, el enlace y «Copiar», «Abrir», «Descargar QR». Sin tienda es la general (el mismo
 * enlace que el QR que ya está impreso, D-496); con tienda, la de esa tienda.
 */
export function TarjetaQr({ tienda }: { tienda: string | null }) {
  const { t } = usePrefs();
  const [copiado, setCopiado] = useState(false);
  const [src, setSrc] = useState<string | null>(null);
  const enlace = enlaceDeTienda(tienda);
  useEffect(() => {
    let vivo = true;
    setCopiado(false);
    QRCode.toDataURL(enlace, { width: 1024, margin: 2, errorCorrectionLevel: "M" })
      .then((s) => { if (vivo) setSrc(s); })
      .catch(() => { if (vivo) setSrc(null); });
    return () => { vivo = false; };
  }, [enlace]);
  const titulo = tienda ?? t("General (no store)", "General (sin tienda)");
  return (
    <div className="card" data-qr-tienda={tienda ?? ""} style={{ display: "flex", gap: 14, alignItems: "center", flexWrap: "wrap" }}>
      <ImagenQr texto={enlace} alt={t("Survey QR code", "Código QR de la encuesta") + (tienda ? ` · ${tienda}` : "")} />
      <div style={{ flex: "1 1 220px", minWidth: 0 }}>
        <div style={{ fontWeight: 700 }}>{tienda ? "🏬" : "🔗"} {titulo}</div>
        <a href={enlace} target="_blank" rel="noopener noreferrer" style={{ wordBreak: "break-all", fontSize: 14 }}>{enlace}</a>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 8 }}>
          <button type="button" className="btn btn-primary btn-sm" data-copiar-enlace onClick={() => {
            void navigator.clipboard?.writeText(enlace).then(() => setCopiado(true), () => setCopiado(false));
          }}>{copiado ? `✓ ${t("Copied", "Copiado")}` : `📋 ${t("Copy link", "Copiar enlace")}`}</button>
          <a className="btn btn-ghost btn-sm" href={enlace} target="_blank" rel="noopener noreferrer">↗ {t("Open", "Abrir")}</a>
          {src && <a className="btn btn-ghost btn-sm" href={src} download={archivoDelQr(tienda)} data-descargar-qr>⬇ {t("Download QR", "Descargar QR")}</a>}
        </div>
      </div>
    </div>
  );
}
