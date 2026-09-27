import { dinero } from "@/lib/estimator/modelo";
import type { HojaDelCliente } from "@/lib/estimator/hoja";

/**
 * La hoja impresa del cliente (T-0408).
 *
 * **Solo recibe `HojaDelCliente`**, nunca el borrador: lo que no está en ese objeto no se puede
 * pintar aquí aunque alguien lo intente, y ese objeto no lleva teléfono, empresa, dirección, código,
 * descripción interna ni $/SF (`lib/estimator/hoja.ts`, y su prueba).
 *
 * Aspecto de propósito **poco oficial**, como pide el documento: encabezado tecleado en monoespaciada,
 * sin logotipo, sin sello, sin número de factura. Al imprimir, `estimator.css` esconde todo lo demás.
 */
export function HojaCliente({ hoja }: { hoja: HojaDelCliente }) {
  return (
    <div className="hoja-cliente" data-hoja-cliente>
      <div className="hc-encabezado">
        <div className="hc-empresa">{hoja.encabezado}</div>
        <div className="hc-subtitulo">{hoja.subtitulo}</div>
      </div>

      <div className="hc-datos">
        <div><span>Prepared for:</span> {hoja.preparadoPara}</div>
        <div><span>Quote Reference:</span> {hoja.referencia}</div>
        <div><span>Valid through:</span> {hoja.validaHasta}</div>
        <div><span>Sales Representative:</span> {hoja.representante}</div>
      </div>

      {hoja.resumen && (
        <div className="hc-resumen">
          <div className="hc-titulo-seccion">PROJECT SUMMARY</div>
          <div>{hoja.resumen}</div>
        </div>
      )}

      <table className="hc-tabla">
        <thead>
          <tr>
            <th>Description</th>
            <th>Quantity</th>
            <th className="hc-num">Amount</th>
          </tr>
        </thead>
        <tbody>
          {hoja.filas.map((f, i) => (
            <tr key={i}>
              <td>{f.descripcion}</td>
              <td>{f.cantidad.map((c, j) => <div key={j}>{c}</div>)}</td>
              <td className="hc-num">{dinero(f.importe)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="hc-total">{hoja.textoTotal}</div>

      <div className="hc-validez">
        <div className="hc-validez-fecha">{hoja.validezConspicua}</div>
        <div>{hoja.avisoJuntoAlTotal}</div>
      </div>

      {hoja.entrega && <p className="hc-entrega">{hoja.entrega}</p>}

      <div className="hc-notas">
        {hoja.notas.map((n, i) => <p key={i}>{n}</p>)}
      </div>
    </div>
  );
}
