import { describe, it, expect } from "vitest";
import { canAutoReload, isStaleChunkError, markAutoReload } from "./stale-chunk";

/**
 * El reconocedor del "bundle viejo" (D-155).
 *
 * Se prueba porque de él cuelga una **recarga automática de la página**. Pasarse de listo
 * recarga delante de alguien que está trabajando, por un fallo que la recarga no arregla;
 * quedarse corto devuelve la tarjeta de error a quien solo tenía media aplicación vieja.
 *
 * Los mensajes son los literales de los distintos motores, porque no hay código de error:
 * cada navegador lo redacta a su manera y esto es, al final, una lista de cadenas.
 */
const err = (name: string, message: string) => ({ name, message });

describe("isStaleChunkError", () => {
  it("reconoce el fallo de chunk en los distintos motores", () => {
    // webpack / Next, en Chrome y Firefox
    expect(isStaleChunkError(err("ChunkLoadError", "Loading chunk 4823 failed."))).toBe(true);
    expect(isStaleChunkError(err("Error", "Loading CSS chunk 91 failed."))).toBe(true);
    // Chrome, con import() dinámico
    expect(isStaleChunkError(err("TypeError", "Failed to fetch dynamically imported module: https://x/page-9f2.js"))).toBe(true);
    // Safari / WebKit, que lo dice de otra forma
    expect(isStaleChunkError(err("TypeError", "Importing a module script failed."))).toBe(true);
  });

  it("NO se lleva por delante un fallo de verdad", () => {
    // El que motivó todo esto. Si se recargara por él, la persona vería la página
    // reiniciarse y volver a fallar, sin ninguna pista de qué pasó.
    expect(isStaleChunkError(err("TypeError", "Cannot read properties of undefined (reading 'length')"))).toBe(false);
    expect(isStaleChunkError(err("TypeError", "x.map is not a function"))).toBe(false);
    expect(isStaleChunkError(err("Error", "permission denied for schema timetracker"))).toBe(false);
  });

  it("aguanta lo que no es un error", () => {
    expect(isStaleChunkError(null)).toBe(false);
    expect(isStaleChunkError(undefined)).toBe(false);
    expect(isStaleChunkError(err("", ""))).toBe(false);
  });

  it("no distingue mayúsculas", () => {
    expect(isStaleChunkError(err("Error", "LOADING CHUNK 12 FAILED"))).toBe(true);
  });
});

describe("canAutoReload", () => {
  // sessionStorage no existe en el entorno de las pruebas: sin él la función deja
  // recargar, que es la decisión deliberada (el caso normal es el bueno).
  it("deja recargar cuando no hay almacén donde apuntarlo", () => {
    expect(canAutoReload()).toBe(true);
  });

  it("no revienta al intentar apuntarlo sin almacén", () => {
    expect(() => markAutoReload()).not.toThrow();
  });
});
