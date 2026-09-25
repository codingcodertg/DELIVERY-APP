"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { usePrefs } from "@/lib/prefs";
import { useOrdenYFiltro } from "@/lib/use-orden-y-filtro";
import { useCierraAlSalir } from "@/lib/menu-desplegable";
import { anchoDeTabla, useColWidthMap } from "@/lib/use-col-widths";
import { CabeceraConMenu, FiltrosPuestos, MenuDeColumnaAbierto, type ColumnaConMenu } from "@/components/CabeceraConMenu";
import { BarraSuperior } from "@/components/BarraSuperior";
import { ANCHO_MINIMO, anchosDeUnRol, CLAVE_DE_COLUMNAS_DE_PROMOS, guardaColumnas, hayQueSembrar, leeColumnas, type AnchosPorRol, type ClienteDePrefs, type ColumnasPorRol } from "@/lib/user-prefs";
import type { UserRole } from "@/lib/types";
import {
  cambioEnBloque, clavesDeTiendaDe, columnasDePromos, columnasDePromosPorDefecto, columnasVisiblesDePromos,
  COLOR_DE_ESTADO, COLUMNA_PRIMERA, COLUMNAS_FIJAS, cuentaPorEstado, filasDePromo, filtraPorTienda, textoDePrecio,
  MINIMO_EN_LA_TIENDA, motivoParaNoDecidir, mueveColumnaDePromos, ordenDeColumnasDePromos, puedeDecidir,
  valorParaFiltrar, type DecisionDeGrupo, type EstadoDeDecision, type ProductoDeCatalogo,
} from "@/lib/promos/tabla";

const SIN_BASE = process.env.NEXT_PUBLIC_LOCAL_MODE === "true";

