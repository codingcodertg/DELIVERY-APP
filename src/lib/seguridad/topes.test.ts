import { describe, it, expect } from "vitest";
import {
  cuotaDeLaHora, decideAviso, marcaPorIp, necesitaResumen, origenDe, ordenaPorGravedad,
  TOPE_CORREOS_HORA, TOPE_CORREOS_LOGIN_HORA, TOPE_IDENTIFICADORES_POR_IP_HORA, TOPE_SMS_HORA, TOPE_SMS_POR_CORRIDA,
  type CuotaHora,
} from "./topes";
import type { Hallazgo } from "./detectores";

const vacia = (): CuotaHora => ({ correos: 0, correosLogin: 0, sms: 0, resumen: false, omitidos: 0 });
const SI = { correo: true, telefonos: 2 };

describe("cuotaDeLaHora: cuenta lo que ya salió en la última hora", () => {
  it("separa correos del servidor y de login, y suma SMS, omitidas y resumen", () => {
    const c = cuotaDeLaHora([
      { avisos: { correo: true, sms: 2, origen: "servidor" } },
      { avisos: { correo: true, origen: "login" } },
      { avisos: { correo: true } }, // filas antiguas: cuentan como servidor
      { omitido: "correo" },
      { omitido: "sms" },
      { resumen_horario: true, omitidas: 9 },
      { agrupada: "ip" },
      null,
    ]);
    expect(c).toEqual({ correos: 2, correosLogin: 1, sms: 2, resumen: true, omitidos: 2 });
  });
});

describe("origen del aviso", () => {
  it("los fallos de login son de navegador; el resto, del servidor", () => {
    expect(origenDe("login-fallido-identificador")).toBe("login");
    expect(origenDe("login-fallido-ip")).toBe("login");
    expect(origenDe("login-fallido-ip-agrupado")).toBe("login");
    expect(origenDe("ratelimit-ip")).toBe("servidor");
    expect(origenDe("admin-nuevo")).toBe("servidor");
  });
});

describe("tope de correos del servidor: 5 por hora", () => {
  it("la quinta sale, la sexta se omite", () => {
    expect(decideAviso(4, { ...vacia(), correos: TOPE_CORREOS_HORA - 1 }, { correo: true, telefonos: 0 }, 0, "servidor").correo).toBe(true);
    const sexta = decideAviso(4, { ...vacia(), correos: TOPE_CORREOS_HORA }, { correo: true, telefonos: 0 }, 0, "servidor");
    expect(sexta).toMatchObject({ correo: false, omitido: "correo" });
  });
  it("una alerta de severidad 3 no avisa por correo nunca", () => {
    expect(decideAviso(3, vacia(), SI, 2, "servidor")).toEqual({ correo: false, sms: 0, omitido: null });
  });
});

describe("cuota de login aparte: no puede gastar la del servidor", () => {
  it("con la cuota de login agotada, una alerta de login se omite pero una del servidor sale", () => {
    const agotada = { ...vacia(), correosLogin: TOPE_CORREOS_LOGIN_HORA, correos: 0 };
    expect(decideAviso(4, agotada, { correo: true, telefonos: 0 }, 0, "login")).toMatchObject({ correo: false, omitido: "correo" });
    expect(decideAviso(4, agotada, { correo: true, telefonos: 0 }, 0, "servidor").correo).toBe(true);
  });
  it("con la cuota del servidor agotada, un fallo de login sigue saliendo si le queda cupo", () => {
    const llena = { ...vacia(), correos: TOPE_CORREOS_HORA, correosLogin: 0 };
    expect(decideAviso(4, llena, { correo: true, telefonos: 0 }, 0, "login").correo).toBe(true);
  });
});

describe("severidad 5 siempre sale por correo, aunque la cuota esté agotada", () => {
  it("la cuota del servidor llena no detiene una alerta 5/5", () => {
    const llena = { ...vacia(), correos: TOPE_CORREOS_HORA + 3 };
    expect(decideAviso(5, llena, { correo: true, telefonos: 0 }, 0, "servidor")).toMatchObject({ correo: true, omitido: null });
  });
  it("y tampoco la de login", () => {
    const llena = { ...vacia(), correosLogin: TOPE_CORREOS_LOGIN_HORA + 1 };
    expect(decideAviso(5, llena, { correo: true, telefonos: 0 }, 0, "login").correo).toBe(true);
  });
});

