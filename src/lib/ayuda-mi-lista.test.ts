import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

// «Mis solicitudes» (/home/ayuda) y «Solicitudes de ayuda» (/home/solicitudes-de-ayuda), 2026-11-24. Roberto pidió:
// el estado delante, la fecha a la derecha con el texto ocupando el hueco, una 📷 para la foto, pulsar el texto
// para abrir el hilo (sin botón «Abrir»), y la casita a la izquierda en las dos pantallas.

const leer = (p: string) => readFileSync(p, "utf8").replace(/\r\n/g, "\n");

describe("Mis solicitudes: la fila", () => {
  const pagina = leer("src/app/home/ayuda/page.tsx");

  it("ya no hay botón «Abrir» / «Ocultar»: el texto de la solicitud es el que abre el hilo", () => {
    expect(pagina).not.toContain('t("Open", "Abrir")');
    expect(pagina).not.toContain('t("Hide", "Ocultar")');
    expect(pagina).toContain("data-abrir-solicitud");
    expect(pagina).toContain("aria-expanded={abiertaEsta}");
  });

  it("el estado (Abierta / Atendida) va antes que el texto del mensaje", () => {
    const estado = pagina.indexOf('t("Handled", "Atendida")');
    const texto = pagina.indexOf("asomoDelMensaje(s.message, 300)");
    expect(estado).toBeGreaterThan(0);
    expect(texto).toBeGreaterThan(0);
    expect(estado).toBeLessThan(texto);
  });

  it("la fecha va después del texto, y la 📷 con data-ver-foto antes de Eliminar", () => {
    const texto = pagina.indexOf("asomoDelMensaje(s.message, 300)");
    const fecha = pagina.indexOf("{fecha(s.created_at)}");
    const foto = pagina.indexOf("data-ver-foto");
    const eliminar = pagina.indexOf("data-eliminar-solicitud");
    expect(texto).toBeLessThan(fecha);
    expect(fecha).toBeLessThan(foto);
    expect(foto).toBeLessThan(eliminar);
  });

  it("la 📷 no abre el hilo a la vez (stopPropagation) y la modal se cierra con ✕, fondo y Escape", () => {
    expect(pagina).toContain("e.stopPropagation(); void abreFotos(s);");
    expect(pagina).toContain('data-ver-fotos onClick={cierraFotos}');
    expect(pagina).toContain('if (e.key === "Escape") cierraFotos();');
    expect(pagina).toContain("createSignedUrl(a.path, VALIDEZ_AL_VER)");
  });
});

describe("casita a la izquierda, justo después del título", () => {
  it("en «Mis solicitudes» y en «Solicitudes de ayuda», <BotonCasa /> va justo tras el </h2>", () => {
    for (const ruta of ["src/app/home/ayuda/page.tsx", "src/app/home/solicitudes-de-ayuda/page.tsx"]) {
      expect(leer(ruta), ruta).toMatch(/<\/h2>\n\s*<BotonCasa \/>\n/);
    }
  });

  it("la cabecera de esas dos pantallas lleva el modificador que la alinea a la izquierda", () => {
    expect(leer("src/app/home/ayuda/page.tsx")).toContain('className="page-head page-head-casa-izq"');
    expect(leer("src/app/home/solicitudes-de-ayuda/page.tsx")).toContain('className="page-head page-head-casa-izq"');
  });
});
