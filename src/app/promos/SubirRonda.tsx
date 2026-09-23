"use client";

import { useRef, useState } from "react";
import type { AvisoPromo } from "@/lib/promos/excel";

interface Vista {
  etiqueta: string;
  nombreDeFichero: string;
  huella: string;
  productos: number;
  sugerencias: number;
  gruposConSugerencias: string[];
  gruposConocidos: string[];
  avisos: AvisoPromo[];
  muestra: { code: string; description: string | null; price: number | null; qoh: number | null; sourceSheet: string; rowNo: number }[];
}

const TITULO_DE_AVISO: Record<string, { es: string; en: string }> = {
  "hoja-ignorada": { es: "Hoja que no es de productos", en: "Not a product sheet" },
  "fila-sin-codigo": { es: "Fila sin código", en: "Row with no code" },
  "codigo-repetido": { es: "Código repetido", en: "Duplicate code" },
  "sugerido-fuera-del-universo": { es: "Sugerido y no listado", en: "Suggested but not listed" },
  "grupo-sin-hoja": { es: "Grupo sin hoja", en: "Group with no sheet" },
};

/**
 * Subir una ronda, en **dos pasos y con los avisos delante**.
 *
 * El primer botón llama a `preview`, que analiza y **no escribe nada**. Solo cuando lo analizado
 * está en pantalla —cuántos productos, qué sugiere cada grupo, y sobre todo **qué decidió no meter
 * el lector y por qué**— se habilita el segundo, que es el que escribe.
 *
 * No es adorno: el libro real trae tres filas con descripción y sin código, cinco productos con el
 * costo en blanco y hojas que no son de productos. Confirmar sin ver eso sería subir una ronda a
 * ciegas y descubrirlo cuando alguien pregunte por qué falta un producto.
 *
 * El mismo fichero se manda las dos veces: el servidor lo vuelve a leer él. La `huella` que devolvió
 * `preview` viaja con la confirmación, y si no casa con lo que el servidor lee ahora, no escribe —
 * es lo que caza haberse equivocado de fichero entre un paso y el otro.
 */
