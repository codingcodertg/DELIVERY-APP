import { NextResponse } from "next/server";
import { requireUser } from "@/lib/api-auth";
import { tieneAccesoAEntregas } from "@/lib/constants";
import { createAdminClient } from "@/lib/supabase/admin";
import { configDeTracksolid } from "@/lib/tracksolid/api";
import { almacenEnSupabase, AlmacenNoDisponible, clienteDeServicioDeTracksolid } from "@/lib/tracksolid/almacen";
import { puedeVerCamiones } from "@/lib/tracksolid/camiones";
import { camionesDelDia, camionHabitualDe, fechaValida, peticionValida, planDeCamion, puedeVerPosicionDeChoferes } from "@/lib/tracksolid/camion-del-dia";
import { leeCamionesDelDia, leeChoferes, leeChoferesEnTurno } from "@/lib/tracksolid/camion-del-dia-servicio";
import { posicionesDeCamiones, type PosicionDeCamion } from "@/lib/tracksolid/posiciones";
import { todayISO } from "@/lib/utils";
import type { UserRole } from "@/lib/types";

// ============================================================
// /api/tracksolid/assignments — qué camión lleva cada chofer un día, y dónde está ese camión (D-903).
//
// GET ?date=YYYY-MM-DD[&live=1]
//   Quién: cualquiera con el módulo de Entregas. Qué ve cada uno:
//     · el camión de cada chofer ese día (el NOMBRE del camión): todos; un chofer, solo el suyo;
//     · la lista de camiones para elegir (`trucks`) y `canAssign`: solo quien planifica rutas;
//     · con `live=1` y SOLO para hoy, la posición del camión de cada chofer (`positions`): los mismos que ya
//       pueden leer la posición del teléfono del chofer (`driver_locations`: admin, logística, gerencia,
//       almacén; el chofer, la suya) — y solo de choferes CON EL TURNO ABIERTO. El rastreo de una persona
//       es de su turno (043): fuera de turno, su camión no la sitúa. (Quien planifica sigue viendo todos
//       los camiones, como camiones, en /api/tracksolid/trucks — D-900.)
//   Nunca salen de aquí las llaves de TrackSolid ni el token.
//
// PUT { date, driver_id, imei | null | "usual", swap? }
//   Quién: quien planifica rutas (Entregas + `route_plan`), comprobado aquí y no en el navegador.
//   Un camión no va con dos choferes el mismo día: si lo lleva otro, 409 con quién — y con `swap: true`
//   se intercambian. Escribe con `createAdminClient`, que en modo enseñanza no toca la base (D-626).
// ============================================================

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SIN_CACHE = { "Cache-Control": "no-store" };

type Perfil = { role: UserRole; permissions: string[] | null; module_access: string[] | null };

async function quienLlama(): Promise<{ ok: true; id: string; perfil: Perfil } | { ok: false; response: NextResponse }> {
  const auth = await requireUser();
  if (!auth.ok) return auth;
  const { data: yo, error } = await auth.supabase.from("profiles").select("role, permissions, module_access").eq("id", auth.user.id).maybeSingle();
  if (error) return { ok: false, response: NextResponse.json({ error: "Could not check your access." }, { status: 503 }) };
  const perfil = yo ? { role: yo.role as UserRole, permissions: yo.permissions as string[] | null, module_access: yo.module_access as string[] | null } : null;
  if (!perfil || !tieneAccesoAEntregas(perfil)) return { ok: false, response: NextResponse.json({ error: "Deliveries access is required." }, { status: 403 }) };
  return { ok: true, id: auth.user.id, perfil };
}

/** El nombre de cada camión: el de TrackSolid si se leyó; si no, el que se guardó al enlazarlo; si no, su IMEI. */
function nombresDeCamiones(posiciones: PosicionDeCamion[], enlaces: { imei: string; device_name: string | null }[]): Map<string, string> {
  const out = new Map<string, string>();
  for (const e of enlaces) out.set(e.imei, e.device_name || e.imei);
  for (const p of posiciones) out.set(p.imei, p.nombre || out.get(p.imei) || p.imei);
  return out;
}

