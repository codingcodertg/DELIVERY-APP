import { describe, expect, it } from "vitest";
import { datosDemoDeSeguridad } from "./demo-data";

// D-931 · La semilla de Seguridad del demo. Con una fecha FIJA: una prueba con la fecha real pasa en local y cae en
// el CI tras la medianoche UTC.
const AHORA = new Date("2026-11-08T18:00:00Z");
const d = datosDemoDeSeguridad(AHORA);
const ids = new Set(d.todos.map((p) => p.id));

describe("la semilla de Seguridad del demo", () => {
  it("cada dispositivo y cada uso apuntan a personas que existen", () => {
    for (const x of d.devices) {
      for (const id of [x.first_user_id, x.last_user_id, x.requested_by]) if (id) expect(ids.has(id), `${x.id}: ${id}`).toBe(true);
    }
    const dispositivos = new Set(d.devices.map((x) => x.id));
    for (const u of d.usos) { expect(ids.has(u.user_id)).toBe(true); expect(dispositivos.has(u.device_id)).toBe(true); }
    for (const b of d.bloqueos) { expect(ids.has(b.user_id)).toBe(true); if (b.device_id) expect(dispositivos.has(b.device_id)).toBe(true); }
    for (const id of d.policy?.web_exempt ?? []) expect(ids.has(id)).toBe(true);
  });

  it("nada está fechado en el futuro y los bloqueos caen en los últimos 7 días (lo que lee la página)", () => {
    const ms = AHORA.getTime();
    for (const x of d.devices) { expect(Date.parse(x.last_seen_at)).toBeLessThanOrEqual(ms); expect(Date.parse(x.first_seen_at)).toBeLessThanOrEqual(Date.parse(x.last_seen_at)); }
    for (const u of d.usos) expect(Date.parse(u.last_seen_at)).toBeLessThanOrEqual(ms);
    for (const b of d.bloqueos) { expect(Date.parse(b.at)).toBeLessThanOrEqual(ms); expect(Date.parse(b.at)).toBeGreaterThan(ms - 7 * 86400000); }
  });

  it("hay de todo lo que el panel enseña: uno pendiente con quién lo pidió, uno revocado, uno ligado y uno con versión vieja", () => {
    const pendiente = d.devices.find((x) => x.status === "pending");
    expect(pendiente?.requested_by).toBeTruthy();
    expect(pendiente?.request_note).toBeTruthy();
    expect(d.devices.some((x) => x.status === "revoked" && x.revoked_at)).toBe(true);
    expect(d.devices.some((x) => x.bound)).toBe(true);
    expect(d.devices.some((x) => /RTGHub\/1\.1\.0/.test(x.user_agent ?? ""))).toBe(true);
    expect(d.policy?.enforced).toBe(true);
  });

  it("las fechas se mueven con «ahora»: la misma semilla un día después queda un día después", () => {
    const d2 = datosDemoDeSeguridad(new Date(AHORA.getTime() + 86400000));
    expect(Date.parse(d2.devices[0].last_seen_at) - Date.parse(d.devices[0].last_seen_at)).toBe(86400000);
  });
});
