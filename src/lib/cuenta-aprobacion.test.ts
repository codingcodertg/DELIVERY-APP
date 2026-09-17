import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { cuentaRequiereAprobacion, naceAprobada } from "./cuenta-aprobacion";
import type { AccountRecord } from "./types";

// Cuentas que siempre pasan por oficina (D-NEXT, migración 123). Nombres inventados: las cuatro
// cuentas de verdad las carga el orquestador en Ajustes.

const leer = (r: string) => readFileSync(join(process.cwd(), r), "utf8").split("\r\n").join("\n");
const plano = (s: string) => s.replace(/\s+/g, " ");

const cuenta = (name: string, extra: Partial<AccountRecord> = {}): AccountRecord =>
  ({ name, contact: "", phone: "", ...extra });

const CUENTAS = [
  cuenta("Cliente Marcado", { requires_approval: true }),
  cuenta("Cliente Normal"),
  cuenta("Sucursal", { intertienda: true }),
];

describe("cuentaRequiereAprobacion", () => {
  it("la marcada sí, las demás no", () => {
    expect(cuentaRequiereAprobacion(CUENTAS, "Cliente Marcado")).toBe(true);
    expect(cuentaRequiereAprobacion(CUENTAS, "Cliente Normal")).toBe(false);
    expect(cuentaRequiereAprobacion(CUENTAS, "Sucursal")).toBe(false);
  });

  it("el nombre se compara sin espacios de sobra ni mayúsculas", () => {
    expect(cuentaRequiereAprobacion(CUENTAS, "  cliente marcado ")).toBe(true);
    expect(cuentaRequiereAprobacion(CUENTAS, "CLIENTE MARCADO")).toBe(true);
  });

  it("lo que no se sabe no se inventa: sin cuenta, o con una que no está, no pide aprobación", () => {
    expect(cuentaRequiereAprobacion(CUENTAS, null)).toBe(false);
    expect(cuentaRequiereAprobacion(CUENTAS, "")).toBe(false);
    expect(cuentaRequiereAprobacion(CUENTAS, "   ")).toBe(false);
    expect(cuentaRequiereAprobacion(CUENTAS, "Una que no existe")).toBe(false);
    expect(cuentaRequiereAprobacion(null, "Cliente Marcado")).toBe(false);
    expect(cuentaRequiereAprobacion([], "Cliente Marcado")).toBe(false);
  });

  it("una cuenta sin la marca es una cuenta sin la marca, no una a medias", () => {
    expect(cuentaRequiereAprobacion([cuenta("X", { requires_approval: false })], "X")).toBe(false);
    expect(cuentaRequiereAprobacion([cuenta("X")], "X")).toBe(false);
  });
});

describe("naceAprobada: quién puede crear una orden ya aprobada", () => {
  const base = { creaComoOficina: false, tiendaAutoAprueba: false, cuentaPideAprobacion: false, intertiendaSinPo: false };

  it("como antes: oficina o tienda que aprueba sola", () => {
    expect(naceAprobada({ ...base, creaComoOficina: true })).toBe(true);
    expect(naceAprobada({ ...base, tiendaAutoAprueba: true })).toBe(true);
    expect(naceAprobada(base)).toBe(false);
  });

  it("la cuenta marcada gana a la tienda Y a la oficina", () => {
    expect(naceAprobada({ ...base, tiendaAutoAprueba: true, cuentaPideAprobacion: true })).toBe(false);
    expect(naceAprobada({ ...base, creaComoOficina: true, cuentaPideAprobacion: true })).toBe(false);
    expect(naceAprobada({ ...base, creaComoOficina: true, tiendaAutoAprueba: true, cuentaPideAprobacion: true })).toBe(false);
  });

  it("y la Intertienda sin PO sigue yendo a pendiente, como antes", () => {
    expect(naceAprobada({ ...base, creaComoOficina: true, intertiendaSinPo: true })).toBe(false);
    expect(naceAprobada({ ...base, tiendaAutoAprueba: true, intertiendaSinPo: true })).toBe(false);
  });
});

