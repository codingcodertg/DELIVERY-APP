import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// Modo demo de Time Tracker (sin base ni sesión), para los vídeos tutoriales. Estas pruebas leen el fuente: cada una
// cae si se quita la rama de LOCAL_MODE (`if (false)`, borrar la línea) o si la rama se mueve detrás de la base.
// Las anclas son texto de CÓDIGO que ningún comentario repite; el orden se mide con índices, y antes se afirma que
// cada ancla existe (un indexOf de −1 pasaría la comparación de orden).
const leer = (r: string) => readFileSync(r, "utf8").split("\r\n").join("\n");
const indice = (s: string, ancla: string) => { const i = s.indexOf(ancla); expect(i, `falta «${ancla}»`).toBeGreaterThan(-1); return i; };
const DECLARACION = 'const LOCAL_MODE = process.env.NEXT_PUBLIC_LOCAL_MODE === "true";';

describe("Time Tracker en modo demo", () => {
  it("el layout ramifica en LOCAL_MODE ANTES de crear el cliente y de auth.getUser(), con el proveedor demo y el mismo armazón", () => {
    const s = leer("src/app/timetracker/(timetracker)/layout.tsx");
    indice(s, DECLARACION);
    const rama = indice(s, "if (LOCAL_MODE) return (");
    const cliente = indice(s, "const supabase = await createClient();");
    expect(rama).toBeLessThan(cliente);
    expect(rama).toBeLessThan(indice(s, "supabase.auth.getUser()"));
    const cuerpo = s.slice(rama, cliente);
    expect(cuerpo).toContain("<DemoDataProvider me={ADMIN_DEMO}>");
    expect(cuerpo).toContain('<TopBar deliveriesRole="admin" moduleAccess={null} />');
    expect(cuerpo).toContain("<CronometroAnfitrion />");
    expect(cuerpo).toContain("<CapacitacionProvider inicial={null}");
    expect(cuerpo).toContain("<OfflineIndicator />");
    expect(cuerpo).not.toContain("capacitacionDeLaPeticion(");
  });

  it("assignments y audit devuelven su componente cliente en LOCAL_MODE antes de crear el cliente", () => {
    for (const [ruta, componente] of [["assignments", "AssignmentsTabs"], ["audit", "AuditTabs"]] as const) {
      const s = leer(`src/app/timetracker/(timetracker)/${ruta}/page.tsx`);
      indice(s, DECLARACION);
      const rama = indice(s, `if (LOCAL_MODE) return <${componente} />;`);
      expect(rama, ruta).toBeLessThan(indice(s, "const supabase = await createClient();"));
      expect(rama, ruta).toBeLessThan(indice(s, "supabase.auth.getUser()"));
    }
  });

  it("payroll calcula la cabecera con la semilla en LOCAL_MODE y devuelve PayrollTabs antes de crear el cliente", () => {
    const s = leer("src/app/timetracker/(timetracker)/payroll/page.tsx");
    indice(s, DECLARACION);
    const rama = indice(s, "if (LOCAL_MODE) {");
    const cliente = indice(s, "const supabase = await createClient();");
    expect(rama).toBeLessThan(cliente);
    const cuerpo = s.slice(rama, cliente);
    expect(cuerpo).toContain("horasPorPersona(demoSessions(Date.now()), start, addDaysISO(start, 6))");
    expect(cuerpo).toContain("<PayrollTabs");
    expect(cuerpo).toContain("return (");
    // El periodo se resuelve ANTES de la rama: el demo también obedece a `?period=`.
    expect(indice(s, "periodStartOf(new Date())")).toBeLessThan(rama);
  });

  it("reports y schedule solo redirigen: no abren cliente ni sesión, así que no necesitan rama", () => {
    const reports = leer("src/app/timetracker/(timetracker)/reports/page.tsx");
    const schedule = leer("src/app/timetracker/(timetracker)/schedule/page.tsx");
    expect(reports).toContain('redirect("/timetracker/payroll")');
    expect(schedule).toContain('redirect("/timetracker/assignments")');
    for (const s of [reports, schedule]) { expect(s).not.toContain("createClient"); expect(s).not.toContain("auth.getUser"); }
  });

  it("TeamDiary elige la versión demo por LOCAL_MODE, y esa versión no toca Supabase", () => {
    const s = leer("src/components/timetracker/TeamDiary.tsx");
    indice(s, DECLARACION);
    indice(s, "return LOCAL_MODE ? <TeamDiaryDemo /> : <TeamDiaryReal />;");
    const demo = s.slice(indice(s, "function TeamDiaryDemo()"), indice(s, "function TeamDiaryReal()"));
    expect(demo).toContain("useData()");
    expect(demo).not.toMatch(/supabase\./);
    expect(demo).not.toMatch(/createClient\(/);
    expect(demo).not.toMatch(/sessionsSince/);
    // La real sigue entera: su cliente y su consulta de capturas no se movieron.
    const real = s.slice(indice(s, "function TeamDiaryReal()"));
    expect(real).toContain("const supabase = useMemo(() => createClient(), []);");
  });

  it("el proveedor demo está tipado DataState, monta el mismo Ctx que el real y no habla con nadie", () => {
    const s = leer("src/lib/timetracker-demo-data-provider.tsx");
    expect(s).toContain('import { Ctx, type DataState } from "@/lib/timetracker-data-provider";');
    expect(s).toContain("const value: DataState = {");
    expect(s).toContain("<Ctx.Provider value={value}>");
    expect(s).toContain('export const LS_KEY_TT_DEMO = "rtg_timetracker_local_v1";');
    expect(s).not.toMatch(/createClient|supabase\.|from\("|fetch\(|new Notification/);
    // Y el real exporta el contexto (antes era privado).
    expect(leer("src/lib/timetracker-data-provider.tsx")).toContain("export const Ctx = createContext<DataState | null>(null);");
  });

  it("la huella del dispositivo no avisa al servidor en demo (contestaba 401 en cada ruta)", () => {
    const s = leer("src/components/IdentidadDelDispositivo.tsx");
    indice(s, DECLARACION);
    expect(s).toContain("const sinSesion = LOCAL_MODE || !pathname ||");
  });
});
