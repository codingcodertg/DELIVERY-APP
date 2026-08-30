import { describe, it, expect } from "vitest";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

// D-119. El middleware estuvo muerto porque el fichero estaba en el sitio equivocado: Next lo
// busca al lado de `app`, y aquí `app` vive en `src/`. No hubo error ni aviso — solo un
// manifiesto vacío y, como consecuencia, sesiones que se perdían y listas vacías hasta
// recargar. Un fallo que no avisa necesita una prueba que sí lo haga.
const raiz = resolve(__dirname, "../..");

describe("el middleware está donde Next lo busca", () => {
  it("existe src/middleware.ts", () => {
    expect(existsSync(resolve(raiz, "src/middleware.ts"))).toBe(true);
  });

  it("y NO hay uno en la raíz que parezca activo sin estarlo", () => {
    // Tener los dos es peor que no tener ninguno: el de la raíz no corre, pero se lee como
    // si corriera, y fue exactamente la lectura que retrasó un año encontrar esto.
    expect(existsSync(resolve(raiz, "middleware.ts"))).toBe(false);
  });
});
