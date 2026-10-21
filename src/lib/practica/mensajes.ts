import type { Idioma } from "@/lib/idioma";

/**
 * Lo que se dice cuando algo no se puede practicar (D-628): una función de la base que escribe, un archivo, o algo que
 * sale al mundo real (un correo, un SMS, una llamada, una cuenta). Aparte para que el middleware lo use sin cargar más.
 */
export function mensajeDeLoQueNoSePractica(idioma: Idioma): string {
  return idioma === "es"
    ? "Modo enseñanza: esto no se puede practicar (manda algo fuera, toca un archivo o lo hace el servidor) y no se hizo. Lo demás sí se practica."
    : "Teaching mode: this can't be practiced (it sends something out, touches a file or runs on the server) and was not done. Everything else can.";
}
