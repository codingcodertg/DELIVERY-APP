import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { boletoDe, boletoValido, VIDA_DEL_BOLETO_MS } from "./cron-boleto";

const T = "a".repeat(64);
const pide = (auth?: string) => new Request("https://x.test/api/cron/rc-comms", { headers: auth ? { authorization: auth } : {} });

describe("boleto de un cron que sale de la base (D-1129)", () => {
  it("solo cuenta un token con forma de boleto", () => {
    expect(boletoDe(pide(`Bearer boleto:${T}`))).toBe(T);
    expect(boletoDe(pide("Bearer otro-secreto"))).toBeNull();
    expect(boletoDe(pide("Bearer boleto:corto"))).toBeNull();
    expect(boletoDe(pide("Bearer boleto:" + "Z".repeat(64)))).toBeNull();
    expect(boletoDe(pide())).toBeNull();
  });

  it("vale si la base lo encuentra para ESA ruta y reciente, y lo gasta", async () => {
    const vistos: unknown[] = [];
    const ahora = new Date("2026-11-22T12:00:00Z");
    const base = { gastaBoleto: async (token: string, ruta: string, desde: string) => { vistos.push([token, ruta, desde]); return 1; } };
    expect(await boletoValido(pide(`Bearer boleto:${T}`), "/api/cron/rc-comms", base, ahora)).toBe(true);
    expect(vistos).toEqual([[T, "/api/cron/rc-comms", new Date(ahora.getTime() - VIDA_DEL_BOLETO_MS).toISOString()]]);
  });

  it("no vale si no existe (ya gastado, viejo o de otra ruta), si falla la base o si no trae boleto", async () => {
    expect(await boletoValido(pide(`Bearer boleto:${T}`), "/api/cron/rc-comms", { gastaBoleto: async () => 0 })).toBe(false);
    expect(await boletoValido(pide(`Bearer boleto:${T}`), "/api/cron/rc-comms", { gastaBoleto: async () => { throw new Error("x"); } })).toBe(false);
    let llamadas = 0;
    expect(await boletoValido(pide("Bearer secreto"), "/api/cron/rc-comms", { gastaBoleto: async () => { llamadas++; return 1; } })).toBe(false);
    expect(llamadas).toBe(0);
  });

  it("los dos crons de RingCentral aceptan el boleto de SU ruta; la migración solo llama rutas de cron y la tabla no tiene políticas", () => {
    expect(readFileSync("src/app/api/cron/rc-comms/route.ts", "utf8")).toContain('await cronAutorizadoORBoleto(req, "/api/cron/rc-comms")');
    expect(readFileSync("src/app/api/cron/rc-choferes/route.ts", "utf8")).toContain('await cronAutorizadoORBoleto(req, "/api/cron/rc-choferes")');
    const sql = readFileSync("supabase/migrations/342_cron_desde_la_base.sql", "utf8");
    expect(sql).toContain("alter table public.cron_tickets enable row level security;");
    expect(sql).not.toMatch(/create policy/i);
    expect(sql).toContain("if p_ruta !~ '^/api/cron/[a-z0-9/-]+$' then");
    expect(sql).toContain("revoke all on function public.llama_cron(text) from public, anon, authenticated;");
  });
});
