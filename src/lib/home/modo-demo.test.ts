import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// D-NEXT · El inicio del Hub en el demo (`NEXT_PUBLIC_LOCAL_MODE`). El dueño, 2026-11-09: «pero quiero que sea de todo,
// todas las appas y todos los procedimientos». Estas pruebas leen el fuente: se afirma el ORDEN (la rama del demo va antes
// de tocar la base), y que la bandera sea exactamente la del demo.
const leer = (r: string) => readFileSync(r, "utf8").split("\r\n").join("\n");
const BANDERA = 'const LOCAL_MODE = process.env.NEXT_PUBLIC_LOCAL_MODE === "true";';

const ordenado = (texto: string, antes: string, despues: string) => {
  const i = texto.indexOf(antes), j = texto.indexOf(despues);
  expect(i, antes).toBeGreaterThan(-1); expect(j, despues).toBeGreaterThan(-1);
  expect(i).toBeLessThan(j);
};

const SERVIDOR: [string, string][] = [
  ["src/app/home/layout.tsx", 'if (LOCAL_MODE) return <><AppUpdateBanner app="deliveries" />'],
  ["src/app/home/page.tsx", "if (LOCAL_MODE) return <HomeSelector me={PERFIL_DEMO}"],
  ["src/app/home/mapa/page.tsx", "if (LOCAL_MODE) return <MapaDeLaEmpresa me={PERFIL_DEMO}"],
  ["src/app/home/profile/page.tsx", "if (LOCAL_MODE) return <ProfileView id={PERFIL_DEMO.id}"],
  ["src/app/home/tutorials/page.tsx", "if (LOCAL_MODE) return <TutorialsHub yo={PERFIL_DEMO.id}"],
  ...["ayuda", "directory", "personalizar", "profile", "tutorials"].map(
    (d): [string, string] => [`src/app/home/${d}/layout.tsx`, 'if (LOCAL_MODE) return <div className="wrap">{children}</div>;'],
  ),
  ["src/app/home/users/layout.tsx", "if (LOCAL_MODE) return (\n      <ConfirmProvider>\n        <ProveedorDemoDelHub>"],
  ["src/app/home/solicitudes-de-ayuda/layout.tsx", "if (LOCAL_MODE) return enDemo(children);"],
  ["src/app/home/switch-user/layout.tsx", "if (LOCAL_MODE) return enDemo(children);"],
];

const NAVEGADOR = [
  "src/app/home/ayuda/page.tsx", "src/app/home/directory/page.tsx", "src/app/home/solicitudes-de-ayuda/page.tsx",
  "src/app/home/solicitudes-de-ayuda/[id]/copiar/page.tsx", "src/components/HomeSelector.tsx",
  "src/components/tutorials/TutorialsHub.tsx", "src/components/HiloDeAyuda.tsx", "src/components/profile/ProfileView.tsx",
];

describe("/home/** en el demo, sin base ni sesión", () => {
  it.each(SERVIDOR)("%s ramifica en LOCAL_MODE antes de crear el cliente de Supabase", (ruta, rama) => {
    const f = leer(ruta);
    expect(f).toContain(BANDERA);
    ordenado(f, rama, "await createClient()");
    ordenado(f, rama, "supabase.auth.getUser()");
  });

  it("la vista móvil no llama a perfilDeLaVistaMovil en el demo, ni en la puerta ni en la página", () => {
    const layout = leer("src/app/home/vista-movil/layout.tsx");
    expect(layout).toContain(BANDERA);
    ordenado(layout, "if (LOCAL_MODE) return enDemo(children);", "await perfilDeLaVistaMovil()");
    const pagina = leer("src/app/home/vista-movil/page.tsx");
    expect(pagina).toContain(BANDERA);
    expect(pagina).toContain("const perfil = LOCAL_MODE ? null : (await perfilDeLaVistaMovil()).perfil;");
  });

  it.each(NAVEGADOR)("%s toma el cliente del hub y no el del navegador directamente", (ruta) => {
    const f = leer(ruta);
    expect(f).toContain('import { clienteDelHub as createClient } from "@/lib/home/cliente-del-hub";');
    expect(f).not.toContain('from "@/lib/supabase/client"');
  });

  it("con la bandera apagada, el cliente del hub es el real; la rama del demo va delante y mira la bandera exacta", () => {
    const f = leer("src/lib/home/cliente-del-hub.ts");
    expect(f).toContain(BANDERA);
    ordenado(f, "if (LOCAL_MODE) return clienteDemoDelHub(new Date())", "return clienteReal();");
  });

  it("lo que no pasa por el cliente del hub contesta el aviso antes de salir a la red", () => {
    const AVISO = 'process.env.NEXT_PUBLIC_LOCAL_MODE === "true"';
    const perfil = leer("src/components/profile/ProfileView.tsx");
    ordenado(perfil, AVISO, "guardaMiNombre(createClient()");
    ordenado(perfil.slice(perfil.indexOf("const enviar = async")), AVISO, 'fetch("/api/profile/password"');
    ordenado(leer("src/components/HiloDeAyuda.tsx"), AVISO, "await subeAdjuntosDeAyuda(");
    ordenado(leer("src/app/home/ayuda/page.tsx"), AVISO, "await enviaSolicitudDeAyuda(");
    ordenado(leer("src/components/SwitchUserPanel.tsx"), AVISO, "await fetch(ruta,");
    ordenado(leer("src/app/home/switch-user/page.tsx"), AVISO, 'fetch("/api/impersonate/state?ask=switch")');
    const hub = leer("src/components/tutorials/TutorialsHub.tsx");
    ordenado(hub.slice(hub.indexOf("const marcarVisto")), "if (DEMO)", "await marcaVisto(");
    ordenado(hub.slice(hub.indexOf("const guardar = async")), "if (DEMO)", "await guardaTutoriales(");
    ordenado(leer("src/components/tutorials/AvisoDeTutoriales.tsx"), AVISO, 'cliente.rpc("tutorials")');
  });

  it("Usuarios y «Cambiar de usuario» usan el proveedor con los accesos, y el diálogo enseña todos los módulos en el demo", () => {
    const proveedor = leer("src/components/ProveedorDemoDelHub.tsx");
    expect(proveedor).toContain("users: usuariosDemoDelHub(datos.users)");
    expect(proveedor).toContain("<LocalDataProvider me={PERFIL_DEMO}><ConAccesos>");
    expect(leer("src/app/home/switch-user/layout.tsx")).toContain("<ProveedorDemoDelHub>");
    expect(leer("src/components/UserDialog.tsx")).toContain("{MODULE_ACCESS.filter((m) => (m.offeredTo?.(u.role) ?? true)).map((m) => {");
  });
});
