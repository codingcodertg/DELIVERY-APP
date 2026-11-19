import { notFound } from "next/navigation";

// Destino de la reescritura de todo lo que el dominio de tarjetas no debe enseñar: responde la 404 de tarjetas.
export default function TarjetaNoEncontradaPage() {
  notFound();
}
