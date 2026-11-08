import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// D-NEXT · Seguridad en el demo (`NEXT_PUBLIC_LOCAL_MODE`). El dueño, 2026-11-08: «daselo al demo entonces para que
// lo haga». Estas pruebas leen el fuente: lo que se afirma es el ORDEN (la rama del demo va antes de tocar la base),
// no la presencia de un texto que un comentario también cumpliría.
const leer = (r: string) => readFileSync(r, "utf8").split("\r\n").join("\n");
const layout = leer("src/app/security/layout.tsx");
const pagina = leer("src/app/security/page.tsx");
const panel = leer("src/app/security/PanelDeSeguridad.tsx");
const acciones = leer("src/app/security/actions.ts");

const ordenado = (texto: string, antes: string, despues: string) => {
  const i = texto.indexOf(antes), j = texto.indexOf(despues);
  expect(i, antes).toBeGreaterThan(-1); expect(j, despues).toBeGreaterThan(-1);
  expect(i).toBeLessThan(j);
};

describe("Seguridad funciona en el demo sin base ni sesión", () => {
  it("el layout devuelve la barra del demo ANTES de preguntar a Supabase quién entró", () => {
    ordenado(layout, 'if (LOCAL_MODE) return <><BarraSencilla nombre={NOMBRE} deliveriesRole="admin"', "await createClient()");
    ordenado(layout, "if (LOCAL_MODE) return", "supabase.auth.getUser()");
  });

  it("la página toma las filas de la semilla en el demo y de la base si no; la base solo se abre dentro de leerDeLaBase", () => {
    expect(pagina).toContain("LOCAL_MODE ? { ...datosDemoDeSeguridad(new Date()), error: null } : await leerDeLaBase()");
    // `createClient()` aparece una sola vez, y es dentro de la función que lee la base (nunca en el cuerpo de la página).
    expect(pagina.match(/await createClient\(\)/g) ?? []).toHaveLength(1);
    ordenado(pagina, "async function leerDeLaBase(", "await createClient()");
    ordenado(pagina, "await createClient()", "export default async function SecurityPage()");
  });

  it("el panel no abre el canal en vivo en el demo: la guarda va antes de crear el cliente", () => {
    const efecto = panel.slice(panel.indexOf("function useEnVivo()"), panel.indexOf("return vivo;"));
    ordenado(efecto, "if (LOCAL_MODE) return;", "const supabase = createClient();");
  });

  it("las acciones de servidor contestan «no disponible» en el demo antes de tocar la base, y todas pasan por esa puerta", () => {
    const puerta = acciones.slice(acciones.indexOf("async function admin()"), acciones.indexOf("type R ="));
    ordenado(puerta, 'if (LOCAL_MODE) return { ok: false as const, message: "Not available in the demo." };', "await createClient()");
    const exportadas = acciones.match(/^export async function \w+/gm) ?? [];
    expect(exportadas.length).toBeGreaterThanOrEqual(7);
    expect((acciones.match(/const a = await admin\(\);/g) ?? []).length).toBe(exportadas.length);
  });
});
