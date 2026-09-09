import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createRequire } from "node:module";

// `desktop/` es CommonJS y vive fuera de `src`, así que se carga con `require` en vez de con un
// `import` — y así entra en `vitest`, que solo recoge `src/**/*.test.ts`. Es lo que convierte esta
// regla en algo probado de verdad y no en «se lee y parece correcto»: `desktop/` no tenía ninguna
// prueba hasta hoy.
const requerir = createRequire(import.meta.url);
const { crearConfianza } = requerir("../../desktop/origenes.js") as {
  crearConfianza: (o: string) => {
    esNuestro: (u: string) => boolean;
    aprendeDeLaPrimeraCarga: (u: string) => string | null;
    origenes: () => string[];
    yaAprendio: () => boolean;
  };
};

const leer = (r: string) => readFileSync(join(process.cwd(), r), "utf8");

// El caso real, con los dominios de verdad: el instalador que la gente tiene (RDZ Hub 1.0.0, del
// 2026-09-03) lleva embebido el dominio viejo; el sitio se mudó el 2026-09-04 y el viejo redirige
// con 307. La app cargaba bien y el cierre de sesión abría el navegador.
const VIEJO = "https://deliveries-app-seven.vercel.app";
const NUEVO = "https://rtg-hub.vercel.app";

describe("EL FALLO: cerrar sesión abría el navegador en vez de cerrar la sesión", () => {
  it("antes de arrancar, el dominio nuevo NO es de confianza — así estaba el binario instalado", () => {
    const c = crearConfianza(VIEJO);
    expect(c.esNuestro(`${NUEVO}/auth/signout`)).toBe(false);
  });
  it("tras la primera carga, que acaba redirigida al nuevo, el signout se queda DENTRO", () => {
    const c = crearConfianza(VIEJO);
    c.aprendeDeLaPrimeraCarga(`${NUEVO}/home`);
    expect(c.esNuestro(`${NUEVO}/auth/signout`)).toBe(true);
  });
  it("el dominio compilado sigue siendo de confianza: se añade uno, no se sustituye", () => {
    // Si se sustituyera, una instalación que cargue directa contra el viejo se rompería al revés.
    const c = crearConfianza(VIEJO);
    c.aprendeDeLaPrimeraCarga(`${NUEVO}/home`);
    expect(c.esNuestro(`${VIEJO}/home`)).toBe(true);
    expect(c.origenes()).toEqual([VIEJO, NUEVO]);
  });
  it("sin redirección no se aprende nada: la lista se queda como estaba", () => {
    const c = crearConfianza(NUEVO);
    expect(c.aprendeDeLaPrimeraCarga(`${NUEVO}/home`)).toBeNull();
    expect(c.origenes()).toEqual([NUEVO]);
  });
});

describe("estar cargado no vuelve confiable a nadie", () => {
  it("un sitio ajeno NO es nuestro, ni antes ni después de aprender", () => {
    const c = crearConfianza(VIEJO);
    c.aprendeDeLaPrimeraCarga(`${NUEVO}/home`);
    for (const u of ["https://google.com/maps", "https://vercel.app", "https://rtg-hub.vercel.app.evil.com/x"]) {
      expect(c.esNuestro(u), u).toBe(false);
    }
  });
  it("SOLO se aprende una vez: la segunda navegación ya no enseña nada", () => {
    // Es el límite entero de la regla. La versión general —«confía en cualquier redirección desde
    // un origen de confianza»— convertiría en interno un proveedor externo (un OAuth, una
    // pasarela) y lo abriría DENTRO de la ventana, con la sesión puesta y sin barra de
    // direcciones.
    const c = crearConfianza(VIEJO);
    c.aprendeDeLaPrimeraCarga(`${NUEVO}/home`);
    expect(c.yaAprendio()).toBe(true);
    expect(c.aprendeDeLaPrimeraCarga("https://login.microsoftonline.com/x")).toBeNull();
    expect(c.esNuestro("https://login.microsoftonline.com/x")).toBe(false);
    expect(c.origenes()).toEqual([VIEJO, NUEVO]);
  });
  it("la oportunidad se gasta aunque la primera carga no enseñe nada nuevo", () => {
    const c = crearConfianza(NUEVO);
    c.aprendeDeLaPrimeraCarga(`${NUEVO}/home`);          // sin redirección
    expect(c.aprendeDeLaPrimeraCarga("https://otro.com/")).toBeNull();
    expect(c.esNuestro("https://otro.com/")).toBe(false);
  });
  it("un subdominio no es el mismo origen, y un puerto distinto tampoco", () => {
    const c = crearConfianza("https://rtg-hub.vercel.app");
    expect(c.esNuestro("https://otro.rtg-hub.vercel.app/x")).toBe(false);
    expect(c.esNuestro("http://rtg-hub.vercel.app/x")).toBe(false);   // http ≠ https
  });
});

