import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { HUB_TOOLS, canReachHub } from "./constants";

// El fallo del dueño: entra con una cuenta que solo tiene el ERP, pulsa «Todas las apps» y no
// pasa nada. No es que no pase nada — es que **va y vuelve**: `/home` comprueba `canReachHub` y
// lo devuelve a su sitio (`home/page.tsx:53`). El enlace prometía una pantalla a la que la app no
// le deja entrar, y sin enseñar ningún error: un parpadeo y sigues donde estabas.

const leer = (r: string) => readFileSync(join(process.cwd(), r), "utf8");

const soloErp = { role: "sales" as const, module_access: ["erp"] };
const erpYEntregas = { role: "sales" as const, module_access: ["erp", "deliveries"] };

describe("LA REGLA: quién tiene un hub al que volver", () => {
  it("EL CASO DEL DUEÑO: con el ERP como único módulo, NO hay hub", () => {
    // El perfil con el que lo vio tenía `module_access: ["erp"]`.
    expect(canReachHub(soloErp)).toBe(false);
  });
  it("con dos módulos sí lo hay, que es para lo que existe el selector", () => {
    expect(canReachHub(erpYEntregas)).toBe(true);
  });
  it("un admin con un solo módulo también: le espera Usuarios en el hub", () => {
    // `canReachHub` es `más de un módulo` **o** `tiene alguna herramienta de hub visible`, y
    // Usuarios es visible para admin. Por eso el hub no es un callejón sin salida para él.
    expect(canReachHub({ role: "admin", module_access: ["erp"] })).toBe(true);
    expect(HUB_TOOLS.some((t) => t.visible({ role: "admin" }))).toBe(true);
  });
  it("un chofer nunca, le den lo que le den (D-051)", () => {
    expect(canReachHub({ role: "driver", module_access: ["erp", "deliveries", "recruiting"] })).toBe(false);
  });
  it("sin módulos o con la lista vacía, tampoco", () => {
    for (const acceso of [null, undefined, [], ["erp"]]) {
      expect(canReachHub({ role: "manager", module_access: acceso }), JSON.stringify(acceso)).toBe(false);
    }
  });
});

describe("la barra del ERP ya no promete lo que no puede cumplir", () => {
  const nav = leer("src/components/erp/side-nav.tsx");
  const header = leer("src/components/erp/header.tsx");

  it("los DOS enlaces al hub están condicionados", () => {
    // Eran dos: el de la cabecera (junto a «RTG ERP») y el de la lista lateral. Los dos pintaban
    // sin ninguna guarda — `canReachHub` no aparecía en el fichero.
    expect(nav.match(/href="\/home"/g) ?? []).toHaveLength(2);
    expect(nav.match(/\{hubReachable && \(/g) ?? []).toHaveLength(2);
  });
  it("la barra NO decide por su cuenta: recibe la respuesta ya hecha", () => {
    // Dos sitios preguntando lo mismo por separado es lo que produjo el fallo. La regla se
    // consulta una vez, arriba.
    // Se mira el CÓDIGO, no los comentarios: el comentario de la prop sí cita `canReachHub`
    // para decir de dónde viene la respuesta, y eso tiene que poder quedarse escrito.
    const navCodigo = nav.replace(/\/\*[\s\S]*?\*\/|\/\/.*/g, "");
    expect(navCodigo).not.toContain("canReachHub");
    expect(header).toContain('from "@/lib/constants"');
    expect(header).toContain("hubReachable={canReachHub({ role: session.hubRole, module_access: session.moduleAccess })}");
  });
  it("el rol del hub viaja en la sesión que ya se leía, sin consulta nueva", () => {
    // `role` en el ERP está moldeado a `AppRole`; las preguntas del hub necesitan el rol del hub.
    // Es la misma columna y la misma consulta: se expone con su tipo propio.
    const auth = leer("src/lib/erp/auth.ts");
    expect(auth).toContain("hubRole: UserRole;");
    // El `?.` se fue en D-NEXT: ahora, si el perfil no se leyó, esto ni se ejecuta.
    expect(auth).toContain('hubRole: (profile.role as UserRole) ?? "sales",');
    // Y no se añade una segunda lectura de `profiles` para esto.
    expect(auth.match(/\.from\("profiles"\)/g) ?? []).toHaveLength(1);
  });
  it("el comentario que afirmaba lo contrario ya no está", () => {
    // Decía «aquí el hub nunca es un callejón sin salida». El fallo no fue un descuido: fue una
    // suposición escrita, y por eso se corrige el texto además del código.
    expect(nav).not.toContain("so it is never a dead end");
  });
});

describe("los otros módulos: medidos, no supuestos", () => {
  it("HR y Time Tracker no tienen enlace propio al hub — lo pone `ModuleSwitcher`", () => {
    // Y `ModuleSwitcher` ya se esconde solo con la misma regla, así que nunca tuvieron el fallo.
    for (const ruta of ["src/components/recruiting/TopBar.tsx", "src/components/timetracker/TopBar.tsx"]) {
      const src = leer(ruta);
      expect(src, ruta).not.toContain('href="/home"');
      expect(src, ruta).toContain("<ModuleSwitcher");
    }
    const sw = leer("src/components/ModuleSwitcher.tsx");
    expect(sw).toContain("if (!canReachHub({ role: deliveriesRole, module_access: moduleAccess })");
  });
  it("el «Volver al hub» de Usuarios no puede ser un callejón: solo entran admins", () => {
    // `/home/users` redirige a cualquiera que no sea admin (su propio layout, D-056), y todo
    // admin cumple `canReachHub` porque Usuarios es una herramienta de hub visible para él. O
    // sea que quien puede ver ese enlace puede, por definición, llegar al hub.
    expect(leer("src/app/home/users/layout.tsx")).toContain('if (me.role !== "admin") redirect(landingRoute(me));');
    expect(leer("src/app/home/users/page.tsx")).toContain('href="/home"');
    expect(canReachHub({ role: "admin", module_access: [] })).toBe(true);
  });
});

describe("lo que NO cambia", () => {
  it("la regla de quién ve el hub sigue siendo la de D-056/D-173, intacta", () => {
    // Esta rama arregla quién PINTA el enlace, no quién puede entrar. Si alguien relajara
    // `canReachHub` para «arreglar» el botón, el fallo del dueño desaparecería enseñando una
    // pantalla que no le sirve.
    const src = leer("src/lib/constants.ts");
    expect(src).toContain('if (me.role === "driver") return false;');
    expect(src).toContain("return accessibleModules(me.module_access).length > 1 || HUB_TOOLS.some((t) => t.visible(me));");
  });
  it("`/home` sigue devolviendo a su sitio a quien no puede estar ahí", () => {
    expect(leer("src/app/home/page.tsx")).toContain("if (!canReachHub(me)) redirect(landingRoute(me));");
  });
});
