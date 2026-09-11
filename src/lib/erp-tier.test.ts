import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ERP_TIERS, canSeeCost, erpTier } from "./erp/domain/roles";
import { canReachHub } from "./constants";

// El fallo: el ERP decidía con el rol de ENTREGAS. `getSessionInfo` hacía
// `profile.role as AppRole`, y `erp_role` —el escalafón propio que creó D-181— solo se escribía:
// nadie lo leía para decidir. Medido en producción: la cuenta de una persona `manager` en
// Entregas y `staff` en el ERP entraba con la pastilla «manager · cost visible».

const leer = (r: string) => readFileSync(join(process.cwd(), r), "utf8");

describe("EL CASO MEDIDO: manager en Entregas, staff en el ERP", () => {
  it("el nivel del ERP sale de `erp_role`, no del rol de Entregas", () => {
    // El perfil exacto que lo destapó.
    const patricia = { role: "manager", erp_role: "staff" };
    expect(erpTier(patricia)).toBe("staff");
    expect(canSeeCost(erpTier(patricia))).toBe(false);
  });
  it("y al revés también: staff en Entregas y manager en el ERP SÍ ve coste", () => {
    // No es «bajarle el nivel a todo el mundo»: son dos escalafones, y cada uno manda en su casa.
    const alguien = { role: "sales", erp_role: "manager" };
    expect(erpTier(alguien)).toBe("manager");
    expect(canSeeCost(erpTier(alguien))).toBe(true);
  });
  it("un admin de Entregas SIN nivel de ERP no hereda nada", () => {
    // Era el camino del fallo: heredar. Ahora sin `erp_role` no hay autoridad, punto.
    const adminDeEntregas = { role: "admin", erp_role: null };
    expect(erpTier(adminDeEntregas)).toBe("staff");
    expect(canSeeCost(erpTier(adminDeEntregas))).toBe(false);
  });
});

describe("falla cerrado, y con lista blanca", () => {
  it("sin perfil, sin campo o vacío → staff", () => {
    for (const p of [null, undefined, {}, { erp_role: null }, { erp_role: undefined }, { erp_role: "" }]) {
      expect(erpTier(p), JSON.stringify(p)).toBe("staff");
    }
  });
  it("un valor que no está en la lista NO concede nada, aunque parezca un rol", () => {
    // Lo que había era `as AppRole`: un molde acepta cualquier cadena de la columna y la
    // convierte en autoridad. Con lista blanca, un valor inesperado vale `staff`.
    for (const raro of ["ADMIN", "Manager", "superadmin", "logistics", "driver", "owner", " admin"]) {
      expect(erpTier({ erp_role: raro }), raro).toBe("staff");
    }
  });
  it("los tres niveles válidos pasan tal cual, y son los que acepta la base", () => {
    // `profiles_erp_role_known` (migración 101) permite exactamente estos tres.
    expect(ERP_TIERS).toEqual(["staff", "manager", "admin"]);
    for (const t of ERP_TIERS) expect(erpTier({ erp_role: t })).toBe(t);
    expect(leer("supabase/migrations/101_erp_role_and_cost.sql"))
      .toContain("check (erp_role is null or erp_role in ('staff','manager','admin'))");
  });
  it("solo admin y manager ven coste; los cinco roles del reparto, no", () => {
    expect(canSeeCost("admin")).toBe(true);
    expect(canSeeCost("manager")).toBe(true);
    for (const r of ["staff", "driver", "warehouse", "logistics", "sales", "accounting"] as const) {
      expect(canSeeCost(r), r).toBe(false);
    }
  });
});

describe("el cableado: una sola lectura, y cada rol en su sitio", () => {
  const auth = leer("src/lib/erp/auth.ts");

  it("`erp_role` entra en la consulta que ya se hacía", () => {
    expect(auth).toContain('.select("role, erp_role, full_name, module_access, recruiting_role, timetracker_role, store")');
    expect(auth.match(/\.from\("profiles"\)/g) ?? []).toHaveLength(1);
  });
  it("`role` del ERP sale de `erpTier`, y ya no hay molde sobre el rol de Entregas", () => {
    expect(auth).toContain("role: erpTier(profile),");
    expect(auth).not.toContain("profile?.role as AppRole");
  });
  it("`hubRole` sigue siendo el rol de Entregas: D-227 no se rompe", () => {
    // Las preguntas del hub siguen necesitando el rol del hub. Son dos escalafones, no uno.
    // Sin `?.` desde D-NEXT: un perfil ilegible lanza antes de llegar aquí, así que el
    // respaldo `?? "sales"` ya solo cubre una COLUMNA nula, no una lectura fallida.
    expect(auth).toContain('hubRole: (profile.role as UserRole) ?? "sales",');
    expect(leer("src/components/erp/header.tsx"))
      .toContain("hubReachable={canReachHub({ role: session.hubRole, module_access: session.moduleAccess })}");
    // Y la regla del hub sigue contestando lo suyo con el rol del hub.
    expect(canReachHub({ role: "manager", module_access: ["erp", "deliveries"] })).toBe(true);
    expect(canReachHub({ role: "manager", module_access: ["erp"] })).toBe(false);
  });
  it("ningún consumidor del ERP se quedó preguntando por el rol de Entregas", () => {
    // Los ~38 consumidores usan `session.role`, que ahora ES el nivel del ERP. Lo que no puede
    // aparecer es alguno preguntando por `hubRole` para decidir autoridad dentro del ERP.
    const erpFiles = [
      "src/app/erp/dashboard/page.tsx",
      "src/app/erp/product/[id]/page.tsx",
      "src/app/erp/purchasing/orders/[id]/page.tsx",
      "src/app/erp/review/daltile/page.tsx",
      "src/app/api/erp/master-export/route.ts",
      "src/lib/erp/actions.ts",
    ];
    for (const f of erpFiles) expect(leer(f), f).not.toContain("hubRole");
  });
});

describe("la base ya decidía bien, y por tres barreras distintas", () => {
  const f064 = leer("supabase/migrations/064_erp_functions.sql");
  const f101 = leer("supabase/migrations/101_erp_role_and_cost.sql");

  it("`current_app_role()` lee `erp_role` desde D-181", () => {
    expect(f101).toContain("select erp_role from public.profiles where id = auth.uid()");
  });
  it("el enmascarado de coste cuelga de ahí", () => {
    expect(f064).toContain("select coalesce(erp.current_app_role() in ('admin','manager'), false)");
    expect(f101).toContain("select case when erp.can_see_cost() then p.cost else null end");
  });
  it("las vistas son `security_invoker`, que es lo que hace útil al REVOKE", () => {
    // Sin esto la vista correría con los permisos de quien la creó y el `REVOKE` sobre la
    // columna base no habría servido de nada: las dos barreras solo funcionan juntas.
    expect(f101.match(/with \(security_invoker = on\)/g) ?? []).toHaveLength(3);
  });
  it("y las funciones DEFINER se preguntan el rol ELLAS MISMAS", () => {
    // Es la barrera que cubre lo que el enmascarado no puede: `reconcile_po` alimenta la página
    // que firma URLs a los PDF de compras con service-role. Si solo dependiera del gate del
    // cliente, un `staff` habría recibido enlaces a documentos con costes reales.
    expect(f064).toContain("if coalesce(erp.current_app_role()::text, '') not in ('admin','manager') then");
    expect(f064).toContain("raise exception 'not authorized' using errcode = '42501'");
  });
});
