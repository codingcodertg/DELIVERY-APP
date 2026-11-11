import { describe, it, expect, vi, afterEach } from "vitest";
import { errorAlCliente } from "./api-error";

afterEach(() => vi.restoreAllMocks());

describe("errorAlCliente", () => {
  it("no filtra el detalle de la base al cliente y registra en el servidor", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const res = errorAlCliente("prueba", new Error('duplicate key value violates unique constraint "profiles_username_key"'), 500);
    expect(res.status).toBe(500);
    const cuerpo = await res.json();
    expect(cuerpo.error).toBe("Something went wrong. Please try again.");
    expect(JSON.stringify(cuerpo)).not.toContain("constraint"); // el detalle de la BD NO sale
    expect(log).toHaveBeenCalled(); // pero sí se registra en el servidor
    expect(String(log.mock.calls[0])).toContain("constraint");
  });

  it("respeta un mensaje genérico propio y el status", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const res = errorAlCliente("prueba", { code: "42P01", message: "relation x does not exist" }, 503, "Could not reach the database.");
    expect(res.status).toBe(503);
    const cuerpo = await res.json();
    expect(cuerpo.error).toBe("Could not reach the database.");
    expect(JSON.stringify(cuerpo)).not.toContain("relation x");
  });
});
