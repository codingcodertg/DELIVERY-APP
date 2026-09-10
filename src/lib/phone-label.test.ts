import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

// Pedido del dueño, literal y en mayúsculas: «SALE NUMBER PERO TIENE QUE DECIR PHONE NUMBER».
// El campo del teléfono en la ficha de pedido se etiquetaba «Number» / «Número» a secas, debajo
// de «Contact name», en una pantalla que también maneja número de orden, de factura y de SO.

const leer = (r: string) => readFileSync(join(process.cwd(), r), "utf8");

const norm = (s: string) => s.split("\\").join("/");
const RAIZ = norm(process.cwd());
const tsx: string[] = [];
const recorre = (dir: string) => {
  for (const f of readdirSync(dir)) {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) recorre(p);
    else if (f.endsWith(".tsx")) tsx.push(norm(p).replace(RAIZ + "/", ""));
  }
};
recorre(join(process.cwd(), "src"));

describe("la etiqueta del teléfono en la ficha de pedido", () => {
  const modal = leer("src/components/OrderModal.tsx");

  it("dice «Phone number», en los dos idiomas y en el mismo `t(...)`", () => {
    // La pantalla no tiene diccionario de claves: cada texto lleva sus dos idiomas en línea.
    expect(modal).toContain('label={t("Phone number", "Número de teléfono")} val={d.delivery_phone}');
  });
  it("y el par no queda cojo: si el inglés se hace específico, el español también", () => {
    // `t("Phone number", "Número")` habría dejado al español diciendo menos que al inglés.
    expect(modal).not.toContain('t("Phone number", "Número")');
  });
  it("ya no queda ningún «Number» a secas en TODO el repo", () => {
    // Era el único, y es lo que hacía ambiguo el campo: «Number» ahí podía leerse como el número
    // de la orden tanto como el del teléfono.
    const conNumber = tsx.filter((r) => leer(r).includes('t("Number"'));
    expect(conNumber).toEqual([]);
  });
});

describe("el vocabulario que ya había, para que la elección conste", () => {
  it("«Phone» / «Teléfono» aparece en 10 sitios — 4 son columnas y 2 etiquetas de campo", () => {
    // Patrón EXACTO a propósito. Uno amplio arrastra «Phone call», «Phone interview» y compañía,
    // que no son este campo — y da otro número según cómo de amplio sea: el mismo día, dos
    // sesiones midieron 17 y 41 con patrones distintos y **las dos tenían razón**, porque medían
    // cosas distintas. Un número sin su comando al lado vuelve a bailar en cuanto alguien lo
    // recuente. El de aquí se reproduce así:
    //   grep -rn 't("Phone", "Teléfono")' --include=*.tsx src | wc -l
    const ocurrencias = tsx.reduce(
      (n, r) => n + (leer(r).match(/t\("Phone", "Teléfono"\)/g) ?? []).length, 0);
    expect(
      ocurrencias,
      "Si has añadido una etiqueta de teléfono legítima, sube este número A CONCIENCIA: el canario " +
      "existe para que la decisión de llamarlo de otra forma se tome mirando, no por inercia. " +
      "Ver la nota de arriba y la entrada de la decisión.",
    ).toBe(10);
  });
  it("y no todas son cabeceras de tabla: dos son etiquetas de formulario con su campo", () => {
    // Es el dato que decide cómo se plantea la elección. Se comprobó porque la primera versión
    // del inventario decía «casi todas son columnas», y no era cierto.
    expect(leer("src/app/(app)/accounts/page.tsx"))
      .toContain('<label>{t("Phone", "Teléfono")}</label><input value={form.phone}');
    expect(leer("src/components/recruiting/ModalHost.tsx"))
      .toContain('<label>{t("Phone", "Teléfono")}</label><input value={f.phone}');
  });
  it("así que «Phone number» es una forma NUEVA, y entra a sabiendas", () => {
    // No se unifica el resto: los otros diez no tienen el problema que tiene este.
    const conPhoneNumber = tsx.filter((r) => leer(r).includes('t("Phone number"'));
    expect(conPhoneNumber).toEqual(["src/components/OrderModal.tsx"]);
  });
});
