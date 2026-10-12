import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

// ============================================================
// D-523 · La cámara del recibo de gasolina. El dueño, 2026-10-11: «gas stop add the option for the camera of the
// receipt». Dos cosas: «📷 Cámara» y «🖼 Galería» por separado, y la foto ya al registrar la parada (opcional), que
// «▶ Seguir» trae puesta.
// ============================================================

vi.mock("@/lib/data-provider", () => ({ useData: () => ({ teaching: false, notify: () => {} }) }));
vi.mock("@/lib/prefs", () => ({ usePrefs: () => ({ t: (en: string) => en, lang: "en" }) }));

const leer = (r: string) => readFileSync(join(process.cwd(), r), "utf8").split("\r\n").join("\n");
const t = (en: string) => en;
const FOTO = "data:image/jpeg;base64,AAAA";

describe("PhotoUpload con `galeria`: cámara y galería, dos botones", () => {
  it("con `galeria`: «Camera» abre la entrada con `capture`, «Gallery» otra SIN `capture`", async () => {
    const { PhotoUpload } = await import("@/components/PhotoUpload");
    const html = renderToStaticMarkup(createElement(PhotoUpload, { photos: [], onChange: () => {}, t, max: 1, galeria: true }));
    expect(html).toMatch(/data-foto-camara=""[^>]*>📷<span>Camera<\/span>/);
    expect(html).toMatch(/data-foto-galeria="true">🖼<span>Gallery<\/span>/);
    const entradas = html.match(/<input[^>]*>/g) ?? [];
    expect(entradas).toHaveLength(2);
    expect(entradas.filter((e) => e.includes('capture="environment"'))).toHaveLength(1);
    expect(entradas.find((e) => e.includes("data-entrada-galeria"))).not.toContain("capture");
  });

  it("sin `galeria` queda como siempre: un solo «Add photo» que abre la cámara", async () => {
    const { PhotoUpload } = await import("@/components/PhotoUpload");
    const html = renderToStaticMarkup(createElement(PhotoUpload, { photos: [], onChange: () => {}, t }));
    expect(html).toContain("📷<span>Add photo</span>");
    expect(html).not.toContain("data-foto-galeria");
    expect(html.match(/<input[^>]*>/g)).toHaveLength(1);
  });

  it("con la foto ya puesta (máximo 1), ni cámara ni galería", async () => {
    const { PhotoUpload } = await import("@/components/PhotoUpload");
    const html = renderToStaticMarkup(createElement(PhotoUpload, { photos: [FOTO], onChange: () => {}, t, max: 1, galeria: true }));
    expect(html).not.toContain("data-foto-camara");
    expect(html).not.toContain("data-foto-galeria");
  });
});

describe("«▶ Seguir» trae la foto que tomó al registrar la parada", () => {
  it("con foto ya tomada: sale puesta, sin «No tengo recibo», y «Seguir» encendido", async () => {
    const { DialogoDeRecibo } = await import("@/components/PausaDelChofer");
    const html = renderToStaticMarkup(createElement(DialogoDeRecibo, { t, ocupado: false, error: null, fotoYaTomada: FOTO, onCancelar: () => {}, onConfirmar: () => {} }));
    expect(html).toContain(`src="${FOTO}"`);
    expect(html).not.toContain("data-sin-recibo");
    expect(html).toMatch(/<button data-confirmar-recibo="true"[^>]*>/);
    expect(html.match(/<button data-confirmar-recibo="true"[^>]*>/)![0]).not.toContain("disabled");
  });

  it("sin foto: cámara y galería, «No tengo recibo», y «Seguir» apagado", async () => {
    const { DialogoDeRecibo } = await import("@/components/PausaDelChofer");
    const html = renderToStaticMarkup(createElement(DialogoDeRecibo, { t, ocupado: false, error: null, fotoYaTomada: null, onCancelar: () => {}, onConfirmar: () => {} }));
    expect(html).toContain("data-foto-camara");
    expect(html).toContain("data-foto-galeria");
    expect(html).toContain("data-sin-recibo");
    expect(html.match(/<button data-confirmar-recibo="true"[^>]*>/)![0]).toContain("disabled");
  });
});

describe("al registrar la parada de gasolina", () => {
  const c = leer("src/components/PausaDelChofer.tsx");
  const h = leer("src/lib/usePausasDelChofer.ts");

  it("el cuadro enseña la foto del recibo solo si el motivo pide recibo, con cámara y galería", () => {
    expect(c).toContain("{motivo && pideRecibo(motivo) && (");
    expect(c).toContain("<PhotoUpload photos={fotos} onChange={(n) => setFotos(n.slice(0, 1))} max={1} t={t} disabled={ocupado} galeria />");
    expect(c).toContain("onConfirmar(inicio.motivo, inicio.nota, fotos[0] ?? null)");
  });

  it("la foto se guarda al empezar, y solo en la de gasolina (la base no la admite en otra)", () => {
    expect(c).toContain("const r = await empezar({ motivo, nota, recibo_foto: pideRecibo(motivo) ? foto : null }, gps);");
    expect(h).toContain(".insert({ driver_id: driverId, ...inicio, recibo_foto: inicio.recibo_foto ?? null, ...ubicacion })");
    expect(h).toContain("recibo_foto: inicio.recibo_foto ?? null, recibo_monto: null");
  });

  it("«Seguir» le pasa al recibo la foto de la parada abierta, y el recibo usa cámara y galería", () => {
    expect(c).toContain("fotoYaTomada={abierta.recibo_foto}");
    expect(c).toContain("useState<string[]>(fotoYaTomada ? [fotoYaTomada] : [])");
    expect(c).toContain("max={1} t={t} disabled={ocupado} galeria />\n        </div>\n        <div style={{ display: \"flex\", gap: 8, marginTop: 10 }}>");
  });
});
