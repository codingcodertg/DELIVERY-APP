import { VistaMovil } from "@/components/VistaMovil";
import { anchoElegido, rutaParaElMarco } from "@/lib/mobile-preview";

/** La vista móvil del admin (D-NEXT). La ruta y el ancho viajan en la URL: recargar o guardar el enlace los conserva. */
export default async function VistaMovilPage({ searchParams }: { searchParams: Promise<{ ruta?: string; ancho?: string }> }) {
  const { ruta, ancho } = await searchParams;
  return <VistaMovil rutaInicial={rutaParaElMarco(ruta)} anchoInicial={anchoElegido(ancho)} />;
}
