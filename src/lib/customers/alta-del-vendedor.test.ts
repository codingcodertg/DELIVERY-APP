import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { erroresDeContactos, enEdicion, parcheDeContactos, type ContactoEnEdicion } from "./contactos";
import { almacenDemoNuevo } from "./demo";
import { faltanEnElAlta } from "./obligatorios";
import {
  avisoDeErrores, CAMPOS, dondeEstaElError, filasPorGrupo, filasPorGrupoQueVe, formDe, parcheDe, veElCampo, veElGrupo, type QuienVeLaFicha,
} from "./reglas";
import { cuerpoDeSolicitud } from "./solicitud-de-cliente";

/**
 * D-858 · El dueño, 2026-11-04: «como el usuario de sales quiero agregar la solicitud de un nuevo cliente; lleno todo lo
 * que está en rojo y no me deja guardar».
 *
 * Causa: D-772 hizo obligatorios los «Términos» en todo alta, y D-728 esconde al vendedor la tarjeta «Crédito y términos»
 * donde están. El vendedor llenaba lo rojo (nombre de la cuenta, nombre, cargo y teléfono o correo del contacto 1) y
 * «Enviar solicitud» seguía diciendo «Revisa los campos marcados», sin nada marcado a la vista. Medido en producción
 * (solo lectura, 2026-11-04): `erp.customer_requests` tiene 0 filas, con 15 vendedores con el módulo.
 *
 * Y lo que ve el vendedor en el alta: sin «Estado e historial»; de «Cuenta», solo «Vendedor de comisión»; «Contacto»
 * igual; de «Otros», todo menos el tipo CRM.
 */

const leer = (r: string) => readFileSync(join(process.cwd(), r), "utf8").split("\r\n").join("\n");
const t = (_en: string, es: string) => es;
const vendedorEnElAlta: QuienVeLaFicha = { esVendedor: true, alta: true };
const seVePara = (q: QuienVeLaFicha) => (k: string) => veElCampo(k, q);

/** Lo que la ventana del alta calcula al pulsar «Enviar solicitud» (`FichaEnVentana`: `parcheDe` + contactos + obligatorios). */
function erroresDelAlta(form: Record<string, string>, contactos: ContactoEnEdicion[], q: QuienVeLaFicha, solicitud: boolean): string[] {
  return [...parcheDe(form, formDe(null), true).errores, ...erroresDeContactos(contactos), ...faltanEnElAlta(form, contactos, solicitud, seVePara(q))];
}

/** El alta del vendedor como sale de la ficha: su tienda y él como vendedor (D-740/D-767), y lo que está en rojo, lleno. */
const formDelVendedor = { ...formDe(null), rep_id: "vendedor-1", store: "MCA", account: "TEST VENDEDOR TILE" };
const contactoLleno: ContactoEnEdicion[] = [{ ...enEdicion([])[0], name: "Omar Garza", title: "Owner", phones: ["(956) 261-4318"], emails: [""] }];

describe("el alta del vendedor se puede mandar", () => {
  it("con todo lo rojo lleno, no queda ningún error (antes: «terms», en una tarjeta que el vendedor no ve)", () => {
    expect(erroresDelAlta(formDelVendedor, contactoLleno, vendedorEnElAlta, true)).toEqual([]);
  });

  it("todo lo que se le exige al vendedor lo tiene a la vista", () => {
    const exigido = erroresDelAlta({ ...formDe(null), rep_id: "vendedor-1" }, enEdicion([]), vendedorEnElAlta, true);
    expect(exigido.length).toBeGreaterThan(0);
    for (const k of exigido) expect(veElCampo(k, vendedorEnElAlta), k).toBe(true);
    expect(exigido).not.toContain("terms");
  });

  it("y la solicitud que sale es la que la 216 acepta: cuenta no vacía y su tienda", async () => {
    const parche = { ...parcheDe(formDelVendedor, formDe(null), true).parche, ...parcheDeContactos([], contactoLleno, null) };
    const cuerpo = cuerpoDeSolicitud(parche, ["MCA"]);
    expect(String(cuerpo.payload.account).trim()).not.toBe("");
    expect(cuerpo.payload.rep_id).toBe("vendedor-1");
    expect(cuerpo.stores).toEqual(["MCA"]);
    const sql = leer("supabase/migrations/216_solicitudes_de_cliente.sql");
    expect(sql).toContain("length(btrim(coalesce(payload->>'account', ''))) > 0");
    expect(sql).not.toMatch(/payload->>'terms'/);
    const r = await almacenDemoNuevo().solicitarAlta(parche, ["MCA"]);
    expect(r.ok).toBe(true);
  });

  it("al admin (alta directa), al gerente y a la oficina se les siguen exigiendo los términos", () => {
    for (const q of [{ esVendedor: false, alta: true }]) {
      expect(erroresDelAlta(formDelVendedor, contactoLleno, q, false)).toContain("terms");
      expect(erroresDelAlta(formDelVendedor, contactoLleno, q, true)).toEqual(["terms"]);
    }
  });
});

