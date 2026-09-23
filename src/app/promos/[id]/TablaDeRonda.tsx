"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { usePrefs } from "@/lib/prefs";
import { useOrdenYFiltro } from "@/lib/use-orden-y-filtro";
import { CabeceraConMenu, MenuDeColumnaAbierto, type ColumnaConMenu } from "@/components/CabeceraConMenu";
import {
  cambioEnBloque, clavesDeTiendaDe, columnasDePromos, columnasDePromosPorDefecto, COLUMNAS_FIJAS,
  cuentaPorEstado, filasDePromo, LARGO_DE_NOTA, motivoParaNoDecidir, puedeDecidir, valorParaFiltrar,
  type DecisionDeGrupo, type EstadoDeDecision, type ProductoDeCatalogo,
} from "@/lib/promos/tabla";

/**
 * La tabla de una ronda: decidir producto por producto o en bloque.
 *
 * Lo que decide **no vive aquí**: las columnas, el valor de cada celda, el estado de cada producto,
 * si se puede decidir y qué filas se escriben salen de `lib/promos/tabla`, probado sin navegador.
 * Ordenar y filtrar por columna son los de D-360 (`useOrdenYFiltro` + `CabeceraConMenu`), los mismos
 * que usan Órdenes y el Gestor de Rutas: mismo gesto y mismo menú, no una tercera versión.
 *
 * **Un `upsert` y no un `insert` o un `update`**: la clave primaria de `promo_decisions` es
 * `(round_id, code, group_code)`, así que un producto sin decidir todavía no tiene fila y uno ya
 * decidido la tiene. Preguntarlo desde aquí sería un `if` que se puede equivocar.
 *
 * **Y se comprueba cuántas filas volvieron.** Un `update` que la RLS no deja pasar afecta a cero
 * filas y PostgREST responde limpio: sin `.select()`, «guardado» sería una suposición.
 */
