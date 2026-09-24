import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { AuthApiError, AuthWeakPasswordError } from "@supabase/supabase-js";
import { codigoDeFalloAlGuardar, mensajeDeContrasena } from "./profile-password";

// El ojo en las contraseñas, y que un rechazo de Supabase diga por qué (D-271). Este fichero NO simula
// Supabase: los errores son las clases reales de la librería instalada, que es la entrada que de verdad
// le llega a la ruta. Las pruebas de la ruta, que sí lo simulan, usan objetos con estos mismos campos, y
// la primera prueba de aquí fija que esos campos existen en las clases reales.

const es = (_en: string, es_: string) => es_;
const en = (en_: string) => en_;

describe("un rechazo de Supabase al guardar, con las clases reales", () => {
  it("las clases reales traen `code` y, la débil, `reasons`: los campos que simulan las pruebas de la ruta", () => {
    const debil = new AuthWeakPasswordError("Password is too weak", 422, ["length"]);
    const misma = new AuthApiError("New password should be different from the old password.", 422, "same_password");
    expect(debil.code).toBe("weak_password");
    expect(debil.reasons).toEqual(["length"]);
    expect(misma.code).toBe("same_password");
  });

  it("débil, con sus motivos", () => {
    expect(codigoDeFalloAlGuardar(new AuthWeakPasswordError("weak", 422, ["length", "pwned"])))
      .toEqual({ codigo: "debil", motivos: ["length", "pwned"] });
  });

  it("igual a la anterior", () => {
    expect(codigoDeFalloAlGuardar(new AuthApiError("same", 422, "same_password"))).toEqual({ codigo: "misma_contrasena" });
  });

  it("cualquier otro error sigue siendo «no se guardó»", () => {
    expect(codigoDeFalloAlGuardar(new AuthApiError("boom", 500, "unexpected_failure"))).toEqual({ codigo: "no_guardada" });
    expect(codigoDeFalloAlGuardar(null)).toEqual({ codigo: "no_guardada" });
  });

  it("un motivo que la app no conoce no se cuela en el mensaje", () => {
    const e = new AuthWeakPasswordError("weak", 422, ["length"]);
    (e as unknown as { reasons: string[] }).reasons = ["length", "raro"];
    expect(codigoDeFalloAlGuardar(e)).toEqual({ codigo: "debil", motivos: ["length"] });
  });
});

describe("el mensaje dice qué cambiar", () => {
  it("débil: nombra cada motivo, en los dos idiomas", () => {
    const texto = mensajeDeContrasena("debil", es, ["length", "characters", "pwned"]);
    expect(texto).toContain("es demasiado corta para este sistema");
    expect(texto).toContain("necesita mezclar letras, números y símbolos");
    expect(texto).toContain("aparece en una lista de contraseñas filtradas");
    expect(mensajeDeContrasena("debil", en, ["length"])).toContain("it is too short for this system");
  });

  it("débil sin motivos: igual dice qué probar, no solo que falló", () => {
    expect(mensajeDeContrasena("debil", es)).toContain("Prueba una más larga");
  });

  it("igual a la anterior: lo dice, en vez de invitar a reintentar lo mismo", () => {
    expect(mensajeDeContrasena("misma_contrasena", es)).toBe("La nueva contraseña es igual a la actual. Elige una distinta.");
    expect(mensajeDeContrasena("misma_contrasena", es)).not.toBe(mensajeDeContrasena("no_guardada", es));
  });
});

describe("el componente del ojo", () => {
  const src = readFileSync("src/components/PasswordInput.tsx", "utf8");

  it("sin nada sugerido dentro: un campo vacío se ve vacío (D-388)", () => {
    // El dueño: «el sugerido de los dots confunde, como si ya hubiese algo».
    expect(src).toContain("placeholder = \"\",");
    expect(src).not.toMatch(/[•●]/);
  });

  it("alterna el tipo del campo", () => {
    expect(src).toContain('type={visible ? "text" : "password"}');
    expect(src).toContain("onClick={() => setVisible((v) => !v)}");
  });

  it("el botón dice lo que hace en los dos idiomas, como título y como `aria-label`, y marca su estado", () => {
    expect(src).toContain('t("Hide password", "Ocultar contraseña")');
    expect(src).toContain('t("Show password", "Mostrar contraseña")');
    expect(src).toContain("title={etiqueta}");
    expect(src).toContain("aria-label={etiqueta}");
    expect(src).toContain("aria-pressed={visible}");
  });

  it("es un botón que no envía el formulario", () => {
    expect(src).toContain('type="button"');
  });
});

describe("todos los campos de contraseña de la app son el componente", () => {
  // El mismo detector que el barrido del encargo: ve un `type` partido en varias líneas.
  const detector = /type\s*=\s*(\{[^}]*?password[^}]*?\}|["']password["'])/gs;
  const tsx: string[] = [];
  const recorre = (d: string) => {
    for (const f of readdirSync(d)) {
      const p = join(d, f);
      if (statSync(p).isDirectory()) recorre(p);
      else if (f.endsWith(".tsx")) tsx.push(p.split("\\").join("/"));
    }
  };
  recorre("src");

  it("el detector ve un `type` partido en varias líneas (control), y recorre la app entera", () => {
    expect("<input\n  type=\n  \"password\"".match(detector)).not.toBeNull();
    expect(tsx.length).toBeGreaterThanOrEqual(200);
  });

  it("el único `type` de contraseña está dentro del componente", () => {
    const sitios = tsx.filter((p) => (readFileSync(p, "utf8").match(detector) ?? []).length > 0);
    expect(sitios).toEqual(["src/components/PasswordInput.tsx"]);
  });

  it("y los cinco campos que lo necesitaban lo usan", () => {
    const usos = (r: string) => (readFileSync(r, "utf8").match(/<PasswordInput\b/g) ?? []).length;
    expect(usos("src/app/login/page.tsx")).toBe(1);
    expect(usos("src/app/reset-password/page.tsx")).toBe(1);
    expect(usos("src/components/profile/ProfileView.tsx")).toBe(3);
  });
});
