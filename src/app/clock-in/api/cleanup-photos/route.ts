import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Photos are only kept for recent spot-checks. Time records themselves are never
// touched (they stay for years) — we only null the photo reference + delete the file.
const RETENTION_DAYS = 60;

// Runner/salesman vehicle trips are operational proof only (manager reviews them
// by Thursday each week). We keep this week + last week, then delete the rows and
// their photos entirely — no long-term retention.
const TRIP_RETENTION_DAYS = 14;

function env() {
  return {
    url: process.env.NEXT_PUBLIC_SUPABASE_URL!,
    key: process.env.SUPABASE_SERVICE_ROLE_KEY!,
  };
}

async function rest(path: string, init?: RequestInit) {
  const { url, key } = env();
  return fetch(`${url}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
    cache: "no-store",
  });
}

async function removeFromStorage(paths: string[]) {
  if (paths.length === 0) return;
  const { url, key } = env();
  // delete in batches
  for (let i = 0; i < paths.length; i += 100) {
    const batch = paths.slice(i, i + 100);
    await fetch(`${url}/storage/v1/object/exception-photos`, {
      method: "DELETE",
      headers: { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ prefixes: batch }),
    });
  }
}

export async function GET(req: Request) {
  const key = new URL(req.url).searchParams.get("key");
  if (!process.env.CRON_SECRET || key !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const cutoff = new Date(Date.now() - RETENTION_DAYS * 86400000).toISOString();

  // 1) gather old photo paths from both tables
  const exRes = await rest(
    `exceptions?select=photo_path&photo_path=not.is.null&created_at=lt.${cutoff}`,
  );
  const teRes = await rest(
    `time_entries?select=clock_in_photo_path&clock_in_photo_path=not.is.null&clock_in_at=lt.${cutoff}`,
  );
  const exRows = exRes.ok ? ((await exRes.json()) as { photo_path: string }[]) : [];
  const teRows = teRes.ok ? ((await teRes.json()) as { clock_in_photo_path: string }[]) : [];

  const paths = [
    ...exRows.map((r) => r.photo_path),
    ...teRows.map((r) => r.clock_in_photo_path),
  ].filter(Boolean);

  // 2) delete the files
  await removeFromStorage(paths);

  // 3) null the references (keep the time/exception records themselves)
  await rest(`exceptions?photo_path=not.is.null&created_at=lt.${cutoff}`, {
    method: "PATCH",
    headers: { Prefer: "return=minimal" },
    body: JSON.stringify({ photo_path: null }),
  });
  await rest(`time_entries?clock_in_photo_path=not.is.null&clock_in_at=lt.${cutoff}`, {
    method: "PATCH",
    headers: { Prefer: "return=minimal" },
    body: JSON.stringify({ clock_in_photo_path: null }),
  });

  // ---- Vehicle trips + stops (delete rows AND photos past the trip window) ----
  const tripCutoff = new Date(Date.now() - TRIP_RETENTION_DAYS * 86400000).toISOString();

  // Only purge trips that are already closed (never orphan an in-progress trip).
  const oldTripsRes = await rest(
    `vehicle_trips?select=id,start_photo_path,end_photo_path&started_at=lt.${tripCutoff}&ended_at=not.is.null`,
  );
  const oldTrips = oldTripsRes.ok
    ? ((await oldTripsRes.json()) as { id: string; start_photo_path: string | null; end_photo_path: string | null }[])
    : [];
  const tripIds = oldTrips.map((t) => t.id);

  let tripPaths = oldTrips.flatMap((t) => [t.start_photo_path, t.end_photo_path]).filter(Boolean) as string[];
  let stopsDeleted = 0;

  if (tripIds.length) {
    // Gather stop photos for these trips, then delete the stop rows.
    const inList = `(${tripIds.join(",")})`;
    const stopsRes = await rest(`trip_stops?select=photo_path&trip_id=in.${inList}&photo_path=not.is.null`);
    const stopRows = stopsRes.ok ? ((await stopsRes.json()) as { photo_path: string }[]) : [];
    tripPaths = tripPaths.concat(stopRows.map((r) => r.photo_path).filter(Boolean));

    await removeFromStorage(tripPaths);

    const delStops = await rest(`trip_stops?trip_id=in.${inList}`, {
      method: "DELETE",
      headers: { Prefer: "return=minimal" },
    });
    stopsDeleted = delStops.ok ? tripIds.length : 0;
    await rest(`vehicle_trips?id=in.${inList}`, {
      method: "DELETE",
      headers: { Prefer: "return=minimal" },
    });
  }

  return NextResponse.json({
    ok: true,
    retentionDays: RETENTION_DAYS,
    deleted: paths.length,
    tripRetentionDays: TRIP_RETENTION_DAYS,
    tripsDeleted: tripIds.length,
    tripPhotosDeleted: tripPaths.length,
    stopsDeleted,
  });
}
