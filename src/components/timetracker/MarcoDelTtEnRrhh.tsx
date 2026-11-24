import type React from "react";
import { redirect } from "next/navigation";
import "@/app/timetracker/timetracker.css";
import { DataProvider } from "@/lib/timetracker-data-provider";
import { DemoDataProvider } from "@/lib/timetracker-demo-data-provider";
import { ADMIN_DEMO } from "@/lib/timetracker/demo-data";
import { CapacitacionProvider } from "@/components/timetracker/Capacitacion";
import { capacitacionDeLaPeticion } from "@/lib/timetracker/capacitacion-servidor";
import { leerEntornoDelServidor } from "@/lib/timetracker/entorno-del-servidor";
import { ProfileReadError } from "@/components/ProfileReadError";

/**
 * Marco de las pantallas del Time Tracker que viven dentro de RR. HH. (tt/a-hr:
 * /recruiting/tt-empleados y /recruiting/tt-tarifas).
 *
 * Hace lo que hace el layout del Time Tracker, menos su barra: carga el CSS del módulo, monta el
 * proveedor de datos y el de la práctica, y deja la barra y el `.wrap` a RR. HH., que ya los
 * pone. El layout del Time Tracker NO se toca (tt/a-hr); su copia de la lectura de perfil vive
 * en `lib/timetracker/entorno-del-servidor.ts`, que usa este marco.
 *
 * ACCESO. Estas pantallas enseñan tarifas de pago. Hoy solo las ve quien tiene
 * `profiles.timetracker_role === "admin"` (la misma regla que la página de Asignaciones). Eso se
 * comprueba AQUÍ, en el servidor, ANTES de montar el proveedor de datos: quien no es admin del
 * Time Tracker no recibe nada de las tarifas, aunque tenga acceso a RR. HH. El armazón de RR. HH.
 * sigue exigiendo su propio rol; este marco es una segunda puerta, no un sustituto.
 *
 * Modo demo: sin base ni sesión; la persona es el admin inventado, como en el resto de las demos.
 */

const LOCAL_MODE = process.env.NEXT_PUBLIC_LOCAL_MODE === "true";

const SIN_ACCESO_EN = "Only Time Tracker admins can open this screen.";
const SIN_ACCESO_ES = "Solo los administradores del Time Tracker pueden abrir esta pantalla.";

export async function MarcoDelTtEnRrhh({ children }: { children: React.ReactNode }) {
  if (LOCAL_MODE) {
    return (
      <div className="timetracker-module tt-en-rrhh">
        <CapacitacionProvider inicial={null} uid={ADMIN_DEMO.id}>
          <DemoDataProvider me={ADMIN_DEMO}>{children}</DemoDataProvider>
        </CapacitacionProvider>
      </div>
    );
  }

  const entorno = await leerEntornoDelServidor();
  if (entorno.estado === "sin-sesion") redirect("/login?next=/recruiting");
  if (entorno.estado === "fallo") {
    return <ProfileReadError error={entorno.error} verDetalle={entorno.verDetalle} />;
  }

  // ACCESO (servidor): solo timetracker_role === "admin". Se decide antes de montar nada con datos:
  // sin esta comprobación, los hijos (que leen tarifas) no se renderizan. No se redirige, para que
  // no haya bucle entre pantallas: se enseña la tarjeta.
  const me = entorno.me;
  if (entorno.perfil?.timetracker_role !== "admin" || !me) {
    return (
      <div className="timetracker-module tt-en-rrhh">
        <div className="card">
          <p>{SIN_ACCESO_EN}</p>
          <p className="muted">{SIN_ACCESO_ES}</p>
        </div>
      </div>
    );
  }

  // Modo capacitación (D-490): se lee la cookie aquí, como en el layout del Time Tracker.
  const capacitacion = await capacitacionDeLaPeticion();

  return (
    <div className="timetracker-module tt-en-rrhh">
      <CapacitacionProvider inicial={capacitacion} uid={me.id}>
        <DataProvider me={me} tiendas={entorno.tiendasDeFichaje}>
          {children}
        </DataProvider>
      </CapacitacionProvider>
    </div>
  );
}
