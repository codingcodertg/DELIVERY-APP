import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { rondaDeEntrada, tiendasSinGrupoDePromos } from "./entrada";
import type { NamedLocation } from "@/lib/types";

/**
 * Entrar directo a la tabla (D-NEXT). El dueño mandó la captura de la lista de rondas: «esto
 * elimínalo, que entre directo a la tabla».
 */

const leer = (rel: string) => readFileSync(join(process.cwd(), rel), "utf8").replace(/\r\n/g, "\n");
const plano = (s: string) => s.replace(/\s+/g, " ");
const r = (id: string, uploaded_at: string, closed_at: string | null = null) => ({ id, uploaded_at, closed_at });

describe("a qué ronda se entra", () => {
  it("a la más reciente ABIERTA, aunque haya una cerrada más nueva", () => {
    // El día que se sube la ronda de octubre sin haber cerrado la de septiembre, y al revés.
    const rondas = [r("cerrada-nueva", "2026-10-01T00:00:00Z", "2026-10-02T00:00:00Z"), r("abierta", "2026-09-01T00:00:00Z")];
    expect(rondaDeEntrada(rondas)?.id).toBe("abierta");
  });
  it("entre dos abiertas, la más nueva", () => {
    expect(rondaDeEntrada([r("vieja", "2026-08-01T00:00:00Z"), r("nueva", "2026-09-01T00:00:00Z")])?.id).toBe("nueva");
  });
  it("si todas están cerradas, la más reciente: es mirar, pero es a algo", () => {
    const rondas = [r("a", "2026-08-01T00:00:00Z", "2026-08-09T00:00:00Z"), r("b", "2026-09-01T00:00:00Z", "2026-09-09T00:00:00Z")];
    expect(rondaDeEntrada(rondas)?.id).toBe("b");
  });
  it("sin rondas, null — y eso NO redirige a ningún sitio", () => {
    // Un redirect en el camino del error es como se hace un bucle: sin filas se pinta un mensaje.
    expect(rondaDeEntrada([])).toBe(null);
  });
  it("no se fía del orden en que llegan: ordena ella", () => {
    // La consulta ordena por `uploaded_at` descendente, pero eso vive en otro fichero y se puede
    // cambiar sin mirar aquí. Se le pasan al revés a propósito.
    const alReves = [r("vieja", "2026-01-01T00:00:00Z"), r("media", "2026-05-01T00:00:00Z"), r("nueva", "2026-09-01T00:00:00Z")];
    expect(rondaDeEntrada(alReves)?.id).toBe("nueva");
    expect(rondaDeEntrada([...alReves].reverse())?.id).toBe("nueva");
  });
});

describe("el aviso de los grupos de tienda", () => {
  const tienda = (name: string, promo_group?: string) => ({ name, address: "", promo_group }) as unknown as NamedLocation;
  it("no dice nada cuando están todos puestos, que es el caso de hoy", () => {
    expect(tiendasSinGrupoDePromos([tienda("McAllen", "RGV"), tienda("Pharr", "RGV")])).toEqual([]);
  });
  it("nombra las que faltan, que es lo que hace falta para arreglarlo", () => {
    expect(tiendasSinGrupoDePromos([tienda("McAllen", "RGV"), tienda("Pharr"), tienda("Mission", "  ")]))
      .toEqual(["Pharr", "Mission"]);
  });
  it("una tienda sin nombre no se cuenta: no se podría ir a arreglarla", () => {
    expect(tiendasSinGrupoDePromos([tienda(""), tienda("  ")])).toEqual([]);
  });
});

describe("la pantalla: /promos es una puerta, no una lista", () => {
  const indice = leer("src/app/promos/page.tsx");
  it("redirige a la ronda que decide `rondaDeEntrada`, en la base y en el demo", () => {
    expect(indice).toContain('import { rondaDeEntrada } from "@/lib/promos/entrada";');
    expect((indice.match(/redirect\(`\/promos\/\$\{destino\.id\}`\)/g) ?? []).length).toBe(2);
    expect(indice).toContain("if (SIN_BASE) {");
  });
  it("ya no hay lista de rondas ni el renglón que el dueño mandó quitar", () => {
    expect(indice).not.toContain("Toca una ronda");
    expect(indice).not.toContain("<table");
    expect(indice).not.toMatch(/Rondas \/ Round/);
  });
  it("sin rondas se pinta un mensaje, y dice las DOS razones por las que puede estar vacío", () => {
    // Cero filas es «no se ha subido ninguna» o «no tienes el módulo»: la RLS de la 140 devuelve lo
    // mismo en los dos casos, así que prometer que subiendo un Excel se arregla sería mentir a la
    // mitad de quien lo lea.
    expect(indice).toContain("function SinRondas()");
    expect(plano(indice)).toContain("no tienes el módulo de promociones habilitado");
    expect(plano(indice)).toContain("you don&apos;t have the promos module enabled");
  });
  it("sigue sin tocar `promo_products`, y ahora pide menos aún", () => {
    // El nombre SI aparece, en el comentario que explica por que no se consulta: lo que no puede
    // aparecer es la consulta. Un `not.toContain("promo_products")` a secas prohibiria explicarlo.
    expect(indice).not.toContain('from("promo_products")');
    expect(indice).toContain('.from("promo_rounds")');
    expect(indice).toContain('.select("id, uploaded_at, closed_at")');
  });
});

