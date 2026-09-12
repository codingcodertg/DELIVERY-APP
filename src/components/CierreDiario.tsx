"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { isPublicPath } from "@/lib/route-guard";
import { usePrefs } from "@/lib/prefs";
import { CIERRE_DIARIO, horaDelNegocio, minutosHastaElCorte, pasoElCorte, tocaAvisar } from "@/lib/session-cutoff";
import { useCutoffExempt } from "@/lib/use-cutoff-exempt";

/**
 * El aviso de que la sesión se va a cerrar a las 18:30 (D-NEXT).
 *
 * **Esto no cierra nada.** La barrera es el middleware, que comprueba en cada navegación si la
 * sesión se autenticó antes del último corte. Este componente existe para que el corte no sea
 * a traición: unos minutos antes lo dice, y a la hora provoca una navegación —`router.refresh()`—
 * para que el servidor decida en ese momento en vez de esperar a que la persona haga clic.
 *
 * Que no decida nada aquí es deliberado. Una segunda copia de la regla en el cliente es cómo se
 * cuela un rol (D-240), y además el cliente no puede saber si está exento sin preguntar: por eso
 * pregunta **una vez**, al entrar en la ventana de aviso, y no en cada vuelta del reloj.
 *
 * Vive en el layout raíz porque es el único por el que pasan las cinco apps y el hub, igual que
 * `VersionStamp`.
 */
export function CierreDiario() {
  const pathname = usePathname();
  const router = useRouter();
  const { t } = usePrefs();
  const [ahora, setAhora] = useState<string | null>(null);
  const [cerrado, setCerrado] = useState(false);

  // Cada medio minuto basta: lo que se mira es el minuto, y un reloj por segundo aquí serían
  // 3.600 repintados por hora del layout entero para no enseñar nada la mayor parte del día.
  useEffect(() => {
    const tic = () => setAhora(horaDelNegocio());
    tic();
    const id = setInterval(tic, 30_000);
    return () => clearInterval(id);
  }, []);

  const enPublica = isPublicPath(pathname);
  const enVentana = !!ahora && tocaAvisar(ahora);
  const yaPaso = !!ahora && pasoElCorte(ahora);

  // Se pregunta UNA vez, cuando el aviso empieza a ser relevante, y por el hook compartido:
  // el cronómetro hace la misma pregunta y no tiene sentido que sean dos peticiones ni dos
  // respuestas que podrían no coincidir.
  const exento = useCutoffExempt(!enPublica && (enVentana || yaPaso));

  // A la hora, una navegación para que el middleware resuelva. Una sola vez: si la persona
  // está exenta no pasa nada, y si no lo está, el propio refresco la manda al login.
  useEffect(() => {
    if (enPublica || cerrado || !yaPaso || exento !== false) return;
    setCerrado(true);
    router.refresh();
  }, [enPublica, cerrado, yaPaso, exento, router]);

  if (enPublica || exento !== false || !enVentana) return null;

  const faltan = ahora ? minutosHastaElCorte(ahora) : null;
  if (faltan === null) return null;

  return (
    <div
      role="status"
      style={{ position: "fixed", right: 16, bottom: 16, zIndex: 9998, maxWidth: 320 }}
      className="box"
    >
      <div className="small" style={{ fontWeight: 700 }}>
        {t("Session closes at 6:30 PM", "La sesión se cierra a las 6:30 PM")}
      </div>
      <div className="small muted">
        {t(
          `In ${faltan} min you'll be signed out. Your account stays saved on this device — you'll only need your password.`,
          `En ${faltan} min se cerrará tu sesión. Tu cuenta sigue guardada en este equipo: solo tendrás que poner la contraseña.`,
        )}
      </div>
      <div className="small muted" style={{ marginTop: 4, opacity: 0.7 }}>{CIERRE_DIARIO}</div>
    </div>
  );
}