describe("los enlaces que SÍ tienen que salir al sistema siguen saliendo", () => {
  it("`mailto:`, `sms:` y `tel:` no son orígenes web y nunca son nuestros", () => {
    // La app usa los tres (`OrderModal`, `ModalHost`). Si se volvieran «nuestros» se abrirían
    // dentro de una ventana sin barra de direcciones en vez de en el correo o el teléfono.
    const c = crearConfianza(NUEVO);
    for (const u of ["mailto:a@b.com?subject=x", "sms:9561234567?&body=hola", "tel:+19561234567"]) {
      expect(c.esNuestro(u), u).toBe(false);
    }
  });
  it("tampoco se pueden aprender: un esquema que no es web no entra en la lista", () => {
    const c = crearConfianza(NUEVO);
    expect(c.aprendeDeLaPrimeraCarga("mailto:a@b.com")).toBeNull();
    expect(c.origenes()).toEqual([NUEVO]);
  });
  it("una URL rota no rompe nada y no es nuestra", () => {
    const c = crearConfianza(NUEVO);
    for (const u of ["", "no-es-una-url", "://x"]) {
      expect(c.esNuestro(u), JSON.stringify(u)).toBe(false);
    }
  });
  it("un origen compilado inservible deja la lista vacía en vez de confiar en todo", () => {
    const c = crearConfianza("basura");
    expect(c.origenes()).toEqual([]);
    expect(c.esNuestro(`${NUEVO}/home`)).toBe(false);
  });
});

describe("las navegaciones de página completa que hay HOY en la app", () => {
  it("los SEIS `signout` son POST de página completa, y todos fallaban por lo mismo", () => {
    // Medido en esta rama: no era solo el del hub. Cada app tiene el suyo y todas comparten el
    // fallo, porque el fallo no estaba en el formulario sino en qué consideraba suyo la ventana.
    const formularios = [
      "src/components/TopBar.tsx",                    // hub (dos: menú y barra)
      "src/components/HomeSelector.tsx",
      "src/components/erp/side-nav.tsx",
      "src/components/recruiting/TopBar.tsx",
      "src/components/timetracker/TopBar.tsx",
    ];
    let total = 0;
    for (const ruta of formularios) {
      // El `[^>]*` no es descuido: uno de los seis lleva `className` (`HomeSelector`), así que
      // exigir el cierre inmediato dejaría fuera un formulario que sí tiene el fallo.
      const n = (leer(ruta).match(/<form action="\/auth\/signout" method="post"[^>]*>/g) ?? []).length;
      expect(n, ruta).toBeGreaterThanOrEqual(1);
      total += n;
    }
    expect(total).toBe(6);
  });
  it("la sesión caducada también era una salida al navegador, y también queda cerrada", () => {
    // `SessionExpired` manda a `/login` con `window.location.href`, o sea otra navegación de
    // página completa. Es relativa, así que se resuelve contra el origen cargado —el nuevo— y
    // hasta hoy habría abierto el navegador en vez de la pantalla de entrar.
    expect(leer("src/components/SessionExpired.tsx")).toContain('window.location.href = "/login?next="');
    const c = crearConfianza(VIEJO);
    c.aprendeDeLaPrimeraCarga(`${NUEVO}/home`);
    expect(c.esNuestro(`${NUEVO}/login?next=%2Fhome`)).toBe(true);
  });
});

