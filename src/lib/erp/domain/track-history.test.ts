// Regression lock for the GPS-history and location-filter ports (ADR 0010).
//
// The expected block was produced by the ORIGINAL implementation and is compared value for value.
// These two modules are where a silent drift would be least visible — a reconstructed day is
// plausible-looking whatever the numbers say — so the assertion is against real output, not against
// what the numbers ought to be.
//
// Cases that matter, all covered below:
//   * an impossible jump (McAllen -> New York in one minute) is REFUSED and counted, not averaged
//     into the mileage: one stray fix from another device once turned a day into 4,936 miles.
//   * a long silence becomes `unknownMinutes` rather than driving or standing, because the data
//     genuinely cannot tell those apart.
import { test, expect } from "vitest";
import {
  cleanFixes, summarizeTrack, nameStop,
  STILL_M, STOP_MIN_MINUTES, GAP_MINUTES, MAX_ACCURACY_M, MAX_SPEED_MPH, MIN_TELEPORT_MI,
  type Fix,
} from "./track-history";
import {
  metresBetween, shouldSend, heartbeatDue,
  MIN_INTERVAL_MS, MIN_MOVE_M, HEARTBEAT_MS,
} from "./location-filter";

const T0 = Date.parse("2026-08-25T13:00:00Z");
const at = (min: number) => new Date(T0 + min * 60_000).toISOString();
const f = (lat: number, lng: number, min: number, acc?: number | null): Fix => ({ lat, lng, at: at(min), accuracy_m: acc });
const B = { lat: 26.2034, lng: -98.23 };

const EXPECTED = `
const|60|4|20|200|100|1
lfconst|10000|25|300000
clean|00:00,03:00,07:00,10:00
clean-empty|[]
sum-day|{"miles":3.5,"movingMinutes":15,"stoppedMinutes":25,"unknownMinutes":0,"firstAt":"2026-08-25T13:00:00.000Z","lastAt":"2026-08-25T13:40:00.000Z","stops":[{"at":{"lat":26.2034,"lng":-98.23},"from":"2026-08-25T13:00:00.000Z","to":"2026-08-25T13:10:00.000Z","minutes":10},{"at":{"lat":26.2534,"lng":-98.23},"from":"2026-08-25T13:25:00.000Z","to":"2026-08-25T13:40:00.000Z","minutes":15}],"gaps":0,"teleports":0,"sparse":true,"fixes":6}
sum-teleport|{"miles":0,"movingMinutes":0,"stoppedMinutes":11,"unknownMinutes":1,"firstAt":"2026-08-25T13:00:00.000Z","lastAt":"2026-08-25T13:12:00.000Z","stops":[{"at":{"lat":26.2034,"lng":-98.23},"from":"2026-08-25T13:00:00.000Z","to":"2026-08-25T13:05:00.000Z","minutes":5},{"at":{"lat":40.7,"lng":-74},"from":"2026-08-25T13:06:00.000Z","to":"2026-08-25T13:12:00.000Z","minutes":6}],"gaps":0,"teleports":1,"sparse":true,"fixes":4}
sum-gap|{"miles":1.4,"movingMinutes":0,"stoppedMinutes":10,"unknownMinutes":85,"firstAt":"2026-08-25T13:00:00.000Z","lastAt":"2026-08-25T14:35:00.000Z","stops":[{"at":{"lat":26.2034,"lng":-98.23},"from":"2026-08-25T13:00:00.000Z","to":"2026-08-25T13:05:00.000Z","minutes":5},{"at":{"lat":26.223399999999998,"lng":-98.23},"from":"2026-08-25T14:30:00.000Z","to":"2026-08-25T14:35:00.000Z","minutes":5}],"gaps":1,"teleports":0,"sparse":true,"fixes":4}
sum-empty|{"miles":0,"movingMinutes":0,"stoppedMinutes":0,"unknownMinutes":0,"firstAt":null,"lastAt":null,"stops":[],"gaps":0,"teleports":0,"sparse":false,"fixes":0}
sum-one|{"miles":0,"movingMinutes":0,"stoppedMinutes":0,"unknownMinutes":0,"firstAt":"2026-08-25T13:00:00.000Z","lastAt":"2026-08-25T13:00:00.000Z","stops":[],"gaps":0,"teleports":0,"sparse":false,"fixes":1}
stops-n|2
name|McAllen Depot|McAllen Depot
name|null|null
name-none|null
m|same|0
m|near|111.19492664469462
send|first|true
send|too-soon|false
send|moved|true
send|still|false
send|coarse|false
send|still-but-heartbeat|true
send|no-accuracy|true
hb|never|false
hb|recent|false
hb|due|true
`.trim().split("\n");

