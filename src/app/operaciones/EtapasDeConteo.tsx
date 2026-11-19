"use client";

import type { ReactNode } from "react";
import { usePrefs } from "@/lib/prefs";
import { fmtDateTime } from "@/lib/utils";
import { ETAPAS_DE_CONTEO, INFO_DE_ETAPA_DE_CONTEO, etapaHecha, fechaDeEtapaDeConteo, nombreDeEtapaDeConteo, type Conteo, type EstadoDeConteo } from "@/lib/almacen-ops/conteos";

/**
 * Operaciones de almacén (333): la etapa de un conteo con EL MISMO lenguaje visual que la merma (EtapasDeMerma.tsx):
 * el chip `.ops-etapa` con su color y la línea de tiempo `.ops-linea-de-etapas`. Los cinco nombres de Roberto, en orden:
 * Organize, Count, Review, Sign off, Adjust. El color va en `data-etapa-conteo` (operaciones.css).
 */

/** El chip de la etapa: «2. Contar». Sale en la lista de conteos, en la tarjeta y en el informe. */
export function ChipDeEtapaDeConteo({ e }: { e: EstadoDeConteo }) {
  const { lang } = usePrefs();
  const i = INFO_DE_ETAPA_DE_CONTEO[e];
  return (
    <span className="ops-etapa" data-etapa-conteo={e} title={nombreDeEtapaDeConteo(e, lang)}>
      <span className="ops-etapa-nombre">{i.n > 0 ? `${i.n}. ` : ""}{nombreDeEtapaDeConteo(e, lang)}</span>
    </span>
  );
}

/**
 * La línea de tiempo de los cinco pasos (o «Cancelado»). Cada paso hecho dice cuándo y quién; el actual dice qué toca.
 * `nombre` resuelve un id a nombre; `adjunto` pinta una captura o una hoja (la tarjeta tiene los enlaces).
 */
export function LineaDeEtapasDeConteo({ c, nombre, adjunto }: { c: Conteo; nombre: (id: string | null) => string; adjunto?: (ruta: string, alt: string) => ReactNode }) {
  const { t, lang } = usePrefs();
  return (
    <section className="ops-etapas" data-etapas-conteo={c.stage}>
      <ol className="ops-linea-de-etapas">
        {ETAPAS_DE_CONTEO.map((e) => {
          const hecha = etapaHecha(c, e);
          const f = fechaDeEtapaDeConteo(c, e);
          const actual = c.stage === e;
          const info = INFO_DE_ETAPA_DE_CONTEO[e];
          return (
            <li key={e} data-etapa-conteo={e} data-hecha={hecha ? "si" : "no"} className={hecha && !actual ? "hecha" : actual ? "hecha actual" : ""}>
              <span className="ops-etapa-punto" aria-hidden />
              <span className="ops-etapa-texto">
                <strong>{info.n}. {nombreDeEtapaDeConteo(e, lang)}</strong>
                {hecha && !actual && f.at && <span className="ops-etapa-cuando">{t("entered", "entró")} {fmtDateTime(f.at)}{f.by && ` · ${nombre(f.by)}`}</span>}
                {actual && c.stage !== "adjusted" && <span className="ops-etapa-cuando">{lang === "es" ? info.que_es : info.que_en}</span>}
                {e === "organizing" && c.instructions && <span className="ops-nota-fallo">📝 {c.instructions}</span>}
                {e === "review" && hecha && c.orders_note && c.stage !== "review" && <span className="ops-nota-fallo">🗒 {c.orders_note}</span>}
                {e === "sign_off" && c.signed_at && <span className="ops-etapa-cuando" data-firmado>✍️ {t("Signed by", "Firmó")} {c.signed_by_name ?? nombre(c.signed_by)} · {fmtDateTime(c.signed_at)} {c.signed_sheet && adjunto?.(c.signed_sheet, t("Signed sheet", "Hoja firmada"))}</span>}
                {e === "sign_off" && c.sign_note && <span className="ops-nota-fallo">🗒 {c.sign_note}</span>}
                {e === "adjusted" && c.adjusted_at && <span className="ops-etapa-cuando">{fmtDateTime(c.adjusted_at)} · {nombre(c.adjusted_by)}</span>}
                {e === "adjusted" && c.adjustment_shots.map((s) => <span key={s}>{adjunto?.(s, t("ERP screenshot", "Captura del ERP"))}</span>)}
              </span>
            </li>
          );
        })}
        {c.stage === "cancelled" && (
          <li data-etapa-conteo="cancelled" className="hecha">
            <span className="ops-etapa-punto" aria-hidden />
            <span className="ops-etapa-texto"><strong>{t("Cancelled", "Cancelado")}</strong><span className="ops-etapa-cuando">{fmtDateTime(c.cancelled_at)} · {nombre(c.cancelled_by)}{c.cancel_note && ` · ${c.cancel_note}`}</span></span>
          </li>
        )}
      </ol>
    </section>
  );
}
