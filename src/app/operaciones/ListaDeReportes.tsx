"use client";

import { mensajeDeError, mensajeDeErrorAlCargar } from "@/lib/mensaje-de-error";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { HUECO_DE_LA_BARRA } from "@/components/BarraDeApp";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { usePrefs } from "@/lib/prefs";
import { createClient } from "@/lib/supabase/client";
import { fmtDateTime, fmtMoney } from "@/lib/utils";
import { INFO_DE_TIPO, TIPOS, esDeRrhh, type TipoDeReporte } from "@/lib/almacen-ops/tipos";
import { CLAVE_ROMPIO_TEXTO, PASOS, PASO_QUIEN_REPORTO, etiquetaDeOpcion } from "@/lib/almacen-ops/pasos";
import { CerrarX } from "./CerrarX";
import { etiquetaDeEquipoDelReporte } from "@/lib/almacen-ops/mantenimiento";
import { nombreOTexto, personasParaElegir } from "@/lib/almacen-ops/personas";
import { totalesPorTienda } from "@/lib/almacen-ops/perdida";
import { DEMO_PRODUCTOS, origenDeMerma, type TipoDeOrigen, DEMO_REPORTES, agregarFotos, borrarReporteDeMerma, buscarProductos, corregirMerma, corregirOrigenDeMerma, crearGrupoDeMerma, editarReporteDeMerma, enlacesDeFotos, guardarHuellas, listarGrupos, reportesConLaFoto, subirFoto, type ParcheDeMerma, type Reporte } from "@/lib/almacen-ops/datos";
import { esCorteDePractica } from "@/lib/practica/es-corte";
import { borrarPractica, cargaPractica, esGrupoDePractica, grupoDePracticaPorReporte, gruposDePractica } from "@/lib/practica/grupos-de-practica";
import { crearBorradorDeGrupo, esBorradorDeGrupo, listarBorradoresDeGrupo } from "@/lib/almacen-ops/borradores-de-grupo";
import { HojaBorrador } from "./HojaBorrador";
import { ensenanzaDelNavegador } from "@/lib/ensenanza-general";
import { HistorialDeMerma } from "./HistorialDeMerma";
import { avisoYaEnGrupo, esErrorDeYaEnGrupo, estadoDelGrupo, filtrarGrupos, seleccionadasEnGrupo, type FiltroDeGrupos, type GrupoDeMerma } from "@/lib/almacen-ops/grupos";
import { HojaDeGrupo } from "./HojaDeGrupo";
import { HojaImprimible } from "./HojaImprimible";
import { VisorDeFotos } from "./VisorDeFotos";
import { MAX_FOTOS, avisoDeRepetida, duplicadosPorHuella, etiquetaSinFoto, fotoPendienteVencida, fotosSinHuella, iconoDeFotos, sha256Hex, sinFoto, type Repetida } from "@/lib/almacen-ops/fotos";
import { BotonesDeFoto } from "./BotonesDeFoto";
import { detalleParaConsola, leerFotoDelTelefono, mensajeDeFotoFallida } from "@/lib/almacen-ops/foto-del-telefono";
import { ORIGENES_DE_MERMA, TIPOS_DE_MERMA, MOTIVOS_VIEJOS, motivosDeMerma, costoDelCampo, type ProductoElegido } from "@/lib/almacen-ops/pasos";
import { cuentaComoPerdida, perdidaDeMerma, repartoDeReporte } from "@/lib/almacen-ops/perdida";
import { puedeCorregirMerma, puedeExportar, puedeVerReporte, veLosReportes } from "@/lib/almacen-ops/visibilidad";
import { diaDelReporte, fmtDia, hoyEnTexas, ordenPorDia } from "@/lib/almacen-ops/fecha-del-dano";
import { ATAJOS_DEL_MENU, NOMBRE_DE_ATAJO, eleccionAUrl, eleccionDeUrl, etiquetaDeRango, filtrarPorRango, perdidaEnRango, rangoDeAtajo, rangoDeEleccion, type Atajo, type Eleccion } from "@/lib/almacen-ops/rango-de-merma";
import { ETAPAS, ETAPAS_VISIBLES, etapaDe, etapaVisible, nombreDeEtapa, nombreDeEtapaVisible, perdidaPorEtapa, puedeCambiarEtapa, seleccionableParaHoja, tieneEtapas, type Etapa, type EtapaVisible } from "@/lib/almacen-ops/etapas";
import { COLUMNAS_EXCEL, celdasDeMerma, csvDeMermas, nombreDelCsv, rompioEscrito } from "@/lib/almacen-ops/tabla-de-merma";
import { COLUMNAS_DE_MERMA, alternaColumna, clavePrefsDeMerma, clavePrefsDeMermaVieja, columnasVisibles, fmtDiaCorto, mueveColumna, normalizaPrefs, ocultasPorDefecto, ordenPropio, prefsAlAbrir, prefsIniciales, sueltaColumna, tramosDeCabecera, type ColumnaDeMerma, type PrefsDeColumnas } from "@/lib/almacen-ops/columnas-de-merma";
import { useOrdenDeColumnas } from "./useOrdenDeColumnas";
import { SelectorDeColumnas } from "@/components/SelectorDeColumnas";
import { useCierraAlSalir } from "@/lib/menu-desplegable";
import { datosPdfDeMerma } from "@/lib/almacen-ops/pdf-de-merma";
import { AdjuntarYMarcar, ChipDeEtapa, LineaDeEtapas, aplicarEtapa, ErrorParcial } from "./EtapasDeMerma";
import { documentoDeGrupo, esAdminParaDeshacer, puedeBorrarMerma, puedeIniciarAprobacion } from "@/lib/almacen-ops/etapas";
import { coincideBusqueda } from "@/lib/almacen-ops/busqueda-de-merma";
import { useOrdenYFiltro } from "@/lib/use-orden-y-filtro";
import { CabeceraConMenu, MenuDeColumnaAbierto, type ColumnaConMenu } from "@/components/CabeceraConMenu";
import type { ValorDeCelda } from "@/lib/orden-y-filtro";
import { particionaParaDeshacer, particionaPorEtapa, resumenDeBloque, resumenDeDeshacer } from "@/lib/almacen-ops/bloque";
import { KpiDeEntregas } from "./KpiDeEntregas";
import type { Contexto } from "./Operaciones";

const LIMITE = 500;
// «Todos los reportes» (lista) se retiró de «Reportes» (dueño, 10 nov): solo Merma y Entregas. La vista «Mis reportes»
// (modo="mios") sigue usando la tabla de la lista, pero sin pestañas. La merma es la pestaña por defecto.
type Pestana = "merma" | "entregas" | "revision";
// La fila cruda de PostgREST: como `Reporte`, pero `answers` puede traer claves extra (p. ej. `broken_on` antes de la
// 266) y las firmas vienen embebidas. Se mapea a `Reporte` al leer. 280.
type ReporteCrudo = Omit<Reporte, "answers"> & { answers: Reporte["answers"] & Record<string, unknown> };

/**
 * «Mis reportes» y «Reportes» (D-883, 247). Las filas son las que la RLS deja ver; «Mis reportes» además se queda con
 * las que llenó quien mira (sin las de RR. HH., que el autor no ve). Cada fila se abre como tarjeta aquí mismo.
 * La tabla es la de Órdenes (CLAUDE.md): `table.orders` dentro de `.tbl-scroll.tbl-caja` (sin anchos que se arrastran, como el historial de RR. HH.), chips con `.cnt`.
 */