test("track-history + location-filter ports match the original exactly", () => {
  const out: string[] = [];
  const j = (v: unknown) => JSON.stringify(v);

  out.push(`const|${STILL_M}|${STOP_MIN_MINUTES}|${GAP_MINUTES}|${MAX_ACCURACY_M}|${MAX_SPEED_MPH}|${MIN_TELEPORT_MI}`);
  out.push(`lfconst|${MIN_INTERVAL_MS}|${MIN_MOVE_M}|${HEARTBEAT_MS}`);

  const messy: Fix[] = [
    f(B.lat, B.lng, 10, 20), f(B.lat, B.lng, 0, 20), f(B.lat, B.lng, 5, 999),
    f(B.lat, B.lng, 7, null), f(B.lat, B.lng, 3, 200),
  ];
  out.push(`clean|${cleanFixes(messy).map((x) => x.at.slice(14, 19)).join(",")}`);
  out.push(`clean-empty|${j(cleanFixes([]))}`);

  const day: Fix[] = [
    f(B.lat, B.lng, 0, 10), f(B.lat, B.lng, 5, 10), f(B.lat, B.lng, 10, 10),
    f(B.lat + 0.05, B.lng, 25, 10), f(B.lat + 0.05, B.lng, 30, 10), f(B.lat + 0.05, B.lng, 40, 10),
  ];
  out.push(`sum-day|${j(summarizeTrack(day))}`);

  const teleport: Fix[] = [
    f(B.lat, B.lng, 0, 10), f(B.lat, B.lng, 5, 10),
    f(40.7, -74.0, 6, 10), f(40.7, -74.0, 12, 10),
  ];
  out.push(`sum-teleport|${j(summarizeTrack(teleport))}`);

  const gap: Fix[] = [
    f(B.lat, B.lng, 0, 10), f(B.lat, B.lng, 5, 10),
    f(B.lat + 0.02, B.lng, 90, 10), f(B.lat + 0.02, B.lng, 95, 10),
  ];
  out.push(`sum-gap|${j(summarizeTrack(gap))}`);
  out.push(`sum-empty|${j(summarizeTrack([]))}`);
  out.push(`sum-one|${j(summarizeTrack([f(B.lat, B.lng, 0, 10)]))}`);

  const places = [
    { label: "McAllen Depot", lat: B.lat, lng: B.lng },
    { label: "Pharr Store", lat: 26.1948, lng: -98.1836 },
  ];
  const stops = summarizeTrack(day).stops;
  out.push(`stops-n|${stops.length}`);
  for (const s of stops) out.push(`name|${nameStop(s, places)}|${nameStop(s, places, 0.001)}`);
  out.push(`name-none|${stops.length ? nameStop(stops[0], []) : "n/a"}`);

  out.push(`m|same|${metresBetween(B.lat, B.lng, B.lat, B.lng)}`);
  out.push(`m|near|${metresBetween(B.lat, B.lng, B.lat + 0.001, B.lng)}`);

  const L = (lat: number, lng: number, t: number) => ({ lat, lng, at: t });
  const cases: Array<[string, { lat: number; lng: number; accuracy?: number | null }, { lat: number; lng: number; at: number } | null, number]> = [
    ["first", { lat: B.lat, lng: B.lng, accuracy: 10 }, null, T0],
    ["too-soon", { lat: B.lat + 0.01, lng: B.lng, accuracy: 10 }, L(B.lat, B.lng, T0), T0 + 5_000],
    ["moved", { lat: B.lat + 0.01, lng: B.lng, accuracy: 10 }, L(B.lat, B.lng, T0), T0 + 60_000],
    ["still", { lat: B.lat, lng: B.lng, accuracy: 10 }, L(B.lat, B.lng, T0), T0 + 60_000],
    ["coarse", { lat: B.lat + 0.01, lng: B.lng, accuracy: 999 }, L(B.lat, B.lng, T0), T0 + 60_000],
    ["still-but-heartbeat", { lat: B.lat, lng: B.lng, accuracy: 10 }, L(B.lat, B.lng, T0), T0 + HEARTBEAT_MS],
    ["no-accuracy", { lat: B.lat + 0.01, lng: B.lng }, L(B.lat, B.lng, T0), T0 + 60_000],
  ];
  for (const [name, fix, last, now] of cases) out.push(`send|${name}|${shouldSend(fix, last, now)}`);

  out.push(`hb|never|${heartbeatDue(null, T0)}`);
  out.push(`hb|recent|${heartbeatDue(T0, T0 + 60_000)}`);
  out.push(`hb|due|${heartbeatDue(T0, T0 + HEARTBEAT_MS)}`);

  expect(out).toEqual(EXPECTED);
});