export async function GET(request: Request) {
  const quien = await quienLlama();
  if (!quien.ok) return quien.response;
  const url = new URL(request.url);
  const fecha = url.searchParams.get("date");
  if (!fechaValida(fecha)) return NextResponse.json({ error: "Invalid date." }, { status: 400 });

  const config = configDeTracksolid();
  if (!config) return NextResponse.json({ enabled: false }, { headers: SIN_CACHE });

  try {
    const db = clienteDeServicioDeTracksolid();
    const [lectura, delDia, choferes] = await Promise.all([
      posicionesDeCamiones({ config, almacen: almacenEnSupabase(db), fetch: (u, init) => fetch(u, { ...init, cache: "no-store" }) }),
      leeCamionesDelDia(db, fecha),
      leeChoferes(db),
    ]);
    const posiciones = lectura?.camiones ?? [];
    const nombres = nombresDeCamiones(posiciones, delDia.habituales);
    const resueltos = camionesDelDia(delDia.habituales, delDia.delDia);
    const esChofer = quien.perfil.role === "driver";
    const planifica = puedeVerCamiones(quien.perfil);

    const assignments = [...resueltos].flatMap(([driverId, c]) => {
      const driver = choferes.get(driverId);
      if (!driver || (esChofer && driverId !== quien.id)) return [];
      const usual = camionHabitualDe(delDia.habituales, driverId);
      return [{ driverId, driver, imei: c.imei, truck: c.imei ? nombres.get(c.imei) ?? c.imei : null, origin: c.origen, usualImei: usual, usualTruck: usual ? nombres.get(usual) ?? usual : null }];
    });

    const cuerpo: Record<string, unknown> = { enabled: true, date: fecha, canAssign: planifica && delDia.hayTablaDelDia, assignments };
    if (planifica) {
      cuerpo.trucks = [...nombres].map(([imei, name]) => ({ imei, name, usualDriverId: delDia.habituales.find((h) => h.imei === imei)?.driver_id ?? null })).sort((a, b) => a.name.localeCompare(b.name));
    }
    // La posición: solo hoy, solo a quien ya lee la del teléfono, y solo de choferes en turno.
    if (url.searchParams.get("live") === "1" && fecha === todayISO()) {
      const veATodos = puedeVerPosicionDeChoferes(quien.perfil.role);
      const enTurno = veATodos || esChofer ? await leeChoferesEnTurno(db) : new Set<string>();
      const porImei = new Map(posiciones.map((p) => [p.imei, p]));
      cuerpo.positions = assignments.flatMap((a) => {
        if (!a.imei || !enTurno.has(a.driverId) || !(veATodos || (esChofer && a.driverId === quien.id))) return [];
        const p = porImei.get(a.imei);
        return p ? [{ driverId: a.driverId, ...p }] : [];
      });
      cuerpo.fetchedAt = lectura ? new Date(lectura.leidoEn).toISOString() : null;
      cuerpo.delayed = !lectura || lectura.atrasado;
    }
    return NextResponse.json(cuerpo, { headers: SIN_CACHE });
  } catch (e) {
    if (e instanceof AlmacenNoDisponible) return NextResponse.json({ enabled: false }, { headers: SIN_CACHE });
    console.warn("[tracksolid] /assignments falló:", e instanceof Error ? e.message : "error");
    return NextResponse.json({ error: "Could not read the truck assignments." }, { status: 503, headers: SIN_CACHE });
  }
}

export async function PUT(request: Request) {
  const quien = await quienLlama();
  if (!quien.ok) return quien.response;
  if (!puedeVerCamiones(quien.perfil)) return NextResponse.json({ error: "Route planning access is required." }, { status: 403 });

  const v = peticionValida(await request.json().catch(() => null));
  if (!v.ok) return NextResponse.json({ error: v.error }, { status: 400 });

  let db;
  try { db = createAdminClient(); } catch { return NextResponse.json({ error: "Not available on this installation." }, { status: 503 }); }

  try {
    const [delDia, choferes, guardadas] = await Promise.all([
      leeCamionesDelDia(db, v.fecha),
      leeChoferes(db),
      // Lo último que se leyó de TrackSolid, de la base: para los nombres y para saber qué camiones existen. No llama fuera.
      almacenEnSupabase(db).leePosiciones().catch(() => null),
    ]);
    if (!delDia.hayTablaDelDia) return NextResponse.json({ error: "Per-day truck assignment is not available yet." }, { status: 503 });
    if (!choferes.has(v.peticion.driverId)) return NextResponse.json({ error: "That driver does not exist." }, { status: 400 });
    const nombres = nombresDeCamiones(guardadas?.camiones ?? [], delDia.habituales);
    const imei = v.peticion.imei;
    if (typeof imei === "string" && imei !== "usual" && !nombres.has(imei)) return NextResponse.json({ error: "That truck does not exist." }, { status: 400 });

    const plan = planDeCamion(delDia.habituales, delDia.delDia, v.peticion);
    if (!plan.ok) {
      const c = plan.conflicto;
      return NextResponse.json({
        error: "That truck is with another driver that day.",
        conflict: { driverId: c.driverId, driver: choferes.get(c.driverId) ?? "another driver", imei: c.imei, truck: nombres.get(c.imei) ?? c.imei, inReturn: c.aCambio ? nombres.get(c.aCambio) ?? c.aCambio : null },
      }, { status: 409 });
    }
    for (const paso of plan.pasos) {
      const res = paso.op === "quita"
        ? await db.from("truck_day_assignments").delete().eq("day", v.fecha).eq("driver_id", paso.driver_id)
        : await db.from("truck_day_assignments").upsert({ day: v.fecha, driver_id: paso.driver_id, imei: paso.imei, updated_at: new Date().toISOString(), updated_by: quien.id }, { onConflict: "day,driver_id" });
      if (res.error) {
        // 23505: el índice único — otra persona le dio ese camión a otro chofer hace un instante.
        if (String(res.error.code) === "23505") return NextResponse.json({ error: "That truck was just given to another driver. Reload and try again." }, { status: 409 });
        return NextResponse.json({ error: "Could not save the truck." }, { status: 500 });
      }
    }
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "Could not save the truck." }, { status: 503 });
  }
}
