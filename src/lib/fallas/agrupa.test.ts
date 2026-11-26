import { describe, it, expect } from "vitest";
import { agrupaFallas, filtraFallas, type FilaDeFalla } from "./agrupa";

const fila = (p: Partial<FilaDeFalla> & Pick<FilaDeFalla, "id" | "huella">): FilaDeFalla => ({
  created_at: "2026-11-24T10:00:00.000Z",
  origen: "cliente",
  app: "timetracker",
  ruta: "/timetracker/clock-in",
  mensaje: "boom",
  pila: null,
  componente: null,
  user_id: null,
  rol: null,
  version: "1.45.2",
  navegador: "Chrome",
  escritorio: false,
  veces: 1,
  ultima_vez: "2026-11-24T10:00:00.000Z",
  usuarios: [],
  ...p,
});

describe("agrupaFallas", () => {
  it("una fila por huella, con las veces sumadas", () => {
    const grupos = agrupaFallas([
      fila({ id: "1", huella: "h", veces: 3 }),
      fila({ id: "2", huella: "h", veces: 2, created_at: "2026-11-25T08:00:00.000Z", ultima_vez: "2026-11-25T09:00:00.000Z" }),
      fila({ id: "3", huella: "otra" }),
    ]);
    expect(grupos).toHaveLength(2);
    const g = grupos.find((x) => x.huella === "h")!;
    expect(g.veces).toBe(5);
    expect(g.primera).toBe("2026-11-24T10:00:00.000Z");
    expect(g.ultima).toBe("2026-11-25T09:00:00.000Z");
    expect(g.filas.map((f) => f.id)).toEqual(["2", "1"]);
  });

  it("cuenta a las personas distintas (usuario de la fila y los de la lista de la base)", () => {
    const g = agrupaFallas([
      fila({ id: "1", huella: "h", user_id: "ana", usuarios: ["ana"] }),
      fila({ id: "2", huella: "h", user_id: "luis", usuarios: ["luis", "ana", "marta"] }),
      fila({ id: "3", huella: "h", user_id: null, usuarios: [] }),
    ])[0];
    expect(g.usuarios).toBe(3);
  });

  it("junta las versiones y los navegadores, sin repetir", () => {
    const g = agrupaFallas([
      fila({ id: "1", huella: "h", version: "1.45.1", navegador: "Chrome" }),
      fila({ id: "2", huella: "h", version: "1.45.2", navegador: "Chrome" }),
      fila({ id: "3", huella: "h", version: "1.45.2", navegador: "Electron" }),
    ])[0];
    expect(g.versiones).toEqual(["1.45.1", "1.45.2"]);
    expect(g.navegadores).toEqual(["Chrome", "Electron"]);
  });

  it("se ordena por lo visto más recientemente", () => {
    const grupos = agrupaFallas([
      fila({ id: "1", huella: "vieja", ultima_vez: "2026-11-20T00:00:00.000Z" }),
      fila({ id: "2", huella: "nueva", ultima_vez: "2026-11-25T00:00:00.000Z" }),
    ]);
    expect(grupos.map((g) => g.huella)).toEqual(["nueva", "vieja"]);
  });
});

describe("filtraFallas", () => {
  const filas = [
    fila({ id: "1", huella: "a", app: "timetracker", origen: "cliente", ultima_vez: "2026-11-20T10:00:00.000Z" }),
    fila({ id: "2", huella: "b", app: "erp", origen: "api", ultima_vez: "2026-11-24T10:00:00.000Z" }),
    fila({ id: "3", huella: "c", app: "erp", origen: "cron", ultima_vez: "2026-11-25T10:00:00.000Z" }),
  ];

  it("por app y por origen", () => {
    expect(filtraFallas(filas, { app: "erp" }).map((f) => f.id)).toEqual(["2", "3"]);
    expect(filtraFallas(filas, { origen: "cron" }).map((f) => f.id)).toEqual(["3"]);
  });

  it("por rango de fechas, incluido en los dos extremos", () => {
    expect(filtraFallas(filas, { desde: "2026-11-21", hasta: "2026-11-24" }).map((f) => f.id)).toEqual(["2"]);
    expect(filtraFallas(filas, { desde: "2026-11-24" }).map((f) => f.id)).toEqual(["2", "3"]);
  });

  it("sin filtros, todo", () => {
    expect(filtraFallas(filas, {})).toHaveLength(3);
  });
});
