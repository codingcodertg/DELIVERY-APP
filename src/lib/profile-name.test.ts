import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { guardaMiNombre, hayCambioDeNombre, nombreParaGuardar, type ClienteDePerfil } from "./profile-name";

/**
 * El nombre se cambia en «Mi perfil» (D-274). El cliente es falso y con la forma de lo que devuelve
 * PostgREST: un UPDATE que la política no deja pasar vuelve **sin error y con cero filas**, que es lo
 * que midió el orquestador contra la base con el nombre de otro vendedor.
 */

const leer = (r: string) => readFileSync(join(process.cwd(), r), "utf8").split("\r\n").join("\n");

describe("qué se guarda", () => {
  it("recortado y con los espacios de dentro unificados; vacío no vale", () => {
    expect(nombreParaGuardar("  Ana   María  López ")).toBe("Ana María López");
    expect(nombreParaGuardar("   ")).toBeNull();
    expect(nombreParaGuardar(null)).toBeNull();
  });

  it("igual al actual después de limpiarlo no es un cambio", () => {
    expect(hayCambioDeNombre("Ana López", "  Ana   López ")).toBe(false);
    expect(hayCambioDeNombre("Ana López", "")).toBe(false);
    expect(hayCambioDeNombre("Ana López", "Ana M. López")).toBe(true);
    expect(hayCambioDeNombre(null, "Ana")).toBe(true);
  });
});

describe("guardar exige la fila de vuelta", () => {
  function cliente(r: { filas?: unknown[] | null; error?: unknown }) {
    const llamadas: { tabla: string; valor: { full_name: string }; col: string; id: string; select: string }[] = [];
    const c: ClienteDePerfil = {
      from: (tabla) => ({
        update: (valor) => ({
          eq: (col, id) => ({
            select: async (sel) => {
              llamadas.push({ tabla, valor, col, id, select: sel });
              return { data: r.filas === undefined ? [{ id }] : r.filas, error: r.error ?? null };
            },
          }),
        }),
      }),
    };
    return { c, llamadas };
  }

  it("una fila: guardado, con el nombre limpio, en la fila de la sesión", async () => {
    const { c, llamadas } = cliente({});
    expect(await guardaMiNombre(c, "u-1", "  Ana   López ")).toEqual({ ok: true, nombre: "Ana López" });
    expect(llamadas).toEqual([{ tabla: "profiles", valor: { full_name: "Ana López" }, col: "id", id: "u-1", select: "id" }]);
  });

  it("cero filas y sin error —la política no deja—: NO es guardado", async () => {
    const { c } = cliente({ filas: [] });
    expect(await guardaMiNombre(c, "u-1", "Ana")).toEqual({ ok: false, motivo: "sin_fila" });
  });

  it("un error de la base es un fallo, no un guardado", async () => {
    const { c } = cliente({ error: { message: "permission denied" }, filas: null });
    expect(await guardaMiNombre(c, "u-1", "Ana")).toEqual({ ok: false, motivo: "escritura" });
  });

  it("vacío no llama a la base", async () => {
    const { c, llamadas } = cliente({});
    expect(await guardaMiNombre(c, "u-1", "   ")).toEqual({ ok: false, motivo: "vacio" });
    expect(llamadas).toEqual([]);
  });
});

describe("Mi perfil usa esto", () => {
  it("la vista guarda con `guardaMiNombre` y no escribe en `profiles` por su cuenta", () => {
    const vista = leer("src/components/profile/ProfileView.tsx");
    expect(vista).toContain("guardaMiNombre(createClient(), id, valor)");
    expect(vista).not.toMatch(/\.from\("profiles"\)/);
  });

  it("la página le pasa el id de la sesión, que es la fila que la política deja escribir", () => {
    const pagina = leer("src/app/home/profile/page.tsx");
    expect(pagina).toContain("<ProfileView id={user?.id ?? null}");
    expect(pagina).toContain("await supabase.auth.getUser()");
  });
});
