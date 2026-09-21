import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { TABS, vaEnGeneral } from "./constants";

/** D-347 · El dueño: «move dashboard to general for admin». Solo para admin: el gerente lo conserva en la barra. */
describe("el Panel va en «General» para admin", () => {
  const panel = TABS.find((tb) => tb.id === "dashboard")!;
  it("admin lo tiene dentro de «General»; el gerente, en la barra", () => {
    expect(vaEnGeneral(panel, "admin")).toBe(true);
    expect(vaEnGeneral(panel, "manager")).toBe(false);
    expect(vaEnGeneral(panel, null)).toBe(false);
  });
  it("lo que ya iba en «General» sigue yendo para todos, y Órdenes no entra para nadie", () => {
    expect(vaEnGeneral(TABS.find((tb) => tb.id === "audit")!, "manager")).toBe(true);
    expect(vaEnGeneral(TABS.find((tb) => tb.id === "board")!, "admin")).toBe(false);
  });
  it("la barra reparte con esa función, no con `group` a secas", () => {
    const barra = readFileSync(join(process.cwd(), "src/components/TopBar.tsx"), "utf8");
    expect(barra).toContain("const mainTabs = visibleTabs.filter((tb) => !vaEnGeneral(tb, me.role));");
    expect(barra).toContain("const generalTabs = visibleTabs.filter((tb) => vaEnGeneral(tb, me.role));");
    expect(barra).not.toContain('tb.group === "general"');
  });
});
