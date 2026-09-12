import { describe, it, expect, beforeEach, vi } from "vitest";
import { readFileSync } from "node:fs";
import { fallóElRegistro, olvidarAvisoDelRegistro, seAviso } from "./security-log-notice";

beforeEach(() => { olvidarAvisoDelRegistro(); vi.restoreAllMocks(); });

describe("cuando el registro de seguridad no puede escribir", () => {
  it("avisa una vez, y no diez", () => {
    // Quien cambia permisos a diez personas seguidas no necesita diez avisos iguales; necesita
    // saber, una vez, que el registro no está funcionando.
    vi.spyOn(console, "error").mockImplementation(() => {});
    const notify = vi.fn();
    for (let i = 0; i < 5; i++) fallóElRegistro("permission denied", notify, "es");
    expect(notify).toHaveBeenCalledTimes(1);
    expect(seAviso()).toBe(true);
  });

  it("pero a la consola van TODOS: el segundo fallo puede ser de otra clase", () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const notify = vi.fn();
    fallóElRegistro("permission denied", notify, "es");
    fallóElRegistro("column does not exist", notify, "es");
    expect(err).toHaveBeenCalledTimes(2);
    expect(notify).toHaveBeenCalledTimes(1); // control: el aviso sigue siendo uno
  });

  it("el aviso dice que el cambio SÍ se hizo, en los dos idiomas", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const es = vi.fn();
    fallóElRegistro("x", es, "es");
    expect(es.mock.calls[0][0]).toContain("El cambio sí se hizo");

    olvidarAvisoDelRegistro();
    const en = vi.fn();
    fallóElRegistro("x", en, "en");
    expect(en.mock.calls[0][0]).toContain("The change did go through");
  });
});

// El fallo de fondo, que no era «se traga las excepciones» sino algo peor: `insert()` NO lanza
// cuando la base rechaza, devuelve `{ error }`. El `catch` de antes solo cazaba fallos de red,
// así que un permiso mal puesto se iba sin fila, sin aviso y sin una línea en la consola.
describe("los dos registros leen el error del insert", () => {
  const codigo = (f: string) =>
    readFileSync(f, "utf8").split(/\r?\n/).filter((l) => !l.trim().startsWith("//")).join("\n");

  it("el de servidor devuelve si entró en vez de callar", () => {
    const src = codigo("src/lib/security-log-server.ts");
    expect(src).toMatch(/const \{ error \} = await createAdminClient\(\)/);
    expect(src).toContain("Promise<boolean>");
    expect(src).not.toContain("/* logging must never be the thing that fails */");
  });

  it("y el de cliente lo lee y avisa", () => {
    const src = codigo("src/lib/data-provider.tsx");
    expect(src).toMatch(/const \{ error \} = await supabase\.from\("security_events"\)\.insert\(/);
    expect(src).toContain("fallóElRegistro");
  });
});