export function SubirRonda() {
  const entrada = useRef<HTMLInputElement>(null);
  const [etiqueta, setEtiqueta] = useState("");
  const [vista, setVista] = useState<Vista | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [hecho, setHecho] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState<null | "analizando" | "guardando">(null);

  const ficheroElegido = () => entrada.current?.files?.[0] ?? null;

  const analiza = async () => {
    const f = ficheroElegido();
    setError(null); setHecho(null); setVista(null);
    if (!f) { setError("Elige un fichero primero. / Pick a file first."); return; }
    setOcupado("analizando");
    try {
      const cuerpo = new FormData();
      cuerpo.append("file", f);
      if (etiqueta.trim()) cuerpo.append("label", etiqueta.trim());
      const res = await fetch("/api/promos/preview", { method: "POST", body: cuerpo });
      const b = await res.json().catch(() => ({}));
      if (!res.ok || !b.ok) setError(String(b.error ?? res.status));
      else setVista(b as Vista);
    } catch { setError("Error de red. / Network error."); }
    setOcupado(null);
  };

  const confirma = async () => {
    const f = ficheroElegido();
    if (!vista) return;
    setError(null);
    if (!f) { setError("El fichero ya no está elegido; vuelve a analizarlo. / The file is no longer selected; preview it again."); return; }
    setOcupado("guardando");
    try {
      const cuerpo = new FormData();
      cuerpo.append("file", f);
      cuerpo.append("label", vista.etiqueta);
      // Lo que se confirma tiene que ser lo que se vio: el servidor recalcula esta huella al leer
      // el fichero otra vez, y si no casa no escribe.
      cuerpo.append("huella", vista.huella);
      const res = await fetch("/api/promos/commit", { method: "POST", body: cuerpo });
      const b = await res.json().catch(() => ({}));
      if (!res.ok || !b.ok) setError(String(b.error ?? res.status));
      else {
        setHecho(`«${b.etiqueta}» · ${b.productos} productos · ${b.sugerencias} sugerencias`);
        setVista(null);
        if (entrada.current) entrada.current.value = "";
        setEtiqueta("");
      }
    } catch { setError("Error de red. / Network error."); }
    setOcupado(null);
  };

  return (
    <div className="card" style={{ marginTop: 16 }}>
      <div className="section-label">Subir una ronda / Upload a round</div>

      <div className="grid g2" style={{ marginTop: 8 }}>
        <div className="field">
          <label>Fichero .xlsx / .xlsx file</label>
          <input ref={entrada} type="file" accept=".xlsx" onChange={() => { setVista(null); setHecho(null); setError(null); }} />
        </div>
        <div className="field">
          <label>Nombre de la ronda / Round name</label>
          <input
            value={etiqueta}
            placeholder="Si lo dejas vacío, el del fichero / Empty = the file's name"
            onChange={(e) => setEtiqueta(e.target.value)}
          />
        </div>
      </div>

      <div style={{ display: "flex", gap: 8, marginTop: 10, flexWrap: "wrap" }}>
        <button onClick={analiza} disabled={ocupado !== null}>
          {ocupado === "analizando" ? "Analizando…" : "1 · Analizar (no guarda nada) / Preview (writes nothing)"}
        </button>
        <button onClick={confirma} disabled={ocupado !== null || !vista} className="primary">
          {ocupado === "guardando" ? "Guardando…" : "2 · Confirmar y guardar / Confirm and save"}
        </button>
      </div>

      {error && <div className="card" style={{ borderColor: "var(--red)", marginTop: 10 }}>{error}</div>}
      {hecho && <div className="card" style={{ borderColor: "var(--green)", marginTop: 10 }}>Ronda guardada / Round saved: {hecho}</div>}

      {vista && (
        <div style={{ marginTop: 12 }}>
          <p style={{ marginBottom: 6 }}>
            <b>{vista.etiqueta}</b> — {vista.productos} productos, {vista.sugerencias} sugerencias
            {vista.gruposConSugerencias.length > 0 && <> en {vista.gruposConSugerencias.length} grupo(s): {vista.gruposConSugerencias.join(", ")}</>}
          </p>

          {vista.gruposConocidos.length === 0 && (
            <div className="card" style={{ borderColor: "var(--amber)" }}>
              Ninguna tienda tiene grupo de promociones todavía, así que el libro entero entra como
              catálogo y no hay sugerencias por tienda. Se pone en <b>Datos → Tiendas</b>.
              <br />
              <span className="hint">
                No store has a promo group yet, so the whole workbook is loaded as the catalog with no
                per-store suggestions. Set it in <b>Data → Stores</b>.
              </span>
            </div>
          )}

          <div className="section-label" style={{ marginTop: 10 }}>
            Lo que NO se va a guardar, y por qué / What will NOT be saved, and why ({vista.avisos.length})
          </div>
          {vista.avisos.length === 0 ? (
            <p className="hint">Nada: todas las filas del libro se pudieron leer. / Nothing: every row could be read.</p>
          ) : (
            <ul style={{ margin: "6px 0 0", paddingLeft: 18 }}>
              {vista.avisos.map((a, i) => (
                <li key={i}>
                  <b>{TITULO_DE_AVISO[a.tipo]?.es ?? a.tipo}</b> — {a.hoja}
                  {a.fila != null && <>, fila {a.fila}</>}: {a.detalle}
                </li>
              ))}
            </ul>
          )}

          <details style={{ marginTop: 10 }}>
            <summary>Ver los {vista.muestra.length} productos leídos / See the {vista.muestra.length} products read</summary>
            <div style={{ maxHeight: 320, overflow: "auto", marginTop: 8 }}>
              <table>
                <thead>
                  <tr><th>Código</th><th>Descripción</th><th>QOH</th><th>Precio</th><th>Hoja</th><th>Fila</th></tr>
                </thead>
                <tbody>
                  {vista.muestra.map((p) => (
                    <tr key={`${p.sourceSheet}:${p.rowNo}:${p.code}`}>
                      <td>{p.code}</td><td>{p.description ?? "—"}</td><td>{p.qoh ?? "—"}</td>
                      <td>{p.price ?? "—"}</td><td>{p.sourceSheet}</td><td>{p.rowNo}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="hint" style={{ marginBottom: 0 }}>
              El costo y el margen no viajan hasta aquí: para comprobar que el libro se leyó bien no
              hacen falta. / Cost and margin are not sent here: they aren&apos;t needed to check the
              file parsed correctly.
            </p>
          </details>
        </div>
      )}
    </div>
  );
}
