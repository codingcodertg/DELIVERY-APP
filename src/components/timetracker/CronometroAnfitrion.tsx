"use client";

import { usePathname } from "next/navigation";
import { useData } from "@/lib/timetracker-data-provider";
import { effWorkerType } from "@/lib/timetracker/helpers";
import { debeMontarCronometro, esRutaDelCronometro } from "@/lib/timetracker/vigia";
import { Cronometro } from "@/components/timetracker/Cronometro";

/**
 * Quien mantiene vivo el cronómetro en todo el módulo (D-NEXT).
 *
 * El 2026-10-04 el dueño perdió el registro de más de tres horas porque abrió «Capturas» con el
 * reloj corriendo: el tick, el latido y el receptor de capturas eran parte de la PÁGINA
 * «Registrar tiempo», y Next desmonta la página al cambiar de pestaña. No hubo error ni aviso;
 * la app de escritorio siguió enseñando «captura tomada» mientras las capturas no iban a
 * ningún sitio.
 *
 * Este componente se monta en el layout de Time Tracker, que no se desmonta al navegar dentro
 * del módulo. En «Registrar tiempo» enseña el cronómetro; en las demás pantallas lo deja
 * montado y oculto, latiendo. `page.tsx` de esa ruta ya no pinta nada: si lo hiciera habría dos
 * cronómetros escribiendo a la vez sobre la misma fila.
 */
export function CronometroAnfitrion() {
  const pathname = usePathname();
  const { me } = useData();
  const visible = esRutaDelCronometro(pathname);
  const montar = debeMontarCronometro({
    visible,
    presencial: effWorkerType(me) === "inhouse",
    esAdmin: me.role === "admin",
  });
  if (!montar) return null;
  return <Cronometro visible={visible} />;
}
