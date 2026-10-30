import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/** Mi perfil y Personalizar se abren como tarjeta encima del hub, no en otra pantalla (D-765). */

const leer = (r: string) => readFileSync(join(process.cwd(), r), "utf8").split("\r\n").join("\n");
const sinComentarios = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

describe("el hub", () => {
  const hub = sinComentarios(leer("src/components/HomeSelector.tsx"));
  it("el clic en Mi perfil o Personalizar abre la tarjeta y no navega; el enlace conserva su ruta", () => {
    expect(hub).toContain('<Link href="/home/profile" className="hub-profile-link" data-hub-perfil onClick={abre("perfil")}>');
    expect(hub).toContain('<Link href={RUTA_PERSONALIZAR} className="hub-profile-link" data-hub-personalizar onClick={abre("personalizar")}>');
    expect(hub).toContain("(e: React.MouseEvent) => { e.preventDefault(); setTarjeta(cual); }");
  });
  it("la tarjeta es el velo y el modal de siempre, con Mi perfil o Personalizar dentro, y se cierra con el velo, Escape o su botón", () => {
    expect(hub).toContain('<div className="overlay" data-hub-tarjeta={tarjeta} onClick={() => setTarjeta(null)}>');
    expect(hub).toContain('<div className="modal hub-tarjeta" role="dialog" aria-modal="true" style={{ maxWidth: 560 }} onClick={(e) => e.stopPropagation()}>');
    expect(hub).toContain("<ProfileView id={me.id} nombre={me.full_name} correo={cuenta?.correo ?? null} usuario={cuenta?.usuario ?? null} onCerrar={() => setTarjeta(null)} onPersonalizar={() => setTarjeta(\"personalizar\")} />");
    expect(hub).toContain("<Personalizador onCerrar={() => setTarjeta(null)} />");
    expect(hub).toContain('if (e.key === "Escape") setTarjeta(null);');
  });
  it("el servidor manda lo que Mi perfil enseña: correo o usuario, por identidadVisible", () => {
    const p = sinComentarios(leer("src/app/home/page.tsx"));
    expect(p).toContain('.select("id, full_name, role, module_access, username")');
    expect(p).toContain("const cuenta = identidadVisible({ email: user.email, username: me.username });");
    expect(p).toContain("<HomeSelector me={me} suplantando={suplantando} cuenta={cuenta} />");
  });
});

describe("los dos componentes", () => {
  it("en tarjeta enseñan «Cerrar»; en su página, «Volver al hub»", () => {
    for (const f of ["src/components/profile/ProfileView.tsx", "src/components/profile/Personalizador.tsx"]) {
      const c = sinComentarios(leer(f));
      expect(c, f).toContain('? <button type="button" className="btn btn-ghost btn-sm" data-cerrar-tarjeta onClick={onCerrar}>{t("Close", "Cerrar")}</button>');
      expect(c, f).toContain(': <Link href="/home" className="btn btn-ghost btn-sm">{t("Back to hub", "Volver al hub")}</Link>}');
    }
  });
  it("sus páginas siguen existiendo (menú del nombre en cada app, TabGate)", () => {
    expect(leer("src/app/home/profile/page.tsx")).toContain("<ProfileView id=");
    expect(leer("src/app/home/personalizar/page.tsx")).toContain("<Personalizador />");
  });
});