/** La clave del navegador, por rol, igual que la de Órdenes (`claveDelNavegador` de user-prefs). */
const claveDelNavegadorDePromos = (rol: string) => `rtg_promos_columns_${rol}`;
/** Y la del ORDEN (D-385), aparte, como en la fila de la base: `_orden` no es la lista de visibles. */
const claveDelOrdenDePromos = (rol: string) => `rtg_promos_orden_${rol}`;

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
  ronda, productos, decisiones, rol, userId, grupo, esDecisor, esAdmin, gruposDelLibro, rondas, tiendasSinGrupo,
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
  /** Todas las rondas, para el selector que sustituye a la lista que se quitó (D-375). */
  rondas: readonly { id: string; label: string; uploaded_at: string; closed_at: string | null }[];
  /** Tiendas a las que les falta el grupo de promociones. Vacío = no hay nada que avisar. */
  tiendasSinGrupo: readonly string[];
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

  // Las columnas y los ANCHOS de cada persona, en `user_prefs` (migración 141), las dos mitades de
  // la misma fila. La versión anterior tenía las columnas en un `useState` y los anchos solo en el
  // navegador, mientras el comentario decía «como en Órdenes»: ni una cosa ni la otra.
  //
  // LA LECCIÓN DE D-338, QUE ES LO QUE HACE QUE ESTO NO SE ROMPA SOLO: `guardaColumnas` escribe la
  // fila ENTERA, así que guardar una mitad con la otra a medio poner la borra. Por eso hay **un
  // solo escritor**, `escribeLaFila`, que siempre manda las dos tal como están en ese momento;
  // marcar una columna y arrastrar un ancho llaman al mismo sitio.
  const [visibles, setVisibles] = useState<string[]>(() => columnasDePromosPorDefecto(clavesDeTienda, puedeVerPrivadas));
  const [anchosDelRol, setAnchosDelRol] = useState<Record<string, number> | null>(null);
  const visiblesDeLaBase = useRef<ColumnasPorRol | null>(null);
  const anchosDeLaBase = useRef<AnchosPorRol>({});
  // El ORDEN (D-385), la tercera mitad de la misma fila (`_orden`, como Órdenes en D-332). Hasta
  // aquí el escritor mandaba `{}` en su sitio: no borraba nada porque nadie lo escribía. En cuanto
  // alguien ordena, mandar `{}` le borraría el orden al marcar una casilla — así que va lo leído.
  const [ordenDeColumnas, setOrdenDeColumnas] = useState<string[] | null>(null);
  const ordenDeLaBase = useRef<ColumnasPorRol>({});
  const escribeLaFila = () =>
    guardaColumnas(
      createClient() as unknown as ClienteDePrefs, userId!, visiblesDeLaBase.current ?? {},
      CLAVE_DE_COLUMNAS_DE_PROMOS, ordenDeLaBase.current, anchosDeLaBase.current,
    );

  // Lo del navegador primero, para que la elección esté puesta antes de que la base conteste (y
  // para que en demo, donde no hay base, sobreviva a recargar). Lo que llegue de la base lo pisa.
  useEffect(() => {
    if (!rol) return;
    try {
      const crudo = localStorage.getItem(claveDelNavegadorDePromos(rol));
      const lista = crudo ? JSON.parse(crudo) : null;
      if (Array.isArray(lista)) setVisibles(columnasVisiblesDePromos(lista.filter((k) => typeof k === "string"), columnas));
    } catch { /* sin memoria, el defecto */ }
    try {
      const crudo = localStorage.getItem(claveDelOrdenDePromos(rol));
      const lista = crudo ? JSON.parse(crudo) : null;
      if (Array.isArray(lista)) setOrdenDeColumnas(lista.filter((k) => typeof k === "string"));
    } catch { /* sin memoria, el orden del catálogo */ }
  }, [rol]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!userId || !rol || SIN_BASE) return;
    let vivo = true;
    void leeColumnas(createClient() as unknown as ClienteDePrefs, userId, CLAVE_DE_COLUMNAS_DE_PROMOS).then(async (leido) => {
      if (!vivo || !leido.leida) return;
      visiblesDeLaBase.current = leido.columnas;
      anchosDeLaBase.current = leido.anchos;
      ordenDeLaBase.current = leido.orden;
      const suyas = leido.columnas[rol as UserRole];
      if (suyas) setVisibles(columnasVisiblesDePromos(suyas, columnas));
      const suOrden = leido.orden[rol as UserRole];
      if (suOrden) setOrdenDeColumnas(suOrden);
      const suyos = leido.anchos[rol as UserRole];
      if (suyos) setAnchosDelRol(suyos);
      if (leido.hayFila) return;

      // SEMILLA: los anchos que ya se arrastraron en este navegador antes de que esto se guardara
      // por persona. Solo cuando la fila no existe —así no puede pisar nada— y solo si se SABE que
      // no se está suplantando: durante una suplantación la sesión es la del otro, y sembrar le
      // escribiría a esa persona los anchos de este navegador. `hayQueSembrar` exige `false`, no
      // «no se sabe», que es justo la diferencia que importa aquí.
      let delNavegador: Record<string, number> = {};
      try { delNavegador = anchosDeUnRol(JSON.parse(localStorage.getItem("rtg_promos_cols") ?? "{}"), columnas.map((c) => c.key)); } catch { /* sin memoria, sin semilla */ }
      let suplantando: boolean | null = null;
      try { const e = await (await fetch("/api/impersonate/state")).json() as { como?: string }; suplantando = !!e?.como; } catch { /* no se sabe: no se siembra */ }
      const semilla: AnchosPorRol = Object.keys(delNavegador).length ? { [rol as UserRole]: delNavegador } : {};
      if (!vivo || !hayQueSembrar({ baseLeida: true, hayFila: false, suplantando }, {}, semilla)) return;
      anchosDeLaBase.current = semilla;
      setAnchosDelRol(delNavegador);
      void escribeLaFila();
    });
    return () => { vivo = false; };
  }, [userId, rol]); // eslint-disable-line react-hooks/exhaustive-deps

  // El orden de TODAS las columnas para esta persona (D-385), y las que se ven, ya con él. Las
  // dos salen de `lib/promos/tabla`: la pantalla no decide ni el orden ni quién es nueva.
  const ordenDelSelector = ordenDeColumnasDePromos(columnas, ordenDeColumnas);
  const visiblesEfectivas = columnasVisiblesDePromos(visibles, columnas, ordenDeColumnas);

  /**
   * Guardar columnas y orden: **en los dos sitios, y por un solo camino**.
   *
   * `user_prefs` es lo que manda —por persona, vale en cualquier máquina— y **el navegador es la
   * red si la base no contesta**, que es el principio de D-330 y lo que hace Órdenes. Sin él, una
   * lectura fallida le borra a alguien su elección sin decir nada; y en el modo demo, donde no hay
   * base, no habría forma de que sobreviviera a recargar.
   *
   * **Marcar una casilla guarda también el orden** (D-385), tal como está: el orden lista todas
   * las columnas que esa persona tenía delante, y así la tienda que traiga el libro del mes que
   * viene se reconoce como nueva y sale, en vez de quedarse escondida por una lista de septiembre.
   */
  const ponColumnas = (next: string[], nextOrden: string[]) => {
    setVisibles(next);
    setOrdenDeColumnas(nextOrden);
    if (rol) {
      try { localStorage.setItem(claveDelNavegadorDePromos(rol), JSON.stringify(next)); } catch { /* sin memoria, sin red */ }
      try { localStorage.setItem(claveDelOrdenDePromos(rol), JSON.stringify(nextOrden)); } catch { /* sin memoria, sin red */ }
    }
    // A la base solo si se pudo leer: no se escribe a ciegas encima de lo que haya.
    if (!userId || !rol || SIN_BASE || visiblesDeLaBase.current === null) return;
    visiblesDeLaBase.current = { ...visiblesDeLaBase.current, [rol as UserRole]: next };
    ordenDeLaBase.current = { ...ordenDeLaBase.current, [rol as UserRole]: nextOrden };
    void escribeLaFila();
  };
  const ponVisibles = (next: string[]) => ponColumnas(next, ordenDelSelector);

  /**
   * Mover columnas (D-385): flechas ↑ ↓ en ⚙ Columnas, **las de Órdenes** (D-332) — Órdenes no
   * arrastra la cabecera, y en la cabecera el arrastre ya es del asa del ancho. La visibilidad va
   * con él tal como está: reordenar no la pisa.
   */
  const guardaOrden = (nextOrden: string[]) => ponColumnas(visiblesEfectivas, nextOrden);
  const ordenDelCatalogo = ordenDeColumnasDePromos(columnas, null);
  // La flecha se apaga cuando pulsarla no movería nada: el tope, o `code`, que no se mueve.
  const seMueve = (clave: string, delta: -1 | 1) =>
    mueveColumnaDePromos(ordenDelSelector, clave, delta, visiblesEfectivas).join() !== ordenDelSelector.join();

  const alternaColumna = (key: string) => {
    if (COLUMNAS_FIJAS.includes(key)) return;
    ponVisibles(columnasVisiblesDePromos(
      visiblesEfectivas.includes(key) ? visiblesEfectivas.filter((k) => k !== key) : [...visiblesEfectivas, key],
      columnas,
    ));
  };

  // «⚙ Columnas» se cierra con un clic fuera o con Escape (D-275), como en Órdenes.
  const [showCols, setShowCols] = useState(false);
  const colsRef = useRef<HTMLDivElement>(null);
  // La caja de la tabla, que mueve también la barra de arriba (D-NEXT), como en Órdenes.
  const cajaRef = useRef<HTMLDivElement>(null);
  useCierraAlSalir(showCols, () => setShowCols(false), () => [colsRef.current]);

  // El ancho, al SOLTAR: la misma fila, la otra mitad, y por el mismo escritor.
  const guardaAnchos = (next: Record<string, number>) => {
    if (!userId || !rol || SIN_BASE || visiblesDeLaBase.current === null) return;
    const todos: AnchosPorRol = { ...anchosDeLaBase.current };
    const suyos = anchosDeUnRol(next, columnas.map((c) => c.key));
    if (Object.keys(suyos).length) todos[rol as UserRole] = suyos; else delete todos[rol as UserRole];
    anchosDeLaBase.current = todos;
    void escribeLaFila();
  };

  // Las que se pintan, y EN EL ORDEN DE LA PERSONA: una sola función decide las dos cosas.
  const columnasPintadas = visiblesEfectivas.map((k) => columnas.find((c) => c.key === k)!);
  // Los anchos: arrastrables, y guardados POR PERSONA como en Órdenes desde D-338 — el dueño pidió
  // entonces «resize … and it saves for ever», y aquí «así como Excel, resize sus columnas». El
  // navegador sigue siendo la red de abajo; lo que manda es la fila de esa persona.
  const anchos = useColWidthMap("rtg_promos_cols", 120, {
    deLaPersona: anchosDelRol ?? undefined,
    alCambiar: guardaAnchos,
    minimo: ANCHO_MINIMO,
  });

  // El filtro de tienda (D-385): elegida una, fuera lo que tenga menos de 10 en ELLA. Se aplica
  // ANTES que todo lo demás, así que los contadores de estado, el «N / M» y «seleccionar todo»
  // hablan de la lista ya filtrada — un chip que dijera «Pendiente · 60» sobre una tabla de 22
  // mentiría justo en el número que se mira para saber cuánto falta.
  const [tiendaFiltro, setTiendaFiltro] = useState<string>("");
  const todasLasFilas = useMemo(() => filasDePromo(productos, decisiones, grupoActivo), [productos, decisiones, grupoActivo]);
  const filas = useMemo(
    () => filtraPorTienda(todasLasFilas, tiendaFiltro, clavesDeTienda),
    [todasLasFilas, tiendaFiltro, clavesDeTienda],
  );
  const orden = useOrdenYFiltro(filas, valorParaFiltrar);
  const cuenta = cuentaPorEstado(filas);

  const columnasConMenu: ColumnaConMenu[] = columnasPintadas.map((c) => ({ key: c.key, en: c.en, es: c.es }));

  const alterna = (code: string) =>
    setSeleccion((s) => { const n = new Set(s); if (n.has(code)) n.delete(code); else n.add(code); return n; });
  const todasVisiblesSeleccionadas = orden.visibles.length > 0 && orden.visibles.every((f) => seleccion.has(f.code));

  // Sin nota (D-387): la tabla ya no la enseña ni la edita, así que ninguna escritura la toca.
  const guarda = async (codigos: string[], estado: EstadoDeDecision) => {
    if (!sePuede || !grupoActivo || codigos.length === 0) return;
    setOcupado(true); setError(null);
    const filasAEscribir = cambioEnBloque({ roundId: ronda.id, grupo: grupoActivo, codigos, estado });
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

  // El texto de una celda, para pintarlo y para el `title`. El estado se pinta aparte: es pastilla.
  const textoDeCelda = (fila: (typeof filas)[number], clave: string) => {
    if (clave.startsWith("qoh_")) { const v = fila.porTienda[clave.slice(4)]; return v == null ? "—" : String(v); }
    if (clave === "estado") return t(ETIQUETA_ESTADO[fila.estado].en, ETIQUETA_ESTADO[fila.estado].es);
    if (clave === "price") return textoDePrecio(fila.price);
    const v = (fila as unknown as Record<string, unknown>)[clave];
    return v === null || v === undefined || v === "" ? "—" : String(v);
  };

  const celda = (fila: (typeof filas)[number], clave: string) => {
    const texto = textoDeCelda(fila, clave);
    if (clave !== "estado") return texto;
    // La PASTILLA, con las clases de Órdenes y su mismo corte con puntos (D-364): el estado en
    // texto plano era la diferencia que más se veía al poner las dos tablas al lado, y el dueño
    // pidió «the style of the order table in deliveries». El color sale de la paleta de las etapas,
    // no de aquí.
    return (
      <span className="sema" title={texto} style={{ background: COLOR_DE_ESTADO[fila.estado], color: "#fff" }}>{texto}</span>
    );
  };

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <h1 style={{ margin: 0 }}>🏷️ {ronda.label}</h1>
        {rondaCerrada && <span className="sema" style={{ background: "var(--gray)", color: "#fff" }}>{t("Closed", "Cerrada")}</span>}
        {/* El selector que sustituye a la lista de rondas (D-375). Solo sale si hay MAS DE UNA:
            con una sola ronda seria un desplegable de un elemento, que es justo el clic de mas que
            el dueno mando quitar. Es un `<select>` y no enlaces porque las rondas crecen con los
            meses y una fila de enlaces se hace larga sola. */}
        {rondas.length > 1 && (
          <select
            value={ronda.id}
            aria-label={t("Round", "Ronda")}
            style={{ maxWidth: 260 }}
            onChange={(e) => { if (e.target.value !== ronda.id) router.push(`/promos/${e.target.value}`); }}
          >
            {rondas.map((r) => (
              <option key={r.id} value={r.id}>
                {r.label}{r.closed_at ? t(" · closed", " · cerrada") : ""}
              </option>
            ))}
          </select>
        )}
        {esAdmin && (
          <button onClick={() => cierraOReabre(!rondaCerrada)} disabled={ocupado}>
            {rondaCerrada ? t("Reopen round", "Reabrir ronda") : t("Close round", "Cerrar ronda")}
          </button>
        )}
      </div>

      {/* El aviso de los grupos de tienda: SOLO al admin y SOLO si falta alguno, y diciendo cual.
          Antes se ensenaba siempre, en la pantalla que ya no existe; un aviso permanente sobre algo
          que ya esta hecho deja de leerse, y entonces tampoco se lee el dia que si falta. */}
      {esAdmin && tiendasSinGrupo.length > 0 && (
        <div className="card" style={{ borderColor: "var(--amber)", marginTop: 10 }}>
          {t(
            `These stores have no promo group, so nobody there can approve: ${tiendasSinGrupo.join(", ")}. Set it in Data → Stores.`,
            `Estas tiendas no tienen grupo de promociones, así que nadie de ellas puede aprobar: ${tiendasSinGrupo.join(", ")}. Se pone en Datos → Tiendas.`,
          )}
        </div>
      )}

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
        {/* El filtro de tienda (D-385). Hasta aquí NO existía: lo único con «tienda» era el menú de
            cabecera de cada columna de existencias, que filtra por VALOR exacto —una casilla por
            cada número distinto— y así quitar «menos de 10» era desmarcar los números uno a uno. */}
        {clavesDeTienda.length > 0 && (
          <select
            value={tiendaFiltro}
            aria-label={t("Store filter", "Filtro de tienda")}
            style={{ maxWidth: 220 }}
            onChange={(e) => { setTiendaFiltro(e.target.value); setSeleccion(new Set()); }}
          >
            <option value="">{t("All stores", "Todas las tiendas")}</option>
            {clavesDeTienda.map((k) => (
              <option key={k} value={k}>{t(`${k}: ${MINIMO_EN_LA_TIENDA}+ in stock`, `${k}: ${MINIMO_EN_LA_TIENDA} o más`)}</option>
            ))}
          </select>
        )}
        <span className="hint">{orden.visibles.length} / {filas.length}</span>
        {todasLasFilas.length > filas.length && (
          <span className="hint">
            {t(
              `${todasLasFilas.length - filas.length} hidden: under ${MINIMO_EN_LA_TIENDA} in ${tiendaFiltro}`,
              `${todasLasFilas.length - filas.length} ocultos: menos de ${MINIMO_EN_LA_TIENDA} en ${tiendaFiltro}`,
            )}
          </span>
        )}
        {/* El MISMO «⚙ Columnas» de Órdenes y del Gestor, con su `.col-menu` y su cierre al pulsar
            fuera o con Escape (D-275). Era un `<details>` nativo, que se veía distinto de todo lo
            demás justo en la pantalla a la que el dueño pidió parecerse. */}
        <div ref={colsRef} style={{ position: "relative" }}>
          <button className="btn btn-ghost" onClick={() => setShowCols((v) => !v)}>⚙ {t("Columns", "Columnas")}</button>
          {showCols && (
            <div className="col-menu">
              <div className="col-menu-head">
                <b>{t("Show and order columns", "Mostrar y ordenar columnas")}</b>
                <button className="notif-clear" onClick={() => ponVisibles(columnasDePromosPorDefecto(clavesDeTienda, puedeVerPrivadas))}>
                  {t("Reset", "Restablecer")}
                </button>
                {ordenDelSelector.join() !== ordenDelCatalogo.join() && <button className="notif-clear" onClick={() => guardaOrden(ordenDelCatalogo)}>{t("Reset order", "Restablecer orden")}</button>}
              </div>
              {/* En el orden de la persona, con las flechas de Órdenes (D-332). `code` no lleva
                  flechas activas: va siempre primera. */}
              {ordenDelSelector.map((k) => columnas.find((c) => c.key === k)!).map((c) => (
                <div key={c.key} style={{ display: "flex", alignItems: "center", gap: 4 }}>
                  <label className="col-opt" style={{ flex: 1 }}>
                    <input
                      type="checkbox"
                      checked={visiblesEfectivas.includes(c.key)}
                      disabled={COLUMNAS_FIJAS.includes(c.key)}
                      onChange={() => alternaColumna(c.key)}
                    />
                    {lang === "es" ? c.es : c.en}
                  </label>
                  <button type="button" className="btn btn-ghost btn-sm" disabled={c.key === COLUMNA_PRIMERA || !seMueve(c.key, -1)} aria-label={t(`Move ${c.en} up`, `Subir ${c.es}`)} onClick={() => guardaOrden(mueveColumnaDePromos(ordenDelSelector, c.key, -1, visiblesEfectivas))}>↑</button>
                  <button type="button" className="btn btn-ghost btn-sm" disabled={c.key === COLUMNA_PRIMERA || !seMueve(c.key, 1)} aria-label={t(`Move ${c.en} down`, `Bajar ${c.es}`)} onClick={() => guardaOrden(mueveColumnaDePromos(ordenDelSelector, c.key, 1, visiblesEfectivas))}>↓</button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {sePuede && seleccion.size > 0 && (
        <div className="card" style={{ marginBottom: 10, display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <b>{t(`${seleccion.size} selected`, `${seleccion.size} seleccionados`)}</b>
          {/* Aprobar VERDE y rechazar ROJO, aqui y en cada fila, con las clases de la paleta
              (`btn-green` / `btn-danger`, que salen de --green y --red). Antes aprobar era el azul
              de `primary` y rechazar un boton igual que «Limpiar»: el color no distinguia lo que se
              iba a hacer, y son las dos acciones de la pantalla. Dejar pendiente se queda neutro a
              proposito — es deshacer, no una tercera decision. */}
          <button className="btn btn-green" disabled={ocupado} onClick={() => guarda([...seleccion], "approved")}>✓ {t("Approve", "Aprobar")}</button>
          <button className="btn btn-danger" disabled={ocupado} onClick={() => guarda([...seleccion], "rejected")}>✕ {t("Reject", "Rechazar")}</button>
          <button className="btn btn-ghost" disabled={ocupado} onClick={() => guarda([...seleccion], "pending")}>{t("Back to pending", "Dejar pendiente")}</button>
          <button className="btn btn-ghost" onClick={() => setSeleccion(new Set())}>{t("Clear", "Limpiar")}</button>
        </div>
      )}

      <FiltrosPuestos estado={orden} columnas={columnasConMenu} lang={lang} t={t} />
      {/* La MISMA tabla de Ordenes, no una parecida: sus clases, su `colgroup`, sus asas de
          arrastre y su corte con puntos (D-338/D-344/D-345).
          SIN alto propio, y eso se midio: la de Ordenes NO tiene desplazamiento vertical propio
          —quien baja es la pagina— y lo que da la sensacion de «cabe en una pantalla» es no
          salirse de LADO (la caja se desplaza sola) mas la cabecera pegada. Acotarle el alto seria
          hacer mas que la referencia, y el dueno pidio el estilo de Ordenes.
          CAMBIADO por D-NEXT, y sigue siendo la misma regla: «como Ordenes». Esa medida decia que la
          cabecera estaba pegada, y no lo estaba (se iba con la pagina). Ahora Ordenes lleva alto propio
          (`tbl-caja`) y la barra de arriba, y esta tabla las lleva porque las lleva la referencia. */}
      <BarraSuperior caja={cajaRef} />
      <div className="tbl-scroll tbl-fit orders-scroll tbl-caja" ref={cajaRef}>
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
                  // Y `title` con el texto entero: la celda corta con puntos (`tbl-resize`), y aquí
                  // la descripción es el NOMBRE del producto que hay que reconocer para decidir.
                  // Sin esto no hay forma de leerlo salvo ensanchando la columna.
                  <td
                    key={c.key}
                    data-label={lang === "es" ? c.es : c.en}
                    title={c.key === "estado" ? undefined : textoDeCelda(f, c.key)}
                    className={c.key === "estado" ? "td-pastillas" : undefined}
                    style={{ textAlign: c.numero ? "right" : undefined }}
                  >
                    {celda(f, c.key)}
                  </td>
                ))}
                {sePuede && (
                  <td>
                    <span style={{ display: "flex", gap: 4 }}>
                      <button className="btn btn-sm btn-green" disabled={ocupado || f.estado === "approved"} onClick={() => guarda([f.code], "approved")} title={t("Approve", "Aprobar")} aria-label={t("Approve", "Aprobar")}>✓</button>
                      <button className="btn btn-sm btn-danger" disabled={ocupado || f.estado === "rejected"} onClick={() => guarda([f.code], "rejected")} title={t("Reject", "Rechazar")} aria-label={t("Reject", "Rechazar")}>✕</button>
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
