import { redirect } from "next/navigation";
import { landingRoute } from "@/lib/constants";
import { ProfileReadError } from "@/components/ProfileReadError";
import { estadoDeLectura, puedeVerDetalle } from "@/lib/profile-read";
import { esAdmin } from "@/lib/impersonation";
import { puedeAbrirLaVistaMovil } from "@/lib/vista-movil-acceso";
import { perfilDeLaVistaMovil, suplantacionEnCurso } from "@/lib/vista-movil-servidor";

/**
 * La vista móvil es del admin (D-278), y se decide en el servidor con el rol de la sesión, igual que
 * Usuarios (D-056). «Ver como» es solo del cliente y no cambia la sesión, así que un admin
 * previsualizando otro rol sigue entrando.
 *
 * Desde D-NEXT entra también **un admin dentro de la cuenta de otra persona** (D-243): ahí la sesión es la
 * de esa persona, y antes se le echaba. No basta con la cookie de vuelta, que no va firmada: hace falta el
 * rastro que solo escribe el servidor. La regla entera, en `puedeAbrirLaVistaMovil`. Sin suplantación, solo
 * el admin, como antes.
 *
 * Sin `DataProvider`: esta página no lee órdenes. La app que se prueba corre dentro del marco, con los
 * suyos.
 */
export default async function VistaMovilLayout({ children }: { children: React.ReactNode }) {
  const { user, perfil, errorPerfil } = await perfilDeLaVistaMovil();
  if (!user) redirect("/login?next=/home/vista-movil");

  // Tres desenlaces (D-234): si la consulta falla no se redirige, que el login volvería aquí.
  if (estadoDeLectura({ data: perfil, error: errorPerfil }) === "fallo") {
    return <ProfileReadError error={errorPerfil!} verDetalle={puedeVerDetalle(user)} />;
  }
  if (!perfil) redirect("/login?next=/home/vista-movil");
  // Al admin no se le pregunta nada más: su visita cuesta lo mismo que antes.
  const suplantacion = esAdmin(perfil.role) ? null : await suplantacionEnCurso(user.id);
  if (!puedeAbrirLaVistaMovil({ rolDeLaSesion: perfil.role, usuarioId: user.id, suplantacion, ahora: Date.now() })) {
    redirect(landingRoute(perfil));
  }

  return <div className="wrap">{children}</div>;
}
