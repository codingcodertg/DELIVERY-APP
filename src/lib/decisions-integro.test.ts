import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * `DECISIONS.md` no vuelve a empalmarse (D-319).
 *
 * El 2026-09-17, resolviendo un conflicto con un script que pegaba los dos lados del marcador, el
 * commit **564a9b1** (PR #104) metió una **copia entera del documento dentro de la entrada D-279**,
 * partiéndola a mitad de palabra. El fichero pasó de 18.109 a 35.921 líneas y 277 entradas quedaron
 * por duplicado. **No falló nada**: Markdown se lee igual de bien, así que vivió un día entero.
 *
 * Esta prueba corre el mismo comprobador que se usó para repararlo —`scripts/decisions-check.mjs`—,
 * no una copia de sus reglas: si el script deja de funcionar, esto cae también.
 */

const RAIZ = process.cwd();
const SCRIPT = "scripts/decisions-check.mjs";

/** Corre el comprobador sobre `cwd` y devuelve código de salida y lo que dijo. */
function comprueba(cwd: string, ...args: string[]): { codigo: number; salida: string } {
  try {
    const salida = execFileSync(process.execPath, [join(RAIZ, SCRIPT), ...args], { cwd, encoding: "utf8" });
    return { codigo: 0, salida };
  } catch (e) {
    const err = e as { status?: number; stdout?: string; stderr?: string };
    return { codigo: err.status ?? -1, salida: (err.stdout ?? "") + (err.stderr ?? "") };
  }
}

describe("DECISIONS.md está entero", () => {
  it("pasa el comprobador: sin repetidas, en orden, un título y sin costuras", () => {
    const { codigo, salida } = comprueba(RAIZ);
    expect(salida.trim(), salida).toContain("sin repetidas, en orden y sin costuras");
    expect(codigo, salida).toBe(0);
  });

  it("y no queda ni rastro del empalme de 564a9b1", () => {
    // Las dos señales concretas de aquel accidente, comprobadas aparte del script por si alguien lo
    // tocara: el título pegado a otro texto, y la entrada D-279 dos veces.
    //
    // **Fuera de los bloques de código**, porque la entrada que cuenta el empalme cita la línea rota
    // como prueba. Es la misma regla que aplica el comprobador, y aquí está escrita una vez.
    const doc = readFileSync(join(RAIZ, "DECISIONS.md"), "utf8").split("\r\n").join("\n");
    let dentro = false;
    const prosa = doc.split("\n").filter((l) => {
      if (/^\s*```/.test(l)) { dentro = !dentro; return false; }
      return !dentro;
    }).join("\n");
    expect(prosa).not.toContain("`$function# Bitácora");
    expect(prosa.split("# Bitácora de decisiones — RDZ · Deliveries").length - 1).toBe(1);
    expect((prosa.match(/^## D-279\b/gm) ?? []).length).toBe(1);
  });
});

describe("el comprobador de verdad comprueba", () => {
  /** Un `DECISIONS.md` de juguete en un directorio aparte. Nada toca el del repo. */
  function conDocumento(texto: string): { codigo: number; salida: string } {
    const dir = mkdtempSync(join(tmpdir(), "decisions-"));
    try {
      writeFileSync(join(dir, "DECISIONS.md"), texto, "utf8");
      return comprueba(dir);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }

  const TITULO = "# Bitácora de decisiones — RDZ · Deliveries";
  const bien = [TITULO, "", "## D-001 · Una", "cuerpo", "", "## D-002 · Otra", "cuerpo"].join("\n");

  it("un documento sano pasa (control: sin esto, lo de abajo podría fallar siempre)", () => {
    expect(conDocumento(bien).codigo).toBe(0);
  });

  it("cae con una entrada repetida", () => {
    const { codigo, salida } = conDocumento(bien + "\n\n## D-001 · Una\ncuerpo");
    expect(codigo).toBe(1);
    expect(salida).toContain("1.");
  });

  it("cae con los números fuera de orden", () => {
    const { codigo, salida } = conDocumento([TITULO, "", "## D-002 · Otra", "", "## D-001 · Una"].join("\n"));
    expect(codigo).toBe(1);
    expect(salida).toContain("2.");
  });

  it("cae con el título dos veces", () => {
    const { codigo, salida } = conDocumento(bien + "\n\n" + TITULO);
    expect(codigo).toBe(1);
    expect(salida).toContain("3.");
  });

  it("pero NO cae por lo que una entrada cita dentro de un bloque de código", () => {
    // Hizo falta el mismo día: la entrada que cuenta el empalme **cita la línea rota como prueba**,
    // y el comprobador se cazaba a sí mismo. Una cita no es estructura.
    const citando = [
      TITULO, "", "## D-001 · Una",
      "Lo que decía aquella línea:", "", "```",
      "mayúsculas de Postgres y `$function" + TITULO,
      "## D-001 · Una (esto es una cita, no una entrada)",
      "```", "", "## D-002 · Otra",
    ].join("\n");
    const { codigo, salida } = conDocumento(citando);
    expect(codigo, salida).toBe(0);
  });

  it("cae con la costura EXACTA del accidente, que es la que ningún otro criterio ve", () => {
    // Medido: con el fichero de aquel día, los criterios 1 y 2 caían por las entradas duplicadas,
    // pero el del título **pasaba** — el título pegado a otro texto no es una línea de título. Si
    // el empalme hubiera sido de un documento sin entradas, solo este lo habría cazado.
    const empalmado = [TITULO, "", "## D-001 · Una", "una frase que se corta a mitad de `$function" + TITULO, "", "## D-002 · Otra"].join("\n");
    const { codigo, salida } = conDocumento(empalmado);
    expect(codigo).toBe(1);
    expect(salida).toContain("4.");
    expect(salida).toContain("costura");
  });

  it("y con `--contra` caza lo que los otros cuatro NO pueden ver: un renglón que desaparece", () => {
    // Es el criterio que hace del «no se perdió nada» una medición en vez de una impresión, y el
    // único que caza que una entrada entera se esfume: los otros cuatro admiten huecos en la
    // numeración a propósito (D-124 y D-178 nunca se usaron).
    const dir = mkdtempSync(join(tmpdir(), "decisions-"));
    try {
      const antes = join(dir, "antes.md");
      writeFileSync(antes, bien + "\n\n## D-003 · Una tercera\nuna línea que luego se pierde", "utf8");
      writeFileSync(join(dir, "DECISIONS.md"), bien, "utf8");
      const { codigo, salida } = comprueba(dir, "--contra", antes);
      expect(codigo, salida).toBe(1);
      expect(salida).toContain("5.");
      expect(salida).toContain("una línea que luego se pierde");
      // Y no se queja cuando de verdad no falta nada.
      writeFileSync(antes, bien, "utf8");
      expect(comprueba(dir, "--contra", antes).codigo).toBe(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
