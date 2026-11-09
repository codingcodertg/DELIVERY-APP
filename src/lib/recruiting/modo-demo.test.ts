import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// Modo demo de RR. HH. (D-932): lee los fuentes y afirma que, con NEXT_PUBLIC_LOCAL_MODE=true, nada de /recruiting
// toca Supabase ni /api. Cada afirmación cae si se quita la rama correspondiente (el mutante está anotado).

const leer = (r: string) => readFileSync(r, "utf8").split("\r\n").join("\n");
/** Sin comentarios: un comentario que diga «MODO_DEMO» no cuenta como guarda. */
const sinComentarios = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
/** Un índice que exista: `indexOf` devuelve -1 cuando falta, y -1 < cualquier cosa pasaría la prueba de orden. */
const donde = (s: string, ancla: string) => { const i = s.indexOf(ancla); expect(i, `falta «${ancla}»`).toBeGreaterThan(-1); return i; };

const ficheros = (dir: string): string[] =>
  readdirSync(dir).flatMap((n) => { const p = join(dir, n); return statSync(p).isDirectory() ? ficheros(p) : [p]; })
    .filter((p) => /\.tsx?$/.test(p) && !/\.test\.tsx?$/.test(p)).map((p) => p.split("\\").join("/"));

const LAYOUT = "src/app/recruiting/(recruiting)/layout.tsx";
const PROVEEDOR_REAL = "src/lib/recruiting-data-provider.tsx";
const PROVEEDOR_DEMO = "src/lib/recruiting-demo-data-provider.tsx";

