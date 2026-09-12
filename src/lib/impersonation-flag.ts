import "server-only";

/**
 * La bandera que mantiene «entrar como» apagado hasta que alguien lo encienda a mano (D-243).
 *
 * No es un ajuste de producto: es un **freno de despliegue**. Queda una cosa sin comprobar en
 * esta rama —si el proyecto de Supabase dispara además su propio correo al generar el enlace
 * mágico, cosa que desde una rama sin llaves no se puede medir sin escribirle a un empleado
 * real— y esta bandera es lo que impide que el despliegue encienda solo una función que todavía
 * tiene una pregunta abierta.
 *
 * Apagada por defecto, y se enciende poniendo `IMPERSONATION_ENABLED=true` en el entorno. Se
 * apaga quitando la variable: no hace falta desplegar para desactivarla, que es la propiedad que
 * de verdad importa el día que algo salga mal.
 *
 * Con ella apagada, la ruta responde **404 y no 403**: una función que no está no se anuncia.
 */
export function impersonacionActiva(): boolean {
  return process.env.IMPERSONATION_ENABLED?.trim().toLowerCase() === "true";
}
