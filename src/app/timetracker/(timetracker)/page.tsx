// «Registrar tiempo». Esta página NO pinta nada, y es a propósito (D-NEXT).
//
// El cronómetro vivía aquí, y con él el tick, el latido de diez segundos, el contador de
// actividad y el receptor de capturas de la app de escritorio. Next desmonta la página al
// cambiar de pestaña, así que abrir «Capturas» o «Semana» con el reloj corriendo lo mataba todo
// en silencio (incidente del 2026-10-04: 3 h 12 min sin un latido).
//
// Ahora lo monta `CronometroAnfitrion` desde el layout del módulo, que sobrevive a la
// navegación, y lo enseña cuando la ruta es esta. **No importes `Cronometro` aquí**: habría dos
// cronómetros a la vez escribiendo sobre la misma fila. Lo vigila `vigia.test.ts`.
export default function TrackTimePage() {
  return null;
}
