import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { destinoAlEntrar } from "./auth-redirect";
import { decide } from "./route-guard";

/**
 * D-839: «when people log in to app they see delivery app by default instead of Home Screen». Las apps abren la raíz
 * (`/`, la lista de Entregas); sin sesión se iba a `/login?next=/` y al entrar volvía a Entregas.
 */
const leer = (r: string) => readFileSync(r, "utf8").split("\r\n").join("\n");

describe("al entrar", () => {
  it("la raíz pelada va al inicio; lo demás, como siempre", () => {
    expect(destinoAlEntrar("/")).toBe("/home");
    expect(destinoAlEntrar(null)).toBe("/home");
    expect(destinoAlEntrar("/?order=123")).toBe("/?order=123");
    expect(destinoAlEntrar("/timetracker")).toBe("/timetracker");
    expect(destinoAlEntrar("//evil.com")).toBe("/home");
  });
  it("con sesión pisando /login?next=/: al inicio", () => {
    expect(decide("/login?next=%2F", "/", true)).toEqual({ kind: "redirect", to: "/home" });
  });
  it("el login y el enlace del correo usan el mismo destino", () => {
    expect(leer("src/app/login/page.tsx")).toContain('setNext(destinoAlEntrar(params.get("next")));');
    expect(leer("src/app/auth/callback/route.ts")).toContain('const next = destinoAlEntrar(url.searchParams.get("next"));');
  });
});