describe("el layout de RR. HH. ramifica en demo antes de preguntar por la sesión", () => {
  const src = sinComentarios(leer(LAYOUT));
  it("importa la bandera de modo-demo.ts y el proveedor del demo", () => {
    expect(src).toContain('import { MODO_DEMO } from "@/lib/recruiting/modo-demo";');
    expect(src).toContain('import { DemoDataProvider } from "@/lib/recruiting-demo-data-provider";');
  });
  it("`if (MODO_DEMO)` va ANTES de createClient() y de auth.getUser(), y dentro monta DemoDataProvider con el admin del demo", () => {
    // Mutante: quitar el `if` (o moverlo debajo de getUser) → el índice falta o el orden se invierte.
    const rama = donde(src, "if (MODO_DEMO) {");
    expect(rama).toBeLessThan(donde(src, "const supabase = await createClient();"));
    expect(rama).toBeLessThan(donde(src, "auth.getUser()"));
    const cuerpo = src.slice(rama, donde(src, "const supabase = await createClient();"));
    expect(cuerpo).toContain("<DemoDataProvider me={ADMIN_DEMO} hub={HUB_DEMO}>");
    expect(cuerpo).toContain('<TopBar me={ADMIN_DEMO} deliveriesRole="admin" moduleAccess={null} />');
    expect(cuerpo).toMatch(/return \(/);
    expect(cuerpo).not.toContain("supabase");
  });
  it("el perfil del hub del demo es admin (sin él «Permisos» revienta, D-720)", () => {
    expect(src).toMatch(/const HUB_DEMO: PerfilDelHub = \{[^\n]*role: "admin"/);
  });
});

describe("las páginas con servidor propio", () => {
  it("Ajustes no crea el cliente de Supabase en demo y guarda el nombre por el proveedor", () => {
    const src = sinComentarios(leer("src/app/recruiting/(recruiting)/settings/page.tsx"));
    // Mutante: volver a `const supabase = createClient();` → cae aquí.
    expect(src).toContain("const supabase = MODO_DEMO ? null : createClient();");
    // Y el `if (!supabase)` va antes del único uso: quitarlo deja `supabase.schema` sin la guarda.
    expect(donde(src, "if (!supabase) { await updateUserName(me.id, displayName); return; }")).toBeLessThan(donde(src, "supabase.schema("));
    expect(src.match(/supabase\.schema\(/g)).toHaveLength(1);
  });
  it("Crear usuarios solo redirige a Empleados: no toca Supabase ni /api, así que no hay nada que ramificar", () => {
    const src = sinComentarios(leer("src/app/recruiting/(recruiting)/user-creation/page.tsx"));
    expect(src).toContain('redirect("/recruiting/employees")');
    expect(src).not.toMatch(/supabase|fetch\(|recruiting\/actions/);
  });
  it("Empleados y Activos enseñan el aviso del demo y no montan la pantalla de verdad", () => {
    for (const [p, fn] of [["src/app/recruiting/(recruiting)/employees/page.tsx", "EmployeeFilesPage"], ["src/app/recruiting/(recruiting)/assets/page.tsx", "AssetsPage"]]) {
      const src = sinComentarios(leer(p));
      // Mutante: quitar el `if` del envoltorio → el índice falta; ponerlo después de la pantalla real → el orden cae.
      const guarda = donde(src, "if (MODO_DEMO) return <AvisoDeDemoDePagina />;");
      expect(guarda).toBeLessThan(donde(src, `function ${fn}Real() {`));
      expect(src.slice(donde(src, `export default function ${fn}() {`), guarda)).not.toContain("use");
    }
  });
});

describe("ningún componente de RR. HH. llama al servidor sin la guarda del demo", () => {
  const todos = [...ficheros("src/components/recruiting"), ...ficheros("src/app/recruiting/(recruiting)")];
  const tocaServidor = (s: string) => /@\/app\/recruiting\/actions|recruiting\/supabase|@\/lib\/supabase|fetch\("\/api/.test(s);
  const conServidor = todos.filter((p) => tocaServidor(sinComentarios(leer(p))));
  /** Una guarda de verdad, en código: `if (MODO_DEMO)`, `MODO_DEMO ? …`, `&& !MODO_DEMO`. Un comentario no vale. */
  const GUARDA = /if \(!?MODO_DEMO\)|MODO_DEMO \? |&& !MODO_DEMO|!MODO_DEMO &&/;

  it("la lista de los que tocan el servidor es la conocida (si entra uno nuevo, que pase por aquí)", () => {
    expect(conServidor.sort()).toEqual([
      "src/app/recruiting/(recruiting)/assets/page.tsx",
      "src/app/recruiting/(recruiting)/employees/acciones.tsx",
      "src/app/recruiting/(recruiting)/employees/page.tsx",
      "src/app/recruiting/(recruiting)/employees/time-tracker.tsx",
      "src/app/recruiting/(recruiting)/layout.tsx",
      "src/app/recruiting/(recruiting)/settings/page.tsx",
      "src/components/recruiting/ActivosDelEmpleado.tsx",
      "src/components/recruiting/BotonContratar.tsx",
      "src/components/recruiting/ChecklistDelEmpleado.tsx",
      "src/components/recruiting/GlobalSearch.tsx",
      "src/components/recruiting/HistorialDeRrhh.tsx",
      "src/components/recruiting/InPersonScheduleModal.tsx",
      "src/components/recruiting/PermisosDelEmpleado.tsx",
      "src/components/recruiting/QuitFormDelEmpleado.tsx",
      "src/components/recruiting/UsuariosPorCrear.tsx",
    ]);
  });

  it.each(conServidor)("%s importa MODO_DEMO de modo-demo.ts y lo usa como guarda en código", (p) => {
    const src = sinComentarios(leer(p));
    // Mutante: quitar la guarda de un fichero (o dejar solo el comentario) → cae ese caso con su nombre.
    expect(src).toMatch(/import \{[^}]*\bMODO_DEMO\b[^}]*\} from "@\/lib\/recruiting\/modo-demo";/);
    expect(src).toMatch(GUARDA);
    expect(src).not.toContain("process.env.NEXT_PUBLIC_LOCAL_MODE");
  });

  it("la bandera se lee en UN sitio", () => {
    expect(sinComentarios(leer("src/lib/recruiting/modo-demo.ts"))).toContain('export const MODO_DEMO = process.env.NEXT_PUBLIC_LOCAL_MODE === "true";');
  });
});

describe("el proveedor del demo cumple la interfaz del real y no sale del navegador", () => {
  const real = sinComentarios(leer(PROVEEDOR_REAL));
  const demo = sinComentarios(leer(PROVEEDOR_DEMO));
  it("el real exporta `DataState` y `Ctx`, y el demo los importa de ahí", () => {
    expect(real).toContain("export interface DataState {");
    expect(real).toContain("export const Ctx = createContext<DataState | null>(null);");
    expect(demo).toContain('import { Ctx, type DataState } from "@/lib/recruiting-data-provider";');
  });
  it("el valor va tipado `DataState` (tsc exige todos los campos) y se monta en el mismo `Ctx`", () => {
    // Mutante: `const value = {` sin tipo → tsc dejaría pasar un campo de menos; aquí cae.
    expect(demo).toContain("const value: DataState = {");
    expect(demo).toContain("<Ctx.Provider value={value}>");
    expect(demo).toContain("export function DemoDataProvider(");
  });
  it("sin red: ni Supabase, ni Storage, ni fetch; guarda en localStorage con la clave del demo", () => {
    expect(demo).not.toMatch(/supabase|createClient|fetch\(|\/api\//i);
    expect(demo).toContain("CLAVE_DEMO_RRHH");
    expect(demo).toContain("window.localStorage.setItem(CLAVE_DEMO_RRHH");
    expect(sinComentarios(leer("src/lib/recruiting/modo-demo.ts"))).toContain('export const CLAVE_DEMO_RRHH = "rtg_recruiting_local_v1";');
  });
  it("el enlace corto del CV devuelve null (lo firma el servidor) y las etapas se traducen con etapasEnIdioma (D-687)", () => {
    expect(demo).toMatch(/const resumeLink = useCallback<DataState\["resumeLink"\]>\(async \(\) => \{[\s\S]*?return null;/);
    expect(demo).toContain('import { etapasEnIdioma } from "@/lib/recruiting/etapas-idioma";');
    expect(demo).toContain("stages: stagesEnIdioma,");
    expect(demo).toContain("stagesGuardadas: store.stages,");
  });
});
