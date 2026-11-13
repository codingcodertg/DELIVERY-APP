import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { esErrorTecnico, mensajeDeError, mensajeDeErrorAlCargar } from "./mensaje-de-error";

/** D-1021: el fallo de la base, dicho para quien trabaja; lo crudo, a la consola. */
describe("mensajeDeError", () => {
  let consola: ReturnType<typeof vi.spyOn>;
  beforeEach(() => { consola = vi.spyOn(console, "error").mockImplementation(() => {}); });
  afterEach(() => { consola.mockRestore(); });

  it("lo nuestro de Warehouse Ops sale sin el prefijo, en español, y en inglés con su frase", () => {
    expect(mensajeDeError({ code: "P0001", message: "warehouse_ops: el grupo ya esta aprobado" }, "es")).toBe("El grupo ya esta aprobado.");
    expect(mensajeDeError({ code: "P0001", message: "warehouse_ops: el grupo ya esta aprobado" }, "en")).toBe("The group is already approved.");
    expect(mensajeDeError({ code: "42501", message: "warehouse_ops: sin acceso a esa tienda" }, "en")).toBe("You don't have access to that store.");
    expect(mensajeDeError(new Error("warehouse_ops: primero la foto de las piezas"), "es")).toBe("Primero la foto de las piezas.");
    // Sin frase en inglés: mejor el texto de la base (español, legible) que uno genérico.
    expect(mensajeDeError({ message: "warehouse_ops: faltan 3 lineas por contar" }, "en")).toBe("Faltan 3 lineas por contar.");
    expect(consola).not.toHaveBeenCalled();
  });

  it("los RELEVO_* salen con su explicación en los dos idiomas", () => {
    expect(mensajeDeError({ code: "P0001", message: "RELEVO_ORDEN: this transfer step can't be picked up until step A is delivered" }, "es"))
      .toBe("Este tramo no se puede recoger hasta que el tramo anterior se entregue en la tienda de relevo.");
    expect(mensajeDeError({ message: "RELEVO_ORDEN_DESHACER: next step already picked up" }, "en")).toBe("It can't be undone: the next transfer step was already picked up.");
    expect(mensajeDeError({ message: "RELEVO_FORBIDDEN: only route planners" }, "es")).toBe("Solo quien planea rutas o un admin arma o deshace un relevo.");
    expect(mensajeDeError("RELEVO_NOT_FOUND: order 12", "en")).toBe("The order was not found.");
  });

  it("los códigos conocidos de Postgres / PostgREST tienen su frase, y lo crudo va a la consola", () => {
    const rls = { code: "42501", message: 'new row violates row-level security policy for table "customers"' };
    expect(mensajeDeError(rls, "es")).toBe("No tienes permiso para hacer esto.");
    expect(mensajeDeError(rls, "en")).toBe("You don't have permission to do this.");
    expect(consola).toHaveBeenCalledWith("[error]", rls);
    expect(mensajeDeError({ code: "23505", message: 'duplicate key value violates unique constraint "x_key"' }, "es")).toBe("Eso ya existe (está repetido).");
    expect(mensajeDeError({ code: "23503", message: "violates foreign key constraint" }, "es")).toBe("No se puede: hay otros registros que dependen de este.");
    expect(mensajeDeError({ code: "23502", message: 'null value in column "store"' }, "es")).toBe("Falta un dato obligatorio.");
    expect(mensajeDeError({ code: "22P02", message: "invalid input syntax for type uuid" }, "es")).toBe("Uno de los datos no tiene el formato correcto.");
    expect(mensajeDeError({ code: "PGRST116", message: "JSON object requested, multiple (or no) rows returned" }, "es")).toBe("No se encontró (puede que ya lo hayan borrado).");
    expect(mensajeDeError({ code: "57014", message: "canceling statement due to statement timeout" }, "es")).toBe("Tardó demasiado. Intenta de nuevo.");
    expect(mensajeDeError({ code: "PGRST301", message: "JWT expired" }, "es")).toBe("Tu sesión venció. Vuelve a entrar.");
  });

  it("sin código, la jerga técnica se reconoce por el texto (lo que devuelven las acciones del servidor)", () => {
    expect(mensajeDeError('new row violates row-level security policy for table "employees"', "es")).toBe("No tienes permiso para hacer esto.");
    expect(mensajeDeError('duplicate key value violates unique constraint "customers_phone_key"', "en")).toBe("That already exists (duplicate).");
    expect(mensajeDeError(new TypeError("Failed to fetch"), "es")).toBe("Sin conexión. Revisa tu internet e intenta de nuevo.");
    expect(mensajeDeError("JWT expired", "en")).toBe("Your session expired. Sign in again.");
    expect(mensajeDeError('relation "public.x" does not exist', "es")).toBe("Esta función todavía no está instalada. Avísale al admin.");
  });

  it("un mensaje para personas (nuestro) pasa tal cual y no ensucia la consola", () => {
    expect(mensajeDeError("Marked as left, but the login could not be removed", "en")).toBe("Marked as left, but the login could not be removed");
    expect(mensajeDeError(new Error("Elige una tienda primero."), "es")).toBe("Elige una tienda primero.");
    expect(mensajeDeError("A customer with that phone already exists in your store.", "en")).toBe("A customer with that phone already exists in your store.");
    expect(consola).not.toHaveBeenCalled();
  });

  it("lo desconocido sale genérico, en el idioma, y el detalle crudo queda en la consola", () => {
    const raro = { code: "XX000", message: "internal error: unexpected chunk number 3 for toast value" };
    expect(mensajeDeError(raro, "es")).toBe("No se pudo guardar. Intenta de nuevo.");
    expect(mensajeDeError(raro, "en")).toBe("Could not save. Try again.");
    expect(consola).toHaveBeenCalledWith("[error]", raro);
    expect(mensajeDeError(null, "es")).toBe("No se pudo guardar. Intenta de nuevo.");
    expect(mensajeDeError(undefined, "es")).toBe("No se pudo guardar. Intenta de nuevo.");
    expect(mensajeDeError("", "en")).toBe("Could not save. Try again.");
    expect(mensajeDeError(new Error("Cannot read properties of undefined (reading 'id')"), "es")).toBe("No se pudo guardar. Intenta de nuevo.");
    expect(mensajeDeError('column "foo" of relation "bar" has a problem', "es")).toBe("No se pudo guardar. Intenta de nuevo.");
  });

  it("al cargar, lo genérico dice «cargar»; lo conocido no cambia", () => {
    expect(mensajeDeErrorAlCargar({ code: "XX000", message: "boom pg_toast" }, "es")).toBe("No se pudo cargar. Intenta de nuevo.");
    expect(mensajeDeErrorAlCargar(undefined, "en")).toBe("Could not load. Try again.");
    expect(mensajeDeErrorAlCargar({ code: "42501", message: "permission denied for table x" }, "es")).toBe("No tienes permiso para hacer esto.");
  });

  it("sin idioma dado toma el de la página, y sin página, inglés", () => {
    expect(mensajeDeError({ code: "23505", message: "duplicate key value" })).toBe("That already exists (duplicate).");
    vi.stubGlobal("document", { documentElement: { lang: "es" } });
    try { expect(mensajeDeError({ code: "23505", message: "duplicate key value" })).toBe("Eso ya existe (está repetido)."); }
    finally { vi.unstubAllGlobals(); }
  });

  it("esErrorTecnico distingue la jerga de una frase", () => {
    expect(esErrorTecnico('insert or update on table "a" violates foreign key constraint "b"')).toBe(true);
    expect(esErrorTecnico("TypeError: x is not a function")).toBe(true);
    expect(esErrorTecnico("El cliente ya tiene una solicitud abierta.")).toBe(false);
  });
});
