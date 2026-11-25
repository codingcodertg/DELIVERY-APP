"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { useData } from "@/lib/timetracker-data-provider";
import { effWorkerType } from "@/lib/timetracker/helpers";
import { debeMontarCronometro, esRutaDelCronometro } from "@/lib/timetracker/vigia";
import { Cronometro } from "@/components/timetracker/Cronometro";

/**
 * Quien mantiene vivo el cronómetro en todo el módulo (D-470).
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
  const { me, listLiveSessions } = useData();
  const visible = esRutaDelCronometro(pathname);
  const presencial = effWorkerType(me) === "inhouse";
  const esAdmin = me.role === "admin";
  // Desde 2026-11-25 el presencial (que no es admin) no tiene cronómetro (`fichaje-en-tienda.ts`). Solo se monta
  // si quedó uno corriendo de antes, para poder pararlo. Si no se puede leer, se monta: es lo más seguro.
  // Una vez montado se queda hasta recargar, para que parar no lo desmonte a mitad de guardar.
  const [vivoAlEntrar, setVivoAlEntrar] = useState<boolean>(false);
  useEffect(() => {
    if (!presencial || esAdmin) return;
    let vigente = true;
    listLiveSessions()
      .then((vivas) => { if (vigente && vivas.length > 0) setVivoAlEntrar(true); })
      .catch(() => { if (vigente) setVivoAlEntrar(true); });
    return () => { vigente = false; };
  }, [presencial, esAdmin, listLiveSessions]);
  const montar = debeMontarCronometro({
    visible,
    presencial,
    esAdmin,
    hayCronometroVivo: vivoAlEntrar,
  });
  if (!montar) return null;
  return <Cronometro visible={visible} />;
}
