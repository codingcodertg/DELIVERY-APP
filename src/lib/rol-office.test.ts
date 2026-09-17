import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import {
  canApprove, canCreate, canEditFields, hasCap, ordersLikeOfficeManager, ROLE_CAPS, ROLE_ORDER, roleLabel, STAGES,
} from "./constants";
import { seesAllHistory } from "./utils";
import type { UserRole } from "./types";

// `accounting` se ve como «Office» y crea órdenes como el gerente (D-279). La clave no cambia.
// La migración del guard que se lo permite en la base es de otra rama (`guard-office-como-manager`).

const leer = (r: string) => readFileSync(join(process.cwd(), r), "utf8").split("\r\n").join("\n");
const plano = (s: string) => s.replace(/\s+/g, " ");
const office = (extra: Partial<{ permissions: string[] }> = {}) => ({ role: "accounting" as UserRole, ...extra });

describe("«Office»: la etiqueta de accounting", () => {
  it("se lee Office / Oficina", () => {
    expect(roleLabel("accounting", "en")).toBe("Office");
    expect(roleLabel("accounting", "es")).toBe("Oficina");
  });

  it("manager sigue siendo el gerente de oficina", () => {
    expect(roleLabel("manager", "en")).toBe("Office Manager");
    expect(roleLabel("manager", "es")).toBe("Gerente de Oficina");
  });

  it("la clave interna sigue siendo accounting: tipos, orden, invitación e importación", () => {
    expect(ROLE_ORDER).toContain("accounting");
    expect(leer("src/lib/types.ts")).toMatch(/export type UserRole = [^;]*"accounting"/);
    expect(leer("src/app/api/invite/route.ts")).toMatch(/const ROLES = \[[^\]]*"accounting"/);
    expect(plano(leer("src/components/UsersImportModal.tsx"))).toContain('asst: "accounting", acct: "accounting", accounting: "accounting",');
  });

  // Barrido de textos visibles. Reclutamiento y ERP tienen su propio «Accounting» (un puesto, un
  // módulo), que no es este rol, y se quedan fuera.
  const FUERA = [/\/recruiting\//, /\/erp\//, /recruiting-data-provider/, /\.test\.ts$/];
  const literal = /(["'`])((?:(?!\1)[^\\\n]|\\.)*?\b(?:Accounting|Contabilidad)\b(?:(?!\1)[^\\\n]|\\.)*?)\1/g;
  const sinComentarios = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
  function ficheros(dir: string): string[] {
    const out: string[] = [];
    for (const n of readdirSync(dir)) {
      const p = `${dir}/${n}`;
      if (statSync(p).isDirectory()) out.push(...ficheros(p));
      else if (/\.(ts|tsx)$/.test(p) && !FUERA.some((r) => r.test(p))) out.push(p);
    }
    return out;
  }

  it("el detector caza un texto así (control)", () => {
    expect([...sinComentarios(`t("Role codes ASST→Accounting", "ASST→Contabilidad")`).matchAll(literal)]).toHaveLength(2);
    // Y no caza un comentario ni una clave.
    expect([...sinComentarios(`// Accounting reviews\nconst r = "accounting";`).matchAll(literal)]).toHaveLength(0);
  });

  it("ningún texto visible dice Accounting o Contabilidad", () => {
    const hallados = ficheros("src").flatMap((f) =>
      [...sinComentarios(leer(f)).matchAll(literal)].map((m) => `${f}: ${m[2].slice(0, 60)}`));
    expect(hallados).toEqual([]);
  });
});

describe("Office crea y aprueba, como el gerente sin el panel", () => {
  it("crea y aprueba por rol, sin permisos sueltos", () => {
    expect(canCreate(office())).toBe(true);
    expect(canApprove(office())).toBe(true);
    expect(hasCap(office(), "dashboard")).toBe(false);
  });

  it("sus capacidades son las del gerente menos el panel", () => {
    expect([...ROLE_CAPS.accounting].sort()).toEqual(ROLE_CAPS.manager.filter((c) => c !== "dashboard").sort());
  });

  it("edita en las mismas etapas que el gerente, en todas", () => {
    for (const s of STAGES) expect([s.key, canEditFields("accounting", s.key)]).toEqual([s.key, canEditFields("manager", s.key)]);
    expect(STAGES.every((s) => canEditFields("accounting", s.key))).toBe(true);
  });

  it("los demás roles no ganan nada: ventas sigue sin editar un borrador", () => {
    expect(canEditFields("sales", "draft")).toBe(false);
    expect(canEditFields("logistics", "approved")).toBe(false);
  });

  it("ordersLikeOfficeManager: el gerente y office, nadie más", () => {
    expect(ordersLikeOfficeManager("manager")).toBe(true);
    expect(ordersLikeOfficeManager("accounting")).toBe(true);
    for (const r of ["admin", "sales", "warehouse", "driver", "logistics", "", null, undefined]) {
      expect([r, ordersLikeOfficeManager(r)]).toEqual([r, false]);
    }
  });

  it("y ve solo ayer, hoy y lo que viene, como todos menos admin y logística", () => {
    expect(seesAllHistory("accounting")).toBe(false);
  });
});

describe("OrderModal: donde decía manager, ahora dice office también", () => {
  const modal = plano(leer("src/components/OrderModal.tsx"));

  it("elige vendedor al crear una orden de cliente", () => {
    expect(modal).toContain('const needsSalesRep = isNew && (ordersLikeOfficeManager(me.role) || me.role === "admin" || me.role === "driver")');
  });

  it("edita los campos de ventas", () => {
    expect(modal).toContain('const salesFields = editing && (isNew || me.role === "sales" || me.role === "admin" || ordersLikeOfficeManager(me.role));');
  });

  it("crea la orden ya aprobada, y el botón lo dice", () => {
    expect(modal).toContain("const autoApprove = (ordersLikeOfficeManager(me.role) || storeAutoApprove) && !intertiendaNeedsPo;");
    expect(modal).toContain("{ordersLikeOfficeManager(me.role) && !intertiendaNeedsPo");
  });

  it("puede registrar una re-entrega, porque la 118 se lo deja", () => {
    expect(modal).toContain('(["admin", "warehouse", "driver"].includes(me.role) || ordersLikeOfficeManager(me.role))');
  });

  it("lo que NO cambia: notas privadas del gerente, y el enlace de seguimiento de D-044", () => {
    expect(modal).toContain('(me.role === "admin" || me.role === "manager" || existing.created_by === me.id)');
    expect(modal).toContain('me.role !== "sales" && me.role !== "warehouse" && me.role !== "accounting" && (');
    expect(modal).toContain('{me.role !== "accounting" && (');
  });
});
