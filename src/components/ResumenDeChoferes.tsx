"use client";

import { useEffect, useMemo, useState } from "react";
import { useData } from "@/lib/data-provider";
import { usePrefs } from "@/lib/prefs";
import { useAjustesDeChofer } from "@/lib/usa-ajustes-de-chofer";
import { BUSINESS_TZ, fmtMoney, todayISO } from "@/lib/utils";
import { mesesHastaHoy, rangoDelMes } from "@/lib/almacen-ops/kpi-almacen";
import { resumenDeChoferes, millasGpsPorChofer, MAX_DANOS_MES, GRACIA_TARDE_MIN, type FilaDeResumen } from "@/lib/resumen-de-choferes";
import { tarjetasDeChoferes } from "@/lib/reportes-choferes/metricas";
import type { InformeDelDia } from "@/lib/reportes-choferes/dia";
import type { Delivery } from "@/lib/types";

/**
 * «Choferes — resumen» (junta con el dueño, 2026-11-19): arriba del Panel, una tarjeta por chofer con ocho cifras de un
 * mes. El dueño: «lo más simple posible… ocho puntos… 52 rotos contra un máximo de 30». Mes por defecto: el actual; se
 * puede elegir cualquiera de los últimos doce (octubre incluido). Las tablas de detalle están en «Ver detalles».
 *
 * De dónde sale cada cifra y por qué una puede salir «—» está en `lib/resumen-de-choferes.ts`. Las millas reales son las
 * del rastro GPS (`/api/driver-reports`, el mismo que «Reportes de choferes»); si el rastro no está, se dice.
 */

const SIN_BASE = process.env.NEXT_PUBLIC_LOCAL_MODE === "true";

/** «HH:MM» o «HH:MM:SS» → minutos desde medianoche. */
function minutosDeHora(v: string | null | undefined): number | null {
  const m = /^(\d{1,2}):(\d{2})/.exec(v ?? "");
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}

