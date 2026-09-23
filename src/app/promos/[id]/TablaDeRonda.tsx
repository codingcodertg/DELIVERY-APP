"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { usePrefs } from "@/lib/prefs";
import { useOrdenYFiltro } from "@/lib/use-orden-y-filtro";
import { anchoDeTabla, useColWidthMap } from "@/lib/use-col-widths";
import { CabeceraConMenu, FiltrosPuestos, MenuDeColumnaAbierto, type ColumnaConMenu } from "@/components/CabeceraConMenu";
import { CLAVE_DE_COLUMNAS_DE_PROMOS, guardaColumnas, leeColumnas, type ClienteDePrefs, type ColumnasPorRol } from "@/lib/user-prefs";
import type { UserRole } from "@/lib/types";
import {
  cambioEnBloque, clavesDeTiendaDe, columnasDePromos, columnasDePromosPorDefecto, columnasVisiblesDePromos,
  COLUMNAS_FIJAS, cuentaPorEstado, filasDePromo, LARGO_DE_NOTA, motivoParaNoDecidir, puedeDecidir,
  valorParaFiltrar, type DecisionDeGrupo, type EstadoDeDecision, type ProductoDeCatalogo,
} from "@/lib/promos/tabla";

const SIN_BASE = process.env.NEXT_PUBLIC_LOCAL_MODE === "true";

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
  ronda, productos, decisiones, rol, userId, grupo, esDecisor, esAdmin, gruposDelLibro,
}: {
  ronda: { id: string; label: string; closed_at: string | null };
  productos: ProductoDeCatalogo[];
  decisiones: DecisionDeGrupo[];
  rol: string | null;
  userId: string | null;
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

  // Las columnas de cada persona, en `user_prefs` (migración 141). La versión anterior las tenía
  // en un `useState` y nada más: se elegían, se veían, y al recargar volvían al defecto — la clave
  // de la 141 estaba declarada y no la usaba nadie. Mismo cableado que el Gestor de Rutas.
  const [visibles, setVisibles] = useState<string[]>(() => columnasDePromosPorDefecto(clavesDeTienda, puedeVerPrivadas));
  const prefsLeidas = useRef<ColumnasPorRol | null>(null);
  useEffect(() => {
    if (!userId || !rol || SIN_BASE) return;
    let vivo = true;
    void leeColumnas(createClient() as unknown as ClienteDePrefs, userId, CLAVE_DE_COLUMNAS_DE_PROMOS).then((leido) => {
      if (!vivo || !leido.leida) return;
      prefsLeidas.current = leido.columnas;
      const suyas = leido.columnas[rol as UserRole];
      if (suyas) setVisibles(columnasVisiblesDePromos(suyas, columnas));
    });
    return () => { vivo = false; };
  }, [userId, rol]); // eslint-disable-line react-hooks/exhaustive-deps

  const alternaColumna = (key: string) => {
    if (COLUMNAS_FIJAS.includes(key)) return;
    const next = columnasVisiblesDePromos(
      visibles.includes(key) ? visibles.filter((k) => k !== key) : [...visibles, key],
      columnas,
    );
    setVisibles(next);
    // A la base solo si se pudo leer: no se escribe a ciegas encima de lo que haya.
    if (!userId || !rol || SIN_BASE || prefsLeidas.current === null) return;
    const todas: ColumnasPorRol = { ...prefsLeidas.current, [rol as UserRole]: next };
    prefsLeidas.current = todas;
    void guardaColumnas(createClient() as unknown as ClienteDePrefs, userId, todas, CLAVE_DE_COLUMNAS_DE_PROMOS);
  };

  const columnasPintadas = columnas.filter((c) => visibles.includes(c.key));
  // Los anchos, arrastrables y recordados, como en Ordenes y en el Gestor (D-338).
  const anchos = useColWidthMap("rtg_promos_cols", 120);

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
                  onChange={() => alternaColumna(c.key)}
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

      <FiltrosPuestos estado={orden} columnas={columnasConMenu} lang={lang} t={t} />
      {/* La MISMA tabla de Ordenes, no una parecida: sus clases, su `colgroup`, sus asas de
          arrastre y su corte con puntos (D-338/D-344/D-345).
          SIN alto propio, y eso se midio: la de Ordenes NO tiene desplazamiento vertical propio
          —quien baja es la pagina— y lo que da la sensacion de «cabe en una pantalla» es no
          salirse de LADO (la caja se desplaza sola) mas la cabecera pegada. Acotarle el alto seria
          hacer mas que la referencia, y el dueno pidio el estilo de Ordenes. */}
      <div className="tbl-scroll tbl-fit orders-scroll">
        <table
          className="orders tbl-resize orders-responsive"
          style={anchoDeTabla([sePuede ? 34 : 0, ...columnasPintadas.map((c) => anchos.widthOf(c.key)), sePuede ? 92 : 0])}
        >
          <colgroup>
            {sePuede && <col style={{ width: 34 }} />}
            {columnasPintadas.map((c) => <col key={c.key} style={{ width: anchos.widthOf(c.key) }} />)}
            {sePuede && <col style={{ width: 92 }} />}
          </colgroup>
          <thead>
            <tr>
              {sePuede && (
                <th>
                  <input
                    type="checkbox"
                    checked={todasVisiblesSeleccionadas}
                    onChange={(e) => setSeleccion(e.target.checked ? new Set(orden.visibles.map((f) => f.code)) : new Set())}
                    style={{ width: 15, height: 15 }}
                  />
                </th>
              )}
              {columnasConMenu.map((c) => (
                <th key={c.key}>
                  <CabeceraConMenu estado={orden} col={c} lang={lang} t={t} />
                  <span
                    className="col-resizer"
                    title={t("Drag to change the width; double-click to reset", "Arrastra para cambiar el ancho; doble clic para restablecer")}
                    onMouseDown={anchos.startResize(c.key)}
                    onDoubleClick={() => anchos.resetCol(c.key)}
                  />
                </th>
              ))}
              {sePuede && <th>{t("Decide", "Decidir")}</th>}
            </tr>
          </thead>
          <tbody>
            {orden.visibles.map((f) => (
              <tr key={f.code} className={sePuede ? "con-casilla" : undefined}>
                {sePuede && (
                  <td className="sel-cell" onClick={(e) => e.stopPropagation()}>
                    <input type="checkbox" checked={seleccion.has(f.code)} onChange={() => alterna(f.code)} style={{ width: 15, height: 15 }} />
                  </td>
                )}
                {columnasPintadas.map((c) => (
                  // `data-label` no es decoracion: es lo que `orders-responsive` usa para
                  // convertir cada fila en una tarjeta con su rotulo en el telefono.
                  <td key={c.key} data-label={lang === "es" ? c.es : c.en} style={{ textAlign: c.numero ? "right" : undefined }}>
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
