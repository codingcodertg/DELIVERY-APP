import { VistaMovil } from "@/components/VistaMovil";
import { roleHome } from "@/lib/constants";
import { anchoElegido, rutaParaElMarco } from "@/lib/mobile-preview";
import { perfilDeLaVistaMovil } from "@/lib/vista-movil-servidor";

/**
 * La vista móvil del admin (D-278). La ruta y el ancho viajan en la URL: recargar o guardar el enlace los conserva.
 *
 * Sin ruta, el marco abre la pantalla de inicio del rol de la sesión (D-NEXT), no siempre la portada: dentro
 * de «Entrar como» un chofer, eso es `/driver`. Para el admin sigue siendo `/`.
 */
export default async function VistaMovilPage({ searchParams }: { searchParams: Promise<{ ruta?: string; ancho?: string }> }) {
  const { ruta, ancho } = await searchParams;
  const { perfil } = await perfilDeLaVistaMovil();
  const inicio = perfil?.role ? roleHome(perfil.role) : "/";
  return <VistaMovil rutaInicial={rutaParaElMarco(ruta, inicio)} rutaDeInicio={inicio} anchoInicial={anchoElegido(ancho)} />;
}
