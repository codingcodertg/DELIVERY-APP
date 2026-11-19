import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { TarjetaPublica } from "@/components/tarjetas/TarjetaPublica";
import { tarjetaPublicaPorSlug } from "@/lib/tarjetas/servidor";
import { ORIGEN_DE_TARJETAS } from "@/lib/tarjetas/host";
import { MARCA } from "@/lib/tarjetas/datos";

export const dynamic = "force-dynamic";

type Params = Promise<{ slug: string }>;

/** Título, descripción y Open Graph propios de cada persona: nombre, rol y foto. Sin datos internos. */
export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { slug } = await params;
  const t = await tarjetaPublicaPorSlug(slug);
  if (!t) return { title: MARCA.nombre, robots: { index: false, follow: false } };
  const rol = t.rolEn || t.rolEs;
  const titulo = `${t.nombre} · ${MARCA.nombre}`;
  const descripcion = rol ? `${t.nombre} · ${rol} · ${MARCA.nombre}` : titulo;
  const url = `${ORIGEN_DE_TARJETAS}/${t.slug}`;
  return {
    title: titulo,
    description: descripcion,
    robots: { index: false, follow: false },
    alternates: { canonical: url },
    openGraph: {
      title: titulo,
      description: descripcion,
      url,
      siteName: MARCA.nombre,
      type: "profile",
      images: t.fotoUrl ? [{ url: t.fotoUrl, alt: t.nombre }] : undefined,
    },
  };
}

export default async function TarjetaPage({ params }: { params: Params }) {
  const { slug } = await params;
  const t = await tarjetaPublicaPorSlug(slug);
  if (!t) notFound();
  return <TarjetaPublica tarjeta={t} />;
}
