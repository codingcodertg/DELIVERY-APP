import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// El formulario de crear usuario, plegado (D-300). Lo pidió el dueño: ocupaba toda la parte de
// arriba de Usuarios aunque casi siempre se venga a mirar la lista.

const leer = (r: string) => readFileSync(join(process.cwd(), r), "utf8").split("\r\n").join("\n");
const pagina = leer("src/app/home/users/page.tsx");
const plano = pagina.replace(/\s+/g, " ");

describe("empieza cerrado y lo abre quien va a crear", () => {
  it("cerrado de salida", () => {
    expect(plano).toContain("const [creando, setCreando] = useState(false);");
  });

  it("el botón alterna, y dice si está abierto", () => {
    const boton = plano.slice(plano.indexOf("onClick={() => setCreando"), plano.indexOf("</button>", plano.indexOf("onClick={() => setCreando")));
    expect(boton).toContain("setCreando((v) => !v)");
    // `aria-expanded` no es adorno: es lo que dice si esto está abierto a quien no ve la pantalla.
    expect(boton).toContain("aria-expanded={creando}");
  });

  it("los campos solo existen cuando está abierto", () => {
    expect(plano).toContain("{creando && (<>");
    const abre = pagina.indexOf("{creando && (<>");
    const cierra = pagina.indexOf("</>)}", abre);
    expect(abre).toBeGreaterThan(-1);
    expect(cierra).toBeGreaterThan(abre);
    const dentro = pagina.slice(abre, cierra);
    // Las etiquetas enteras, no la palabra suelta: «Username» también sale en `setUsername`, así
    // que buscarla a secas medía el nombre de una variable y no el campo. Lo enseñó un mutante.
    for (const campo of [
      't("Full name", "Nombre completo")',
      't("Username", "Usuario")',
      't("Role", "Rol")',
      't("Create user", "Crear usuario")',
    ]) {
      expect(dentro, campo).toContain(campo);
    }
  });
});

describe("al crear no se pierde el resultado ni la lista", () => {
  const submit = pagina.slice(pagina.indexOf("const submit = async"), pagina.indexOf("// Name and role. Nothing else."));

  it("se pliega solo cuando la creación salió bien", () => {
    expect(submit).toContain("setCreando(false);");
    // Dentro del `if (res.ok)`: plegarlo tras un fallo escondería el formulario con los datos a
    // medio escribir.
    const ok = submit.slice(submit.indexOf("if (res.ok)"));
    expect(ok).toContain("setCreando(false);");
  });

  it("y limpia también el usuario, no solo el resto", () => {
    // Antes se quedaba escrito el de la persona anterior, y el alta siguiente salía con un usuario
    // que ya existe.
    expect(submit).toContain('setEmail(""); setUsername(""); setName("");');
  });

  it("las credenciales quedan FUERA del plegado, así que sobreviven al cierre", () => {
    const cierre = pagina.indexOf("</>)}");
    const credenciales = pagina.indexOf("{created && (");
    expect(cierre).toBeGreaterThan(-1);
    expect(credenciales).toBeGreaterThan(cierre);
  });

  it("la lista de usuarios sigue debajo, pase lo que pase con el formulario", () => {
    const lista = pagina.indexOf("groups.map(");
    expect(lista).toBeGreaterThan(pagina.indexOf("{created && ("));
    // Y no depende del plegado.
    expect(pagina.slice(pagina.indexOf("{created && ("), lista)).not.toContain("creando &&");
  });
});