const formatoHora = new Intl.DateTimeFormat("en-GB", { timeZone: BUSINESS_TZ, hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
const formatoDia = new Intl.DateTimeFormat("en-CA", { timeZone: BUSINESS_TZ, year: "numeric", month: "2-digit", day: "2-digit" });
const minutoLocal = (ms: number) => {
  const [h, m] = formatoHora.format(new Date(ms)).split(":").map(Number);
  return h * 60 + m;
};
const diaLocal = (ms: number) => formatoDia.format(new Date(ms));

export function ResumenDeChoferes({ ordenes, choferesIds }: {
  /** Las órdenes del Panel, ya acotadas a las tiendas de quien mira (D-396). El mes lo pone este componente. */
  ordenes: readonly Delivery[];
  /** Los choferes de quien mira (su alcance); `null` = todos. Filtra los turnos. */
  choferesIds: ReadonlySet<string> | null;
}) {
  const { users, shifts, settings, ensureDeliveriesSince } = useData();
  const { lang, t } = usePrefs();
  const ajustes = useAjustesDeChofer();
  const hoy = todayISO();
  const meses = useMemo(() => mesesHastaHoy(hoy, 12), [hoy]);
  const [mes, setMes] = useState(hoy.slice(0, 7));
  const rango = useMemo(() => {
    const r = rangoDelMes(mes);
    if (!r) return null;
    return { desde: r.desde, hasta: r.hasta > hoy ? hoy : r.hasta };
  }, [mes, hoy]);

  // G-16: el mes que se elige puede estar fuera de la ventana cargada; se pide aquí (idempotente).
  useEffect(() => { if (rango) void ensureDeliveriesSince(rango.desde); }, [rango, ensureDeliveriesSince]);

  // Millas reales: el rastro del mes. Sin base (demo) o sin permiso, no hay: las millas salen del sistema.
  const [gps, setGps] = useState<ReturnType<typeof millasGpsPorChofer> | null>(null);
  const [cargandoGps, setCargandoGps] = useState(false);
  useEffect(() => {
    setGps(null);
    if (SIN_BASE || !rango) { setCargandoGps(false); return; }
    let vivo = true;
    setCargandoGps(true);
    void (async () => {
      try {
        const res = await fetch(`/api/driver-reports?from=${rango.desde}&to=${rango.hasta}`);
        const b = (await res.json().catch(() => ({}))) as { ok?: boolean; dias?: InformeDelDia[] };
        if (!res.ok || !b.ok || !b.dias) return;
        const tarjetas = tarjetasDeChoferes(b.dias, minutoLocal);
        if (vivo) setGps(millasGpsPorChofer(tarjetas));
      } catch {
        // Sin red: las millas salen del sistema, y la tarjeta lo dice.
      } finally {
        if (vivo) setCargandoGps(false);
      }
    })();
    return () => { vivo = false; };
  }, [rango]);

  const filas: FilaDeResumen[] = useMemo(() => {
    if (!rango) return [];
    const entradaPorPerfil = new Map(ajustes.map((a) => [a.profile_id, minutosDeHora(a.shift_start)]));
    return resumenDeChoferes({
      ordenes,
      turnos: choferesIds ? shifts.filter((s) => choferesIds.has(s.driver_id)) : shifts,
      choferes: users.map((u) => ({ id: u.id, nombre: u.full_name, entradaMin: entradaPorPerfil.get(u.id) ?? null })),
      desde: rango.desde,
      hasta: rango.hasta,
      reglas: settings.order_type_rules,
      diaLocal,
      minutoLocal,
      gps,
    });
  }, [rango, ordenes, shifts, choferesIds, users, ajustes, settings.order_type_rules, gps]);

  const nombreDelMes = (m: string) => {
    const [a, b] = m.split("-").map(Number);
    return new Intl.DateTimeFormat(lang === "es" ? "es-MX" : "en-US", { month: "long", year: "numeric", timeZone: "UTC" })
      .format(new Date(Date.UTC(a, b - 1, 15)));
  };
  const num = (n: number) => n.toLocaleString(lang === "es" ? "es-MX" : "en-US", { maximumFractionDigits: 1 });
  const pctTexto = (v: number | null) => (v == null ? "—" : `${v}%`);
  const colorPct = (v: number | null, meta: number) => (v == null ? undefined : { color: v >= meta ? "var(--green)" : "var(--amber)" });

  const sinHoraDeEntrada = t("No shift start set in Settings → Routes", "Sin hora de entrada en Ajustes → Rutas");
  const sinRastro = cargandoGps
    ? t("Loading GPS miles…", "Cargando millas GPS…")
    : SIN_BASE
      ? t("Demo: no GPS trail, miles come from the system", "Demo: sin rastro GPS; las millas salen del sistema")
      : t("No GPS trail for this month: miles come from the system", "Sin rastro GPS en este mes: las millas salen del sistema");

  return (
    <div className="card" data-resumen-choferes>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "wrap", marginBottom: 6 }}>
        <h2 style={{ margin: 0 }}>🧭 {t("Drivers — summary", "Choferes — resumen")}</h2>
        <select value={mes} onChange={(e) => setMes(e.target.value)} style={{ width: "auto", maxWidth: 240 }} aria-label={t("Month", "Mes")} data-resumen-mes>
          {meses.map((m) => <option key={m} value={m}>{nombreDelMes(m)}</option>)}
        </select>
      </div>
      <p className="hint" style={{ marginTop: 0, marginBottom: 12 }}>
        {t(
          "Only the selected month. Customer deliveries and transfers between stores are counted apart. Pass the cursor over a dash to see why it has no number.",
          "Solo el mes elegido. Las entregas a clientes y los traslados entre tiendas se cuentan aparte. Pase el cursor sobre un «—» para ver por qué no tiene cifra.",
        )}
      </p>

      {!rango ? null : filas.length === 0 ? (
        <div className="empty">{t("No driver activity in this month.", "Sin actividad de choferes en este mes.")}</div>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: 12 }}>
          {filas.map((f) => {
            const millasLabel = f.fuenteMillas === "gps"
              ? t("Actual miles (GPS)", "Millas reales (GPS)")
              : f.fuenteMillas === "sistema"
                ? t("Miles (system, no GPS)", "Millas (sistema, sin GPS)")
                : t("Miles", "Millas");
            const millasTitulo = f.fuenteMillas === "gps"
              ? t(`GPS trail on ${f.diasConRastro} of ${f.diasConTurno} days worked`, `Rastro GPS en ${f.diasConRastro} de ${f.diasConTurno} días trabajados`)
              : sinRastro;
            return (
              <div key={f.chofer} className="card" style={{ margin: 0 }} data-resumen-chofer={f.chofer}>
                <h3 style={{ margin: "0 0 10px", fontSize: 16 }}>{f.chofer}</h3>
                <div className="kpi-grid" style={{ marginBottom: 0 }}>
                  <Dato
                    valor={`${f.diasTrabajados} / ${f.diasTarde ?? "—"}`}
                    label={t("Days worked / late", "Días trabajados / tarde")}
                    titulo={f.diasTarde == null ? sinHoraDeEntrada : t(`Late = after shift start + ${GRACIA_TARDE_MIN} min`, `Tarde = después de la entrada + ${GRACIA_TARDE_MIN} min`)}
                  />
                  <Dato valor={String(f.entregas)} label={t("Customer deliveries", "Entregas a clientes")} titulo={t("Delivered orders to customers", "Órdenes entregadas a clientes")} />
                  <Dato valor={String(f.traslados)} label={t("Store transfers", "Traslados entre tiendas")} titulo={t("Delivered Intertienda / transfer orders (no customer)", "Órdenes Intertienda / transfer entregadas (sin cliente)")} />
                  <Dato valor={f.millas == null ? "—" : num(f.millas)} label={millasLabel} titulo={f.millas == null ? sinRastro : millasTitulo} />
                  <Dato
                    valor={f.ingresoPorMilla == null ? "—" : fmtMoney(f.ingresoPorMilla)}
                    label={t("Revenue / mile", "Ingreso / milla")}
                    titulo={f.ingresoPorMilla == null ? t("No miles to divide by", "No hay millas con que dividir") : t("Delivery fees ÷ miles above", "Cobros de entrega ÷ millas de arriba")}
                  />
                  <Dato
                    valor="—"
                    label={t(`Damaged pieces (max ${MAX_DANOS_MES})`, `Piezas dañadas (máx. ${MAX_DANOS_MES})`)}
                    titulo={t("Damage is logged by store in Warehouse Ops, not by driver: there is no per-driver figure yet.", "La merma se registra por tienda en Operaciones de Almacén, no por chofer: todavía no hay cifra por chofer.")}
                  />
                  <Dato valor={pctTexto(f.productivoPct)} label={t("Productive time", "Tiempo productivo")} estilo={colorPct(f.productivoPct, 80)} titulo={f.productivoPct == null ? t("No clock-in time this month", "Sin tiempo en turno este mes") : t("Active time (leaving or pickup → delivered) ÷ time clocked in", "Tiempo activo (salida o recogida → entregado) ÷ tiempo en turno")} />
                  <Dato valor={pctTexto(f.aTiempoPct)} label={t("On time", "A tiempo")} estilo={colorPct(f.aTiempoPct, 80)} titulo={f.aTiempoPct == null ? t("No customer deliveries with a window this month", "Sin entregas a cliente con ventana este mes") : t("Customer deliveries within their window", "Entregas a cliente dentro de su ventana")} />
                </div>
              </div>
            );
          })}
        </div>
      )}
      {rango && cargandoGps && filas.length > 0 && <p className="hint" style={{ marginTop: 8 }}>{sinRastro}</p>}
    </div>
  );
}

function Dato({ valor, label, titulo, estilo }: {
  valor: string; label: string; titulo?: string; estilo?: { color: string } | undefined;
}) {
  return (
    <div className="kpi" title={titulo}>
      <b style={{ fontSize: 20, ...(estilo ?? {}) }}>{valor}</b>
      <span>{label}</span>
    </div>
  );
}