describe("la pantalla: el selector de ronda vive dentro de la tabla", () => {
  const tabla = leer("src/app/promos/[id]/TablaDeRonda.tsx");
  const pagina = leer("src/app/promos/[id]/page.tsx");
  it("no se pierde el acceso a una ronda vieja: hay selector y navega a la suya", () => {
    expect(plano(tabla)).toContain("{rondas.length > 1 && (");
    expect(plano(tabla)).toContain("onChange={(e) => { if (e.target.value !== ronda.id) router.push(`/promos/${e.target.value}`); }}");
  });
  it("con una sola ronda NO sale: un desplegable de un elemento es el clic que se mandó quitar", () => {
    expect(tabla).toContain("rondas.length > 1");
    expect(tabla).not.toContain("rondas.length > 0 && (");
  });
  it("la página le pasa todas las rondas, y el demo también", () => {
    expect(pagina).toContain('.from("promo_rounds")');
    expect(plano(pagina)).toContain("rondas={(todasLasRondas ?? [])");
    expect(leer("src/app/promos/[id]/RondaDemo.tsx")).toContain("rondas={RONDAS_DEMO}");
  });
  it("y se fue el enlace «← RTG PROMOS», que ahora volvería a redirigir aquí mismo", () => {
    expect(pagina).not.toContain("RTG PROMOS</Link>");
    expect(pagina).not.toContain('from "next/link"');
  });
});

describe("la pantalla: el aviso de grupos solo cuando hace falta", () => {
  const tabla = leer("src/app/promos/[id]/TablaDeRonda.tsx");
  it("solo al admin y solo si falta alguno", () => {
    expect(plano(tabla)).toContain("{esAdmin && tiendasSinGrupo.length > 0 && (");
  });
  it("ya no está en la raíz, que era donde se enseñaba siempre", () => {
    expect(leer("src/app/promos/page.tsx")).not.toContain("promo group");
    expect(leer("src/app/promos/page.tsx")).not.toContain("grupo de promociones");
  });
});

describe("la pantalla: los botones de decidir se ven", () => {
  const tabla = leer("src/app/promos/[id]/TablaDeRonda.tsx");
  it("aprobar en VERDE y rechazar en ROJO, en cada fila", () => {
    // Antes eran un ✓ y una ✕ sin clase: 10 × 17 px y fondo transparente, medido en el navegador.
    // Ahora 29 × 26 con `btn-green`. El color es lo que distingue las dos acciones de la pantalla.
    expect(tabla).toContain('className="btn btn-sm btn-green" disabled={ocupado || f.estado === "approved"}');
    expect(tabla).toContain('className="btn btn-sm btn-danger" disabled={ocupado || f.estado === "rejected"}');
  });
  it("y lo mismo en la barra de bloque, donde aprobar era el azul de `primary`", () => {
    expect(tabla).toContain('<button className="btn btn-green" disabled={ocupado} onClick={() => guarda([...seleccion], "approved")}>');
    expect(tabla).toContain('<button className="btn btn-danger" disabled={ocupado} onClick={() => guarda([...seleccion], "rejected")}>');
    // Ya no queda ningún `primary` en la barra: era lo que hacía que aprobar fuera azul.
    expect(tabla).not.toContain('className="primary" disabled={ocupado}');
  });
  it("dejar pendiente y limpiar se quedan neutros: deshacer no es una tercera decisión", () => {
    expect(tabla).toContain('<button className="btn btn-ghost" disabled={ocupado} onClick={() => guarda([...seleccion], "pending")}>');
    expect(tabla).toContain('<button className="btn btn-ghost" onClick={() => setSeleccion(new Set())}>');
  });
  it("el color sale de la paleta, no de un hex suelto en el componente", () => {
    // `btn-green` y `btn-danger` viven en globals.css y salen de --green y --red. Un hex aquí
    // sobreviviría a un cambio de paleta y se quedaría desparejado sin que nadie lo notara.
    const css = leer("src/app/globals.css");
    expect(css).toContain(".btn-green { background: #e5f6ee; color: var(--green); }");
    expect(css).toContain(".btn-danger { background: #fdeaea; color: var(--red); }");
    const cuerpo = tabla.slice(tabla.indexOf("return ("));
    expect(cuerpo).not.toMatch(/#[0-9a-fA-F]{6}/);
  });
  it("siguen siendo ACCESIBLES sin leer el símbolo: title y aria-label", () => {
    // Un ✓ de color no dice nada a quien usa lector de pantalla, y el color tampoco a quien no lo
    // distingue. El nombre va aparte del símbolo.
    expect(tabla).toContain('title={t("Approve", "Aprobar")} aria-label={t("Approve", "Aprobar")}');
    expect(tabla).toContain('title={t("Reject", "Rechazar")} aria-label={t("Reject", "Rechazar")}');
  });
});
