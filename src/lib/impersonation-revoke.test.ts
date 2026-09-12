import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { SIGN_OUT_SCOPES } from "@supabase/auth-js";

const sinComentarios = (src: string) =>
  src.split(/\r?\n/).filter((l) => {
    const t = l.trim();
    return !t.startsWith("//") && !t.startsWith("*") && !t.startsWith("/*");
  }).join("\n");

// El riesgo de esta pieza no es que no cierre: es que cierre de más. Un alcance equivocado echa
// a un chofer de la app en mitad de una ruta, y eso no lo enseñaría ningún error — la vuelta del
// admin funcionaría igual de bien.
describe("el alcance de la revocación", () => {
  const src = sinComentarios(readFileSync("src/lib/impersonation-revoke.ts", "utf8"));

  it("los tres alcances de la biblioteca son los que se razonaron", () => {
    // Si una versión nueva de auth-js cambiara la lista, esta prueba obliga a releer la
    // elección en vez de dar por buena una constante que ya no significa lo mismo.
    expect([...SIGN_OUT_SCOPES]).toEqual(["global", "local", "others"]);
  });

  it("se usa `local`, y NUNCA `global` ni `others`", () => {
    expect(src).toMatch(/signOut\([^)]*,\s*"local"\)/);
    expect(src).not.toContain('"global"');
    expect(src).not.toContain('"others"');
  });

  it("y con un token vacío no llama a nadie", () => {
    // Control de que la guarda existe: sin token, `admin.signOut` recibiría `""` y cerraría
    // algo indeterminado o fallaría de forma rara.
    expect(src).toMatch(/if \(!jwt\) return false;/);
  });
});

describe("la vuelta revoca la sesión ajena, y en el orden correcto", () => {
  const src = readFileSync("src/app/api/impersonate/return/route.ts", "utf8");
  const codigo = sinComentarios(src);

  it("toma el token de la sesión impersonada ANTES de restaurar al admin", () => {
    // Después de `refreshSession` la sesión del navegador ya es la del admin: pedir el token
    // entonces devolvería el suyo, y se revocaría la sesión equivocada — la que acaba de
    // recuperar.
    const iToken = codigo.indexOf("getSession()");
    const iRestaurar = codigo.indexOf("refreshSession(");
    expect(iToken).toBeGreaterThan(-1);
    expect(iRestaurar).toBeGreaterThan(-1);
    expect(iToken).toBeLessThan(iRestaurar);
  });

  it("y la revocación no bloquea la vuelta", () => {
    // `void`: se dispara y no se espera. Si se esperara y fallara, el admin podría quedarse sin
    // su cuenta por no haber podido cerrar la de otro, que es lo único que esto no puede hacer.
    expect(codigo).toMatch(/void revocarSesionImpersonada\(/);
  });
});