describe("tope de SMS: 2 por corrida y 2 por hora (sev 5)", () => {
  it("por corrida: aunque la hora esté libre, no pasa de 2 mensajes en la corrida", () => {
    expect(TOPE_SMS_POR_CORRIDA).toBe(2);
    const d = decideAviso(5, vacia(), { correo: false, telefonos: 5 }, TOPE_SMS_POR_CORRIDA, "servidor");
    expect(d.sms).toBe(2);
    expect(d.omitido).toBe("sms");
  });
  it("por hora: si ya salieron 2 en la hora, no sale ninguno más", () => {
    const d = decideAviso(5, { ...vacia(), sms: TOPE_SMS_HORA }, SI, 2, "servidor");
    expect(d.sms).toBe(0);
    expect(d.omitido).toBe("sms");
  });
  it("el SMS solo es para severidad 5", () => {
    expect(decideAviso(4, vacia(), SI, 2, "servidor").sms).toBe(0);
  });
  it("con un solo teléfono y cupo, manda uno y no marca omisión", () => {
    expect(decideAviso(5, vacia(), { correo: false, telefonos: 1 }, 2, "servidor")).toEqual({ correo: false, sms: 1, omitido: null });
  });
});

describe("orden por gravedad: lo grave primero, y estable a igual severidad", () => {
  it("de mayor a menor, sin tocar el original", () => {
    const xs = [{ severidad: 3, n: "a" }, { severidad: 5, n: "b" }, { severidad: 4, n: "c" }, { severidad: 5, n: "d" }];
    const orden = ordenaPorGravedad(xs).map((x) => x.n);
    expect(orden).toEqual(["b", "d", "c", "a"]);
    expect(xs[0].n).toBe("a");
  });
  it("así un 5/5 se atiende antes que un 4 cuando la cuota es corta", () => {
    const orden = ordenaPorGravedad([{ severidad: 4, id: 1 }, { severidad: 5, id: 2 }]);
    expect(orden[0].id).toBe(2);
  });
});

describe("correo-resumen: una vez por hora, cuando hubo omitidas", () => {
  it("sale si hubo omitidas (en la hora o en esta corrida) y aún no salió", () => {
    expect(necesitaResumen(vacia(), 1)).toBe(true);
    expect(necesitaResumen({ ...vacia(), omitidos: 4 }, 0)).toBe(true);
  });
  it("no sale si no hubo omitidas", () => {
    expect(necesitaResumen(vacia(), 0)).toBe(false);
  });
  it("no sale otra vez si ya salió en esta hora", () => {
    expect(necesitaResumen({ ...vacia(), omitidos: 9, resumen: true }, 3)).toBe(false);
  });
});

function identificador(ip: string | null, n: number): Hallazgo[] {
  return Array.from({ length: n }, (_, i) => ({
    detector: "login-fallido-identificador", severidad: 4 as const, sujeto: `identificador:${ip}-${i}`,
    usuario_id: null, ip, resumen: "",
  }));
}

describe("fallos por IP: se guarda todo; pasado el tope, la alerta va marcada como agrupada (sin aviso)", () => {
  it("la cuarta cuenta de la misma IP se GUARDA, marcada como agrupada, y se lista su hash", () => {
    const { marcados, agrupados, hashes } = marcaPorIp(identificador("1.1.1.1", 5), new Map());
    expect(marcados).toHaveLength(5);
    expect(marcados.filter((m) => !m.agrupada)).toHaveLength(TOPE_IDENTIFICADORES_POR_IP_HORA);
    expect(marcados.filter((m) => m.agrupada)).toHaveLength(2);
    expect(agrupados.get("1.1.1.1")).toBe(2);
    expect(hashes.get("1.1.1.1")).toEqual(["1.1.1.1-3", "1.1.1.1-4"]);
  });
  it("cuenta lo que la IP ya abrió antes en la hora", () => {
    const { marcados, agrupados } = marcaPorIp(identificador("2.2.2.2", 2), new Map([["2.2.2.2", 2]]));
    expect(marcados.filter((m) => !m.agrupada)).toHaveLength(1);
    expect(agrupados.get("2.2.2.2")).toBe(1);
  });
  it("otra IP no se ve afectada", () => {
    const mezcla = [...identificador("1.1.1.1", 5), ...identificador("3.3.3.3", 2)];
    const { marcados, agrupados } = marcaPorIp(mezcla, new Map());
    expect(marcados.filter((m) => m.h.ip === "3.3.3.3" && m.agrupada)).toHaveLength(0);
    expect(agrupados.has("3.3.3.3")).toBe(false);
  });
  it("los hallazgos que no son de identificador pasan sin marcar", () => {
    const otro: Hallazgo = { detector: "ratelimit-ip", severidad: 3, sujeto: "ratelimit:1.1.1.1", usuario_id: null, ip: "1.1.1.1", resumen: "" };
    const { marcados } = marcaPorIp([otro], new Map([["1.1.1.1", 99]]));
    expect(marcados).toEqual([{ h: otro, agrupada: false }]);
  });
});