export function TablaDeRonda({
  ronda, productos, decisiones, grupo, esDecisor, esAdmin, gruposDelLibro,
}: {
  ronda: { id: string; label: string; closed_at: string | null };
  productos: ProductoDeCatalogo[];
  decisiones: DecisionDeGrupo[];
  rol: string | null;
  grupo: string | null;
  esDecisor: boolean;
  esAdmin: boolean;
  gruposDelLibro: string[];
}) {
  const { lang, t } = usePrefs();
  const router = useRouter();
  const supabase = useMemo(() => createClient(), []);

  // El admin no tiene tienda propia, así que elige de qué grupo mira y decide. Los demás miran el
  // suyo y no hay selector: la RLS solo les deja escribir ahí.
  const [grupoElegido, setGrupoElegido] = useState<string | null>(grupo ?? gruposDelLibro[0] ?? null);
  const grupoActivo = esAdmin ? grupoElegido : grupo;

  const [seleccion, setSeleccion] = useState<Set<string>>(new Set());
  const [ocupado, setOcupado] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notaEditando, setNotaEditando] = useState<{ code: string; texto: string } | null>(null);

  const rondaCerrada = ronda.closed_at !== null;
  const sePuede = puedeDecidir({ esDecisor, grupo: grupoActivo, rondaCerrada });
  const motivo = motivoParaNoDecidir({ esDecisor, grupo: grupoActivo, rondaCerrada });

  // Si el costo llegó o no llegó lo dice el DATO, no una regla copiada de la base.
  const puedeVerPrivadas = productos.length > 0 && productos[0].private !== null;
  const clavesDeTienda = useMemo(() => clavesDeTiendaDe(productos), [productos]);
  const columnas = useMemo(
    () => columnasDePromos(clavesDeTienda, puedeVerPrivadas),
    [clavesDeTienda, puedeVerPrivadas],
  );

  const [visibles, setVisibles] = useState<string[]>(() => columnasDePromosPorDefecto(clavesDeTienda, puedeVerPrivadas));
  const columnasPintadas = columnas.filter((c) => visibles.includes(c.key));

  const filas = useMemo(() => filasDePromo(productos, decisiones, grupoActivo), [productos, decisiones, grupoActivo]);
  const orden = useOrdenYFiltro(filas, valorParaFiltrar);
  const cuenta = cuentaPorEstado(filas);

  const columnasConMenu: ColumnaConMenu[] = columnasPintadas.map((c) => ({ key: c.key, en: c.en, es: c.es }));

  const alterna = (code: string) =>
    setSeleccion((s) => { const n = new Set(s); if (n.has(code)) n.delete(code); else n.add(code); return n; });
  const todasVisiblesSeleccionadas = orden.visibles.length > 0 && orden.visibles.every((f) => seleccion.has(f.code));

  const guarda = async (codigos: string[], estado: EstadoDeDecision, nota?: string | null) => {
    if (!sePuede || !grupoActivo || codigos.length === 0) return;
    setOcupado(true); setError(null);
    const filasAEscribir = cambioEnBloque({ roundId: ronda.id, grupo: grupoActivo, codigos, estado, nota });
    const { data, error: err } = await supabase
      .from("promo_decisions")
      .upsert(filasAEscribir, { onConflict: "round_id,code,group_code" })
      .select("code");
    if (err) setError(err.message);
    else if ((data ?? []).length !== filasAEscribir.length) {
      // Cero filas —o menos de las pedidas— es lo que devuelve la RLS cuando no deja pasar. Sin
      // esto, la pantalla diría «guardado» y no se habría guardado nada.
      setError(t(
        `Saved ${(data ?? []).length} of ${filasAEscribir.length}. The database refused the rest.`,
        `Se guardaron ${(data ?? []).length} de ${filasAEscribir.length}. La base rechazó el resto.`,
      ));
    } else {
      setSeleccion(new Set());
      setNotaEditando(null);
      router.refresh();
    }
    setOcupado(false);
  };

  const cierraOReabre = async (cerrar: boolean) => {
    setOcupado(true); setError(null);
    const { error: err } = await supabase.rpc("promo_set_round_closed", { p_round: ronda.id, p_closed: cerrar });
    if (err) setError(err.message);
    else router.refresh();
    setOcupado(false);
  };

  const celda = (fila: (typeof filas)[number], clave: string) => {
    if (clave.startsWith("qoh_")) return fila.porTienda[clave.slice(4)] ?? "—";
    if (clave === "estado") return t(ETIQUETA_ESTADO[fila.estado].en, ETIQUETA_ESTADO[fila.estado].es);
    if (clave === "nota") return fila.nota ?? "—";
    const v = (fila as unknown as Record<string, unknown>)[clave];
    return v === null || v === undefined || v === "" ? "—" : String(v);
  };

  return (
    <div>
      <div style={{ display: "flex", alignItems: "baseline", gap: 12, flexWrap: "wrap" }}>
        <h1 style={{ margin: 0 }}>🏷️ {ronda.label}</h1>
        {rondaCerrada && <span className="sema" style={{ background: "var(--gray)", color: "#fff" }}>{t("Closed", "Cerrada")}</span>}
        {esAdmin && (
          <button onClick={() => cierraOReabre(!rondaCerrada)} disabled={ocupado}>
            {rondaCerrada ? t("Reopen round", "Reabrir ronda") : t("Close round", "Cerrar ronda")}
          </button>
        )}
      </div>

      {esAdmin && gruposDelLibro.length > 0 && (
        <div className="field" style={{ maxWidth: 260, marginTop: 10 }}>
          <label>{t("Deciding for", "Decidiendo por")}</label>
          <select value={grupoActivo ?? ""} onChange={(e) => { setGrupoElegido(e.target.value || null); setSeleccion(new Set()); }}>
            {gruposDelLibro.map((g) => <option key={g} value={g}>{g}</option>)}
          </select>
        </div>
      )}

      {motivo && <div className="card" style={{ borderColor: "var(--amber)", marginTop: 10 }}>{t(motivo.en, motivo.es)}</div>}
      {error && <div className="card" style={{ borderColor: "var(--red)", marginTop: 10 }}>{error}</div>}

      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", margin: "12px 0" }}>
        {(["pending", "approved", "rejected"] as const).map((e) => (
          <button
            key={e}
            className={orden.filtros.estado?.has(e) ? "primary" : ""}
            onClick={() => (orden.filtros.estado?.has(e) ? orden.limpiar("estado") : orden.aplicar("estado", new Set([e])))}
          >
            {t(ETIQUETA_ESTADO[e].en, ETIQUETA_ESTADO[e].es)} · {cuenta[e]}
          </button>
        ))}
        <span className="hint">{orden.visibles.length} / {filas.length}</span>
        <details>
          <summary>{t("Columns", "Columnas")}</summary>
          <div className="card" style={{ position: "absolute", zIndex: 5, maxHeight: 320, overflow: "auto" }}>
            {columnas.map((c) => (
              <label key={c.key} className="perm-opt" style={{ display: "block" }}>
                <input
                  type="checkbox"
                  checked={visibles.includes(c.key)}
                  disabled={COLUMNAS_FIJAS.includes(c.key)}
                  onChange={(ev) => setVisibles((v) => (ev.target.checked ? [...v, c.key] : v.filter((k) => k !== c.key)))}
                />
                <span>{lang === "es" ? c.es : c.en}</span>
              </label>
            ))}
          </div>
        </details>
      </div>

      {sePuede && seleccion.size > 0 && (
        <div className="card" style={{ marginBottom: 10, display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <b>{t(`${seleccion.size} selected`, `${seleccion.size} seleccionados`)}</b>
          <button className="primary" disabled={ocupado} onClick={() => guarda([...seleccion], "approved")}>{t("Approve", "Aprobar")}</button>
          <button disabled={ocupado} onClick={() => guarda([...seleccion], "rejected")}>{t("Reject", "Rechazar")}</button>
          <button disabled={ocupado} onClick={() => guarda([...seleccion], "pending")}>{t("Back to pending", "Dejar pendiente")}</button>
          <button onClick={() => setSeleccion(new Set())}>{t("Clear", "Limpiar")}</button>
          <span className="hint">{t("Notes are kept: a bulk change only changes the decision.", "Las notas se conservan: un cambio en bloque solo cambia la decisión.")}</span>
        </div>
      )}

      <div className="tbl-scroll">
        <table>
          <thead>
            <tr>
              {sePuede && (
                <th style={{ width: 34 }}>
                  <input
                    type="checkbox"
                    checked={todasVisiblesSeleccionadas}
                    onChange={(e) => setSeleccion(e.target.checked ? new Set(orden.visibles.map((f) => f.code)) : new Set())}
                  />
                </th>
              )}
              {columnasConMenu.map((c) => (
                <th key={c.key}><CabeceraConMenu estado={orden} col={c} lang={lang} t={t} /></th>
              ))}
              {sePuede && <th style={{ width: 150 }}>{t("Decide", "Decidir")}</th>}
            </tr>
          </thead>
          <tbody>
            {orden.visibles.map((f) => (
              <tr key={f.code}>
                {sePuede && <td><input type="checkbox" checked={seleccion.has(f.code)} onChange={() => alterna(f.code)} /></td>}
                {columnasPintadas.map((c) => (
                  <td key={c.key} style={{ textAlign: c.numero ? "right" : undefined }}>
                    {c.key === "nota" && sePuede ? (
                      notaEditando?.code === f.code ? (
                        <span style={{ display: "flex", gap: 4 }}>
                          <input
                            value={notaEditando.texto}
                            maxLength={LARGO_DE_NOTA}
                            autoFocus
                            onChange={(e) => setNotaEditando({ code: f.code, texto: e.target.value })}
                          />
                          <button disabled={ocupado} onClick={() => guarda([f.code], f.estado, notaEditando.texto)}>✓</button>
                          <button onClick={() => setNotaEditando(null)}>✕</button>
                        </span>
                      ) : (
                        <button className="link" onClick={() => setNotaEditando({ code: f.code, texto: f.nota ?? "" })}>
                          {f.nota ?? t("+ note", "+ nota")}
                        </button>
                      )
                    ) : (
                      celda(f, c.key)
                    )}
                  </td>
                ))}
                {sePuede && (
                  <td>
                    <span style={{ display: "flex", gap: 4 }}>
                      {/* SIN nota: estos botones cambian el estado, no la nota. Antes reenviaban
                          `f.nota`, que además de innecesario era una escritura perdida — la nota
                          que esta pantalla leyó pisaría la que otra persona hubiera escrito
                          mientras. La nota solo viaja desde el recuadro de editarla. */}
                      <button disabled={ocupado || f.estado === "approved"} onClick={() => guarda([f.code], "approved")} title={t("Approve", "Aprobar")}>✓</button>
                      <button disabled={ocupado || f.estado === "rejected"} onClick={() => guarda([f.code], "rejected")} title={t("Reject", "Rechazar")}>✕</button>
                    </span>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <MenuDeColumnaAbierto estado={orden} columnas={columnasConMenu} lang={lang} t={t} />
    </div>
  );
}

const ETIQUETA_ESTADO: Record<EstadoDeDecision, { en: string; es: string }> = {
  pending: { en: "Pending", es: "Pendiente" },
  approved: { en: "Approved", es: "Aprobado" },
  rejected: { en: "Rejected", es: "Rechazado" },
};
