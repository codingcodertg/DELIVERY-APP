"use client";

import { useEffect, useMemo, useState } from "react";
import { useData } from "@/lib/data-provider";
import { usePrefs } from "@/lib/prefs";
import { createClient } from "@/lib/supabase/client";
import { orderLabel } from "@/lib/utils";
import { faltaLaTabla, leeEncuestasLocales, resumenDeEncuestas, veEncuestas, type FilaDeEncuesta } from "@/lib/encuesta";
import type { Delivery } from "@/lib/types";

/**
 * «Satisfacción del cliente» en el Panel (D-418, 151): lo que los clientes contestaron en la página de seguimiento.
 *
 * Solo admin, logística y gerentes (`veEncuestas`; la política de la 151 dice lo mismo). De qué órdenes: las MISMAS del
 * Panel —sus tiendas (D-396) y su rango—, así que un gerente ve las de su tienda. La base, además, solo le manda las
 * respuestas de las órdenes que puede ver.
 *
 * Sin la tabla (la 151 sin aplicar) la tarjeta no sale: no hay nada que enseñar ni que prometer. En el demo, las
 * respuestas viven en el navegador (las guarda la propia página de seguimiento).
 */
const SIN_BASE = process.env.NEXT_PUBLIC_LOCAL_MODE === "true";

export function EncuestaDelPanel({ desde, entregasDelPanel }: { desde: string; entregasDelPanel: readonly Delivery[] }) {
  const { me } = useData();
  const { t } = usePrefs();
  const puedeVer = veEncuestas(me?.role);
  const [filas, setFilas] = useState<FilaDeEncuesta[] | null>(null);
  const [sinTabla, setSinTabla] = useState(false);

  useEffect(() => {
    if (!puedeVer) return;
    let vivo = true;
    void (async () => {
      if (SIN_BASE) { if (vivo) setFilas(leeEncuestasLocales(typeof window === "undefined" ? null : window.localStorage)); return; }
      // Desde el primer día del rango: una respuesta llega DESPUÉS de la entrega, así que ninguna de las del Panel es
      // anterior. Lo que sobra (otras tiendas, otro rango) lo quita `resumenDeEncuestas` con las órdenes del Panel.
      const { data, error } = await createClient().from("delivery_surveys")
        .select("delivery_id, rating, comment, created_at").gte("created_at", `${desde}T00:00:00Z`).limit(2000);
      if (!vivo) return;
      if (error) { setSinTabla(faltaLaTabla(error)); setFilas([]); return; }
      setFilas((data ?? []) as FilaDeEncuesta[]);
    })();
    return () => { vivo = false; };
  }, [puedeVer, desde]);

  const porId = useMemo(() => new Map(entregasDelPanel.map((d) => [d.id, d])), [entregasDelPanel]);
  const r = useMemo(() => resumenDeEncuestas(filas ?? [], new Set(porId.keys())), [filas, porId]);

  if (!puedeVer || sinTabla) return null;
  const estrellas = (n: number) => "★".repeat(n) + "☆".repeat(5 - n);

  return (
    <div className="card" data-encuesta-panel>
      <h2>⭐ {t("Customer satisfaction", "Satisfacción del cliente")}</h2>
      <p className="hint" style={{ marginTop: -6, marginBottom: 10 }}>
        {t(
          "What customers answered on the tracking page once their order was delivered (1-5 stars and an optional comment). Only for the orders in this range and your stores.",
          "Lo que contestaron los clientes en la página de seguimiento al recibir su orden (1-5 estrellas y un comentario opcional). Solo de las órdenes de este rango y de sus tiendas.",
        )}
      </p>
      {filas === null ? (
        <div className="hint">{t("Loading…", "Cargando…")}</div>
      ) : r.respuestas === 0 ? (
        <div className="empty">{t("No answers in this range yet.", "Todavía no hay respuestas en este rango.")}</div>
      ) : (
        <>
          <div style={{ display: "flex", gap: 24, flexWrap: "wrap", alignItems: "baseline" }}>
            <div><span style={{ fontFamily: "Archivo, sans-serif", fontWeight: 800, fontSize: 28 }} data-media>{r.media!.toFixed(1)}</span> <span className="hint">/ 5</span></div>
            <div className="hint" data-respuestas>{t(`${r.respuestas} answer(s)`, `${r.respuestas} respuesta(s)`)}</div>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "auto 1fr auto", gap: "4px 10px", alignItems: "center", maxWidth: 420, marginTop: 8 }}>
            {[5, 4, 3, 2, 1].map((n) => (
              <div key={n} style={{ display: "contents" }}>
                <span style={{ color: "var(--amber)", whiteSpace: "nowrap" }}>{estrellas(n)}</span>
                <span style={{ background: "var(--line)", borderRadius: 4, height: 8, display: "block" }}>
                  <span style={{ background: "var(--amber)", borderRadius: 4, height: 8, display: "block", width: `${(r.reparto[n - 1] / r.respuestas) * 100}%` }} />
                </span>
                <span className="hint" style={{ margin: 0 }}>{r.reparto[n - 1]}</span>
              </div>
            ))}
          </div>
          {r.comentarios.length > 0 && (
            <ul style={{ margin: "12px 0 0", paddingLeft: 18 }} data-comentarios>
              {r.comentarios.slice(0, 10).map((c) => (
                <li key={c.delivery_id} style={{ marginBottom: 4, overflowWrap: "anywhere" }}>
                  <b>#{porId.get(c.delivery_id) ? orderLabel(porId.get(c.delivery_id)!) : "—"}</b>{" "}
                  <span style={{ color: "var(--amber)" }}>{estrellas(c.rating)}</span> — {c.comment}
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  );
}
