"use client";

import Link from "next/link";
import { usePrefs } from "@/lib/prefs";
import { Encuestas } from "./Encuestas";
import { TarjetasAdmin } from "@/components/tarjetas/TarjetasAdmin";
import type { ClaveTipoQr, TipoQr } from "@/lib/qr-codes/tipos";

/**
 * La app «QR Codes» (antes «Surveys»; la ruta /surveys y la clave del módulo no cambian).
 *
 * Sin `?tipo=` se ve un selector: una tarjeta grande por tipo de QR, con su descripción y su cuenta. Con `?tipo=…` se
 * abre esa sección, con un «← QR Codes» para volver al selector. Si quien mira solo tiene un tipo (quien no es admin),
 * no hay selector: entra directo a esa sección. Cada tarjeta es un enlace de verdad (`/surveys?tipo=…`), así que se
 * puede compartir y abrir en otra pestaña.
 */
export function QrCodesApp({ demo, tiendas, visibles, tipo, conteos }: {
  demo: boolean;
  tiendas: string[];
  visibles: readonly TipoQr[];
  tipo: ClaveTipoQr | null;
  conteos: Partial<Record<ClaveTipoQr, number | null>>;
}) {
  const { t } = usePrefs();

  if (!tipo) {
    return (
      <section className="qr-selector" aria-label={t("Choose a QR type", "Elige un tipo de QR")}>
        {visibles.map((x) => {
          const n = conteos[x.clave];
          const linea = n == null ? null : x.clave === "tarjetas"
            ? t(`${n} active cards`, `${n} tarjetas activas`)
            : t(`${n} responses`, `${n} respuestas`);
          return (
            <Link key={x.clave} href={`/surveys?tipo=${x.clave}`} className="qr-tile" data-tipo={x.clave}>
              <span className="qr-tile-emoji" aria-hidden="true">{x.emoji}</span>
              <span className="qr-tile-titulo">{t(x.titulo_en, x.titulo_es)}</span>
              <span className="qr-tile-desc">{t(x.descripcion_en, x.descripcion_es)}</span>
              {linea && <span className="qr-tile-cuenta">{linea}</span>}
            </Link>
          );
        })}
      </section>
    );
  }

  return (
    <>
      {visibles.length > 1 && (
        <Link href="/surveys" className="btn btn-ghost btn-sm qr-volver" data-volver-selector>
          ← {t("QR Codes", "QR Codes")}
        </Link>
      )}
      {tipo === "tarjetas" ? <TarjetasAdmin /> : <Encuestas demo={demo} tiendas={tiendas} />}
    </>
  );
}
