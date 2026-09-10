import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { MODULE_ACCESS, landingRoute } from "./constants";

// El dueño: «déjame editar esos roles, no están correctos». El selector del rol de Entregas vivía
// dentro del bloque de su módulo, detrás de la casilla, así que quien no tenía Entregas concedida
// veía su rol en la lista de Usuarios y no podía cambiarlo — seis perfiles en producción.
//
// Y no era una decisión: el comentario de `MODULE_ACCESS` para Entregas YA decía «por eso el rol
// se sigue enseñando aunque la casilla esté apagada». El render no lo cumplía.

const leer = (r: string) => readFileSync(join(process.cwd(), r), "utf8");

describe("el rol de la persona se declara aparte del acceso al módulo", () => {
  const deliveries = MODULE_ACCESS.find((m) => m.key === "deliveries")!;

  it("Entregas declara que su rol se edita en Identidad", () => {
    expect(deliveries.roleEditedIn).toBe("identity");
  });
  it("y CONSERVA su `roleColumn`, que es donde vive ese rol", () => {
    // Quitarlo no rompería ninguna prueba —seguirían pasando— pero dejaría `role` fuera del
    // conjunto vigilado, y otro módulo podría reclamarla sin que saltara nada. Ver la prueba de
    // cobertura de abajo.
    expect(deliveries.roleColumn).toBe("role");
  });
  it("es el único con `roleEditedIn`: los otros tres roles SÍ son de módulo", () => {
    // Nacen y mueren con el acceso; el de Entregas sobrevive a quitar el módulo (D-100).
    const fuera = MODULE_ACCESS.filter((m) => m.roleEditedIn);
    expect(fuera.map((m) => m.key)).toEqual(["deliveries"]);
  });
});

describe("el guardián de las columnas: unicidad Y cobertura", () => {
  const columnas = MODULE_ACCESS.map((m) => m.roleColumn).filter(Boolean);

  it("no hay dos módulos apuntando a la misma columna (lo que ya se comprobaba)", () => {
    expect(new Set(columnas).size).toBe(columnas.length);
  });
  it("y las CUATRO columnas siguen reclamadas, por su nombre", () => {
    // Esto es lo que faltaba. Las dos pruebas que ya existen comprueban unicidad, y una ausencia
    // no rompe la unicidad: quitarle el `roleColumn` a un módulo las deja pasar en verde con esa
    // columna sin dueño — y a partir de ahí otro módulo podría reclamarla en silencio, que es
    // justo el lío `role`/`recruiting_role` de D-052.
    //
    // Se fijan los NOMBRES y no el número: con `toBe(4)`, quitar `role` y añadir otra columna
    // cualquiera volvería a pasar.
    expect(new Set(columnas)).toEqual(new Set(["role", "recruiting_role", "timetracker_role", "erp_role"]));
  });
});

describe("un rol sin su módulo no crea un callejón", () => {
  it("un `driver` SIN Entregas no acaba en /driver", () => {
    // Ahora el rol se puede editar sin tener el módulo, así que este perfil es alcanzable a
    // propósito. `landingRoute` ya exigía las dos cosas (`constants.ts:183`); esta prueba es lo
    // que hace que siga exigiéndolas cuando alguien la toque sin acordarse de este caso.
    expect(landingRoute({ role: "driver", module_access: ["timetracker"] })).toBe("/timetracker");
    expect(landingRoute({ role: "driver", module_access: [] })).toBe("/no-access");
    expect(landingRoute({ role: "driver", module_access: ["timetracker", "recruiting"] })).toBe("/home");
  });
  it("y con Entregas sí, que es la excepción del chofer de D-050/051", () => {
    expect(landingRoute({ role: "driver", module_access: ["deliveries"] })).toBe("/driver");
    expect(landingRoute({ role: "driver", module_access: ["deliveries", "timetracker"] })).toBe("/driver");
  });
});

describe("el cableado del diálogo", () => {
  const dlg = leer("src/components/UserDialog.tsx");

  it("el selector vive en Identidad y escribe con `updateUserRole`", () => {
    const identidad = dlg.slice(dlg.indexOf('{t("Identity", "Identidad")}'), dlg.indexOf('{t("Modules & permissions"'));
    expect(identidad).toContain("updateUserRole(u.id, e.target.value as UserRole)");
    expect(identidad).toContain("ROLE_ORDER.map(");
  });
  it("y NO pasa por la función genérica de roles de módulo", () => {
    // `setModuleRole` es el despacho explícito por módulo de D-057. El rol de la persona no es
    // de un módulo, así que no entra por ahí — y así ninguna función escribe dos columnas.
    const identidad = dlg.slice(dlg.indexOf('{t("Identity", "Identidad")}'), dlg.indexOf('{t("Modules & permissions"'));
    expect(identidad).not.toContain("setModuleRole");
  });
  it("el bloque del módulo dice dónde está el rol, y lo decide el DATO", () => {
    // Nada de `m.key === "deliveries"` para esto: la excepción la declara `roleEditedIn`.
    expect(dlg).toContain('{m.roleEditedIn === "identity" ? (');
    expect(dlg).toContain('"Chosen above, in Identity — it applies across the app, not just here."');
    // El corte se comprueba: un `indexOf` que no encuentra su marca devuelve -1 y el `slice`
    // se lleva medio fichero — entonces la prueba mediría otra cosa y fallaría por un motivo
    // que no es el suyo. (Pasó al escribirla.)
    const desde = dlg.indexOf('{m.roleEditedIn === "identity" ? (');
    const hasta = dlg.indexOf(") : m.roleColumn ? (", desde);
    expect(desde).toBeGreaterThan(0);
    expect(hasta).toBeGreaterThan(desde);
    // Y se mira el CÓDIGO, no los comentarios: el comentario de esa rama cita
    // `m.key === "deliveries"` justamente para decir que NO se usa, y eso tiene que poder
    // quedarse escrito.
    const ramaCodigo = dlg.slice(desde, hasta).replace(/\/\*[\s\S]*?\*\/|\/\/.*/g, "");
    expect(ramaCodigo).not.toContain('m.key === "deliveries"');
  });
  it("el evento de seguridad sigue viajando con la escritura", () => {
    // Va dentro de `updateUserRole`, así que no depende de que el selector se acuerde de nada.
    expect(leer("src/lib/data-provider.tsx")).toContain('logSecurityClient(userId, "role_changed", change(before, role))');
  });
});
