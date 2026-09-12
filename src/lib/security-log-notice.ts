/**
 * El aviso de que el registro de seguridad no pudo escribir (D-245).
 *
 * Vive aparte por dos razones y ninguna es de estilo: se puede probar sin dibujar nada, y **la
 * regla de «una sola vez» tiene que ser de módulo**. Quien cambia permisos a diez personas
 * seguidas no necesita diez avisos iguales; necesita saber, una vez, que el registro no está
 * funcionando. Si la marca viviera dentro del componente, cada remontaje volvería a empezar.
 *
 * No bloquea nada. El cambio que se acaba de hacer ya ocurrió, y deshacerlo por no poder
 * apuntarlo sería peor que la línea que falta — es la misma razón que tenía el `catch` vacío de
 * antes. Lo que cambia es que ahora se **dice**.
 */

let yaAvisado = false;

/** Solo para las pruebas: vuelve a permitir el aviso. Producción no lo necesita. */
export function olvidarAvisoDelRegistro() { yaAvisado = false; }

/** ¿Se ha avisado ya en esta carga de página? Expuesto para poder afirmarlo en una prueba. */
export function seAviso() { return yaAvisado; }

export function fallóElRegistro(
  motivo: string,
  notify: (msg: string) => void,
  lang: "en" | "es",
): void {
  // A la consola SIEMPRE, aunque el aviso ya se haya dado: el segundo fallo puede ser de otra
  // clase que el primero, y quien depura necesita los dos.
  console.error("[security-log] no se pudo apuntar el evento:", motivo);
  if (yaAvisado) return;
  yaAvisado = true;
  notify(
    lang === "es"
      ? "El registro de seguridad no está guardando. El cambio sí se hizo; avisa a un administrador."
      : "The security log is not saving. The change did go through; tell an administrator.",
  );
}