describe("123: la base también lo hace cumplir", () => {
  const dir = "supabase/migrations";
  const sql = leer(`${dir}/123_cuentas_con_aprobacion.sql`);
  const ejecutable = sql.split("\n").map((l) => l.replace(/--.*$/, "")).join("\n");
  const guard = (texto: string) => {
    const i = texto.search(/create or replace function public\.guard_delivery_stage\(\)/i);
    const j = texto.search(/\bend \$function\$\s*;/i);
    if (i < 0 || j < 0) throw new Error("no encuentro el guard");
    return texto.slice(i, j);
  };

  it("la 123 es la última que define el guard (control)", () => {
    const conGuard = readdirSync(join(process.cwd(), dir))
      .filter((f) => f.endsWith(".sql") && leer(`${dir}/${f}`).includes("function public.guard_delivery_stage"))
      .sort();
    expect(conGuard.at(-1)).toBe("123_cuentas_con_aprobacion.sql");
  });

  it("es la 118 con un solo cambio: el `auto` mira también la cuenta", () => {
    // Los dos crudos, con sus comentarios: la copia los trae y quitárselos a uno solo compararía
    // cosas distintas.
    const f118 = guard(leer(`${dir}/118_guard_office_como_manager.sql`));
    const f123 = guard(sql);
    // Primero, que el cambio ESTÉ. Sin esto, un guard idéntico a la 118 —o sea, sin la cuenta—
    // pasaría la comparación de abajo sin más: medido con un mutante.
    expect(plano(f123)).toMatch(/public\.account_requires_approval\(\s*NEW\.account\s*\)/);
    // Y ahora, que sea lo ÚNICO que cambia. Se quita la condición sin fijar su forma exacta: con
    // paréntesis o sin ellos es la misma condición, y el gemelo lo comprobó.
    const sinCuenta = plano(f123).replace(/\s*and\s*\(?\s*not\s+public\.account_requires_approval\(\s*NEW\.account\s*\)\s*\)?/, "");
    expect(sinCuenta).toBe(plano(f118));
  });

  it("la marca se lee de Ajustes, sin espacios ni mayúsculas, y ausente es false", () => {
    const fn = plano(ejecutable.slice(ejecutable.indexOf("create or replace function public.account_requires_approval")));
    expect(fn).toContain("jsonb_array_elements(coalesce(accounts, '[]'::jsonb))");
    expect(fn).toContain("lower(btrim(a->>'name')) = lower(btrim(account_name))");
    expect(fn).toContain("coalesce(bool_or(coalesce((a->>'requires_approval')::boolean, false)), false)");
  });

  it("la función nueva no la puede llamar cualquiera", () => {
    expect(plano(ejecutable)).toContain("revoke execute on function public.account_requires_approval(text) from public, anon;");
    expect(plano(ejecutable)).toContain("grant execute on function public.account_requires_approval(text) to authenticated;");
  });

  it("no escribe datos ni borra el guard", () => {
    expect(ejecutable).not.toMatch(/\bupdate\s+public\.deliveries|\bdelete\s+from|drop\s+(function|trigger)|create\s+trigger/i);
  });

  it("el ensayo dice qué se espera antes y después, y con dos roles", () => {
    // Que el ensayo se HAGA PASAR por cada uno, no que sus nombres aparezcan en un comentario:
    // medido con un mutante que cambiaba el uuid del bloque y dejaba la mención intacta.
    expect(sql).toContain('{"sub":"<uuid-vendedor>","role":"authenticated"}');
    expect(sql).toContain('{"sub":"<uuid-manager>","role":"authenticated"}');
    expect(sql).toContain("-- ANTES:   PERMITIDO · PERMITIDO · PERMITIDO");
    expect(sql).toContain("-- DESPUES: PERMITIDO · BLOQUEADO · PERMITIDO");
    expect(sql).toContain("--   rollback;");
    // Y el límite dicho: al gerente esto no le quita aprobar lo que crea.
    expect(sql).toContain("el gerente crea aprobada POR SU ROL");
  });

  it("se auto-registra y no lleva el marcador sin numerar", () => {
    const [, despues] = sql.split("-- @ledger-below");
    expect(despues).toContain("123_cuentas_con_aprobacion.sql");
    expect(sql).not.toContain("D-" + "NEXT");
  });
});

describe("la pantalla dice lo mismo que la base", () => {
  const modal = plano(leer("src/components/OrderModal.tsx"));
  const datos = plano(leer("src/app/(app)/data/page.tsx"));

  it("la orden nueva decide con naceAprobada, no con una expresión suelta", () => {
    expect(modal).toContain("const cuentaPideAprobacion = cuentaRequiereAprobacion(settings.accounts, d.account);");
    const desde = modal.indexOf("const autoApprove = naceAprobada(");
    expect(desde).toBeGreaterThan(-1);
    expect(modal.slice(desde, modal.indexOf("const payload", desde))).toContain("cuentaPideAprobacion");
    // Y el botón sale de la MISMA decisión, no de una copia con otras condiciones. Se mira el
    // texto del botón entero: un mutante que colara `(ordersLikeOfficeManager(...) || storeAuto…)`
    // DELANTE de `naceAprobada` pasaba una prueba que solo contaba apariciones.
    const boton = modal.slice(modal.indexOf("}}>{", modal.indexOf("const autoApprove = naceAprobada(")));
    const etiqueta = boton.slice(0, boton.indexOf("</button>"));
    // Lo PRIMERO que decide la etiqueta es `naceAprobada`. Que dentro se le pase `storeAutoApprove`
    // está bien —es uno de sus datos—; lo que no puede haber es otra condición por delante.
    expect(etiqueta.trimStart().startsWith("}}>{!naceAprobada({")).toBe(true);
    expect((modal.match(/naceAprobada\(\{/g) ?? []).length).toBe(2);
  });

  it("el admin puede marcar la cuenta en Datos", () => {
    expect(datos).toContain('t("Office approval", "Aprobación de oficina")');
    expect(datos).toContain("update(i, { requires_approval: e.target.checked })");
  });

  it("y guardar las cuentas ya no se lleva por delante lo que no enseña", () => {
    // Lo medido: `commit` reconstruía cada cuenta con solo los campos del formulario, así que
    // guardar la tabla borraba `address`, que se rellena al elegir la cuenta en una orden.
    const commit = datos.slice(datos.indexOf("const accounts = rows"), datos.indexOf("save({ accounts }"));
    expect(commit).toContain("...r.resto");
    expect(datos).toContain("resto: a,");
  });
});
