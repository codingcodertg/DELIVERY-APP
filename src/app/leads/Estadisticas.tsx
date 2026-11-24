import { useEffect, useMemo, useState } from "react";
import { usePrefs } from "@/lib/prefs";
import { TablaEstandar, type ColumnaEstandar } from "@/components/TablaEstandar";
import type { AlmacenDeLeads } from "@/lib/leads/almacen";
import type { EventoLead, Lead, VistaDePool } from "@/lib/leads/reglas";
import { fecha, leadsDeLaVista } from "@/lib/leads/reglas";
import {
  estadisticasDeUso, periodoDeDias, periodoPersonalizado, type FilaDeUso, type LlamadasDeVendedor, type Periodo,
} from "@/lib/leads/estadisticas";

/** «AAAA-MM-DD» del día local de una fecha. */
const diaTexto = (d: Date): string => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

type Modo = "7" | "30" | "propio";

/**
 * La pestaña de estadísticas (admin y gerente): cuánto usa la app cada vendedor. Los últimos 7 o 30 días, o un rango a
 * mano. El historial lo cuenta la pantalla; las llamadas las cuenta la base (337), por el nombre de RingCentral. Las
 * definiciones de cada columna están en `estadisticas.ts`.
 */
export function Estadisticas({ almacen, leads, puedeStxp }: {
  almacen: AlmacenDeLeads;
  /** Los leads a la vista: dicen de qué pool es cada movimiento del historial. */
  leads: readonly Lead[];
  /** ¿Puede ver el STXP Pool? Solo entonces hay interruptor de pool. */
  puedeStxp: boolean;
}) {
  const { t } = usePrefs();
  // D-1145 (Roberto, 2026-11-23, con ESTA tabla delante: «I would like to be able to switch between government pool and
  // permit pool, because I don't know… what is this, both?»): eran los dos, y no lo decía. Ahora lo dice y se elige. Nace en
  // «los dos», que es lo que la tabla enseñaba: los números no cambian solos.
  const [vista, setVista] = useState<VistaDePool>("ambos");
  const [modo, setModo] = useState<Modo>("7");
  const hoy = useMemo(() => new Date(), []);
  const [desdeTxt, setDesdeTxt] = useState(() => { const d = new Date(hoy); d.setDate(d.getDate() - 6); return diaTexto(d); });
  const [hastaTxt, setHastaTxt] = useState(() => diaTexto(hoy));
  const [eventos, setEventos] = useState<EventoLead[] | null>(null);
  const [llamadas, setLlamadas] = useState<{ porVendedor: LlamadasDeVendedor[]; total: number } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const periodo: Periodo | null = useMemo(
    () => (modo === "propio" ? periodoPersonalizado(desdeTxt, hastaTxt) : periodoDeDias(modo === "7" ? 7 : 30, new Date())),
    [modo, desdeTxt, hastaTxt],
  );

  useEffect(() => {
    let vivo = true;
    void almacen.eventos().then((r) => { if (!vivo) return; if (r.ok) setEventos(r.valor); else setError(r.error); });
    return () => { vivo = false; };
  }, [almacen]);

  useEffect(() => {
    if (!periodo) { setLlamadas(null); return; }
    let vivo = true;
    setLlamadas(null);
    void almacen.llamadasPorVendedor(periodo).then((r) => {
      if (!vivo) return;
      // Sin la 337 o sin permiso, las llamadas no salen: la tabla sigue, con cero llamadas y el aviso de abajo.
      setLlamadas(r.ok ? r.valor : { porVendedor: [], total: 0 });
    });
    return () => { vivo = false; };
  }, [almacen, periodo]);

  // El historial de la vista: con un pool elegido, solo los movimientos de sus leads. Las llamadas las cuenta la base por
  // vendedor, sin pool: con un pool elegido se dice que son de los dos.
  const eventosDeVista = useMemo(() => {
    if (!eventos || vista === "ambos" || !puedeStxp) return eventos;
    const ids = new Set(leadsDeLaVista(leads, vista).map((l) => l.id));
    return eventos.filter((e) => ids.has(e.lead_id));
  }, [eventos, leads, vista, puedeStxp]);
  const resumen = eventosDeVista && periodo && llamadas ? estadisticasDeUso(eventosDeVista, periodo, llamadas.porVendedor, llamadas.total) : null;
  const etiquetaVista = vista === "stxp" ? "STXP Pool" : vista === "gov" ? "GOV Pool" : t("GOV Pool and STXP Pool together", "GOV Pool y STXP Pool juntos");

  const columnas: ColumnaEstandar<FilaDeUso>[] = [
    { key: "nombre", en: "Rep", es: "Vendedor", ancho: 200, fija: true, valor: (f) => f.nombre },
    { key: "leads", en: "Leads worked", es: "Leads trabajados", ancho: 130, numerico: true, valor: (f) => f.leads },
    { key: "notas", en: "Notes", es: "Notas", ancho: 100, numerico: true, valor: (f) => f.notas },
    { key: "cambiosDeEtapa", en: "Stage changes", es: "Cambios de etapa", ancho: 130, numerico: true, valor: (f) => f.cambiosDeEtapa },
    { key: "cotizaciones", en: "Quotes", es: "Cotizaciones", ancho: 120, numerico: true, valor: (f) => f.cotizaciones },
    { key: "ventas", en: "Sales", es: "Ventas", ancho: 100, numerico: true, valor: (f) => f.ventas },
    { key: "llamadas", en: "Calls", es: "Llamadas", ancho: 110, numerico: true, valor: (f) => f.llamadas },
    { key: "ultima", en: "Last activity", es: "Última actividad", ancho: 170, valor: (f) => fecha(f.ultima) },
  ];

  const chip = (id: Modo, texto: string) => (
    <button type="button" role="tab" aria-selected={modo === id} className={`chip${modo === id ? " on" : ""}`} data-periodo={id} onClick={() => setModo(id)}>
      {texto}
    </button>
  );

  return (
    <div className="ld-admin" data-estadisticas>
      <div className="card ld-ancho-total">
        <h2>📊 {t("App use by rep", "Uso de la app por vendedor")}</h2>
        <div className="ld-segmento" role="tablist" aria-label={t("Period", "Periodo")}>
          {chip("7", t("Last 7 days", "Últimos 7 días"))}
          {chip("30", t("Last 30 days", "Últimos 30 días"))}
          {chip("propio", t("Custom", "Personalizado"))}
        </div>
        {puedeStxp && (
          <>
            <div className="ld-segmento" role="tablist" aria-label={t("Pool of the numbers", "Pool de los números")}>
              {(["ambos", "gov", "stxp"] as const).map((v) => (
                <button key={v} type="button" role="tab" aria-selected={vista === v} className={`chip${vista === v ? " on" : ""}`}
                  data-pool-de-estadisticas={v} onClick={() => setVista(v)}>
                  {v === "gov" ? "GOV Pool" : v === "stxp" ? "STXP Pool" : t("Both", "Los dos")}
                </button>
              ))}
            </div>
            <p className="hint" data-pool-de-estadisticas-actual>
              {t("These numbers are for:", "Estos números son de:")} <b>{etiquetaVista}</b>
              {vista !== "ambos" && <> · {t("Calls cannot be split by pool: that column counts both.", "Las llamadas no se pueden separar por pool: esa columna cuenta los dos.")}</>}
            </p>
          </>
        )}
        {modo === "propio" && (
          <div className="ld-periodo-propio">
            <label>{t("From", "Desde")} <input type="date" value={desdeTxt} onChange={(e) => setDesdeTxt(e.target.value)} data-desde /></label>
            <label>{t("To", "Hasta")} <input type="date" value={hastaTxt} onChange={(e) => setHastaTxt(e.target.value)} data-hasta /></label>
            {!periodo && <p className="hint ld-telefono-error" role="alert">{t("Check the dates: the start cannot be after the end.", "Revisa las fechas: el inicio no puede ir después del fin.")}</p>}
          </div>
        )}
        {error && <p className="hint ld-telefono-error" role="alert">{error}</p>}
        {!resumen && !error && <p className="hint">{t("Loading…", "Cargando…")}</p>}
        {resumen && resumen.filas.length === 0 && <p className="hint" data-sin-uso>{t("Nobody has used the app in this period.", "Nadie ha usado la app en este periodo.")}</p>}
        {resumen && resumen.filas.length > 0 && (
          <TablaEstandar id="uso-por-vendedor" data-tabla="uso" sinCaja filas={resumen.filas} claveDe={(f) => f.id} columnas={columnas}
            totales={{
              nombre: t("Total", "Total"),
              leads: resumen.totales.leads,
              notas: resumen.totales.notas,
              cambiosDeEtapa: resumen.totales.cambiosDeEtapa,
              cotizaciones: resumen.totales.cotizaciones,
              ventas: resumen.totales.ventas,
              llamadas: resumen.totales.llamadas,
              ultima: fecha(resumen.totales.ultima),
            }} />
        )}
        {resumen && resumen.llamadasSinVendedor > 0 && (
          <p className="hint" data-sin-vendedor>
            {t(
              `${resumen.llamadasSinVendedor} calls in this period are not assigned to a rep: their RingCentral name does not match a name in the app.`,
              `${resumen.llamadasSinVendedor} llamadas de este periodo no se asignan a ningún vendedor: su nombre en RingCentral no coincide con el de la app.`,
            )}
          </p>
        )}
        <p className="hint">
          {t(
            "Leads worked: leads where the rep added a note, a phone, took or closed one. Stage changes: notes that set a stage. Calls: RingCentral calls to the phones of leads, by rep name.",
            "Leads trabajados: leads donde el vendedor anotó, puso un teléfono, tomó o cerró uno. Cambios de etapa: notas que ponen una etapa. Llamadas: de RingCentral a los teléfonos de leads, por nombre del vendedor.",
          )}
        </p>
      </div>
    </div>
  );
}
