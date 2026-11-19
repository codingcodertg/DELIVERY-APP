import { TEXTOS } from "@/lib/tarjetas/textos";

// La 404 de la tarjeta: la misma en el dominio de tarjetas y en el del hub. Bilingüe, sin datos de nadie.
export default function TarjetaNoEncontrada() {
  return (
    <div className="tj">
      <div className="vacio" role="alert">
        <div>
          <h1>{TEXTOS.es.noEncontradaT}</h1>
          <p>{TEXTOS.es.noEncontradaS}</p>
          <h1 style={{ marginTop: 28, fontSize: 16 }}>{TEXTOS.en.noEncontradaT}</h1>
          <p>{TEXTOS.en.noEncontradaS}</p>
        </div>
      </div>
    </div>
  );
}
