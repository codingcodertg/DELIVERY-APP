import { NextResponse } from "next/server";
import { errorAlCliente } from "@/lib/api-error";
import { requireAdminDeRc } from "@/lib/recruiting/rc-comms-acceso";
import { ESPERA_SINCRONIZAR_SEG, esperaRestante, filtrosDeLlamadas, hayFaltaDePermiso } from "@/lib/ringcentral-choferes/choferes";

// ============================================================
// GET /api/ringcentral/llamadas (solo admin): las llamadas de los choferes, de la más reciente a la más antigua, con
// filtros (extensión, rango de fechas, dirección, solo con grabación) y paginación. Devuelve además la lista de choferes
// (para el filtro) y el estado de la última sincronización (cuándo fue, si falta el permiso, cuánto falta para poder
// volver a sincronizar). Nunca devuelve `recording_path`: solo `hasRecording`; el audio sale por /grabacion firmado.
// La consulta va con la sesión del admin, así que RLS es la segunda puerta.
// ============================================================

export async function GET(req: Request) {
  const auth = await requireAdminDeRc();
  if (!auth.ok) return auth.response;

  const filtros = filtrosDeLlamadas(new URL(req.url).searchParams);
  if (!filtros) return NextResponse.json({ error: "bad filters" }, { status: 400 });

  const sb = auth.supabase;
  const desde = (filtros.pagina - 1) * filtros.tamano;

  let consulta = sb.from("rc_driver_calls")
    .select(
      "id, rc_extension_id, direction, started_at, duration_s, from_number, from_name, to_number, to_name, result, recording_path, recording_pending, rc_driver_extensions(extension_number, name)",
      { count: "exact" },
    )
    .order("started_at", { ascending: false })
    .range(desde, desde + filtros.tamano - 1);
  if (filtros.extension) consulta = consulta.eq("rc_extension_id", filtros.extension);
  if (filtros.desde) consulta = consulta.gte("started_at", filtros.desde);
  if (filtros.hasta) consulta = consulta.lte("started_at", filtros.hasta);
  if (filtros.direccion) consulta = consulta.eq("direction", filtros.direccion);
  if (filtros.conGrabacion) consulta = consulta.or("recording_path.not.is.null,recording_uri.not.is.null");

  const { data: llamadas, error, count } = await consulta;
  if (error) return errorAlCliente("ringcentral-choferes-llamadas", error, 503);

  const { data: choferes, error: eChoferes } = await sb.from("rc_driver_extensions")
    .select("rc_extension_id, extension_number, name").eq("active", true).order("extension_number");
  if (eChoferes) return errorAlCliente("ringcentral-choferes-lista", eChoferes, 503);
  const ids = (choferes ?? []).map((c) => c.rc_extension_id as string);

  const { data: estados, error: eEstados } = ids.length
    ? await sb.from("rc_driver_sync_state").select("rc_extension_id, last_run_at, last_error_code").in("rc_extension_id", ids)
    : { data: [], error: null };
  if (eEstados) return errorAlCliente("ringcentral-choferes-estado", eEstados, 503);

  const ultima = (estados ?? []).map((e) => e.last_run_at as string | null).filter((x): x is string => !!x).sort().pop() ?? null;
  const ahora = new Date();

  const filas = (llamadas ?? []).map((l) => {
    const ext = l.rc_driver_extensions as unknown as { extension_number: string; name: string } | null;
    return {
      id: l.id as string,
      extensionId: l.rc_extension_id as string,
      driverNumero: ext?.extension_number ?? "",
      driverNombre: ext?.name ?? "",
      direction: l.direction as "in" | "out",
      started_at: l.started_at as string,
      duration_s: l.duration_s as number | null,
      from_number: l.from_number as string | null,
      from_name: l.from_name as string | null,
      to_number: l.to_number as string | null,
      to_name: l.to_name as string | null,
      result: l.result as string | null,
      hasRecording: !!l.recording_path,
      recording_pending: !!l.recording_pending,
    };
  });

  return NextResponse.json({
    rows: filas,
    pagina: filtros.pagina,
    tamano: filtros.tamano,
    total: count ?? filas.length,
    hayMas: desde + filas.length < (count ?? 0),
    choferes: (choferes ?? []).map((c) => ({
      id: c.rc_extension_id as string,
      numero: c.extension_number as string,
      nombre: c.name as string,
    })),
    estado: {
      ultimaSincronizacion: ultima,
      sinPermiso: hayFaltaDePermiso((estados ?? []).map((e) => ({ last_error_code: e.last_error_code as string | null }))),
      esperaSeg: esperaRestante(ultima, ahora, ESPERA_SINCRONIZAR_SEG),
    },
  });
}
