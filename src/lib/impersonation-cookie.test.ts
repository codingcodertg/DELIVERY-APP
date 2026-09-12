import { describe, it, expect } from "vitest";
import { empaquetar, desempaquetar, AJUSTES_COOKIE, COOKIE_RETORNO } from "./impersonation-cookie";
import { IMPERSONACION_MINUTOS } from "./impersonation";

const buena = { refresh: "rt_123", adminId: "a1", comoId: "v1", inicio: 1_700_000_000_000 };

describe("la cookie de vuelta", () => {
  it("va y vuelve entera", () => {
    expect(desempaquetar(empaquetar(buena))).toEqual(buena);
  });

  it("cualquier duda es null, y null significa «no hay vuelta»", () => {
    // Lo que hace esta lista: cada forma rota que se me ocurrió tiene que salir por el mismo
    // sitio, porque quien llama solo distingue «hay vuelta» de «no la hay».
    const rotas: (string | null | undefined)[] = [
      null, undefined, "", "no soy json", "[]", "null", "42",
      JSON.stringify({ ...buena, refresh: "" }),
      JSON.stringify({ ...buena, refresh: 7 }),
      JSON.stringify({ ...buena, adminId: "  " }),
      JSON.stringify({ ...buena, comoId: undefined }),
      JSON.stringify({ ...buena, inicio: 0 }),
      JSON.stringify({ ...buena, inicio: -1 }),
      JSON.stringify({ ...buena, inicio: "ayer" }),
    ];
    for (const r of rotas) expect(desempaquetar(r), String(r)).toBeNull();
  });

  it("y una buena de verdad sí pasa, que es el control de la lista de arriba", () => {
    expect(desempaquetar(JSON.stringify(buena))).not.toBeNull();
  });
});

describe("los ajustes de la cookie", () => {
  it("el navegador no la deja leer al JavaScript de la página", () => {
    expect(AJUSTES_COOKIE.httpOnly).toBe(true);
    expect(AJUSTES_COOKIE.sameSite).toBe("lax");
    expect(AJUSTES_COOKIE.path).toBe("/");
  });

  it("dura un minuto más que la impersonación, no menos", () => {
    // Si caducara a la vez, moriría justo en el instante en que hace falta para devolver al
    // admin — y entonces «volver» acabaría en el login en el caso más previsible de todos.
    expect(AJUSTES_COOKIE.maxAge).toBe((IMPERSONACION_MINUTOS + 1) * 60);
    expect(AJUSTES_COOKIE.maxAge).toBeGreaterThan(IMPERSONACION_MINUTOS * 60);
  });

  it("tiene un nombre propio y reconocible", () => {
    expect(COOKIE_RETORNO).toBe("rtg_impersonation_return");
  });
});