describe("lo que se empaqueta en el instalador", () => {
  // Lo levantó el auditor, y no lo caza NADA de lo que corremos: ni `tsc`, ni `vitest`, ni
  // `next build`. Un fichero que `main.js` requiere pero que no está en `files` funciona con
  // `npm start` y **falta dentro del `.exe`**, así que la app instalada no arranca. Se vería al
  // instalar el paquete: después del merge y en la máquina del dueño.
  const pkg = JSON.parse(leer("desktop/package.json")) as {
    build: { files: string[]; appId: string; productName: string; artifactName: string; nsis: Record<string, unknown> };
  };
  it("cada fichero que `main.js` requiere del proyecto va dentro del paquete", () => {
    const requeridos = [...leer("desktop/main.js").matchAll(/require\("\.\/([^"]+)"\)/g)].map((m) => m[1]);
    expect(requeridos).toContain("origenes.js");
    for (const f of requeridos) expect(pkg.build.files, f).toContain(f);
  });
  it("el `appId` NO se toca: es lo que hace que el instalador actualice en vez de duplicar", () => {
    // El GUID de la clave de desinstalación deriva de él (`UUID.v5(appId, …)`). Si cambia, el
    // instalador nuevo no encuentra la instalación vieja y quedan dos apps.
    expect(pkg.build.appId).toBe("net.rdztilegroup.hub");
    // Y un `guid` explícito GANA sobre el derivado (`options.guid || UUID.v5(...)`), así que
    // añadir uno tendría el mismo efecto que cambiar el `appId`. No puede aparecer.
    expect(JSON.stringify(pkg.build.nsis)).not.toContain("guid");
    expect(Object.keys(pkg.build)).not.toContain("guid");
  });
  it("el instalador se llama como el producto de hoy, sin espacios", () => {
    // El patrón por defecto es `${productName} Setup ${version}.${ext}` — «RTG Hub Setup 1.0.0.exe»,
    // con espacios. Se declara para que salga el nombre que espera la ruta de descarga.
    expect(pkg.build.productName).toBe("RTG Hub");
    expect(pkg.build.artifactName).toBe("RTG-Hub-Setup-${version}.${ext}");
  });
  it("la descarga acepta los DOS nombres: no se rompe la versión que la gente usa hoy", () => {
    const ruta = leer("src/app/api/download/[app]/route.ts");
    expect(ruta).toContain('blobs: ["apps/RTG-Hub-Setup.exe", "apps/RDZ-Hub-Setup.exe"]');
    expect(ruta).toContain("/^(RTG|RDZ)-Hub-Setup/.test(n)");
  });
  it("el agente de usuario dice RTG, y nadie compara la cadena vieja", () => {
    expect(leer("desktop/main.js")).toContain("RTGHub/${app.getVersion()}");
    // El único comparador de agentes de la app es el del APK de Android, y mira otra cosa.
    expect(leer("src/lib/app-update.ts")).toContain("RDZDeliveries/");
    expect(leer("src/lib/app-update.ts")).not.toContain("RDZHub");
  });
});

describe("el cableado de la ventana", () => {
  const main = leer("desktop/main.js");
  it("`esNuestro` ya no compara contra una constante", () => {
    expect(main).not.toMatch(/new URL\(u\)\.origin === ORIGEN/);
    expect(main).toContain("const esNuestro = (u) => confianza.esNuestro(u);");
  });
  it("se aprende en `did-navigate` y con `once`: una sola vez, por partida doble", () => {
    // `once` en la ventana y la bandera dentro del módulo. Si alguien quitara el `once`, el
    // módulo seguiría negándose a aprender dos veces.
    expect(main).toContain('win.webContents.once("did-navigate"');
    expect(main).toContain("confianza.aprendeDeLaPrimeraCarga(url)");
  });
  it("las dos puertas de salida siguen usando la misma regla", () => {
    expect(main).toContain("setWindowOpenHandler");
    expect(main).toContain('win.webContents.on("will-navigate"');
    expect((main.match(/if \(esNuestro\(url\)\)/g) ?? []).length).toBe(2);
  });
});
