import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { credencialesDeLaSincronizacion } from "./credenciales";

const AGENDAS = JSON.stringify([{ nombre: "Andrés", clientId: "app-1", clientSecret: "s-1", jwt: "jwt-de-la-agenda" }]);

describe("credenciales para leer las llamadas de la empresa (D-1128)", () => {
  it("sin agenda no hay credenciales, aunque haya JWT de empresa", () => {
    expect(credencialesDeLaSincronizacion({})).toBeNull();
    expect(credencialesDeLaSincronizacion({ RINGCENTRAL_LLAMADAS_JWT: "jwt-admin" })).toBeNull();
  });

  it("sin la variable nueva, la agenda de siempre", () => {
    expect(credencialesDeLaSincronizacion({ RINGCENTRAL_AGENDAS_EXTRA: AGENDAS })).toMatchObject({ clientId: "app-1", jwt: "jwt-de-la-agenda" });
  });

  it("con RINGCENTRAL_LLAMADAS_JWT: la misma app, entrando como el usuario administrador", () => {
    expect(credencialesDeLaSincronizacion({ RINGCENTRAL_AGENDAS_EXTRA: AGENDAS, RINGCENTRAL_LLAMADAS_JWT: "  jwt-admin  " }))
      .toEqual({ clientId: "app-1", clientSecret: "s-1", jwt: "jwt-admin" });
  });

  it("las comunicaciones de candidatos siguen con el JWT de la agenda; las llamadas de leads, con el de empresa", () => {
    const cron = readFileSync("src/app/api/cron/rc-comms/route.ts", "utf8");
    expect(cron).toContain("sincronizarRcComms({ db: createAdminClient(), credenciales: agenda, ahora: new Date() })");
    expect(cron).toContain("sincronizarLlamadasDeLeads({ db: createAdminClient(), credenciales: credencialesDeLaSincronizacion() ?? agenda, ahora: new Date() })");
  });
});
