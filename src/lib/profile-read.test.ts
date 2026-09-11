import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { estadoDeLectura, puedeVerDetalle, referenciaDeFallo, textoDeFallo } from "./profile-read";

// El 2026-09-10: una migración sin aplicar, un `select` pidiendo columnas que no existían,
// y el hub en bucle de redirecciones en producción. La causa no fue la migración: fue que
// el layout descartaba el `error` y trataba «la consulta falló» como «no hay fila», cuyo
// camino escrito era `redirect("/login")` — y el login vuelve aquí.

const leer = (r: string) => readFileSync(join(process.cwd(), r), "utf8").split("\r\n").join("\n");
const sinComentarios = (s: string) => s.replace(/\/\*[\s\S]*?\*\/|\/\/.*/g, "");

const err = { message: 'column profiles.title does not exist', code: "42703" };

describe("tres desenlaces, no dos", () => {
  it("con error es FALLO, aunque no haya datos", () => {
    expect(estadoDeLectura({ data: null, error: err })).toBe("fallo");
  });

  it("con error MANDA el error, aunque llegaran datos", () => {
    // Si algún día una consulta devuelve las dos cosas, «hay fila» no es la conclusión
    // segura: no se sabe qué parte de la respuesta es completa.
    expect(estadoDeLectura({ data: { id: "x" }, error: err })).toBe("fallo");
  });

  it("sin error y sin fila sigue siendo la sesión degradada de D-081", () => {
    expect(estadoDeLectura({ data: null, error: null })).toBe("sin-fila");
    expect(estadoDeLectura({ data: null })).toBe("sin-fila");
  });

  it("con fila es ok", () => {
    expect(estadoDeLectura({ data: { id: "x" }, error: null })).toBe("ok");
  });
});

describe("la referencia del fallo", () => {
  it("es estable: el mismo fallo da la misma referencia", () => {
    // Para que dos personas que llaman por lo mismo se reconozcan como lo mismo.
    expect(referenciaDeFallo(err)).toBe(referenciaDeFallo({ ...err }));
  });

  it("cambia con el mensaje y con el código", () => {
    expect(referenciaDeFallo(err)).not.toBe(referenciaDeFallo({ ...err, message: "otra cosa" }));
    expect(referenciaDeFallo(err)).not.toBe(referenciaDeFallo({ ...err, code: "42501" }));
  });

  it("aguanta un error sin código", () => {
    expect(referenciaDeFallo({ message: "fetch failed" })).toMatch(/^ERR-[0-9A-F]{6}$/);
  });

  it("no lleva el mensaje dentro: es un identificador, no una filtración", () => {
    expect(referenciaDeFallo(err)).not.toContain("profiles");
    expect(referenciaDeFallo(err).length).toBeLessThanOrEqual(20);
  });
});

describe("quién ve el mensaje de Postgres", () => {
  it("solo un admin, y se decide sin el perfil, que es lo que no se pudo leer", () => {
    expect(puedeVerDetalle({ user_metadata: { role: "admin" } })).toBe(true);
    expect(puedeVerDetalle({ user_metadata: { role: " Admin " } })).toBe(true);
    expect(puedeVerDetalle({ user_metadata: { role: "sales" } })).toBe(false);
    expect(puedeVerDetalle({ user_metadata: {} })).toBe(false);
    expect(puedeVerDetalle(null)).toBe(false);
  });

  it("el texto lleva el detalle solo con permiso, y la referencia siempre", () => {
    const conDetalle = textoDeFallo(err, true);
    expect(conDetalle.detalle).toContain("column profiles.title does not exist");
    expect(conDetalle.ref).toBeTruthy();

    const sinDetalle = textoDeFallo(err, false);
    expect(sinDetalle.detalle).toBeNull();
    expect(sinDetalle.ref).toBe(conDetalle.ref);
    // Y el texto genérico no puede llevar el mensaje por otro lado.
    expect(JSON.stringify(sinDetalle)).not.toContain("profiles.title");
  });

  it("está en los dos idiomas, porque las preferencias viven detrás de lo que falló", () => {
    const t = textoDeFallo(err, false);
    expect(t.titulo).not.toBe(t.titulo_en);
    expect(t.cuerpo && t.cuerpo_en).toBeTruthy();
  });
});

describe("ningún punto de entrada redirige con un error presente", () => {
  // El canario de la rama. No enumera ficheros: recorre `src/app` y se aplica a cualquiera
  // que consulte `profiles` y redirija, para que el patrón no vuelva a entrar por una
  // puerta nueva.
  const norm = (s: string) => s.split("\\").join("/");
  const RAIZ = norm(process.cwd());
  const rutas: string[] = [];
  const recorre = (dir: string) => {
    for (const f of readdirSync(dir)) {
      const p = join(dir, f);
      if (statSync(p).isDirectory()) recorre(p);
      else if (f.endsWith(".tsx") || f.endsWith(".ts")) rutas.push(norm(p).replace(RAIZ + "/", ""));
    }
  };
  recorre(join(process.cwd(), "src/app"));

  const sospechosos = rutas.filter((r) => {
    const src = sinComentarios(leer(r));
    return src.includes('from("profiles")') && /\bredirect\(/.test(src);
  });

  it("encuentra los puntos de entrada que hay que vigilar", () => {
    // Si esto baja de golpe, el recorrido dejó de ver ficheros y el resto pasa por vacuidad.
    expect(sospechosos.length).toBeGreaterThanOrEqual(10);
  });

  for (const ruta of sospechosos) {
    it(`${ruta.replace("src/app/", "")} — mira el error antes de mandar a nadie a otro sitio`, () => {
      const src = sinComentarios(leer(ruta));
      // El ERP tiene su propio mecanismo y no descarta nada: `unwrap` lanza con el mensaje.
      if (src.includes("unwrap(")) {
        expect(src).toMatch(/unwrap\([\s\S]*?from\("profiles"\)/);
        return;
      }
      // Los demás: el destructuring tiene que recoger el error…
      expect(src, "descarta el error de la consulta").toMatch(/const \{ data: \w+, error: \w+ \} = await supabase/);
      // …y la guarda tiene que ir ANTES del primer redirect que sigue a la consulta.
      const consulta = src.indexOf('from("profiles")');
      const guarda = src.indexOf('=== "fallo"', consulta);
      const rebote = src.indexOf("redirect(", consulta);
      expect(guarda, "no hay guarda de fallo tras la consulta").toBeGreaterThan(0);
      if (rebote > 0) expect(guarda, "redirige antes de mirar el error").toBeLessThan(rebote);
    });
  }
});

describe("la pantalla de fallo no vuelve al bucle", () => {
  it("el botón recarga la misma dirección; no manda al login", () => {
    // Mandar al login desde la pantalla de error sería reconstruir el bucle a mano.
    const src = sinComentarios(leer("src/components/RetryButton.tsx"));
    expect(src).toContain("window.location.reload()");
    expect(src).not.toContain("/login");
  });

  it("la pantalla no redirige por su cuenta", () => {
    const src = sinComentarios(leer("src/components/ProfileReadError.tsx"));
    expect(src).not.toMatch(/\bredirect\(/);
  });
});
