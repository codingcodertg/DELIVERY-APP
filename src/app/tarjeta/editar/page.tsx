import type { Metadata } from "next";
import { EditorDeTarjeta } from "@/components/tarjetas/EditorDeTarjeta";
import { tarjetaPorToken } from "@/lib/tarjetas/servidor";
import { tokenValido } from "@/lib/tarjetas/token";
import { TEXTOS } from "@/lib/tarjetas/textos";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Rodriguez Tile Group", robots: { index: false, follow: false } };

/** El editor de la foto y la portada por enlace privado (`?token=`). El token no se muestra en la página ni se guarda. */
export default async function EditarTarjetaPage({ searchParams }: { searchParams: Promise<{ token?: string | string[] }> }) {
  const { token: crudo } = await searchParams;
  const token = (Array.isArray(crudo) ? crudo[0] : crudo) ?? "";
  const tarjeta = tokenValido(token) ? await tarjetaPorToken(token) : null;
  if (!tarjeta) {
    return (
      <div className="te">
        <div className="panel">
          <section>
            <h1>{TEXTOS.es.editBadLink}</h1>
            <p className="sub" style={{ marginTop: 10 }}>{TEXTOS.en.editBadLink}. Pide tu enlace al administrador · Ask the admin for your link.</p>
          </section>
        </div>
      </div>
    );
  }
  return <EditorDeTarjeta token={token} tarjeta={tarjeta} />;
}
