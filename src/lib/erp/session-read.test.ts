import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PerfilNoLeido, SIN_FILA, esSinFila, referenciaDeFallo } from "@/lib/profile-read";
import { erpTier } from "@/lib/erp/domain/roles";

// D-234 arregló el bucle de los layouts. Esta rama es el mismo `const { data } = …` en
// `getSessionInfo()`, donde la consecuencia no es un bucle sino un ROL: el ERP decidía
// permisos con un perfil que no se pudo leer. Falla cerrado —`staff`— así que se ve de
// menos, pero mudo: la persona cree que ese es su nivel.

const leer = (r: string) => readFileSync(join(process.cwd(), r), "utf8").split("\r\n").join("\n");
const sinComentarios = (s: string) => s.replace(/\/\*[\s\S]*?\*\/|\/\/.*/g, "");
const auth = leer("src/lib/erp/auth.ts");

describe("«no hay fila» no es «no se pudo leer»", () => {
  it("con `single()`, la fila ausente llega como error y hay que separarla", () => {
    // Es la diferencia entre mandar a alguien a volver a entrar (D-081) y enseñarle una
    // pantalla de fallo. Sin separarlas, una sesión degradada se contaría como avería.
    expect(esSinFila({ message: "no rows", code: SIN_FILA })).toBe(true);
    expect(esSinFila({ message: 'column "x" does not exist', code: "42703" })).toBe(false);
    expect(esSinFila({ message: "fetch failed" })).toBe(false);
    expect(esSinFila(null)).toBe(false);
  });
});

describe("PerfilNoLeido", () => {
  const e = { message: 'column profiles.erp_role does not exist', code: "42703" };

  it("lleva la referencia dentro del mensaje, para que el log y la pantalla se emparejen", () => {
    const err = new PerfilNoLeido(e);
    expect(err.ref).toBe(referenciaDeFallo(e));
    expect(err.message).toContain(err.ref);
    expect(err.name).toBe("PerfilNoLeido");
    expect(err.lectura.code).toBe("42703");
  });

  it("es un Error de verdad, así que la frontera de Next lo recoge", () => {
    expect(new PerfilNoLeido(e)).toBeInstanceOf(Error);
  });
});

describe("getSessionInfo ya no se inventa un rol", () => {
  const src = sinComentarios(auth);

  it("recoge el error de la consulta", () => {
    expect(src).toMatch(/const \{ data: profile, error \} = await supabase/);
  });

  it("lanza en vez de seguir, y separa la fila ausente", () => {
    expect(src).toMatch(/if \(error && !esSinFila\(error\)\)/);
    expect(src).toContain("throw new PerfilNoLeido(error)");
    // La fila ausente vuelve como null, que es lo que las páginas ya mandan al login.
    expect(src).toMatch(/if \(!profile\) return null;/);
  });

  it("escribe el mensaje entero en el log ANTES de lanzar", () => {
    // La frontera de error no puede enseñarlo: Next borra el mensaje de un error de
    // servidor y solo deja el digest. Si no se registra aquí, se pierde.
    const bloque = src.slice(src.indexOf("if (error && !esSinFila(error))"), src.indexOf("if (!profile) return null;"));
    expect(bloque).toContain("console.error");
    expect(bloque.indexOf("console.error")).toBeLessThan(bloque.indexOf("throw new PerfilNoLeido"));
  });

  it("no queda ningún respaldo que se aplique a un perfil que no se leyó", () => {
    // `profile?.` era la marca de que el objeto se construía igual sin perfil. Si vuelve,
    // vuelve el fallo: un valor por defecto indistinguible de un rol de verdad.
    const cuerpo = src.slice(src.indexOf("export const getSessionInfo"));
    expect(cuerpo).not.toContain("profile?.");
    // Y el orden importa: la guarda va antes de construir la sesión.
    expect(cuerpo.indexOf("throw new PerfilNoLeido")).toBeLessThan(cuerpo.indexOf("role: erpTier(profile)"));
  });

  it("sigue fallando cerrado cuando el nivel no está asignado", () => {
    // Lo que cambia es que un ERROR deje de parecerse a esto, no que esto cambie: un
    // perfil leído y sin `erp_role` sigue siendo `staff`, que es el mínimo (D-181/D-228).
    expect(erpTier({ erp_role: null })).toBe("staff");
    expect(erpTier({ erp_role: "admin" })).toBe("admin");
  });
});

describe("la frontera de error del ERP", () => {
  const src = sinComentarios(leer("src/app/erp/error.tsx"));

  it("pinta la MISMA pantalla que el resto del hub, no una segunda versión", () => {
    expect(src).toContain("ProfileReadError");
    expect(src).toContain('"use client"');
  });

  it("no enseña detalle, porque aquí no lo hay", () => {
    // Next borra el mensaje de un error de servidor antes de mandarlo al navegador.
    expect(src).toMatch(/verDetalle=\{false\}/);
  });

  it("no redirige a ningún sitio", () => {
    // Sería reconstruir a mano el bucle que D-234 quitó.
    expect(src).not.toMatch(/\bredirect\(/);
    expect(src).not.toContain("/login");
  });
});