describe("el aviso dice qué falta y dónde", () => {
  it("con el campo y su tarjeta, también lo que no está a la vista", () => {
    expect(dondeEstaElError("terms", t)).toBe("Términos (Crédito y términos)");
    expect(dondeEstaElError("contacto.0.name", t)).toBe("Nombre (Contacto 1)");
    expect(dondeEstaElError("contacto.1.phones.0", t)).toBe("Teléfono (Contacto 2)");
    expect(dondeEstaElError("account", t)).toBe("Nombre de la cuenta (arriba)");
    expect(avisoDeErrores(["contacto.0.name", "contacto.0.title", "contacto.0.name"], t)).toBe("Falta o está mal: Nombre (Contacto 1) · Cargo (Contacto 1)");
    // Sin teléfono ni correo, se marcan los dos, pero basta con uno: el aviso lo dice así.
    expect(avisoDeErrores(["contacto.0.phones.0", "contacto.0.emails.0"], t)).toBe("Falta o está mal: Teléfono o correo (Contacto 1)");
    // Un correo mal escrito, solo, es un correo.
    expect(avisoDeErrores(["contacto.0.emails.0"], t)).toBe("Falta o está mal: Correo (Contacto 1)");
    // Lo que no se ve también se nombra, con su tarjeta (nunca un aviso mudo).
    expect(avisoDeErrores(["terms"], t)).toBe("Falta o está mal: Términos (Crédito y términos)");
  });
  it("la ficha lo usa en vez de «Revisa los campos marcados» y pasa al obligatorio lo que se ve", () => {
    const ficha = leer("src/app/customers/FichaDeCliente.tsx");
    expect(ficha).toContain("setAviso({ tono: \"rojo\", texto: avisoDeErrores(errores, t) });");
    expect(ficha).not.toContain("\"Check the highlighted fields.\", \"Revisa los campos marcados.\"");
    expect(ficha).toContain("faltanEnElAlta(form, contactos, altaComoSolicitud, (k) => veElCampo(k, { esVendedor, alta: true }))");
  });
});

describe("lo que ve el vendedor en el alta", () => {
  const tarjetas = (q: QuienVeLaFicha) => Object.fromEntries(filasPorGrupoQueVe(q).map((g) => [g.grupo.key, g.filas.map((f) => f.key)]));

  it("sin «Estado e historial» ni «Crédito y términos»; «Cuenta» solo con «Vendedor de comisión»; «Otros» sin tipo CRM", () => {
    const v = tarjetas(vendedorEnElAlta);
    expect(Object.keys(v)).toEqual(["cuenta", "contacto", "otros"]);
    // `account` es la línea de solo lectura con el nombre: en el alta no se pinta (el nombre se escribe arriba).
    expect(v.cuenta).toEqual(["account", "rep_id"]);
    expect(v.contacto).toEqual(tarjetas({ esVendedor: false, alta: true }).contacto);
    expect(v.otros).toEqual(["associated_with", "activity_status", "notes"]);
    expect(veElGrupo("ocultos", vendedorEnElAlta)).toBe(false);
  });

  it("al ver o editar un cliente que ya existe, el vendedor ve lo de antes (solo sin crédito, D-728)", () => {
    const antes = filasPorGrupo().filter((g) => g.grupo.key !== "credito").map((g) => [g.grupo.key, g.filas.map((f) => f.key)]);
    expect(Object.entries(tarjetas({ esVendedor: true, alta: false }))).toEqual(antes);
  });

  it("admin, gerente y oficina (no vendedores) ven todo, en el alta y fuera", () => {
    const todo = Object.fromEntries(filasPorGrupo().map((g) => [g.grupo.key, g.filas.map((f) => f.key)]));
    expect(tarjetas({ esVendedor: false, alta: true })).toEqual(todo);
    expect(tarjetas({ esVendedor: false, alta: false })).toEqual(todo);
    for (const c of CAMPOS) expect(veElCampo(c.key, { esVendedor: false, alta: true })).toBe(true);
  });

  it("la ficha pinta las tarjetas con esa regla", () => {
    const ficha = leer("src/app/customers/FichaDeCliente.tsx");
    expect(ficha).toContain("filasPorGrupoQueVe({ esVendedor, alta: cliente === null }).filter(({ grupo }) => claves.includes(grupo.key))");
  });
});
