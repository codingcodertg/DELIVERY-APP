import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { nextOrderCode } from "./order-code";

// D-460. El dueño, 2026-10-02: «everto quiere crear orderneeds y le sale errorr duplicate key value … unique constraint».
const leer = (p: string) => readFileSync(join(process.cwd(), p), "utf8").replace(/\r\n/g, "\n");

describe("el código de orden lo da el servidor, con todos los de la banda (D-460)", () => {
  it("el fallo: con solo SUS códigos a la vista, el siguiente ya está usado por otro", () => {
    const fecha = new Date(2026, 9, 2, 12);                       // semana 40 → banda FT500…
    const todos = ["FT590", "FT591", "FT592", "FT593"];
    const losDeVentas = ["FT591"];                               // RLS: solo las suyas
    expect(nextOrderCode(losDeVentas, fecha)).toBe("FT592");     // choca
    expect(todos).toContain(nextOrderCode(losDeVentas, fecha));
    expect(nextOrderCode(todos, fecha)).toBe("FT594");           // con todos, libre
  });
  it("la ruta exige sesión, lee con la llave de servicio solo `order_code` de la banda, y no escribe", () => {
    const r = leer("src/app/api/next-order-code/route.ts");
    expect(r).toContain('if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });');
    expect(r).toContain("admin = createAdminClient()");
    expect(r).toContain('.select("order_code").eq("is_training", false)');
    expect(r).not.toMatch(/\.(insert|update|delete|upsert)\(/);
    expect(r.indexOf("if (!user)")).toBeLessThan(r.indexOf("createAdminClient()"));
  });
  it("al crear, se pide al servidor en cada intento; el cálculo local queda solo de respaldo", () => {
    const p = leer("src/lib/data-provider.tsx");
    expect(p).toContain('const r = await fetch("/api/next-order-code", { cache: "no-store" });');
    expect(p).toContain("payload.order_code = delServidor ?? nextOrderCode(");
    // El reintento que leía con la RLS de quien crea ya no está.
    expect(p).not.toContain('.gte("order_code", band.prefix + "100")');
  });
});