export function ListaDeReportes({ modo, ctx, filtro = false }: {
  modo: "mios" | "todos"; ctx: Contexto;
  /** Dueño, 11 nov: la vista única «Reportes» con el filtro Mis reportes / Todos (solo para quien ve su tienda). */
  filtro?: boolean;
}) {
  const { t, lang } = usePrefs();
  const [filas, setFilas] = useState<Reporte[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  // D-911: la pestaña y el rango de la merma viven en la URL (?pestana=merma&rango=mes…): aguantan un refresh y se comparten.
  const router = useRouter();
  const ruta = usePathname();
  const params = useSearchParams();
  const hoy = hoyEnTexas();
  // KPI de entregas (Roberto, fase 1): tercera pestaña, «Entregas», con el mismo selector de rango que la merma.
  const pedida = params.get("pestana");
  const pestana: Pestana = (pedida === "merma" || pedida === "entregas" || pedida === "revision") ? pedida : "merma";
  const eleccion = useMemo(() => eleccionDeUrl(params), [params]);
  const irA = useCallback((cambios: { pestana?: Pestana; eleccion?: Eleccion }) => {
    const q = new URLSearchParams();
    const p = cambios.pestana ?? pestana;
    if (p !== "merma") q.set("pestana", p);
    for (const [k, v] of Object.entries(eleccionAUrl(cambios.eleccion ?? eleccion))) q.set(k, v);
    const qs = q.toString();
    router.replace(qs ? `${ruta}?${qs}` : ruta, { scroll: false });
  }, [router, ruta, pestana, eleccion]);
  const setPestana = (p: Pestana) => irA({ pestana: p });
  // 281: un grupo de aprobación abierto vive en la URL (?grupo=<id>): aguanta refresh y se comparte. Solo en «Reportes».
  // 292: el almacén ve la merma de su tienda en «Reportes», pero sin exportar ni el KPI de entregas (eso es de gerencia).
  const gerencia = veLosReportes(ctx.yo);
  // El hueco de la barra azul (junto a la casa) donde suben «Volver» y el título; se busca después de montar.
  const [hueco, setHueco] = useState<HTMLElement | null>(null);
  useEffect(() => { setHueco(document.getElementById(HUECO_DE_LA_BARRA)); }, []);
  const exporta = puedeExportar(ctx.yo);
  const grupoId = modo === "todos" ? params.get("grupo") : null;
  const abrirGrupo = useCallback((id: string) => router.replace(`${ruta}?pestana=merma&grupo=${encodeURIComponent(id)}`, { scroll: false }), [router, ruta]);
  const [grupos, setGrupos] = useState<GrupoDeMerma[]>([]);
  const [recargaGrupos, setRecargaGrupos] = useState(0);
  useEffect(() => {
    if (ctx.demo || modo !== "todos" || pestana !== "merma" || grupoId) return;
    let vivo = true;
    // Práctica (11 nov): los grupos de práctica se guardan en este navegador por persona; al salir del modo enseñanza
    // se borran. Borradores (11 nov): los grupos sin guardar salen con la etiqueta «Borrador».
    cargaPractica(ctx.yo.id);
    if (!ensenanzaDelNavegador()) borrarPractica(ctx.yo.id);
    const extra = () => [...borradoresComoGrupos(ctx.yo.id), ...gruposDePractica()];
    void listarGrupos(createClient()).then((g) => { if (vivo) setGrupos([...extra(), ...g]); })
      .catch(() => { if (vivo) setGrupos(extra()); /* sin 281: no hay grupos */ });
    return () => { vivo = false; };
  }, [ctx.demo, ctx.yo.id, modo, pestana, grupoId, recargaGrupos]);
  const elegir = (atajo: Atajo) => irA({ eleccion: atajo === "otro"
    // Al pasar a «a mano» se arranca con el rango del atajo que estaba puesto, para solo ajustar un extremo.
    ? { atajo, ...(eleccion.atajo === "otro" ? { desde: eleccion.desde, hasta: eleccion.hasta } : rangoDeAtajo(eleccion.atajo, hoy)) }
    : { atajo, desde: "", hasta: "" } });
  const [tipo, setTipo] = useState<TipoDeReporte | "">("");
  const [abierto, setAbierto] = useState<Reporte | null>(null);
  // D-921 (270): filtro por etapa, y la selección de mermas para la hoja de aprobación (solo fotografiadas, sin aprobar).
  const [etapaFiltro, setEtapaFiltro] = useState<EtapaVisible | "">("");
  const [seleccion, setSeleccion] = useState<Set<string>>(new Set());
  const [adjuntando, setAdjuntando] = useState(false);
  // «Groups» (dueño, 10 nov): una opción más al lado de los filtros de etapa; muestra el archivo de grupos en vez de la tabla.
  const [verGrupos, setVerGrupos] = useState(false);
  // «Imprimir hoja» como diálogo en la app (dueño, 10 nov), en vez de abrir otra página.
  const [imprimirHoja, setImprimirHoja] = useState(false);

  useEffect(() => {
    let vivo = true;
    (async () => {
      // 266: la merma se ordena por el día en que se rompió; lo demás, por el día en que se reportó.
      if (ctx.demo) { setFilas(ordenPorDia(DEMO_REPORTES.filter((r) => puedeVerReporte(ctx.yo, r)))); return; }
      // 280: traemos las firmas de aprobación embebidas (sin el dibujo, para la lista). Si la 280 no está aplicada, la
      // relación no existe y PostgREST falla: se reintenta con `select("*")` a secas, y la pantalla sigue sin firmas.
      const sb = createClient();
      const EMBED = "*, firmas:warehouse_report_signatures(slot, signer_id, signer_name, signed_at)";
      const arma = async (cols: string): Promise<{ data: ReporteCrudo[] | null; error: { code?: string | null; message?: string | null } | null }> => {
        let q = sb.from("warehouse_reports").select(cols).order("created_at", { ascending: false }).limit(LIMITE);
        if (modo === "mios") q = q.eq("author_id", ctx.yo.id);
        const res = await q;
        return { data: res.data as unknown as ReporteCrudo[] | null, error: res.error };
      };
      let { data, error: e } = await arma(EMBED);
      if (e && /warehouse_report_signatures|relationship|schema cache|PGRST200/i.test(`${e.code ?? ""} ${e.message ?? ""}`)) {
        ({ data, error: e } = await arma("*"));
      }
      if (!vivo) return;
      if (e) { setError(mensajeDeErrorAlCargar(e)); setFilas([]); return; }
      setFilas(ordenPorDia((data ?? []).map((r) => ({ ...r, unit_cost: r.unit_cost == null ? null : Number(r.unit_cost), total_loss: r.total_loss == null ? null : Number(r.total_loss),
        // Hasta que se aplique la 266 la fecha del daño viaja dentro de `answers`; después, en su columna.
        broken_on: r.broken_on ?? (typeof r.answers?.broken_on === "string" ? r.answers.broken_on : null) })) as Reporte[]));
    })();
    return () => { vivo = false; };
    // 283: `grupoId` entra en las dependencias para que al volver de la hoja de un grupo (se quita `?grupo`) se relea la
    // lista: así una merma recién aprobada en grupo se ve al instante, sin tener que dar Ctrl+R.
  }, [ctx.demo, ctx.yo, modo, grupoId]);

  const propias = useMemo(() => (filas ?? []).filter((r) => modo === "todos" || (r.author_id === ctx.yo.id && !esDeRrhh(r.kind))), [filas, modo, ctx.yo.id]);
  // «Mis reportes» filtra solo por tipo (los filtros de tienda/empleado/fecha eran de la lista «Todos», ya retirada).
  const visibles = useMemo(() => propias.filter((r) => !tipo || r.kind === tipo), [propias, tipo]);
  const cuenta = (k: TipoDeReporte) => propias.filter((r) => r.kind === k).length;
  // Pedido del dueño (10 nov): en «Reportes» quiero ver TODAS las columnas (las del Excel), como en la pestaña de merma.
  // Solo cuando lo que se ve es puro scrap (filtro en «Merma» o todas las filas son merma): el Excel es específico de
  // merma, así que una lista mezclada o de otro tipo sigue con la tabla simple, para no romper los demás reportes.
  const listaSoloMerma = visibles.length > 0 && visibles.every((r) => r.kind === "scrap");
  const listaUsaExcel = tipo === "scrap" || listaSoloMerma;
  // 268: qué reportes comparten una foto (misma huella) con otro, entre los que se ven; la marca sale en ambos.
  const repetidas = useMemo(() => duplicadosPorHuella(propias), [propias]);
  // 268: mermas guardadas sin foto que ya pasaron 24 h (el gerente las reclama).
  const nombreTipo = (k: TipoDeReporte) => (lang === "es" ? INFO_DE_TIPO[k].es : INFO_DE_TIPO[k].en);

  const mermas = useMemo(() => propias.filter((r) => r.kind === "scrap"), [propias]);
  const totales = useMemo(() => totalesPorTienda(mermas, new Date()), [mermas]);
  // D-911: el rango elegido manda sobre la lista de merma y sobre la pérdida por tienda; todo por el día en que se rompió.
  const rango = useMemo(() => rangoDeEleccion(eleccion, hoy), [eleccion, hoy]);
  const mermasEnRango = useMemo(() => (rango ? filtrarPorRango(mermas, rango) : []), [mermas, rango]);
  const [estadoGrupos, setEstadoGrupos] = useState<FiltroDeGrupos>("todos");
  const [verTodosGrupos, setVerTodosGrupos] = useState(false);
  const gruposVisibles = useMemo(() => filtrarGrupos(grupos, estadoGrupos, rango, verTodosGrupos), [grupos, estadoGrupos, rango, verTodosGrupos]);
  const enRango = useMemo(() => (rango ? perdidaEnRango(mermas, rango) : { "*": 0 }), [mermas, rango]);
  const etiqueta = rango ? etiquetaDeRango(rango, lang, hoy) : "—";
  const tiendasDeMerma = Array.from(new Set([...Object.keys(totales), ...Object.keys(enRango)])).filter((k) => k !== "*").sort();
  // D-921 (270): la lista de merma filtrada por etapa, la cuenta por etapa y el desglose de la pérdida del rango por etapa.
  // «⏳ Pendiente» (Roberto, 11 nov): en un grupo y sin aprobar — etapa DERIVADA entre «Fotografiada» y «Aprobada».
  // En práctica, las mermas de un grupo de práctica sin aprobar cuentan igual (no traen scrap_group_id).
  const enPractica = useMemo(() => {
    const s = new Set<string>();
    const aprobados = new Set(gruposDePractica().filter((g) => g.approved_at).map((g) => g.id));
    grupoDePracticaPorReporte().forEach((g, id) => { if (!aprobados.has(g)) s.add(id); });
    return s;
  }, [grupos]); // se recalcula cuando cambia la lista de grupos (incluye los de práctica)
  const mermasPorEtapa = useMemo(() => (etapaFiltro ? mermasEnRango.filter((r) => etapaVisible(r, enPractica) === etapaFiltro) : mermasEnRango),
    [mermasEnRango, etapaFiltro, enPractica]);
  const cuentaEtapa = (e: EtapaVisible) => mermasEnRango.filter((r) => etapaVisible(r, enPractica) === e).length;
  // (El desglose por etapa en texto se quitó: dueño, 10 nov. `perdidaPorEtapa` sigue probada en su módulo.)
  // Se puede marcar cualquier merma que uno gestione (no solo las fotografiadas): así la misma selección sirve para
  // agrupar (solo las fotografiadas se agrupan), para desechar (las aprobadas) y para ajustar (las desechadas). Cada
  // acción filtra por su etapa y avisa qué omite.
  const puedeSeleccionar = useCallback((r: Reporte) => r.kind === "scrap" && puedeCambiarEtapa(ctx.yo, r), [ctx.yo]);
  // Reunión 12 nov: «Seleccionar todos» marcaba TAMBIÉN lo que la búsqueda o un filtro de columna tenían escondido. La
  // tabla avisa qué renglones enseña (`onVisibles`) y aquí todo —la casilla de la cabecera, la cuenta de la barra y las
  // acciones en bloque— va solo sobre eso: nunca se borra ni se aprueba un renglón que no se está viendo.
  const [aLaVista, setALaVista] = useState<Set<string> | null>(null);
  const seVe = useCallback((id: string) => !aLaVista || aLaVista.has(id), [aLaVista]);
  const seleccionadas = useMemo(() => mermasPorEtapa.filter((r) => seleccion.has(r.id) && puedeSeleccionar(r) && seVe(r.id)), [mermasPorEtapa, seleccion, puedeSeleccionar, seVe]);
  // Las marcadas que todavía van a la hoja de aprobación (fotografiadas, sin aprobar).
  // Reunión 11 nov, 11 PM: solo el gerente / store_admin / admin inicia la aprobación (el supervisor no arma el grupo).
  const paraHoja = useMemo(() => seleccionadas.filter((r) => seleccionableParaHoja(r) && puedeIniciarAprobacion(ctx.yo, r)), [seleccionadas, ctx.yo]);
  // Dueño, 10 nov: una marcada que YA está en un grupo no puede ir a otro — se avisa, se apagan las acciones de la hoja
  // y su renglón se resalta para que sepa cuál quitar (antes salía el error crudo de la base).
  const yaEnGrupo = useMemo(() => seleccionadasEnGrupo(paraHoja), [paraHoja]);
  const idsEnConflicto = useMemo(() => new Set(yaEnGrupo.map((r) => r.id)), [yaEnGrupo]);
  const alternar = (id: string) => setSeleccion((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  // Acciones en bloque (dueño, 10 nov): cuáles de las seleccionadas pueden desechar/ajustar (están en la etapa previa).
  const paraDesechar = useMemo(() => particionaPorEtapa(seleccionadas, "dumped"), [seleccionadas]);
  const paraAjustar = useMemo(() => particionaPorEtapa(seleccionadas, "adjusted"), [seleccionadas]);
  // 296 (dueño, 11 nov: «an option to undo»): regresar un paso a las marcadas (cada una desde su etapa).
  // Deshacer en bloque: SOLO admin (reunión 11 nov; la 296 lo exige igual en la base).
  const paraDeshacer = useMemo(() => particionaParaDeshacer(esAdminParaDeshacer(ctx.yo) ? seleccionadas : []), [seleccionadas, ctx.yo]);
  const paraBorrar = useMemo(() => seleccionadas.filter((r) => puedeBorrarMerma(ctx.yo, r)), [seleccionadas, ctx.yo]);
  // «Seleccionar todos» (dueño, 10 nov): antes no había forma de marcar todo. Marca/limpia de un golpe TODAS las mermas
  // seleccionables que se ven ahora (las del filtro de etapa actual).
  const seleccionables = useMemo(() => mermasPorEtapa.filter((r) => puedeSeleccionar(r) && seVe(r.id)), [mermasPorEtapa, puedeSeleccionar, seVe]);
  const todasSeleccionadas = seleccionables.length > 0 && seleccionables.every((r) => seleccion.has(r.id));
  const algunaSeleccionada = seleccionables.some((r) => seleccion.has(r.id));
  const alternarTodas = () => setSeleccion((s) => {
    const n = new Set(s);
    if (todasSeleccionadas) for (const r of seleccionables) n.delete(r.id);
    else for (const r of seleccionables) n.add(r.id);
    return n;
  });
  // 299 (ayuda de Roberto, 12 nov: «delete as admin and manager»): borrar en bloque las marcadas que esta persona puede
  // borrar (admin, o gerente de esa tienda), con confirmación en la misma barra. En práctica solo se quitan de la lista.
  const [confirmaBorrarBloque, setConfirmaBorrarBloque] = useState(false);
  const [borrandoBloque, setBorrandoBloque] = useState(false);
  // Reunión 12 nov («borré 5 y no pasó nada»): la base se negaba —estaban en un grupo YA APROBADO— y el motivo salía
  // en una línea gris, solo el del último. Ahora cada renglón borrado desaparece EN EL ACTO (uno por uno, sin esperar
  // al resto) y los que no se pudieron salen en un aviso ROJO, uno por reporte, con su motivo.
  const [fallosDeBorrado, setFallosDeBorrado] = useState<{ id: string; nombre: string; motivo: string }[]>([]);
  const borrarBloque = async (lista: Reporte[]) => {
    setBorrandoBloque(true); setAvisoBloque(null); setFallosDeBorrado([]);
    let hechos = 0; const fallos: { id: string; nombre: string; motivo: string }[] = [];
    for (const r of lista) {
      try {
        if (!ctx.demo && !ensenanzaDelNavegador()) await borrarReporteDeMerma(createClient(), r.id);
        hechos++;
        setFilas((f) => (f ?? []).filter((x) => x.id !== r.id));
        setSeleccion((s) => { const n = new Set(s); n.delete(r.id); return n; });
      } catch (e) {
        fallos.push({ id: r.id, nombre: `${r.product_name ?? r.product_sku ?? t("Report", "Reporte")} · ${fmtDia(diaDelReporte(r), lang)}`, motivo: mensajeDeError(e) });
      }
    }
    setConfirmaBorrarBloque(false); setBorrandoBloque(false);
    setFallosDeBorrado(fallos);
    setAvisoBloque(hechos > 0 || fallos.length === 0 ? t(`${hechos} deleted.`, `${hechos} borrada(s).`) : null);
  };
  const actualizaFilas = (nuevos: Reporte[]) => {
    const porId = new Map(nuevos.map((n) => [n.id, n]));
    setFilas((f) => (f ?? []).map((x) => porId.get(x.id) ?? x));
    setAbierto((a) => (a && porId.get(a.id)) || a);
    setSeleccion((s) => { const n = new Set(s); for (const id of porId.keys()) n.delete(id); return n; });
  };
  // Pedido de Roberto: bajar la lista de merma tal cual se ve (mismas columnas del Excel) para pegarla en su hoja.
  // Se arma en el navegador (Blob); el nombre lleva la tienda si todas las filas son de la misma, o «all».
  const exportarCsv = (lista: Reporte[]) => {
    const tiendas = new Set(lista.map((r) => r.store));
    const csv = csvDeMermas(lista, ctx.personas, lang);
    // El BOM hace que Excel lea bien los acentos (ñ, á…) al abrir el archivo con doble clic.
    const blob = new Blob(["﻿", csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = nombreDelCsv(tiendas.size === 1 ? [...tiendas][0] : null, hoy);
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  // Mismo reporte, en PDF (pedido del dueño, 10 nov). La librería (`jspdf` + autotable) se carga diferida al tocar el
  // botón, como `@zumer/snapdom`, para no cargarla en cada visita. Las columnas son las del Excel/CSV, para que cuadren.
  const [generandoPdf, setGenerandoPdf] = useState(false);
  const descargarPdf = async (lista: Reporte[], conRango: boolean) => {
    if (lista.length === 0 || generandoPdf) return;
    setGenerandoPdf(true);
    try {
      const tiendas = new Set(lista.map((r) => r.store));
      const d = datosPdfDeMerma(lista, ctx.personas, lang, {
        rango: conRango && rango ? etiqueta : null,
        tienda: tiendas.size === 1 ? [...tiendas][0] : null,
        hoy,
      });
      const [{ jsPDF }, auto] = await Promise.all([import("jspdf"), import("jspdf-autotable")]);
      const autoTable = auto.default;
      const doc = new jsPDF({ orientation: "landscape" });
      doc.setFontSize(14); doc.text(d.empresa, 14, 14);
      doc.setFontSize(11); doc.text(d.titulo, 14, 21);
      doc.setFontSize(9); doc.text(d.subtitulo, 14, 27);
      autoTable(doc, {
        head: [d.encabezados], body: d.filas, startY: 31,
        styles: { fontSize: 7, cellPadding: 1.5, overflow: "linebreak" },
        headStyles: { fillColor: [31, 41, 55] },
      });
      const finalY = (doc as unknown as { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY ?? 31;
      doc.setFontSize(10);
      doc.text(`${d.etiquetaTotal}: ${fmtMoney(d.total)}`, 14, finalY + 8);
      doc.save(d.nombreArchivo);
    } finally {
      setGenerandoPdf(false);
    }
  };

  // 281: crear un grupo de aprobación con las mermas marcadas y abrir su hoja digital (firmar y aprobar de una vez).
  // El nombre del grupo es la fecha y hora de creación (dueño, 10 nov): sin preguntar nada, así cada grupo se identifica
  // por cuándo se armó.
  const iniciarAprobacion = async () => {
    // Solo se agrupan las fotografiadas (sin aprobar); si hay otras marcadas, se ignoran para esto.
    const elegibles = seleccionadas.filter((r) => seleccionableParaHoja(r));
    if (elegibles.length === 0) { setAvisoBloque(t("Pick photographed reports to group.", "Marca reportes fotografiados para agrupar.")); return; }
    if (seleccionadasEnGrupo(elegibles).length > 0) { setAvisoBloque(avisoYaEnGrupo(seleccionadasEnGrupo(elegibles).length, lang)); return; }
    const nombre = fmtDateTime(new Date().toISOString());
    // Dueño, 11 nov: «Iniciar aprobación» abre la hoja como BORRADOR (no se crea en la base hasta «Guardar grupo»).
    // En práctica, Guardar crea el grupo de práctica.
    const id = crearBorradorDeGrupo(ctx.yo.id, nombre, elegibles);
    setSeleccion(new Set());
    abrirGrupo(id);
  };

  // Acciones en bloque: marcar varias como desechadas (approved→dumped) o ajustadas (dumped→adjusted, con una sola foto).
  const [avisoBloque, setAvisoBloque] = useState<string | null>(null);
  const [ajustandoBloque, setAjustandoBloque] = useState(false);
  const deshacerBloque = async () => {
    const { porDestino, omitidos } = paraDeshacer;
    let hechas = 0;
    try {
      for (const [destino, lista] of porDestino) {
        const h = await aplicarEtapa(ctx, lista, destino, null);
        actualizaFilas(h);
        hechas += h.length;
      }
      setAvisoBloque(resumenDeDeshacer(hechas, omitidos.length, lang));
    } catch (e) {
      if (e instanceof ErrorParcial) { actualizaFilas(e.hechos); setAvisoBloque(e.message); }
      else setAvisoBloque(mensajeDeError(e));
    }
  };
  const marcarDesechadas = async () => {
    const { elegibles, omitidos } = paraDesechar;
    if (elegibles.length === 0) { setAvisoBloque(resumenDeBloque("dumped", 0, omitidos.length, lang)); return; }
    try {
      const hechos = await aplicarEtapa(ctx, elegibles, "dumped", null);
      actualizaFilas(hechos);
      setAvisoBloque(resumenDeBloque("dumped", hechos.length, omitidos.length, lang));
    } catch (e) {
      if (e instanceof ErrorParcial) { actualizaFilas(e.hechos); setAvisoBloque(e.message); }
      else setAvisoBloque(mensajeDeError(e));
    }
  };

  // 292: la pestaña de Entregas (KPI) es de gerencia; el almacén solo ve la merma de su tienda.
  // Dueño, 10 nov («pega más eso»): las pestañas y los atajos del rango van en UN renglón (se doblan en el teléfono).
  const pestanas = modo === "todos" && gerencia ? (
    <div className="ops-pestanas" role="tablist">
      <button type="button" role="tab" aria-selected={pestana === "merma"} className={`chip${pestana === "merma" ? " active" : ""}`} onClick={() => setPestana("merma")} data-pestana="merma">🧱 {t("Scrap", "Merma")}</button>
      <button type="button" role="tab" aria-selected={pestana === "entregas"} className={`chip${pestana === "entregas" ? " active" : ""}`} onClick={() => setPestana("entregas")} data-pestana="entregas">🚚 {t("Deliveries", "Entregas")}</button>
    </div>
  ) : null;
  // El selector de rango (D-911) lo comparten la pestaña de merma y la de entregas.
  const selectorDeRango = (
    <div className="ops-fila-de-filtros" data-fila-de-filtros>
      {pestanas}
      {/* Dueño, 11 nov: los atajos de fecha pasan a UN botón «📅» con su menú (primero el rango personalizado). */}
      <MenuDeFecha eleccion={eleccion} etiqueta={etiqueta} onElegir={elegir} />
      {eleccion.atajo === "otro" && (
        <div className="ops-filtros-campos" data-rango-a-mano>
          <span className="ops-fecha">{t("From", "Desde")} <input type="date" value={eleccion.desde} max={hoy} onChange={(e) => irA({ eleccion: { ...eleccion, desde: e.target.value } })} aria-label={t("From", "Desde")} data-campo="rango-desde" /></span>
          <span className="ops-fecha">{t("To", "Hasta")} <input type="date" value={eleccion.hasta} max={hoy} onChange={(e) => irA({ eleccion: { ...eleccion, hasta: e.target.value } })} aria-label={t("To", "Hasta")} data-campo="rango-hasta" /></span>
          {!rango && <span className="ops-aviso ops-aviso-error" role="alert" data-rango-invalido>{t("“From” must be on or before “To”.", "«Desde» no puede ir después de «Hasta».")}</span>}
        </div>
      )}
    </div>
  );

  return (
    <section className="ops-reportes" data-modo={modo}>
      {/* Dueño, 10 nov: «Volver» como botón, a la izquierda (antes era un enlace subrayado a la derecha). */}
      {/* Dueño, 10 nov: «Volver» y el título suben a la barra azul, junto a la casa (ahorra un renglón). Si la barra no
          está (no debería pasar), se quedan aquí arriba como antes. */}
      {(() => {
        const cabeza = (
          <div className="ops-cabeza-reportes" data-cabeza-reportes>
            <Link href="/operaciones" className="ops-volver" data-accion="volver-a-operaciones">← {t("Back to Warehouse Ops", "Volver a Operaciones")}</Link>
            <h2>{filtro || modo === "todos" ? t("Reports", "Reportes") : t("My reports", "Mis reportes")} <span className="count-tag">{visibles.length}</span></h2>
            {filtro && (
              <span className="ops-filtro-mios" role="group" aria-label={t("Show", "Mostrar")} data-filtro-mios>
                <Link href="/operaciones/reportes?ver=mios" className={`chip${modo === "mios" ? " active" : ""}`} aria-pressed={modo === "mios"} data-ver="mios">{t("My reports", "Mis reportes")}</Link>
                <Link href="/operaciones/reportes" className={`chip${modo === "todos" ? " active" : ""}`} aria-pressed={modo === "todos"} data-ver="todos">{t("All reports", "Todos")}</Link>
              </span>
            )}
          </div>
        );
        return hueco ? createPortal(cabeza, hueco) : <div className="page-head">{cabeza}</div>;
      })()}


      {error && <p className="ops-aviso ops-aviso-error">{error}</p>}
      {filas === null && <p className="hint">{t("Loading…", "Cargando…")}</p>}

      {filas && modo === "todos" && pestana === "merma" && (
        <div className="ops-merma" data-merma>
          {selectorDeRango}
          <div className="ops-merma-totales">
            <div className="ops-merma-total ops-merma-total-rango" data-total-rango={enRango["*"]}>
              <span className="ops-merma-cifra">{fmtMoney(enRango["*"])}</span>
              <span data-etiqueta-rango>{etiqueta}</span>
            </div>
            {([["semana", "This week", "Esta semana"], ["mes", "This month", "Este mes"], ["todo", "All time", "Siempre"]] as const).map(([k, en, es]) => (
              <div key={k} className="ops-merma-total">
                <span className="ops-merma-cifra">{fmtMoney(totales["*"]?.[k] ?? 0)}</span>
                <span>{t(en, es)}</span>
              </div>
            ))}
          </div>
          {/* El desglose por tienda solo aporta con MÁS DE UNA tienda: con una sola repite las tarjetas de arriba
              (ayuda de Roberto, 10 nov: «Remove; Redundant»). Con varias, se sigue mostrando. */}
          {tiendasDeMerma.length > 1 && (
          <div className="tbl-scroll tbl-caja">
            <table className="orders" data-perdida-por-tienda>
              <thead><tr><th>{t("Store", "Tienda")}</th><th className="ops-col-rango">{etiqueta}</th><th>{t("This week", "Esta semana")}</th><th>{t("This month", "Este mes")}</th><th>{t("All time", "Siempre")}</th></tr></thead>
              <tbody>
                {tiendasDeMerma.map((s) => (
                  <tr key={s} data-tienda={s}><td>{s}</td><td className="num ops-col-rango" data-perdida-rango={enRango[s] ?? 0}>{fmtMoney(enRango[s] ?? 0)}</td><td className="num">{fmtMoney(totales[s]?.semana ?? 0)}</td><td className="num">{fmtMoney(totales[s]?.mes ?? 0)}</td><td className="num">{fmtMoney(totales[s]?.todo ?? 0)}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
          )}
          {/* Dueño, 10 nov: «quita todo ese texto» — sin el desglose por etapa ni la explicación de los totales. */}
          <h3 className="ops-merma-titulo">{t("Scrap in this range", "Merma en el rango")} <span className="count-tag" data-cuenta-rango>{mermasEnRango.length}</span></h3>
          <div className="filters-oneline ops-filtros" role="group" aria-label={t("Stage", "Etapa")} data-filtro-etapas>
            <button type="button" className={`chip${!verGrupos && etapaFiltro === "" ? " active" : ""}`} onClick={() => { setVerGrupos(false); setEtapaFiltro(""); }} data-etapa-filtro="">{t("All stages", "Todas las etapas")} <span className="cnt">{mermasEnRango.length}</span></button>
            {/* «⏳ Pendiente» va entre «Fotografiada» y «Aprobada» (Roberto, 11 nov): en grupo, sin aprobar. */}
            {ETAPAS_VISIBLES.map((e) => (
              <button type="button" key={e} className={`chip ops-chip-etapa${!verGrupos && etapaFiltro === e ? " active" : ""}`} onClick={() => { setVerGrupos(false); setEtapaFiltro(etapaFiltro === e ? "" : e); }} data-etapa-filtro={e} aria-pressed={!verGrupos && etapaFiltro === e}>
                {e === "pending" ? "⏳ " : <span className="ops-etapa ops-etapa-mini" data-etapa={e} aria-hidden />} {nombreDeEtapaVisible(e, lang)} <span className="cnt">{cuentaEtapa(e)}</span>
              </button>
            ))}
            {/* «Groups» (dueño, 10 nov): al lado de las etapas; muestra el archivo de grupos en vez de la tabla. */}
            <button type="button" className={`chip${verGrupos ? " active" : ""}`} onClick={() => setVerGrupos((v) => !v)} data-filtro-grupos aria-pressed={verGrupos}>🗂 {t("Groups", "Grupos")} <span className="cnt">{grupos.length}</span></button>
            {/* Exportar en la MISMA fila que las etapas (dueño, 10 nov: quitar el espacio muerto sobre la tabla). */}
            {/* 292: el almacén no exporta (dueño: «warehouse people don't need pdf or csv reports»). */}
            {!verGrupos && exporta && mermasPorEtapa.length > 0 && (
              <span className="ops-exportar ops-exportar-en-fila">
                <button type="button" className="btn btn-sm" onClick={() => exportarCsv(mermasPorEtapa)} data-accion="exportar-csv" title={t("Download these rows as a CSV file to paste into Excel", "Baja estas filas como CSV para pegarlas en Excel")}>
                  ⬇ {t("Export CSV", "Exportar CSV")} <span className="cnt">{mermasPorEtapa.length}</span>
                </button>
                <button type="button" className="btn btn-sm" onClick={() => void descargarPdf(mermasPorEtapa, true)} disabled={generandoPdf} data-accion="exportar-pdf" title={t("Download these rows as a PDF report", "Baja estas filas como un reporte PDF")}>
                  📄 {generandoPdf ? t("Generating…", "Generando…") : t("Download PDF", "Descargar PDF")} <span className="cnt">{mermasPorEtapa.length}</span>
                </button>
              </span>
            )}
          </div>
          {!verGrupos && <>
          {seleccionadas.length > 0 && (
            <div className="ops-seleccion" role="region" aria-label={t("Selected for approval", "Seleccionadas para aprobar")} data-seleccion={seleccionadas.length}>
              <span>{t(`${seleccionadas.length} selected`, `${seleccionadas.length} seleccionada${seleccionadas.length === 1 ? "" : "s"}`)}</span>
              {/* Dueño, 10 nov: solo salen las acciones que aplican a lo marcado. Aprobar / imprimir hoja / adjuntar hoja
                  solo con fotografiadas (sin aprobar); desechar con aprobadas; ajustar con desechadas. */}
              {paraHoja.length > 0 && <>
                {/* 281: crear un grupo, firmarlo (gerente + supervisor) y aprobar todas de una vez — la vía principal. */}
                {yaEnGrupo.length > 0 && <span className="ops-aviso-en-grupo" role="alert" data-aviso-ya-en-grupo={yaEnGrupo.length}>⚠ {avisoYaEnGrupo(yaEnGrupo.length, lang)}</span>}
                <button type="button" className="btn btn-primary" disabled={yaEnGrupo.length > 0} onClick={() => void iniciarAprobacion()} data-accion="iniciar-aprobacion">
                  ✅ {t(`Start approval (${paraHoja.length})`, `Iniciar aprobación (${paraHoja.length})`)}
                </button>
                {/* Reunión 11 nov: UNA sola acción para aprobar. Imprimir y adjuntar hoja quedan solo para lo ya aprobado
                    (hoja del grupo aprobado), no aquí. */}
              </>}
              {/* En bloque (dueño, 10 nov): desechar las aprobadas, ajustar las desechadas (una sola foto para todas). */}
              {paraDesechar.elegibles.length > 0 && <button type="button" className="btn" onClick={() => { setAjustandoBloque(false); void marcarDesechadas(); }} data-accion="desechar-bloque">🗑 {t(`Mark as dumped (${paraDesechar.elegibles.length})`, `Marcar como desechadas (${paraDesechar.elegibles.length})`)}</button>}
              {paraAjustar.elegibles.length > 0 && <button type="button" className="btn" onClick={() => { setAvisoBloque(null); setAdjuntando(false); setAjustandoBloque((x) => !x); }} data-accion="ajustar-bloque" aria-pressed={ajustandoBloque}>🧾 {t(`Mark as adjusted (${paraAjustar.elegibles.length})`, `Marcar como ajustadas (${paraAjustar.elegibles.length})`)}</button>}
              {paraDeshacer.elegibles.length > 0 && <button type="button" className="btn btn-ghost" onClick={() => { setAjustandoBloque(false); setAdjuntando(false); void deshacerBloque(); }} data-accion="deshacer-bloque"
                title={t("Move each selected report back one stage", "Regresa cada merma marcada a su etapa anterior")}>↩ {t(`Undo one step (${paraDeshacer.elegibles.length})`, `Deshacer un paso (${paraDeshacer.elegibles.length})`)}</button>}
              {paraHoja.length === 0 && paraDesechar.elegibles.length === 0 && paraAjustar.elegibles.length === 0 && paraDeshacer.elegibles.length === 0 && paraBorrar.length === 0 && (
                <span className="hint" data-sin-acciones>{t("Nothing to do with these: they are already done.", "No hay acción para estas: ya están terminadas.")}</span>
              )}
              {paraBorrar.length > 0 && !confirmaBorrarBloque && (
                <button type="button" className="btn btn-ghost" onClick={() => setConfirmaBorrarBloque(true)} data-accion="borrar-bloque">🗑 {t(`Delete (${paraBorrar.length})`, `Borrar (${paraBorrar.length})`)}</button>
              )}
              {confirmaBorrarBloque && paraBorrar.length > 0 && (
                <span className="ops-confirma-borrar" role="alert" data-confirma-borrar-bloque>
                  {t(`Delete ${paraBorrar.length} report(s)? This can't be undone.`, `¿Borrar ${paraBorrar.length} reporte(s)? No se puede deshacer.`)}
                  <button type="button" className="btn btn-danger btn-sm" disabled={borrandoBloque} onClick={() => void borrarBloque(paraBorrar)} data-accion="confirmar-borrar-bloque">{borrandoBloque ? t("Deleting…", "Borrando…") : t("Yes, delete", "Sí, borrar")}</button>
                  <button type="button" className="btn btn-ghost btn-sm" disabled={borrandoBloque} onClick={() => setConfirmaBorrarBloque(false)}>{t("Cancel", "Cancelar")}</button>
                </span>
              )}
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => { setSeleccion(new Set()); setAdjuntando(false); setAjustandoBloque(false); setAvisoBloque(null); setConfirmaBorrarBloque(false); }} data-accion="limpiar-seleccion">{t("Clear", "Quitar")}</button>
            </div>
          )}
          {avisoBloque && <div className="hint" role="status" data-aviso-bloque>{avisoBloque}</div>}
          {fallosDeBorrado.length > 0 && (
            <div className="ops-aviso ops-aviso-error ops-fallos-de-borrado" role="alert" data-fallos-de-borrado={fallosDeBorrado.length}>
              <strong>{t(`${fallosDeBorrado.length} could not be deleted:`, `${fallosDeBorrado.length} no se pudo(pudieron) borrar:`)}</strong>
              <ul>
                {fallosDeBorrado.map((f) => <li key={f.id} data-fallo-de={f.id}><b>{f.nombre}</b>: {f.motivo}</li>)}
              </ul>
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => setFallosDeBorrado([])}>{t("OK", "Entendido")}</button>
            </div>
          )}
          {adjuntando && paraHoja.length > 0 && (
            <AdjuntarYMarcar reportes={paraHoja} ctx={ctx} etapa="approved" etiqueta={t("Choose the signed sheet (photo or PDF)", "Elegir la hoja firmada (foto o PDF)")}
              onListo={(n) => { setAdjuntando(false); actualizaFilas(n); }} onParcial={actualizaFilas} onCancelar={() => setAdjuntando(false)} />
          )}
          {ajustandoBloque && paraAjustar.elegibles.length > 0 && (
            <AdjuntarYMarcar reportes={paraAjustar.elegibles} ctx={ctx} etapa="adjusted" etiqueta={t("Choose the system screenshot (one photo for all)", "Elegir la captura del sistema (una foto para todas)")}
              onListo={(n) => { setAjustandoBloque(false); actualizaFilas(n); setAvisoBloque(resumenDeBloque("adjusted", n.length, paraAjustar.omitidos.length, lang)); }}
              onParcial={actualizaFilas} onCancelar={() => setAjustandoBloque(false)} />
          )}
          {/* «Seleccionar todos» vive SOLO en la casilla del encabezado (dueño, 10 nov: el botón de arriba era redundante). */}
          <TablaDeMermaExcel filas={mermasPorEtapa} ctx={ctx} onAbrir={setAbierto} repetidas={repetidas} data-lista="merma-en-rango" conEtapa
            grupos={grupos} onAbrirGrupo={abrirGrupo} enConflicto={idsEnConflicto} onVisibles={setALaVista}
            seleccion={{ ids: seleccion, puede: puedeSeleccionar, alternar, todas: todasSeleccionadas, algunas: algunaSeleccionada, alternarTodas }}
            vacio={rango ? (etapaFiltro ? t("No scrap in that stage in this range.", "No hay merma en esa etapa en este rango.") : t("No scrap broken in this range.", "No se rompió nada en este rango.")) : t("Fix the dates to see the list.", "Corrige las fechas para ver la lista.")} />
          </>}
          {/* 281: archivo de grupos de aprobación — abre la hoja digital de cada uno (firmas + fotos). Vive bajo «Groups». */}
          {verGrupos && (
            <div className="ops-grupos" data-grupos={gruposVisibles.length}>
              <h3 className="ops-merma-titulo">{t("Approval groups", "Grupos de aprobación")} <span className="count-tag">{gruposVisibles.length}</span></h3>
              {/* Dueño, 10 nov: pendientes / aprobados; el rango de fechas de arriba también filtra, con «Ver todos». */}
              <div className="filters-oneline ops-filtros" role="group" aria-label={t("Group status", "Estado del grupo")} data-filtro-estado-grupos>
                {([["todos", "All", "Todos"], ["pendientes", "Pending", "Pendientes"], ["aprobados", "Approved", "Aprobados"]] as const).map(([k, en, es]) => (
                  <button type="button" key={k} className={`chip${estadoGrupos === k ? " active" : ""}`} onClick={() => setEstadoGrupos(k)} aria-pressed={estadoGrupos === k} data-estado-grupos={k}>
                    {t(en, es)} <span className="cnt">{filtrarGrupos(grupos, k, rango, verTodosGrupos).length}</span>
                  </button>
                ))}
                <button type="button" className={`chip${verTodosGrupos ? " active" : ""}`} onClick={() => setVerTodosGrupos((v) => !v)} aria-pressed={verTodosGrupos} data-ver-todos-grupos>
                  {verTodosGrupos ? t("Only this date range", "Solo este rango") : t("See all dates", "Ver todos")}
                </button>
              </div>
              {gruposVisibles.length === 0
                ? <p className="hint" data-sin-grupos>{grupos.length === 0
                    ? t("No approval groups yet. Select scrap reports and press «Start approval» to create one.", "Todavía no hay grupos. Selecciona mermas y toca «Iniciar aprobación» para crear uno.")
                    : t("No groups match. Try «See all dates».", "Ningún grupo coincide. Prueba «Ver todos».")}</p>
                : <ul className="ops-grupos-lista">
                    {gruposVisibles.map((g) => (
                      <li key={g.id} data-grupo={g.id}>
                        <button type="button" className="btn btn-sm" onClick={() => abrirGrupo(g.id)} data-abrir-grupo={g.id}>🗂 {g.name}</button>
                        {esBorradorDeGrupo(g.id) && <span className="ops-etiqueta-borrador" data-borrador>📝 {t("Draft", "Borrador")}</span>}
                        {esGrupoDePractica(g.id) && <span className="ops-etiqueta-borrador" data-practica>🎓 {t("Practice", "Práctica")}</span>}
                        <span className="hint">{t(`${g.n_reportes ?? 0} reports`, `${g.n_reportes ?? 0} reportes`)} · {g.store} · <span data-estado-grupo={g.id}>{esBorradorDeGrupo(g.id) ? t("Not saved yet", "Aún sin guardar") : estadoDelGrupo(g, lang)}</span></span>
                      </li>
                    ))}
                  </ul>}
              {grupos.some((g) => esGrupoDePractica(g.id)) && (
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => { borrarPractica(ctx.yo.id); setRecargaGrupos((n) => n + 1); }} data-accion="borrar-practica">
                  🧹 {t("Clear practice", "Borrar práctica")}
                </button>
              )}
            </div>
          )}
        </div>
      )}

      {filas && modo === "todos" && gerencia && pestana === "entregas" && (
        <div className="ops-merma ops-entregas" data-entregas>
          {selectorDeRango}
          <KpiDeEntregas rango={rango} ctx={ctx} />
        </div>
      )}

      {filas && modo === "mios" && (
        <>
          <div className="filters-oneline ops-filtros">
            <button type="button" className={`chip${tipo === "" ? " active" : ""}`} onClick={() => setTipo("")}>{t("All", "Todos")} <span className="cnt">{propias.length}</span></button>
            {TIPOS.filter((k) => cuenta(k) > 0).map((k) => (
              <button type="button" key={k} className={`chip${tipo === k ? " active" : ""}`} onClick={() => setTipo(k)} data-chip={k}>
                {INFO_DE_TIPO[k].emoji} {nombreTipo(k)} <span className="cnt">{cuenta(k)}</span>
              </button>
            ))}
          </div>
          {listaUsaExcel && exporta && visibles.length > 0 && (
            <div className="ops-exportar">
              <button type="button" className="btn btn-sm" onClick={() => exportarCsv(visibles)} data-accion="exportar-csv" title={t("Download these rows as a CSV file to paste into Excel", "Baja estas filas como CSV para pegarlas en Excel")}>
                ⬇ {t("Export CSV", "Exportar CSV")} <span className="cnt">{visibles.length}</span>
              </button>
              <button type="button" className="btn btn-sm" onClick={() => void descargarPdf(visibles, false)} disabled={generandoPdf} data-accion="exportar-pdf" title={t("Download these rows as a PDF report", "Baja estas filas como un reporte PDF")}>
                📄 {generandoPdf ? t("Generating…", "Generando…") : t("Download PDF", "Descargar PDF")} <span className="cnt">{visibles.length}</span>
              </button>
            </div>
          )}
          {listaUsaExcel
            ? <TablaDeMermaExcel filas={visibles} ctx={ctx} onAbrir={setAbierto} repetidas={repetidas} data-lista="todos" conEtapa
                vacio={modo === "mios"
                  ? t("You haven't filed any reports yet. Pick one on the Warehouse Ops screen.", "Todavía no has llenado reportes. Elige uno en la pantalla de Operaciones.")
                  : t("No reports match these filters.", "Ningún reporte coincide con estos filtros.")} />
            : <TablaDeReportes filas={visibles} ctx={ctx} onAbrir={setAbierto} repetidas={repetidas} data-lista="todos" conEtapa={visibles.some((r) => r.kind === "scrap")}
                vacio={modo === "mios"
                  ? t("You haven't filed any reports yet. Pick one on the Warehouse Ops screen.", "Todavía no has llenado reportes. Elige uno en la pantalla de Operaciones.")
                  : t("No reports match these filters.", "Ningún reporte coincide con estos filtros.")} />}
        </>
      )}

      {abierto && <Tarjeta r={abierto} ctx={ctx} onCerrar={() => setAbierto(null)}
        onCambio={(n) => { setAbierto(n); setFilas((f) => (f ?? []).map((x) => (x.id === n.id ? n : x))); }}
        onBorrado={(id) => { setFilas((f) => (f ?? []).filter((x) => x.id !== id)); setSeleccion((s) => { const n = new Set(s); n.delete(id); return n; }); }} />}
      {/* 281 → 10 nov (dueño): el grupo se abre EN TARJETA (overlay), como todo en la app, sin saltar de pantalla.
          Sigue viviendo en la URL (?grupo=…): aguanta refresh y se puede compartir, pero ya no reemplaza la lista. */}
      {grupoId && (
        <div className="overlay" onClick={() => irA({ pestana: "merma" })}>
          <div className="modal ops-tarjeta-grupo" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" data-grupo-abierto={grupoId}>
            <CerrarX onCerrar={() => irA({ pestana: "merma" })} />
            {esBorradorDeGrupo(grupoId)
              ? <HojaBorrador borradorId={grupoId} ctx={ctx} reportesDisponibles={mermas}
                  onSalir={() => { setRecargaGrupos((n) => n + 1); irA({ pestana: "merma" }); }}
                  onGuardado={(id) => { setRecargaGrupos((n) => n + 1); abrirGrupo(id); }} />
              : <HojaDeGrupo grupoId={grupoId} ctx={ctx} onSalir={() => irA({ pestana: "merma" })} />}
          </div>
        </div>
      )}
      {imprimirHoja && paraHoja.length > 0 && <HojaImprimible reportes={paraHoja} ctx={ctx} onCerrar={() => setImprimirHoja(false)} />}
    </section>
  );
}

/** La tabla de reportes (la de Órdenes, CLAUDE.md); la usan la lista y la pestaña de merma. Cada fila se abre como tarjeta. */
function TablaDeReportes({ filas, ctx, onAbrir, vacio, repetidas, conEtapa, seleccion, "data-lista": dataLista }: {
  filas: Reporte[]; ctx: Contexto; onAbrir: (r: Reporte) => void; vacio: string; repetidas: Map<string, string[]>; "data-lista": string;
  /** D-921 (270): la columna «Etapa» (pestaña de merma). Sin ella, el chip sale chico junto al detalle. */
  conEtapa?: boolean;
  /** Casillas para la hoja de aprobación: qué ids están marcados, cuáles se pueden marcar, y el cambio. */
  seleccion?: { ids: Set<string>; puede: (r: Reporte) => boolean; alternar: (id: string) => void };
}) {
  const { t, lang } = usePrefs();
  const nombre = (id: string) => ctx.personas.find((p) => p.id === id)?.full_name ?? "—";
  const nombreTipo = (k: TipoDeReporte) => (lang === "es" ? INFO_DE_TIPO[k].es : INFO_DE_TIPO[k].en);
  const conCasillas = !!seleccion && filas.some((r) => seleccion.puede(r));
  const columnas = 6 + (conEtapa ? 1 : 0) + (conCasillas ? 1 : 0);
  // Reunión 12 nov: las columnas se arrastran igual en todas las tablas de la app (como en Órdenes y en la de merma).
  const cols = useOrdenDeColumnas(`rtg:ops:reportes:orden:${ctx.yo.id}`, COLUMNAS_DE_LISTA.map((c) => c.key));
  const aLaVista = cols.orden.filter((k) => k !== "etapa" || conEtapa);
  const celda = (r: Reporte, k: string) => {
    switch (k) {
      case "cuando": return (
        <td key={k} className="ops-celda-fecha" data-dia={diaDelReporte(r)}>
          {r.kind === "scrap" ? fmtDia(diaDelReporte(r), lang) : fmtDateTime(r.created_at)}
          <IconoDeFotos r={r} repetida={repetidas.has(r.id)} />
          <InsigniasDeFoto r={r} />
        </td>
      );
      case "etapa": return <td key={k} className="ops-col-etapa">{r.kind === "scrap" ? <ChipDeEtapa r={r} /> : "—"}</td>;
      case "tipo": return <td key={k} className="ops-celda-fecha">{INFO_DE_TIPO[r.kind].emoji} {nombreTipo(r.kind)}</td>;
      case "tienda": return <td key={k}>{r.store}</td>;
      case "lleno": return <td key={k}>{r.author_name ?? nombre(r.author_id)}</td>;
      case "empleado": return <td key={k}>{r.subject_ids.map(nombre).join(", ")}</td>;
      case "detalle": return (
        <td key={k} className="ops-detalle-corto">{r.kind === "scrap"
          ? `${r.product_not_in_catalog ? `${r.product_name ?? ""} (${t("not in catalog", "fuera de catálogo")})` : r.product_sku ?? ""} · ${repartoDeReporte(r).damaged} ${t("damaged", "dañadas")} · ${fmtMoney(r.total_loss)}${cuentaComoPerdida(r) ? "" : ` (${t("no CRMA", "sin CRMA")})`}`
          : String(r.answers.description ?? "")}{!conEtapa && r.kind === "scrap" && <ChipDeEtapa r={r} conFecha={false} />}</td>
      );
      default: return null;
    }
  };
  return (
    <div className="tbl-scroll tbl-caja">
      <table className="orders" data-lista={dataLista}>
        <thead>
          <tr>
            {conCasillas && <th className="ops-col-casilla" aria-label={t("Select for the approval sheet", "Marcar para la hoja de aprobación")} />}
            {aLaVista.map((k) => {
              const c = COLUMNAS_DE_LISTA.find((x) => x.key === k)!;
              return (
                <th key={k} data-col={k} className={cols.clase(k)} {...cols.arrastre(k)}
                  title={k === "cuando" ? t("Scrap: the date it was broken. Others: when it was reported. Drag to move this column.", "Merma: el día en que se rompió. Los demás: cuándo se reportó. Arrastra para mover esta columna.") : t("Drag to move this column", "Arrastra para mover esta columna")}>
                  {t(c.en, c.es)}
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {filas.length === 0 && <tr><td colSpan={columnas} className="hint">{vacio}</td></tr>}
          {filas.map((r) => (
            <tr key={r.id} onClick={() => onAbrir(r)} className="ops-fila-tabla" data-reporte={r.id} data-etapa={r.kind === "scrap" ? etapaDe(r) : undefined}>
              {conCasillas && (
                <td className="ops-col-casilla" onClick={(e) => e.stopPropagation()}>
                  {seleccion!.puede(r) && (
                    <input type="checkbox" checked={seleccion!.ids.has(r.id)} onChange={() => seleccion!.alternar(r.id)}
                      aria-label={t("Select for the approval sheet", "Marcar para la hoja de aprobación")} data-casilla={r.id} />
                  )}
                </td>
              )}
              {aLaVista.map((k) => celda(r, k))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * La lista de merma como el Excel de Roberto (gerente de almacén): una fila por reporte, con las columnas de su hoja
 * (fecha, código, descripción, cantidades agrupadas, cómo, motivo, lo rompió, lo reportó, CRMA #, comentarios) y las
 * de siempre (casilla, Cuándo, Etapa, Tipo, Tienda, Lo llenó), que pidió conservar. Encabezado de dos niveles; las
 * cifras a la derecha; se desplaza de lado dentro de su caja. Cada fila se abre como tarjeta, igual que antes.
 */
/** Las columnas de la tabla simple de reportes («Mis reportes»), en el orden de siempre. */
const COLUMNAS_DE_LISTA = [
  { key: "cuando", en: "When", es: "Cuándo" }, { key: "etapa", en: "Stage", es: "Etapa" }, { key: "tipo", en: "Type", es: "Tipo" },
  { key: "tienda", en: "Store", es: "Tienda" }, { key: "lleno", en: "Filed by", es: "Lo llenó" },
  { key: "empleado", en: "Employee", es: "Empleado" }, { key: "detalle", en: "Detail", es: "Detalle" },
] as const;

/** ¿Pantalla de teléfono? (≤ 640 px, el mismo corte que el resto de la app). En el servidor y al montar, no. */
function useEsTelefono(): boolean {
  const [es, setEs] = useState(false);
  useEffect(() => {
    const m = window.matchMedia("(max-width: 640px)");
    const mira = () => setEs(m.matches);
    mira();
    m.addEventListener("change", mira);
    return () => m.removeEventListener("change", mira);
  }, []);
  return es;
}

function TablaDeMermaExcel({ filas, ctx, onAbrir, vacio, repetidas, conEtapa = true, seleccion, grupos, onAbrirGrupo, enConflicto, onVisibles, "data-lista": dataLista }: {
  /** Avisa qué renglones se ven tras la búsqueda y los filtros (para que «seleccionar todos» marque solo esos). */
  onVisibles?: (ids: Set<string>) => void;
  filas: Reporte[]; ctx: Contexto; onAbrir: (r: Reporte) => void; vacio: string; repetidas: Map<string, string[]>; "data-lista": string;
  /** Con la lista de grupos sale la columna «Grupo» (a qué grupo de aprobación pertenece cada merma). */
  grupos?: readonly GrupoDeMerma[]; onAbrirGrupo?: (id: string) => void;
  /** Marcadas que ya están en un grupo: su renglón se resalta para que se quiten de la selección. */
  enConflicto?: ReadonlySet<string>;
  conEtapa?: boolean;
  seleccion?: { ids: Set<string>; puede: (r: Reporte) => boolean; alternar: (id: string) => void;
    /** Casilla del encabezado «seleccionar todos»: si todas/algunas están marcadas y la acción para alternarlas. */
    todas?: boolean; algunas?: boolean; alternarTodas?: () => void };
}) {
  const { t, lang } = usePrefs();
  const nombre = (id: string) => ctx.personas.find((p) => p.id === id)?.full_name ?? "—";
  const nombreTipo = (k: TipoDeReporte) => (lang === "es" ? INFO_DE_TIPO[k].es : INFO_DE_TIPO[k].en);
  const conCasillas = !!seleccion && filas.some((r) => seleccion.puede(r));
  // A qué grupo de aprobación pertenece cada merma (dueño, 10 nov): columna «Grupo» con su nombre (clic = abre el grupo).
  const conGrupo = !!grupos;
  const nombreDeGrupo = new Map((grupos ?? []).map((g) => [g.id, g.name]));
  // Columnas a gusto (dueño, 11 nov): ⚙ Columnas (mostrar/ocultar, ↑ ↓, restablecer) y arrastrar la cabecera. Cada quien
  // guarda lo suyo en este navegador. La casilla de selección va siempre primero. El CSV/PDF siguen con todas.
  // Reunión 12 nov: «Tipo» y «Tienda» salen ocultas mientras nadie las pida; en el teléfono de alguien de almacén,
  // además «Grupo» y «Fecha del daño» (la tabla no cabía).
  const telefonoDeAlmacen = useEsTelefono() && ctx.yo.role === "warehouse";
  const porDefecto = ocultasPorDefecto({ telefonoDeAlmacen });
  const { prefs, setPrefs } = usePrefsDeColumnas(ctx.yo.id, telefonoDeAlmacen);
  const [arrastrando, setArrastrando] = useState<string | null>(null);
  const disponibles = COLUMNAS_DE_MERMA.filter((c) => (c.key !== "etapa" || conEtapa) && (c.key !== "grupo" || conGrupo));
  const visibles = columnasVisibles(prefs).filter((c) => disponibles.some((d) => d.key === c.key));
  const tramos = tramosDeCabecera(visibles);
  const columnas = visibles.length + (conCasillas ? 1 : 0);
  const titulo = (c: ColumnaDeMerma) => (lang === "es" ? c.es : c.en);
  const arrastre = (c: ColumnaDeMerma) => ({
    draggable: true,
    onDragStart: (e: React.DragEvent) => { setArrastrando(c.key); e.dataTransfer.effectAllowed = "move"; },
    onDragOver: (e: React.DragEvent) => { if (arrastrando) e.preventDefault(); },
    onDrop: (e: React.DragEvent) => { e.preventDefault(); if (arrastrando) setPrefs(sueltaColumna(prefs, arrastrando, c.key)); setArrastrando(null); },
    onDragEnd: () => setArrastrando(null),
    title: t("Drag to move this column", "Arrastra para mover esta columna"),
  });
  const claseArrastre = (c: ColumnaDeMerma) => "ops-cabecera-arrastrable" + (arrastrando === c.key ? " ops-cabecera-arrastrando" : "");
  const ordenSelector = normalizaPrefs(prefs).orden.map((k) => disponibles.find((d) => d.key === k)).filter((c): c is ColumnaDeMerma => !!c);
  const deGrupoDePractica = grupoDePracticaPorReporte();
  // Ayudas de Roberto (12 nov): «search bar to find things» y «filter and sort». La búsqueda va primero (sin acentos,
  // cada palabra en algún campo); luego el orden y los filtros por columna (el ▾ de cada cabecera, como en Órdenes).
  const [busca, setBusca] = useState("");
  const nombreGrupoDe = (r: Reporte) => { const gid = r.scrap_group_id ?? deGrupoDePractica.get(r.id) ?? null; return gid ? (nombreDeGrupo.get(gid) ?? "") : ""; };
  // Reunión 12 nov: la columna «Tienda» sale oculta, así que quien ve VARIAS tiendas (un admin) tiene aquí su filtro.
  const tiendas = useMemo(() => Array.from(new Set(filas.map((r) => r.store))).sort(), [filas]);
  const [tiendaElegida, setTienda] = useState("");
  const tienda = tiendas.length > 1 && tiendas.includes(tiendaElegida) ? tiendaElegida : "";
  const filasBuscadas = useMemo(() => (busca.trim() === "" && tienda === "" ? filas : filas.filter((r) => {
    if (tienda !== "" && r.store !== tienda) return false;
    if (busca.trim() === "") return true;
    const c = celdasDeMerma(r, ctx.personas, lang);
    return coincideBusqueda([r.product_name, r.product_sku, c.codigo, c.descripcion, r.id.slice(0, 8), r.author_name ?? nombre(r.author_id),
      c.loRompio, c.loReporto, c.comentarios, c.motivo, c.como, c.crma, r.store, nombreGrupoDe(r)], busca);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  })), [filas, busca, tienda, ctx.personas, lang, grupos]);
  const valorDe = useCallback((key: string, r: Reporte): ValorDeCelda => {
    switch (key) {
      case "reportada": return r.created_at;
      case "etapa": return nombreDeEtapaVisible(etapaVisible(r), lang);
      case "grupo": return nombreGrupoDe(r) || null;
      case "tipo": return lang === "es" ? INFO_DE_TIPO[r.kind].es : INFO_DE_TIPO[r.kind].en;
      case "tienda": return r.store;
      case "lleno": return r.author_name ?? nombre(r.author_id);
    }
    if (key === "costo") return r.total_loss ?? null;
    const c = celdasDeMerma(r, ctx.personas, lang) as unknown as Record<string, string>;
    const ex = COLUMNAS_EXCEL.find((k) => k.id === key);
    const v = c[key] ?? "";
    if (ex?.num) { const n = Number(String(v).replace(/[^0-9.-]/g, "")); return v === "" || Number.isNaN(n) ? null : n; }
    return v === "" ? null : v;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ctx.personas, lang, grupos]);
  const orden = useOrdenYFiltro(filasBuscadas, valorDe);
  // Qué se ve, hacia arriba (para «seleccionar todos»). La clave es el texto de los ids: el efecto corre solo si cambian.
  const idsVisibles = orden.visibles.map((r) => r.id).join(",");
  useEffect(() => {
    onVisibles?.(new Set(idsVisibles === "" ? [] : idsVisibles.split(",")));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idsVisibles]);
  const columnasConMenu: ColumnaConMenu[] = visibles.map((c) => ({ key: c.key, en: c.en, es: c.es, numerico: !!COLUMNAS_EXCEL.find((k) => k.id === c.key)?.num }));
  const cabecera = (c: ColumnaDeMerma) => <CabeceraConMenu estado={orden} col={columnasConMenu.find((x) => x.key === c.key) ?? { key: c.key, en: c.en, es: c.es }} lang={lang} t={t} />;
  // Rosa (12 nov): «scroll bar on top not bottom»: una barra horizontal también ARRIBA de la tabla, sincronizada con la de
  // abajo (con muchas filas, la de abajo queda lejísimos).
  const cajaRef = useRef<HTMLDivElement>(null);
  const arribaRef = useRef<HTMLDivElement>(null);
  const [anchoTabla, setAnchoTabla] = useState(0);
  useEffect(() => {
    const caja = cajaRef.current;
    if (!caja) return;
    const mide = () => setAnchoTabla(caja.scrollWidth > caja.clientWidth + 1 ? caja.scrollWidth : 0);
    mide();
    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(mide) : null;
    ro?.observe(caja);
    const tabla = caja.querySelector("table"); if (tabla) ro?.observe(tabla);
    return () => ro?.disconnect();
  }, [visibles.length, orden.visibles.length]);
  const sincroniza = (de: "arriba" | "abajo") => {
    const a = arribaRef.current, b = cajaRef.current;
    if (!a || !b) return;
    if (de === "arriba" && b.scrollLeft !== a.scrollLeft) b.scrollLeft = a.scrollLeft;
    if (de === "abajo" && a.scrollLeft !== b.scrollLeft) a.scrollLeft = b.scrollLeft;
  };
  const celdaFija = (r: Reporte, key: string) => {
    switch (key) {
      case "reportada": return (
        <td key={key} style={{ whiteSpace: "nowrap" }} data-reportado={r.created_at}>
          {fmtDateTime(r.created_at)}
          <IconoDeFotos r={r} repetida={repetidas.has(r.id)} />
          <InsigniasDeFoto r={r} />
        </td>
      );
      case "etapa": return <td key={key} className="ops-col-etapa"><ChipDeEtapa r={r} /></td>;
      case "grupo": {
        // En práctica (11 nov) también sale el grupo de práctica de la merma (no está en la base).
        const gid = r.scrap_group_id ?? deGrupoDePractica.get(r.id) ?? null;
        return (
          <td key={key} className="ops-col-grupo-merma" data-grupo-de={gid ?? ""}>
            {gid
              // Reunión 11 nov: o la hoja firmada (ya aprobada) o el grupo (pendiente), nunca los dos.
              ? (documentoDeGrupo(r, gid) === "hoja-firmada"
                  ? <button type="button" className="ops-folio-link" onClick={(e) => { e.stopPropagation(); onAbrirGrupo?.(gid); }} title={t("See the signed group sheet", "Ver la hoja firmada del grupo")} data-hoja-firmada={gid}>📄 {t("Signed sheet", "Hoja firmada")}</button>
                  : <button type="button" className="ops-folio-link" onClick={(e) => { e.stopPropagation(); onAbrirGrupo?.(gid); }} title={t("Open this group", "Abrir este grupo")}>🗂 {nombreDeGrupo.get(gid) ?? t("Group", "Grupo")}</button>)
              : <span className="hint">—</span>}
          </td>
        );
      }
      case "tipo": return <td key={key} style={{ whiteSpace: "nowrap" }}>{INFO_DE_TIPO[r.kind].emoji} {nombreTipo(r.kind)}</td>;
      case "tienda": return <td key={key}>{r.store}</td>;
      case "lleno": return <td key={key}>{r.author_name ?? nombre(r.author_id)}</td>;
      default: return null;
    }
  };
  return (
    <div className="ops-tabla-excel-con-columnas">
      <div className="ops-columnas-barra">
        <input type="search" className="ops-busca-merma" value={busca} onChange={(e) => setBusca(e.target.value)} data-busca-merma
          placeholder={t("Search product, SKU, folio, person, comment…", "Buscar producto, SKU, folio, persona, comentario…")}
          aria-label={t("Search scrap reports", "Buscar en la merma")} />
        {tiendas.length > 1 && (
          <select className="ops-filtro-tienda" value={tienda} onChange={(e) => setTienda(e.target.value)} data-filtro-tienda aria-label={t("Store", "Tienda")}>
            <option value="">{t("All stores", "Todas las tiendas")}</option>
            {tiendas.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        )}
        {(busca.trim() !== "" || tienda !== "" || Object.keys(orden.filtros).length > 0) && (
          <span className="hint" data-cuenta-busqueda>{t(`${orden.visibles.length} of ${filas.length}`, `${orden.visibles.length} de ${filas.length}`)}
            {Object.keys(orden.filtros).length > 0 && <> · <button type="button" className="ops-folio-link" onClick={orden.limpiarTodo}>{t("Clear filters", "Quitar filtros")}</button></>}
          </span>
        )}
        <SelectorDeColumnas
          columnas={ordenSelector}
          elegidas={visibles.map((c) => c.key)}
          onAlterna={(k) => setPrefs(alternaColumna(prefs, k))}
          rotulo={titulo} t={t}
          titulo={t("Show and order columns", "Mostrar y ordenar columnas")}
          nota={t("Drag a column header (or a row of this list) to move it. Saved in this browser.", "Arrastra la cabecera de una columna (o un renglón de esta lista) para moverla. Se guarda en este navegador.")}
          mover={{
            seMueve: (k, d) => { const o = ordenSelector.map((c) => c.key); const i = o.indexOf(k) + d; return i >= 0 && i < o.length; },
            onMueve: (k, d) => setPrefs(mueveColumna(prefs, k, d)),
            ordenPropio: ordenPropio(prefs, porDefecto),
            onRestablece: () => setPrefs(prefsIniciales({ telefonoDeAlmacen })),
            onSuelta: (desde, sobre) => setPrefs(sueltaColumna(prefs, desde, sobre)),
          }}
        />
      </div>
      {anchoTabla > 0 && (
        <div className="ops-scroll-arriba" ref={arribaRef} onScroll={() => sincroniza("arriba")} aria-hidden data-scroll-arriba>
          <div style={{ width: anchoTabla }} />
        </div>
      )}
      <div className="tbl-scroll tbl-caja ops-tabla-excel-caja" ref={cajaRef} onScroll={() => sincroniza("abajo")}>
        <table className="orders ops-tabla-excel" data-lista={dataLista}>
          <thead>
            <tr>
              {conCasillas && (
                <th rowSpan={2} className="ops-col-casilla">
                  {seleccion!.alternarTodas && (
                    <input type="checkbox" checked={!!seleccion!.todas}
                      ref={(el) => { if (el) el.indeterminate = !!seleccion!.algunas && !seleccion!.todas; }}
                      onChange={seleccion!.alternarTodas} data-casilla-todas
                      aria-label={t("Select all", "Seleccionar todos")} title={t("Select all", "Seleccionar todos")} />
                  )}
                </th>
              )}
              {tramos.map((tr, n) => tr.tipo === "suelta"
                ? <th key={tr.col.key} rowSpan={2} data-col={tr.col.key} className={claseArrastre(tr.col)} {...arrastre(tr.col)}>{cabecera(tr.col)}</th>
                : <th key={`cant-${n}`} colSpan={tr.cols.length} className="ops-col-grupo" data-col="cantidades">{t("Quantities", "Cantidades")}</th>)}
            </tr>
            <tr>
              {tramos.flatMap((tr) => (tr.tipo === "cantidades" ? tr.cols : [])).map((c) => (
                <th key={c.key} data-col={c.key} className={"num ops-col-subgrupo " + claseArrastre(c)} {...arrastre(c)}>{cabecera(c)}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filas.length === 0 && <tr><td colSpan={columnas} className="hint">{vacio}</td></tr>}
            {filas.length > 0 && orden.visibles.length === 0 && <tr><td colSpan={columnas} className="hint" data-sin-coincidencias>{t("Nothing matches the search or filters.", "Nada coincide con la búsqueda o los filtros.")}</td></tr>}
            {orden.visibles.map((r) => {
              const c = celdasDeMerma(r, ctx.personas, lang);
              const celda = (k: (typeof COLUMNAS_EXCEL)[number]) => {
                // La fecha del daño corta (dueño, 11 nov): MM/DD/YY en los dos idiomas.
                if (k.id === "fecha") return <td key={k.id} className="ops-celda-fecha" data-col={k.id} data-dia={c.fecha}>{fmtDiaCorto(c.fecha)}</td>;
                if (k.id === "costo") return (
                  <td key={k.id} className="num" data-col={k.id} title={t(`Price per piece: ${fmtMoney(r.unit_cost)}`, `Precio por pieza: ${fmtMoney(r.unit_cost)}`)} data-cuenta-como-perdida={cuentaComoPerdida(r) ? "si" : "no"}>
                    {fmtMoney(r.total_loss)}{!cuentaComoPerdida(r) && <span className="hint"> ({t("no CRMA", "sin CRMA")})</span>}
                  </td>
                );
                if (k.id === "codigo" && r.product_not_in_catalog) return <td key={k.id} data-col={k.id}><span className="ops-fuera-de-catalogo">{t("Not in catalog", "No está en el catálogo")}</span></td>;
                if (k.id === "comentarios" || k.id === "descripcion") return <td key={k.id} className="ops-celda-texto" data-col={k.id} title={c[k.id]}>{c[k.id]}</td>;
                return <td key={k.id} className={k.num ? "num" : undefined} data-col={k.id}>{c[k.id]}</td>;
              };
              return (
                <tr key={r.id} onClick={() => onAbrir(r)} className={"ops-fila-tabla" + (enConflicto?.has(r.id) ? " ops-fila-en-grupo-conflicto" : "")} data-reporte={r.id} data-etapa={etapaDe(r)}>
                  {conCasillas && (
                    <td className="ops-col-casilla" onClick={(e) => e.stopPropagation()}>
                      {seleccion!.puede(r) && (
                        <input type="checkbox" checked={seleccion!.ids.has(r.id)} onChange={() => seleccion!.alternar(r.id)}
                          aria-label={t("Select for the approval sheet", "Marcar para la hoja de aprobación")} data-casilla={r.id} />
                      )}
                    </td>
                  )}
                  {visibles.map((col) => {
                    const ex = COLUMNAS_EXCEL.find((k) => k.id === col.key);
                    return ex ? celda(ex) : celdaFija(r, col.key);
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <MenuDeColumnaAbierto estado={orden} columnas={columnasConMenu} lang={lang} t={t} />
    </div>
  );
}

/** Las columnas elegidas por quien mira, guardadas en este navegador (si el navegador no deja, se usa lo de siempre). */
function usePrefsDeColumnas(yo: string, telefonoDeAlmacen: boolean) {
  const clave = clavePrefsDeMerma(yo, telefonoDeAlmacen);
  const [prefs, setEstado] = useState<PrefsDeColumnas>(() => prefsIniciales({ telefonoDeAlmacen }));
  useEffect(() => {
    const lee = (k: string): unknown => { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : null; } catch { return null; } };
    setEstado(prefsAlAbrir(lee(clave), lee(clavePrefsDeMermaVieja(yo)), { telefonoDeAlmacen }));
  }, [clave, yo, telefonoDeAlmacen]);
  const setPrefs = (p: PrefsDeColumnas) => {
    const n = normalizaPrefs(p);
    setEstado(n);
    try { localStorage.setItem(clave, JSON.stringify(n)); } catch { /* sin almacenamiento: dura hasta recargar */ }
  };
  return { prefs, setPrefs };
}

/**
 * «📅 Elegir fecha» (dueño, 11 nov): un botón con la elección actual («📅 Este mes», o el rango si es personalizado) que
 * abre el menú: primero «Rango personalizado» (abre Desde / Hasta), luego Hoy, Ayer, Esta semana… Se cierra con un clic
 * fuera o con Escape; con teclado, Tab recorre las opciones.
 */
function MenuDeFecha({ eleccion, etiqueta, onElegir }: { eleccion: Eleccion; etiqueta: string; onElegir: (a: Atajo) => void }) {
  const { t, lang } = usePrefs();
  const [abierto, setAbierto] = useState(false);
  const caja = useRef<HTMLDivElement>(null);
  useCierraAlSalir(abierto, () => setAbierto(false), () => [caja.current]);
  const nombre = (a: Atajo) => (lang === "es" ? NOMBRE_DE_ATAJO[a].es : NOMBRE_DE_ATAJO[a].en);
  const actual = eleccion.atajo === "otro" ? etiqueta : nombre(eleccion.atajo);
  return (
    <div ref={caja} className="ops-menu-fecha" data-rango-atajos>
      <button type="button" className="chip active" aria-haspopup="menu" aria-expanded={abierto} onClick={() => setAbierto((v) => !v)} data-accion="elegir-fecha"
        title={t("Pick date", "Elegir fecha")}>📅 {actual} ▾</button>
      {abierto && (
        <div className="ops-menu-fecha-lista" role="menu">
          {ATAJOS_DEL_MENU.map((a) => (
            <button type="button" role="menuitemradio" aria-checked={eleccion.atajo === a} key={a}
              className={"ops-menu-fecha-opcion" + (eleccion.atajo === a ? " activa" : "")}
              onClick={() => { onElegir(a); setAbierto(false); }} data-atajo={a}>
              {a === "otro" ? "📅 " : ""}{nombre(a)}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/** 268: la cámara junto a la fecha; solo si hay fotos, y el título dice cuántas. Sin icono = sin fotos. */
function IconoDeFotos({ r, repetida = false }: { r: Pick<Reporte, "photos">;
  /** Reunión 12 nov: la foto repetida ya no es un letrero: la cámara sale ROJA (y el título lo explica). */
  repetida?: boolean }) {
  const { t, lang } = usePrefs();
  const n = (r.photos ?? []).length;
  const ic = iconoDeFotos(n, lang);
  if (!ic.muestra) return null;
  if (repetida) {
    const titulo = `${ic.titulo} · ${t("Duplicate photo: one of its photos is also in another report", "Foto repetida: una de sus fotos también está en otro reporte")}`;
    return (
      <span className="ops-icono-fotos ops-camara-repetida" title={titulo} aria-label={titulo} role="img" data-fotos={n} data-foto-repetida>
        <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" fill="currentColor">
          <path d="M9 4 7.2 6H4a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-3.2L15 4H9Zm3 5a4.5 4.5 0 1 1 0 9 4.5 4.5 0 0 1 0-9Zm0 2a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5Z" />
        </svg>
      </span>
    );
  }
  return <span className="ops-icono-fotos" title={ic.titulo} aria-label={ic.titulo} role="img" data-fotos={n}> 📷</span>;
}

/** 268: «Falta la foto» / «Foto pendiente» (guardada en papel). La «foto repetida» ahora es la cámara roja (`IconoDeFotos`). */
function InsigniasDeFoto({ r }: { r: Reporte }) {
  const { lang } = usePrefs();
  if (!sinFoto(r)) return null;
  return <span className={`ops-insignia ops-insignia-sin-foto${fotoPendienteVencida(r) ? " vencida" : ""}`} data-sin-foto={fotoPendienteVencida(r) ? "vencida" : "si"}>{etiquetaSinFoto(r, lang)}</span>;
}

/**
 * Un reporte como tarjeta, encima de la lista (regla de la casa: los registros se abren en su sitio). También la abre
 * el asistente (268) cuando una foto ya se usó en otro reporte.
 */
export function Tarjeta({ r, ctx, onCerrar, onCambio, onBorrado }: { r: Reporte; ctx: Contexto; onCerrar: () => void; onCambio: (r: Reporte) => void;
  /** 297: el admin borró este reporte de prueba; quien abrió la tarjeta lo quita de su lista. */
  onBorrado?: (id: string) => void }) {
  const { t, lang } = usePrefs();
  // 297 (reunión 11 nov, 11 PM): el admin borra un reporte de merma que no es real («Test»), con confirmación aquí mismo.
  // 299 (ayuda de Roberto, 12 nov): también el gerente de esa tienda, no solo el admin.
  const borra = puedeBorrarMerma(ctx.yo, r);
  const [confirmaBorrar, setConfirmaBorrar] = useState(false);
  const [borrando, setBorrando] = useState(false);
  const [errorBorrar, setErrorBorrar] = useState<string | null>(null);
  const borrar = async () => {
    setBorrando(true); setErrorBorrar(null);
    try {
      if (!ctx.demo && !ensenanzaDelNavegador()) await borrarReporteDeMerma(createClient(), r.id);
      onBorrado?.(r.id);
      onCerrar();
    } catch (e) { setErrorBorrar(mensajeDeError(e)); } finally { setBorrando(false); }
  };
  const [fotos, setFotos] = useState<string[]>([]);
  const [corrigiendo, setCorrigiendo] = useState(false);
  const [editando, setEditando] = useState(false);
  const [huellasCalculadas, setHuellasCalculadas] = useState(false);
  const corrige = puedeCorregirMerma(ctx.yo, r);
  // 268: el autor o quien corrige la merma le agrega la foto a una guardada «sin foto».
  // D-1001 (dueño, 12 nov: «dice add a photo pero no hay ningún botón»): el formulario de la foto sale en CUALQUIER merma
  // sin fotos, no solo en la guardada «sin foto» (photo_pending); es el mismo criterio que el paso «foto» de la tarjeta.
  const agregaFoto = r.kind === "scrap" && (sinFoto(r) || (r.photos ?? []).length === 0) && (r.author_id === ctx.yo.id || corrige);
  const sinHuella = fotosSinHuella(r);
  useEffect(() => {
    if (ctx.demo || r.photos.length === 0) return;
    let vivo = true;
    void enlacesDeFotos(createClient(), r.photos).then((u) => { if (vivo) setFotos(u); });
    return () => { vivo = false; };
  }, [r.photos, ctx.demo]);
  // 268: las fotos de antes no tienen huella (SQL no puede leer storage): se calcula aquí, al abrir, y se guarda.
  useEffect(() => {
    if (ctx.demo || sinHuella === 0 || fotos.length !== r.photos.length || huellasCalculadas) return;
    let vivo = true;
    (async () => {
      try {
        const nuevas: (string | null)[] = [];
        for (let n = 0; n < fotos.length; n++) {
          const ya = r.photo_hashes?.[n];
          if (ya) { nuevas.push(ya); continue; }
          const res = await fetch(fotos[n]);
          nuevas.push(res.ok ? await sha256Hex(await res.arrayBuffer()) : null);
        }
        if (!vivo) return;
        await guardarHuellas(createClient(), r.id, nuevas);
        if (vivo) { setHuellasCalculadas(true); onCambio({ ...r, photo_hashes: nuevas }); }
      } catch { /* sin la 268, o sin red: se intenta la próxima vez que se abra */ }
    })();
    return () => { vivo = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fotos, sinHuella, ctx.demo, huellasCalculadas]);
  const nombre = (id: string) => ctx.personas.find((p) => p.id === id)?.full_name ?? "—";
  const info = INFO_DE_TIPO[r.kind];
  const reparto = repartoDeReporte(r);
  const reportadoPor = Array.isArray(r.answers[PASO_QUIEN_REPORTO]) ? (r.answers[PASO_QUIEN_REPORTO] as string[]) : [];
  const filas: [string, string][] = [];
  for (const p of PASOS[r.kind]) {
    const v = r.answers[p.id];
    if (v == null || v === "") continue;
    if (p.tipo === "personas" || p.tipo === "persona" || p.tipo === "fecha") continue;
    // En merma, el origen, el motivo y el CRMA ya salen arriba desde sus columnas (las que el gerente puede corregir).
    if (r.kind === "scrap" && (p.id === "return_type" || p.id === "reason" || p.id === "crma")) continue;
    // 273: el equipo de un reporte de mantenimiento puede venir del inventario (answers.equipment_name).
    const texto = p.tipo === "opcion" || p.tipo === "sino" ? etiquetaDeOpcion(r.kind, p.id, v, lang) : String(v);
    filas.push([(lang === "es" ? p.es : p.en).replace(/ \((optional|opcional)\)$/, ""), r.kind === "maintenance" && p.id === "equipment" ? etiquetaDeEquipoDelReporte(r.answers, texto) : texto]);
  }
  return (
    <div className="overlay" onClick={onCerrar}>
      <div className="modal ops-tarjeta-reporte" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" data-tarjeta={r.id}>
        <CerrarX onCerrar={onCerrar} />
        <h3>{info.emoji} {lang === "es" ? info.es : info.en}<IconoDeFotos r={r} /></h3>
        <p className="sub">{r.kind === "scrap" ? t("Reported ", "Reportado ") : ""}{fmtDateTime(r.created_at)} · {r.store} · {t("filed by", "lo llenó")} {r.author_name ?? nombre(r.author_id)}</p>
        {sinFoto(r) && (
          <p className="ops-aviso ops-aviso-error" role="status" data-tarjeta-sin-foto={fotoPendienteVencida(r) ? "vencida" : "si"}>
            📷 {etiquetaSinFoto(r, lang)} · {t("Saved from paper, without a photo of the pieces. It is incomplete until the photo is added.", "Guardado desde papel, sin foto de las piezas. Está incompleto hasta que se le agregue la foto.")}
          </p>
        )}
        {esDeRrhh(r.kind) && <p className="ops-tarjeta-rrhh">{t("In the employee's HR file", "En el expediente del empleado")}</p>}
        <dl className="ops-tarjeta-datos">
          {r.subject_ids.length > 0 && <><dt>{t("Employee", "Empleado")}</dt><dd>{r.subject_ids.map(nombre).join(", ")}</dd></>}
          {r.kind === "scrap" && (
            <>
              <dt>{t("Date broken", "Fecha del daño")}</dt><dd data-fecha-del-dano={diaDelReporte(r)}>{fmtDia(diaDelReporte(r), lang)}</dd>
              <dt>{t("Product", "Producto")}</dt>
              <dd data-producto-reporte={r.product_not_in_catalog ? "libre" : "catalogo"}>
                {r.product_not_in_catalog
                  ? <>{r.product_name} <span className="ops-fuera-de-catalogo">{t("Not in catalog", "No está en el catálogo")}</span></>
                  : <>{r.product_sku} · {r.product_name}</>}
                {corrige && !corrigiendo && (
                  <button type="button" className="btn btn-sm" onClick={() => setCorrigiendo(true)} data-accion="corregir-producto">
                    {r.product_not_in_catalog ? t("Link / edit", "Vincular / editar") : t("Edit", "Editar")}
                  </button>
                )}
              </dd>
              {corrigiendo && <CorregirProducto r={r} ctx={ctx} onListo={(n) => { setCorrigiendo(false); if (n) onCambio(n); }} />}
              {corrigiendo && <CorregirOrigen r={r} ctx={ctx} onListo={(n) => { setCorrigiendo(false); if (n) onCambio(n); }} />}
              <dt>{t("Type", "Tipo")}</dt><dd>{etiquetaDeOpcion("scrap", "scrap_type", r.scrap_type, lang)}</dd>
              <dt>{t("Damaged / sample", "Dañadas / muestra")}</dt>
              <dd data-reparto-reporte={`${reparto.damaged}/${reparto.sample}`}>{t(`${reparto.damaged} damaged · ${reparto.sample} sample`, `${reparto.damaged} dañadas · ${reparto.sample} de muestra`)}</dd>
              <dt>{t("Quantity", "Cantidad")}</dt><dd>{r.loose_pieces
                ? t(`${r.boxes} boxes × ${r.pieces_per_box} + ${r.loose_pieces} loose = ${r.total_pieces} pieces`, `${r.boxes} cajas × ${r.pieces_per_box} + ${r.loose_pieces} sueltas = ${r.total_pieces} piezas`)
                : t(`${r.boxes} boxes × ${r.pieces_per_box} = ${r.total_pieces} pieces`, `${r.boxes} cajas × ${r.pieces_per_box} = ${r.total_pieces} piezas`)}</dd>
              <dt>{t("Price per piece (when reported)", "Precio por pieza (al reportar)")}</dt><dd>{fmtMoney(r.unit_cost)}</dd>
              <dt>{t("Loss (damaged pieces only)", "Pérdida (solo piezas dañadas)")}</dt><dd className="ops-tarjeta-perdida" data-perdida-reporte={r.total_loss ?? ""} data-cuenta-como-perdida={cuentaComoPerdida(r) ? "si" : "no"}>
                {fmtMoney(r.total_loss)}
                {!cuentaComoPerdida(r) && <span className="hint" data-sin-crma> · {t("No CRMA: not counted as loss", "Sin CRMA: no cuenta como pérdida")}</span>}
              </dd>
              <dt>{t("Where from", "De dónde")}</dt><dd data-origen-reporte={r.return_type ?? ""}>{etiquetaDeOpcion("scrap", "return_type", r.return_type, lang) || "—"}</dd>
              <dt>{t("Reason", "Motivo")}</dt><dd>{etiquetaDeOpcion("scrap", "reason", r.reason, lang)}</dd>
              {/* Reunión 12 nov: «lo rompió» también admite un nombre ESCRITO (va en answers, como «lo reportó»). */}
              {(r.broken_by.length > 0 || rompioEscrito(r.answers).length > 0) && <><dt>{t("Broken by", "Lo rompió")}</dt><dd data-lo-rompio>{[...r.broken_by.map(nombre), ...rompioEscrito(r.answers)].join(", ")}</dd></>}
              {/* Quién avisó (D-915): va en answers, no en columna. Distinto de quién lo rompió y de quién lo llenó. */}
              {reportadoPor.length > 0 && <><dt>{t("Reported by", "Lo reportó")}</dt><dd data-reportado-por>{reportadoPor.map((x) => nombreOTexto(ctx.personas, x)).join(", ")}</dd></>}
              {(r.crma || r.return_type === "customer_return") && <><dt>CRMA</dt><dd data-crma-reporte={r.crma ?? ""}>{r.crma || t("Not yet", "Todavía no")}</dd></>}
            </>
          )}
          {filas.map(([k, v]) => <div key={k} className="ops-par"><dt>{k}</dt><dd>{v}</dd></div>)}
        </dl>
        {r.photos.length > 0 && <VisorDeFotos fotos={fotos} demo={ctx.demo} />}
        {r.photos.length > 0 && sinHuella > 0 && !ctx.demo && (
          <p className="hint" data-huellas="calculando">{t("Report from before duplicate detection: the photo fingerprints are being computed now and saved for next time.", "Reporte de antes de la detección de repetidas: las huellas de las fotos se calculan ahora y se guardan para la próxima.")}</p>
        )}
        {/* D-921 (270): la línea de etapas y lo que el gerente hace con ella. Sin la 270 (sin columnas) sale solo la línea, sin botones. */}
        {r.kind === "scrap" && <HistorialDeMerma r={r} ctx={ctx} />}
        {r.kind === "scrap" && <LineaDeEtapas r={r} ctx={ctx} onCambio={onCambio} />}
        {r.kind === "scrap" && !tieneEtapas(r) && puedeCorregirMerma(ctx.yo, r) && <p className="hint" data-sin-270>{t("Approval stages need database migration 270.", "Las etapas de aprobación necesitan la migración 270 de la base.")}</p>}
        {editando && <EditarReporteDeMerma r={r} ctx={ctx} onListo={(n) => { setEditando(false); if (n) onCambio(n); }} />}
        {confirmaBorrar && (
          <div className="ops-aviso" role="alertdialog" data-confirma-borrar-reporte>
            <p>{t("Delete this report? Only for reports that aren't real (tests). It's removed for good, with its photos; if it's in a pending group it leaves the group.",
              "¿Borrar este reporte? Solo para reportes que no son reales (pruebas). Se borra para siempre, con sus fotos; si está en un grupo pendiente, sale del grupo.")}</p>
            {errorBorrar && <p className="ops-aviso ops-aviso-error" role="alert">{errorBorrar}</p>}
            <div className="ops-etapa-acciones">
              <button type="button" className="btn btn-danger" disabled={borrando} onClick={() => void borrar()} data-accion="confirmar-borrar-reporte">{borrando ? t("Deleting…", "Borrando…") : t("Yes, delete", "Sí, borrar")}</button>
              <button type="button" className="btn btn-ghost" disabled={borrando} onClick={() => setConfirmaBorrar(false)}>{t("Cancel", "Cancelar")}</button>
            </div>
          </div>
        )}
        {/* Dueño, 12 nov: tomar foto / galería, más chico y ABAJO, justo arriba de Editar · Borrar · Cerrar. */}
        {agregaFoto && <AgregarFoto r={r} ctx={ctx} onListo={onCambio} />}
        {/* Reunión 11 nov, 11 PM: los botones ABAJO, como en el resto de la app (Cerrar al final). */}
        <div className="modal-actions" data-acciones-tarjeta>
          {r.kind === "scrap" && corrige && <button type="button" className="btn" onClick={() => setEditando((v) => !v)} data-accion="editar-reporte">✏️ {t("Edit report", "Editar reporte")}</button>}
          {borra && !confirmaBorrar && <button type="button" className="btn btn-ghost" onClick={() => setConfirmaBorrar(true)} data-accion="borrar-reporte">🗑 {t("Delete report", "Borrar reporte")}</button>}
          <button type="button" className="btn btn-primary" onClick={onCerrar}>{t("Close", "Cerrar")}</button>
        </div>
      </div>
    </div>
  );
}

/**
 * 285: editar TODO un reporte de merma (admin/gerente), aun ya aprobado. Solo se envían los campos que cambian; la base
 * recalcula la pérdida, revierte la aprobación (vuelve a «pendiente de firma») y borra las firmas por el trigger. Un
 * almacenista no ve este botón (la puerta es `puedeCorregirMerma`).
 */
function EditarReporteDeMerma({ r, ctx, onListo }: { r: Reporte; ctx: Contexto; onListo: (n: Reporte | null) => void }) {
  const { t, lang } = usePrefs();
  const txt = (v: unknown) => (v == null ? "" : String(v));
  const num = (v: number | null | undefined) => (v == null ? "" : String(v));
  const [productName, setProductName] = useState(r.product_name ?? "");
  const [scrapType, setScrapType] = useState(r.scrap_type ?? "");
  const [boxes, setBoxes] = useState(num(r.boxes));
  const [perBox, setPerBox] = useState(num(r.pieces_per_box));
  const [loose, setLoose] = useState(num(r.loose_pieces));
  const [damaged, setDamaged] = useState(num(r.damaged_pieces));
  const [sample, setSample] = useState(num(r.sample_pieces));
  const [cost, setCost] = useState(num(r.unit_cost));
  const [returnType, setReturnType] = useState(r.return_type ?? "");
  const [reason, setReason] = useState(r.reason ?? "");
  const [crma, setCrma] = useState(r.crma ?? "");
  const [brokenOn, setBrokenOn] = useState(diaDelReporte(r));
  const [comments, setComments] = useState(txt(r.answers?.comments));
  const inicialRotos = (r.broken_by ?? []).slice().sort();
  const [brokenBy, setBrokenBy] = useState<string[]>(r.broken_by ?? []);
  // Reunión 12 nov: nombres ESCRITOS de quien lo rompió (alguien que no está en la lista). Van en `answers`.
  const escritosIniciales = rompioEscrito(r.answers);
  const [escritos, setEscritos] = useState<string[]>(escritosIniciales);
  const [escribiendo, setEscribiendo] = useState("");
  const agregaEscrito = () => {
    const n = escribiendo.trim().replace(/\s+/g, " ");
    if (n !== "" && !escritos.some((x) => x.toLowerCase() === n.toLowerCase())) setEscritos((xs) => [...xs, n]);
    setEscribiendo("");
  };
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const opciones = (o: { v: string; en: string; es: string }) => (lang === "es" ? o.es : o.en);
  const personas = personasParaElegir(ctx.personas, r.store, "", true); // «quién lo rompió»: solo el piso
  const nEntero = (s: string) => (s.trim() === "" ? null : Math.trunc(Number(s)));

  const guarda = async () => {
    setGuardando(true); setError(null);
    try {
      const nBoxes = nEntero(boxes), nPer = nEntero(perBox), nLoose = nEntero(loose);
      const total = (nBoxes ?? 0) * (nPer ?? 0) + (nLoose ?? 0);
      const parche: ParcheDeMerma = {};
      if (productName.trim() !== (r.product_name ?? "")) { parche.product_name = productName.trim(); parche.product_not_in_catalog = true; parche.product_id = null; parche.product_sku = null; }
      if (scrapType !== (r.scrap_type ?? "")) parche.scrap_type = scrapType;
      if (nBoxes !== r.boxes) parche.boxes = nBoxes;
      if (nPer !== r.pieces_per_box) parche.pieces_per_box = nPer;
      if (nLoose !== r.loose_pieces) parche.loose_pieces = nLoose;
      if ((nBoxes !== r.boxes || nPer !== r.pieces_per_box || nLoose !== r.loose_pieces)) parche.total_pieces = total;
      if (nEntero(damaged) !== r.damaged_pieces) parche.damaged_pieces = nEntero(damaged);
      if (nEntero(sample) !== r.sample_pieces) parche.sample_pieces = nEntero(sample);
      const nCost = cost.trim() === "" ? null : Number(cost);
      if (nCost !== r.unit_cost) parche.unit_cost = nCost;
      if (returnType !== (r.return_type ?? "")) parche.return_type = returnType;
      if (reason !== (r.reason ?? "")) parche.reason = reason;
      if (crma.trim() !== (r.crma ?? "")) parche.crma = crma.trim() || null;
      if (brokenOn !== diaDelReporte(r)) parche.broken_on = brokenOn || null;
      // La base FUNDE `answers` con lo que ya había: solo viajan las claves que cambian.
      const respuestas: Record<string, unknown> = {};
      if (comments.trim() !== txt(r.answers?.comments)) respuestas.comments = comments.trim();
      const pendiente = escribiendo.trim().replace(/\s+/g, " ");
      const escritosFinales = pendiente !== "" && !escritos.some((x) => x.toLowerCase() === pendiente.toLowerCase()) ? [...escritos, pendiente] : escritos;
      if (JSON.stringify(escritosFinales) !== JSON.stringify(escritosIniciales)) respuestas[CLAVE_ROMPIO_TEXTO] = escritosFinales;
      if (Object.keys(respuestas).length > 0) parche.answers = respuestas;
      if (JSON.stringify(brokenBy.slice().sort()) !== JSON.stringify(inicialRotos)) parche.broken_by = brokenBy;
      if (Object.keys(parche).length === 0) { onListo(null); return; }
      if (!ctx.demo) await editarReporteDeMerma(createClient(), r.id, parche);
      // Refresca el reporte desde la base (pérdida y etapa recalculadas; firmas borradas).
      let fresco: Reporte = { ...r };
      if (!ctx.demo) {
        const { data } = await createClient().from("warehouse_reports").select("*").eq("id", r.id).maybeSingle();
        if (data) fresco = { ...(data as Reporte), unit_cost: data.unit_cost == null ? null : Number(data.unit_cost), total_loss: data.total_loss == null ? null : Number(data.total_loss), broken_on: (data.broken_on as string | null) ?? null, firmas: null };
      }
      onListo(fresco);
    } catch (e) { setError(mensajeDeError(e)); }
    finally { setGuardando(false); }
  };

  return (
    <div className="ops-corregir ops-editar-reporte" data-editar-reporte={r.id}>
      <p className="hint ops-aviso-reeditar" data-aviso-reeditar>⚠️ {t("Editing clears the signatures: it will need to be approved again.", "Editar borra las firmas: habrá que aprobarlo de nuevo.")}</p>
      <div className="ops-editar-campos">
        <label>{t("Product / description", "Producto / descripción")}<input className="ops-campo" value={productName} onChange={(e) => setProductName(e.target.value)} maxLength={200} data-campo="editar-nombre" /></label>
        <label>{t("Type", "Tipo")}<select className="ops-campo" value={scrapType} onChange={(e) => setScrapType(e.target.value)} data-campo="editar-tipo">{TIPOS_DE_MERMA.map((o) => <option key={o.v} value={o.v}>{opciones(o)}</option>)}</select></label>
        <label>{t("Boxes", "Cajas")}<input className="ops-campo" type="number" inputMode="numeric" value={boxes} onChange={(e) => setBoxes(e.target.value)} data-campo="editar-cajas" /></label>
        <label>{t("Pieces / box", "Piezas / caja")}<input className="ops-campo" type="number" inputMode="numeric" value={perBox} onChange={(e) => setPerBox(e.target.value)} data-campo="editar-por-caja" /></label>
        <label>{t("Loose", "Sueltas")}<input className="ops-campo" type="number" inputMode="numeric" value={loose} onChange={(e) => setLoose(e.target.value)} data-campo="editar-sueltas" /></label>
        <label>{t("Damaged", "Dañadas")}<input className="ops-campo" type="number" inputMode="numeric" value={damaged} onChange={(e) => setDamaged(e.target.value)} data-campo="editar-danadas" /></label>
        <label>{t("Sample", "Muestra")}<input className="ops-campo" type="number" inputMode="numeric" value={sample} onChange={(e) => setSample(e.target.value)} data-campo="editar-muestra" /></label>
        <label>{t("Price / piece", "Precio / pieza")}<input className="ops-campo" type="number" inputMode="decimal" value={cost} onChange={(e) => setCost(e.target.value)} data-campo="editar-precio" /></label>
        <label>{t("Where from", "De dónde")}<select className="ops-campo" value={returnType} onChange={(e) => { const o = e.target.value; setReturnType(o); if (reason && !motivosDeMerma(o).some((m) => m.v === reason)) setReason(""); }} data-campo="editar-origen">{ORIGENES_DE_MERMA.map((o) => <option key={o.v} value={o.v}>{opciones(o)}</option>)}</select></label>
        <label>{t("Reason", "Motivo")}<select className="ops-campo" value={reason} onChange={(e) => setReason(e.target.value)} data-campo="editar-motivo"><option value="">—</option>{[...motivosDeMerma(returnType), ...MOTIVOS_VIEJOS.filter((o) => o.v === reason && !motivosDeMerma(returnType).some((m) => m.v === o.v))].map((o) => <option key={o.v} value={o.v}>{opciones(o)}</option>)}</select></label>
        <label>CRMA<input className="ops-campo" value={crma} onChange={(e) => setCrma(e.target.value)} data-campo="editar-crma" /></label>
        <label>{t("Date broken", "Fecha del daño")}<input className="ops-campo" type="date" value={brokenOn} onChange={(e) => setBrokenOn(e.target.value)} data-campo="editar-fecha" /></label>
        <label className="ops-editar-ancho">{t("Comments", "Comentarios")}<input className="ops-campo" value={comments} onChange={(e) => setComments(e.target.value)} data-campo="editar-comentarios" /></label>
      </div>
      <fieldset className="ops-editar-rotos" data-campo="editar-rompio">
        <legend>{t("Broken by", "Lo rompió")}</legend>
        {personas.map((p) => (
          <label key={p.id} className="ops-editar-persona"><input type="checkbox" checked={brokenBy.includes(p.id)} onChange={(e) => setBrokenBy((xs) => e.target.checked ? [...xs, p.id] : xs.filter((x) => x !== p.id))} /> {p.full_name}</label>
        ))}
        {escritos.length > 0 && (
          <p className="ops-elegidos ops-elegidos-pastillas" data-rompio-escritos>
            {escritos.map((n) => (
              <span key={n} className="ops-pastilla-persona">{n}
                <button type="button" onClick={() => setEscritos((xs) => xs.filter((x) => x !== n))} aria-label={t(`Remove ${n}`, `Quitar a ${n}`)} data-quitar-persona>✕</button>
              </span>
            ))}
          </p>
        )}
        <span className="ops-editar-escrito">
          <input className="ops-campo" value={escribiendo} onChange={(e) => setEscribiendo(e.target.value)} maxLength={80} data-campo="editar-rompio-escrito"
            onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); agregaEscrito(); } }}
            placeholder={t("Someone not on the list? Type the name", "¿No está en la lista? Escribe el nombre")} />
          <button type="button" className="btn btn-sm" onClick={agregaEscrito} disabled={escribiendo.trim() === ""} data-accion="agregar-rompio-escrito">＋ {t("Add", "Agregar")}</button>
        </span>
      </fieldset>
      {error && <p className="ops-aviso ops-aviso-error" role="alert" data-aviso="editar-fallo">{error}</p>}
      <div className="modal-actions">
        <button type="button" className="btn" onClick={() => onListo(null)} disabled={guardando}>{t("Cancel", "Cancelar")}</button>
        <button type="button" className="btn btn-primary" onClick={() => void guarda()} disabled={guardando} data-accion="guardar-edicion">{guardando ? t("Saving…", "Guardando…") : t("Save changes", "Guardar cambios")}</button>
      </div>
    </div>
  );
}

/**
 * 268: agregar la foto a una merma guardada «sin foto» (la apuntaron en papel). Sube, calcula la huella, avisa si la
 * foto ya está en otro reporte (solo aviso) y llama a `warehouse_ops_add_photos`, que quita `photo_pending`.
 */
function AgregarFoto({ r, ctx, onListo }: { r: Reporte; ctx: Contexto; onListo: (n: Reporte) => void }) {
  const { t, lang } = usePrefs();
  const [lista, setLista] = useState<{ jpg: string; huella: string; otros: Repetida[] }[]>([]);
  const [leyendo, setLeyendo] = useState(false);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dia = (iso: string) => (/^\d{4}-\d{2}-\d{2}$/.test(iso) ? fmtDia(iso, lang) : fmtDateTime(iso));
  // D-917: la misma lectura que el asistente (bytes en el acto, decodificador con respaldo, motivo visible y en consola).
  const agrega = async (f: File, origen: "camara" | "galeria") => {
    if (lista.length >= MAX_FOTOS) return;
    setLeyendo(true); setError(null);
    try {
      const leida = await leerFotoDelTelefono(f);
      if (!leida.ok) {
        console.error(detalleParaConsola(leida, f, navigator.userAgent, origen));
        setError(mensajeDeFotoFallida(leida.motivo, lang));
        return;
      }
      const { jpg, huella } = leida;
      const otros = ctx.demo ? [] : await reportesConLaFoto(createClient(), huella).catch(() => [] as Repetida[]);
      setLista((x) => [...x, { jpg, huella, otros: otros.filter((o) => o.reporteId !== r.id) }]);
    } catch (e) {
      console.error(`[merma/foto] inesperado · origen=${origen} · ua=${navigator.userAgent}`, e);
      setError(mensajeDeFotoFallida("no-decodifica", lang));
    } finally { setLeyendo(false); }
  };
  const guarda = async () => {
    if (lista.length === 0) return;
    setGuardando(true); setError(null);
    try {
      let rutas = lista.map((_, n) => `demo/${n}.jpg`);
      if (!ctx.demo) {
        const sb = createClient();
        rutas = [];
        for (const x of lista) rutas.push(await subirFoto(sb, ctx.yo.id, x.jpg));
        await agregarFotos(sb, r.id, rutas, lista.map((x) => x.huella));
      }
      onListo({ ...r, photos: [...r.photos, ...rutas], photo_hashes: [...(r.photo_hashes ?? r.photos.map(() => null)), ...lista.map((x) => x.huella)], photo_pending: false });
    } catch (e) { setError(mensajeDeError(e)); }
    finally { setGuardando(false); }
  };
  return (
    <div className="ops-corregir ops-agregar-foto" data-agregar-foto={r.id}>
      <p className="hint">{t("Add the photo of the damaged pieces to complete this report.", "Agrega la foto de las piezas dañadas para completar este reporte.")}</p>
      <div className="ops-fotos-lista">
        {lista.map((x, n) => (
          <figure key={n} data-repetida={x.otros.length > 0 ? "si" : undefined}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={x.jpg} alt={t(`Photo ${n + 1}`, `Foto ${n + 1}`)} />
            <button type="button" className="ops-boton" onClick={() => setLista((l) => l.filter((_, m) => m !== n))}>{t("Remove", "Quitar")}</button>
          </figure>
        ))}
      </div>
      {lista.map((x, n) => x.otros.length > 0 && (
        <p key={n} className="ops-aviso ops-aviso-error" role="alert" data-aviso="foto-repetida" data-foto={n}>⚠️ {avisoDeRepetida(x.otros[0], lang, dia)} {t("Keep it only if it is the same damage.", "Déjala solo si es el mismo daño.")}</p>
      ))}
      {lista.length < MAX_FOTOS && (
        <BotonesDeFoto onFoto={(f, origen) => void agrega(f, origen)} leyendo={leyendo} disabled={guardando}
          etiquetaCamara={t("Take the photo of the pieces", "Tomar la foto de las piezas")} />
      )}
      {error && <p className="ops-aviso ops-aviso-error" role="alert" data-aviso="foto-fallida">{error}</p>}
      <div className="modal-actions">
        <button type="button" className="btn btn-primary" onClick={() => void guarda()} disabled={lista.length === 0 || guardando} data-accion="guardar-foto">
          {guardando ? t("Saving…", "Guardando…") : t("Add photo and complete", "Agregar foto y completar")}
        </button>
      </div>
    </div>
  );
}

/**
 * Corregir el producto de una merma (migración 252, pedido b158a7a5): el gerente/supervisor de la tienda o el admin
 * la vincula a un producto del catálogo, o corrige el nombre y el precio a mano. La base recalcula la pérdida.
 */
function CorregirProducto({ r, ctx, onListo }: { r: Reporte; ctx: Contexto; onListo: (n: Reporte | null) => void }) {
  const { t } = usePrefs();
  const [q, setQ] = useState("");
  const [lista, setLista] = useState<ProductoElegido[]>([]);
  const [nombre, setNombre] = useState(r.product_name ?? "");
  const [costo, setCosto] = useState(r.unit_cost == null ? "" : String(r.unit_cost));
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    const texto = q.trim();
    if (texto.length < 2) { setLista([]); return; }
    let vivo = true;
    const id = setTimeout(async () => {
      try {
        const res = ctx.demo
          ? DEMO_PRODUCTOS.filter((p) => (p.sku + " " + p.name).toLowerCase().includes(texto.toLowerCase()))
          : await buscarProductos(createClient(), texto);
        if (vivo) setLista(res);
      } catch (e) { if (vivo) setError(mensajeDeError(e)); }
    }, 250);
    return () => { vivo = false; clearTimeout(id); };
  }, [q, ctx.demo]);

  // La misma cuenta que la base (259, 263 y 272): precio de venta × piezas dañadas; $0 en devolución de cliente sin CRMA.
  const total = (c: number | null) => perdidaDeMerma(c, repartoDeReporte(r), r);
  const guarda = async (p: ProductoElegido | null) => {
    const c = costoDelCampo(costo);
    if (!p && (nombre.trim().length < 2 || Number.isNaN(c))) { setError(t("Write a name and a valid price.", "Escribe un nombre y un precio válido.")); return; }
    setGuardando(true); setError(null);
    try {
      if (!ctx.demo) await corregirMerma(createClient(), r.id, { productId: p?.id ?? null, nombre: p ? p.name : nombre.trim(), costo: p ? p.cost : c });
      const n: Reporte = p
        ? { ...r, product_id: p.id, product_sku: p.sku, product_name: p.name, unit_cost: p.cost, total_loss: total(p.cost), product_not_in_catalog: false }
        : { ...r, product_id: null, product_sku: null, product_name: nombre.trim(), unit_cost: c, total_loss: total(c), product_not_in_catalog: true };
      onListo(n);
    } catch (e) {
      setError(mensajeDeError(e));
    } finally { setGuardando(false); }
  };

  return (
    <div className="ops-corregir" data-corregir={r.id}>
      <p className="hint">{t("Link it to a catalog product:", "Vincúlalo a un producto del catálogo:")}</p>
      <input className="ops-campo" type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("Product name or SKU", "Nombre o SKU del producto")} data-campo="corregir-buscar" />
      <div className="ops-opciones">
        {lista.map((p) => (
          <button type="button" key={p.id} className="ops-opcion ops-producto" disabled={guardando} onClick={() => void guarda(p)} data-producto={p.id}>
            <span className="ops-producto-nombre">{p.name}</span>
            <span className="ops-producto-meta">{p.sku} · {p.cost == null ? t("no price", "sin precio") : fmtMoney(p.cost)}</span>
          </button>
        ))}
      </div>
      <p className="hint">{t("Or keep it out of the catalog and fix the name and sales price:", "O déjalo fuera del catálogo y corrige nombre y precio de venta:")}</p>
      <label className="ops-cantidad"><span>{t("Product name", "Nombre del producto")}</span>
        <input className="ops-campo" value={nombre} onChange={(e) => setNombre(e.target.value)} data-campo="corregir-nombre" /></label>
      <label className="ops-cantidad"><span>{t("Sales price per piece", "Precio de venta por pieza")}</span>
        <input className="ops-campo" inputMode="decimal" value={costo} onChange={(e) => setCosto(e.target.value)} data-campo="corregir-costo" /></label>
      {error && <p className="ops-aviso ops-aviso-error" role="alert">{error}</p>}
      <div className="modal-actions">
        <button type="button" className="btn" onClick={() => onListo(null)} disabled={guardando}>{t("Cancel", "Cancelar")}</button>
        <button type="button" className="btn btn-primary" onClick={() => void guarda(null)} disabled={guardando} data-accion="guardar-correccion">{t("Save", "Guardar")}</button>
      </div>
    </div>
  );
}

/**
 * Corregir de dónde viene una merma y su CRMA (migración 263). El CRMA es opcional al reportar y suele llegar después:
 * quien puede corregir el producto lo pone (o lo quita) aquí. La base recalcula la pérdida con la misma regla: una
 * devolución de cliente sin CRMA no cuenta como pérdida; con CRMA, precio × piezas dañadas.
 */
function CorregirOrigen({ r, ctx, onListo }: { r: Reporte; ctx: Contexto; onListo: (n: Reporte | null) => void }) {
  const { t, lang } = usePrefs();
  const [origen, setOrigen] = useState<TipoDeOrigen>(origenDeMerma(r.return_type));
  const [crma, setCrma] = useState(r.crma ?? "");
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const nuevo = { return_type: origen, crma: origen === "customer_return" && crma.trim() ? crma.trim().slice(0, 100) : null };
  const total = perdidaDeMerma(r.unit_cost, repartoDeReporte(r), nuevo);
  const guarda = async () => {
    setGuardando(true); setError(null);
    try {
      if (!ctx.demo) await corregirOrigenDeMerma(createClient(), r.id, { origen, crma: nuevo.crma });
      onListo({ ...r, ...nuevo, total_loss: total });
    } catch (e) {
      setError(mensajeDeError(e));
    } finally { setGuardando(false); }
  };
  return (
    <div className="ops-corregir" data-corregir-origen={r.id}>
      <p className="hint">{t("Where it came from and its CRMA / claim #:", "De dónde viene y su CRMA / n.º de reclamo:")}</p>
      <label className="ops-cantidad"><span>{t("Where from", "De dónde")}</span>
        <select className="ops-campo" value={origen} onChange={(e) => setOrigen(origenDeMerma(e.target.value))} data-campo="corregir-origen">
          {ORIGENES_DE_MERMA.map((o) => <option key={o.v} value={o.v}>{lang === "es" ? o.es : o.en}</option>)}
        </select></label>
      {origen === "customer_return" && (
        <label className="ops-cantidad"><span>{t("CRMA / claim # (optional)", "CRMA / n.º de reclamo (opcional)")}</span>
          <input className="ops-campo" value={crma} maxLength={100} onChange={(e) => setCrma(e.target.value)} data-campo="corregir-crma" /></label>
      )}
      <p className="hint" data-perdida-al-guardar={total ?? ""}>
        {cuentaComoPerdida(nuevo)
          ? t(`Loss when saved: ${fmtMoney(total)}`, `Pérdida al guardar: ${fmtMoney(total)}`)
          : t(`Loss when saved: ${fmtMoney(0)}. No CRMA: not counted as loss.`, `Pérdida al guardar: ${fmtMoney(0)}. Sin CRMA: no cuenta como pérdida.`)}
      </p>
      {error && <p className="ops-aviso ops-aviso-error" role="alert">{error}</p>}
      <div className="modal-actions">
        <button type="button" className="btn" onClick={() => onListo(null)} disabled={guardando}>{t("Cancel", "Cancelar")}</button>
        <button type="button" className="btn btn-primary" onClick={() => void guarda()} disabled={guardando} data-accion="guardar-origen">{t("Save origin / CRMA", "Guardar origen / CRMA")}</button>
      </div>
    </div>
  );
}

/** Los borradores de grupo de esta persona, con forma de grupo para la lista de «Grupos» (etiqueta «Borrador»). */
function borradoresComoGrupos(uid: string): GrupoDeMerma[] {
  return listarBorradoresDeGrupo(uid).map((b) => ({
    id: b.id, name: b.nombre, store: b.store, created_by_name: null, created_at: b.creado,
    approved_at: null, approved_by: null, n_reportes: b.reportes.length, firmas: [],
  }));
}
