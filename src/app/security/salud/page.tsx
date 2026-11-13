import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { leerSalud, CACHE_MS, type Salud } from "@/lib/security/salud-servidor";
import { etiquetaDeConsulta, horasDesde, porHora, ritmoDeDisco, veredictos, sinDatos, GB, MB, type Veredicto } from "@/lib/security/salud";
import { BotonesDeSalud } from "./BotonesDeSalud";
import "../security.css";

export const dynamic = "force-dynamic";

/**
 * Central Hub Monitoring → «📊 Salud del sistema» (D-1012). Solo el admin (lo exige el layout de /security, y la base
 * otra vez dentro de cada función de monitor). El renglón principal es el Disk IO, por el correo de Supabase «running
 * out of Disk IO Budget».
 *
 * Cada tarjeta se pinta con SU lectura. Si una falla, sale gris con «No data — <razón>»; nunca se pinta como sana ni
 * aparece el error crudo de la base.
 */
const LOCAL_MODE = process.env.NEXT_PUBLIC_LOCAL_MODE === "true";
const REF = (() => { try { return new URL(process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").hostname.split(".")[0]; } catch { return ""; } })();
const PANEL_SUPABASE = `https://supabase.com/dashboard/project/${REF || "iwhcsvgujydebdyllcqu"}`;

const bytes = (n: number) => n >= GB ? `${(n / GB).toFixed(2)} GB` : n >= MB ? `${(n / MB).toFixed(1)} MB` : `${Math.round(n / 1024)} kB`;
const num = (n: number) => Math.round(n).toLocaleString("es-MX");
const fecha = (iso: string | null | undefined) => iso ? new Date(iso).toLocaleString("es-MX", { timeZone: "America/Chicago", dateStyle: "medium", timeStyle: "short" }) : "—";

function Tarjeta({ v, grande }: { v: Veredicto; grande?: boolean }) {
  return (
    <article className={`salud-tarjeta salud-${v.nivel}${grande ? " salud-principal" : ""}`} data-salud={v.id} data-nivel={v.nivel}>
      <header><span className="salud-punto" aria-hidden />{v.titulo}</header>
      <p className="salud-valor">{v.valor}</p>
      <p className="salud-que-hacer"><b>{v.nivel === "gris" ? "Nota:" : "Qué hacer:"}</b> {v.queHacer}</p>
    </article>
  );
}

/** Bloque de una sección que no tiene datos: gris, con la razón. */
function SinDatos({ motivo }: { motivo: string }) {
  return <p className="hint salud-sin-datos" data-sin-datos>{sinDatos(motivo)}</p>;
}

export default async function SaludPage() {
  if (LOCAL_MODE) {
    return (
      <div className="container sec salud">
        <div className="sec-head"><h1>📊 Salud del sistema</h1></div>
        <p className="hint">En el demo no hay base ni Vercel que medir.</p>
        <Link className="btn" href="/security">← Central Hub Monitoring</Link>
      </div>
    );
  }
  const supabase = await createClient();
  const s: Salud = await leerSalud(supabase);
  const esc = s.escrituras.datos;
  const arc = s.archivos.datos;
  const bd = s.base.datos;
  const rev = s.revision.datos;

  const horas = horasDesde(esc?.estadisticas_desde ?? null);
  const llamadasQueEscriben = (esc?.escrituras ?? []).reduce((a, x) => a + x.calls, 0);
  const principal = esc?.escrituras?.[0] ? etiquetaDeConsulta(esc.escrituras[0].consulta) : null;
  const archivos30 = (arc?.buckets ?? []).reduce((a, x) => a + x.bytes_30d, 0);
  const capturas = (arc?.buckets ?? []).find((x) => x.bucket === "timetracker-screenshots");

  const vs = veredictos({
    ritmoDisco: ritmoDeDisco(s.disco.antes, s.disco.ahora),
    discoConfigurado: s.disco.configurado,
    motivoDisco: s.disco.error,
    escriturasHora: esc ? porHora(llamadasQueEscriben, horas) : null,
    walMBHora: esc ? porHora(esc.wal_total / MB, horas) : null,
    principalEscritor: principal,
    motivoEscrituras: s.escrituras.error,
    deploys24h: s.vercel.datos?.deploys24h ?? null,
    deploysFallidos24h: s.vercel.datos?.fallidos24h ?? null,
    motivoVercel: s.vercel.error ?? (s.vercel.configurado ? null : "VERCEL_TOKEN no está configurado"),
    archivosGBMes: arc ? archivos30 / GB : null,
    capturasGBMes: capturas ? capturas.bytes_30d / GB : null,
    motivoArchivos: s.archivos.error,
    baseGB: bd ? bd.db_bytes / GB : null,
    conexiones: bd?.conexiones ?? null,
    conexionesMax: bd?.conexiones_max ?? null,
    cache: bd?.cache_aciertos ?? null,
    motivoBase: s.base.error,
    sinRls: rev?.sin_rls ?? null,
    definerAnon: rev?.definer_anon ?? null,
    motivoRevision: s.revision.error,
    compute: s.compute.nombre,
    motivoCompute: s.compute.error ?? (s.compute.configurado ? null : "SUPABASE_ACCESS_TOKEN no está configurado"),
  });
  const [disco, ...resto] = vs;

  return (
    <div className="container sec salud" data-salud-del-sistema>
      <div className="sec-head">
        <h1>📊 Salud del sistema</h1>
        <Link className="btn btn-ghost" href="/security">← Central Hub Monitoring</Link>
      </div>
      <p className="hint">Leído: {fecha(new Date(s.leidoEn).toISOString())} · se guarda {CACHE_MS / 60_000} min si todo salió bien; si algo falla, se vuelve a intentar pronto.</p>
      <BotonesDeSalud />

      {/* El correo de Supabase: Disk IO. */}
      <Tarjeta v={disco} grande />
      <p className="hint salud-nota">
        El porcentaje exacto del «Disk IO Budget» solo lo da Supabase en su panel:{" "}
        <a href={`${PANEL_SUPABASE}/reports/database`} target="_blank" rel="noreferrer">Reports → Database (Disk IO)</a>{" · "}
        <a href={`${PANEL_SUPABASE}/settings/infrastructure`} target="_blank" rel="noreferrer">Infraestructura / Compute</a>.
        Aquí se ve el disco real del servidor (Metrics API) y cuánto escribe cada cosa.
        {s.disco.error && <> Metrics API: {s.disco.error}.</>}
      </p>

      <section className="salud-grilla">{resto.map((v) => <Tarjeta key={v.id} v={v} />)}</section>

      <h2>✍️ Lo que más escribe en la base</h2>
      {esc ? (
        <>
          <p className="hint">Desde {fecha(esc.estadisticas_desde)}{horas ? ` (${num(horas)} h)` : ""}. Reinicia las estadísticas después de un cambio para medir el ritmo nuevo.</p>
          <div className="tbl-scroll tbl-caja">
            <table className="orders">
              <thead><tr><th>Qué</th><th className="num">Veces</th><th className="num">Por hora</th><th className="num">Escrito (WAL)</th></tr></thead>
              <tbody>
                {(esc.escrituras ?? []).map((e, i) => (
                  <tr key={i}><td title={e.consulta}>{etiquetaDeConsulta(e.consulta)}</td><td className="num">{num(e.calls)}</td><td className="num">{horas ? num(e.calls / horas) : "—"}</td><td className="num">{bytes(e.wal_bytes)}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      ) : <SinDatos motivo={s.escrituras.error ?? "sin estadísticas"} />}

      <h2>🗂️ Archivos por bucket</h2>
      {arc ? (
        <div className="tbl-scroll tbl-caja">
          <table className="orders">
            <thead><tr><th>Bucket</th><th className="num">Archivos</th><th className="num">Total</th><th className="num">Últimos 7 días</th><th className="num">Últimos 30 días</th></tr></thead>
            <tbody>
              {(arc.buckets ?? []).map((x) => (
                <tr key={x.bucket} className={x.bucket === "timetracker-screenshots" ? "salud-destacada" : undefined}>
                  <td>{x.bucket}</td><td className="num">{num(x.archivos)}</td><td className="num">{bytes(x.bytes)}</td><td className="num">{bytes(x.bytes_7d)}</td><td className="num">{bytes(x.bytes_30d)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : <SinDatos motivo={s.archivos.error ?? "sin datos de archivos"} />}

      <h2>🧮 Base de datos</h2>
      {bd ? (
        <>
          <p className="hint">Tamaño total: {bytes(bd.db_bytes)} · conexiones {bd.conexiones} de {bd.conexiones_max} · aciertos de caché {bd.cache_aciertos ?? "—"} %.</p>
          <div className="salud-dos">
            <div className="tbl-scroll tbl-caja">
              <table className="orders">
                <thead><tr><th>Tablas más grandes</th><th className="num">Tamaño</th></tr></thead>
                <tbody>{(bd.tablas ?? []).map((t) => <tr key={t.nombre}><td>{t.nombre}</td><td className="num">{bytes(t.bytes)}</td></tr>)}</tbody>
              </table>
            </div>
            <div className="tbl-scroll tbl-caja">
              <table className="orders">
                <thead><tr><th>Tablas más movidas</th><th className="num">Cambios</th><th className="num">Muertas</th><th>Último autovacuum</th></tr></thead>
                <tbody>{(bd.movidas ?? []).map((t) => <tr key={t.tabla}><td>{t.tabla}</td><td className="num">{num(t.cambios)}</td><td className="num">{num(t.muertas)}</td><td>{fecha(t.last_autovacuum)}</td></tr>)}</tbody>
              </table>
            </div>
          </div>
        </>
      ) : <SinDatos motivo={s.base.error ?? "sin datos de la base"} />}

      <h2>🚀 Vercel</h2>
      {s.vercel.datos
        ? <p className="hint">Publicaciones a producción: {s.vercel.datos.deploys24h} en 24 h ({s.vercel.datos.fallidos24h} fallidas) · {s.vercel.datos.deploys7d} en 7 días ({s.vercel.datos.fallidos7d} fallidas) · última: {fecha(s.vercel.datos.ultimo)}. Cada publicación recarga a todos los que tienen la app abierta.</p>
        : <SinDatos motivo={s.vercel.error ?? "agrega la variable VERCEL_TOKEN en Vercel (Settings → Environment Variables), con un token de vercel.com/account/tokens"} />}

      <h2>🖥️ Tamaño del servidor</h2>
      {s.compute.nombre
        ? <p className="hint">Compute actual: <b>{s.compute.nombre}</b>. Subir de tamaño da más presupuesto de Disk IO, memoria y conexiones, y cuesta más al mes. Primero conviene bajar las escrituras.</p>
        : <SinDatos motivo={s.compute.error ?? "agrega SUPABASE_ACCESS_TOKEN en Vercel (token personal de supabase.com/dashboard/account/tokens)"} />}
    </div>
  );
}
