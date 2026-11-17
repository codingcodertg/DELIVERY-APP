import { describe, it, expect } from "vitest";
import {
  combinaResumenIp, cuotaAgotada, decideAviso, TOPE_CORREOS_HORA, TOPE_CORREOS_LOGIN_HORA, TOPE_SMS_HORA, type CuotaHora,
} from "./topes";

const vacia = (): CuotaHora => ({ correos: 0, correosLogin: 0, sms: 0, resumen: false, omitidos: 0 });

describe("cuota agotada por lectura truncada: cerrado para todo menos la severidad 5", () => {
  it("una cuota llena no deja salir correos de sev 4 ni de login", () => {
    const agotada = cuotaAgotada(vacia());
    expect(agotada.correos).toBe(TOPE_CORREOS_HORA);
    expect(agotada.correosLogin).toBe(TOPE_CORREOS_LOGIN_HORA);
    expect(decideAviso(4, agotada, { correo: true, telefonos: 0 }, 2, "servidor").correo).toBe(false);
    expect(decideAviso(4, agotada, { correo: true, telefonos: 0 }, 2, "login").correo).toBe(false);
  });
  it("pero la severidad 5 sale igual por correo, y el SMS sigue con su tope", () => {
    const agotada = cuotaAgotada(vacia());
    expect(decideAviso(5, agotada, { correo: true, telefonos: 2 }, 2, "servidor")).toMatchObject({ correo: true, sms: 0 });
    expect(agotada.sms).toBe(TOPE_SMS_HORA);
  });
  it("no baja una cuota que ya estaba por encima", () => {
    expect(cuotaAgotada({ ...vacia(), correos: 9 }).correos).toBe(9);
  });
});

describe("resumen por IP: un solo contador por IP y hora", () => {
  it("sin fila previa arranca en el número de esta corrida", () => {
    expect(combinaResumenIp(null, 3, ["a", "b", "c"])).toEqual({ contador: 3, hashes: ["a", "b", "c"] });
  });
  it("con fila previa, suma el contador y acumula los identificadores", () => {
    expect(combinaResumenIp({ contador: 4, hashes: ["x"] }, 2, ["y", "z"])).toEqual({ contador: 6, hashes: ["x", "y", "z"] });
  });
  it("los identificadores se quedan en 50 como mucho", () => {
    const viejos = Array.from({ length: 49 }, (_, i) => `v${i}`);
    const r = combinaResumenIp({ contador: 49, hashes: viejos }, 5, ["n1", "n2", "n3", "n4", "n5"]);
    expect(r.hashes).toHaveLength(50);
    expect(r.contador).toBe(54);
  });
});
