import { describe, it, expect } from "vitest";
import { igualesEnTiempoConstante } from "./comparar-secreto";
import { cronAuthorized } from "./clockin/cronAuth";

describe("igualesEnTiempoConstante", () => {
  it("da verdadero solo con el mismo texto", () => {
    expect(igualesEnTiempoConstante("Bearer abc", "Bearer abc")).toBe(true);
    expect(igualesEnTiempoConstante("Bearer abc", "Bearer abd")).toBe(false);
    expect(igualesEnTiempoConstante("Bearer abc", "Bearer abcd")).toBe(false);
    expect(igualesEnTiempoConstante("", "Bearer abc")).toBe(false);
  });
});

describe("cronAuthorized", () => {
  const CRON = "s3cr3t-cron-value";
  const reqCon = (url: string, auth?: string) =>
    new Request(url, auth === undefined ? undefined : { headers: { authorization: auth } });

  it("acepta Authorization: Bearer <CRON_SECRET>", () => {
    process.env.CRON_SECRET = CRON;
    expect(cronAuthorized(reqCon("https://x.test/api/cron/a", `Bearer ${CRON}`))).toBe(true);
  });

  it("ya NO acepta ?key=<CRON_SECRET> (el secreto no va en la URL)", () => {
    process.env.CRON_SECRET = CRON;
    expect(cronAuthorized(reqCon(`https://x.test/api/cron/a?key=${CRON}`))).toBe(false);
  });

  it("rechaza un Bearer equivocado o sin cabecera", () => {
    process.env.CRON_SECRET = CRON;
    expect(cronAuthorized(reqCon("https://x.test/api/cron/a", "Bearer otro"))).toBe(false);
    expect(cronAuthorized(reqCon("https://x.test/api/cron/a", CRON))).toBe(false); // sin «Bearer »
    expect(cronAuthorized(reqCon("https://x.test/api/cron/a"))).toBe(false);
  });

  it("falla cerrado si CRON_SECRET no está configurado", () => {
    delete process.env.CRON_SECRET;
    expect(cronAuthorized(reqCon("https://x.test/api/cron/a", "Bearer "))).toBe(false);
    expect(cronAuthorized(reqCon("https://x.test/api/cron/a", "Bearer undefined"))).toBe(false);
  });
});
