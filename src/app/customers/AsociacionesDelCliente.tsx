"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useConfirm } from "@/lib/confirm";
import type { AlmacenDeClientes } from "@/lib/customers/almacen";
import { asociadasDe, candidatosParaAsociar, puedeAsociar, tiendasEnTexto, type Asociado } from "@/lib/customers/asociaciones";
import { enOrdenDeTienda, principalDe } from "@/lib/customers/empresas";
import { nombreDeTienda, type Cliente } from "@/lib/customers/reglas";

type T = (en: string, es: string) => string;

/**
 * D-NEXT (249): «En asociación con» (el dueño: «es simbólico; dirá "en asociación con" otro cliente»). Entre EMPRESAS:
 * la ven todas las tiendas. Al ver, las pastillas; cada una abre la asociada EN EL SITIO, como tarjeta (nunca se salta a
 * otra página). Editando —solo quien edita directo (`editable`)—, el buscador sobre los clientes que ya existen y la ✕
 * de cada una (con el diálogo de la app). Se guarda al momento: no espera al «Guardar» de la ficha.
 *
 * Sin la 249 (el código llega antes que la migración): sin asociaciones no se pinta nada al ver, y editando sale
 * «pendiente de instalar». Sin `almacen.asociados` (dobles de las pruebas), nada.
 */
export function AsociacionesDelCliente({ cliente, almacen, lista = [], editable = false, pintaFicha, t }: {
  cliente: Pick<Cliente, "id" | "account" | "company_id">;
  almacen: AlmacenDeClientes;
  /** Los clientes ya cargados (la lista): sobre ellos busca el buscador. */
  lista?: readonly Cliente[];
  editable?: boolean;
  /** Cómo se pinta la ficha de una asociada abierta (las tarjetas de solo lectura de la ficha). */
  pintaFicha: (c: Cliente) => ReactNode;
  t: T;
}) {
  const empresa = cliente.company_id ?? null;
  const [asociados, setAsociados] = useState<Asociado[] | null>(null);
  const [pendiente, setPendiente] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busca, setBusca] = useState("");
  const [ocupado, setOcupado] = useState(false);
  const [abierta, setAbierta] = useState<Asociado | null>(null);
  const [vuelta, setVuelta] = useState(0);

  useEffect(() => {
    if (!empresa || !almacen.asociados) return;
    let vivo = true;
    void almacen.asociados(empresa).then((r) => {
      if (!vivo) return;
      if (r.ok) { setAsociados(r.valor); setPendiente(false); setError(null); }
      else if (r.sinTabla) { setAsociados([]); setPendiente(true); }
      else { setAsociados([]); setError(r.error); }
    });
    return () => { vivo = false; };
  }, [empresa, almacen, vuelta]);

  const yaAsociadas = useMemo(() => (asociados ?? []).map((a) => a.company_id), [asociados]);
  const candidatos = useMemo(
    () => (editable && empresa ? candidatosParaAsociar(lista, empresa, yaAsociadas, busca) : []),
    [editable, empresa, lista, yaAsociadas, busca],
  );

  if (!empresa || !almacen.asociados) return null;
  if (!editable && (!asociados || asociados.length === 0)) return null;

  const asocia = async (otra: string) => {
    if (!almacen.asociar || ocupado || !puedeAsociar(empresa, otra, yaAsociadas)) return;
    setOcupado(true);
    const r = await almacen.asociar(empresa, otra);
    setOcupado(false);
    if (!r.ok) { setError(r.duplicado ? t("They are already associated.", "Ya están asociados.") : r.sinPermiso ? t("You can't change associations.", "No puedes cambiar asociaciones.") : r.error); return; }
    setBusca("");
    setVuelta((v) => v + 1);
  };
  // La pregunta la hace `BotonQuitar` (el diálogo de la app); aquí ya está dicho que sí.
  const quita = async (a: Asociado) => {
    if (!almacen.desasociar || ocupado) return;
    setOcupado(true);
    const r = await almacen.desasociar(a.id);
    setOcupado(false);
    if (!r.ok) { setError(r.sinPermiso ? t("You can't change associations.", "No puedes cambiar asociaciones.") : r.error); return; }
    setVuelta((v) => v + 1);
  };

  return (
    <section className="cli-asociaciones" data-asociaciones={asociados?.length ?? 0} data-editable={editable || undefined}>
      <div className="cli-asociaciones-fila">
        <span className="cli-asociaciones-rotulo">🤝 {t("In association with:", "En asociación con:")}</span>
        {asociados?.map((a) => (
          <span key={a.id} className="cli-asociado" data-asociado={a.company_id} data-archivado={a.archivado || undefined}>
            <button type="button" className="cli-asociado-abre" onClick={() => setAbierta(a)}
              title={[a.crm_type, tiendasEnTexto(a.stores)].filter(Boolean).join(" · ")}>
              {a.account}
              {a.stores.length > 0 && <span className="cli-asociado-tiendas">{tiendasEnTexto(a.stores)}</span>}
            </button>
            {editable && almacen.desasociar && (
              <BotonQuitar asociado={a} ocupado={ocupado} onQuita={() => void quita(a)} t={t} />
            )}
          </span>
        ))}
        {editable && asociados?.length === 0 && !pendiente && <span className="cli-asociaciones-nota">{t("None yet.", "Ninguna todavía.")}</span>}
      </div>

      {editable && pendiente && (
        <p className="cli-asociaciones-nota" data-asociaciones-pendiente>
          {t("Associations: setup pending (migration 249).", "Asociaciones: pendiente de instalar (migración 249).")}
        </p>
      )}

      {editable && !pendiente && almacen.asociar && (
        <div className="cli-asociaciones-buscador">
          <input
            type="search"
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            placeholder={t("Add an associated customer: name, phone, contact…", "Añadir cliente asociado: nombre, teléfono, contacto…")}
            aria-label={t("Search a customer to associate", "Buscar un cliente para asociar")}
            data-busca-asociado
            disabled={ocupado}
          />
          {busca.trim().length >= 2 && (
            <ul className="cli-asociaciones-sugerencias" role="listbox" aria-label={t("Customers", "Clientes")}>
              {candidatos.length === 0 && <li className="cli-asociaciones-nota">{t("No customer matches.", "Ningún cliente coincide.")}</li>}
              {candidatos.map((c) => (
                <li key={c.company_id} role="option" aria-selected={false}>
                  <button type="button" onClick={() => void asocia(c.company_id)} disabled={ocupado} data-candidato-asociado={c.company_id}>
                    <span className="cli-candidato-nombre">{c.account}</span>
                    <span className="cli-candidato-detalle">
                      {[tiendasEnTexto(c.stores), c.crm_type].filter(Boolean).join(" · ")}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {error && <p className="cli-asociaciones-error" role="status">{error}</p>}

      {abierta && (
        <TarjetaDeAsociado asociado={abierta} almacen={almacen} pintaFicha={pintaFicha} onClose={() => setAbierta(null)} t={t} />
      )}
    </section>
  );
}

/** La ✕ de una asociada, con el diálogo de la app (`useConfirm`). Aparte para que el hook solo se pida donde hay algo que
 *  quitar (las pruebas pintan la ficha sin ConfirmProvider). */
function BotonQuitar({ asociado: a, ocupado, onQuita, t }: { asociado: Asociado; ocupado: boolean; onQuita: () => void; t: T }) {
  const confirmar = useConfirm();
  const pide = async () => {
    const si = await confirmar(t(`Remove the association with ${a.account}? Both customers stop showing it.`, `¿Quitar la asociación con ${a.account}? Deja de salir en los dos clientes.`), { danger: true });
    if (si) onQuita();
  };
  return (
    <button type="button" className="cli-asociado-quita" onClick={() => void pide()} disabled={ocupado}
      aria-label={t(`Remove association with ${a.account}`, `Quitar asociación con ${a.account}`)} data-quita-asociado={a.company_id}>✕</button>
  );
}

/** La asociada abierta EN EL SITIO: una tarjeta encima, con sus tiendas y sus tarjetas de solo lectura. */
function TarjetaDeAsociado({ asociado, almacen, pintaFicha, onClose, t }: {
  asociado: Asociado; almacen: AlmacenDeClientes; pintaFicha: (c: Cliente) => ReactNode; onClose: () => void; t: T;
}) {
  const [filas, setFilas] = useState<Cliente[] | null>(null);
  const [elegida, setElegida] = useState<number | null>(null);
  useEffect(() => {
    let vivo = true;
    if (!almacen.filasDeEmpresa) { setFilas([]); return; }
    void almacen.filasDeEmpresa(asociado.company_id).then((r) => { if (vivo) setFilas(r.ok ? enOrdenDeTienda(r.valor) : []); });
    return () => { vivo = false; };
  }, [asociado.company_id, almacen]);
  useEffect(() => {
    const tecla = (e: KeyboardEvent) => { if (e.key === "Escape" && !e.defaultPrevented) { e.preventDefault(); onClose(); } };
    window.addEventListener("keydown", tecla, true);
    return () => window.removeEventListener("keydown", tecla, true);
  }, [onClose]);
  const actual = filas && filas.length ? (filas.find((f) => f.id === elegida) ?? principalDe(filas)) : null;
  return (
    <div className="overlay cli-asociado-capa" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }} data-tarjeta-asociado={asociado.company_id}>
      <div className="modal" style={{ maxWidth: 1000 }} role="dialog" aria-modal="true" aria-label={asociado.account}>
        <div className="cli-asociado-cabecera">
          <h2>{asociado.account}</h2>
          {asociado.crm_type && <span className="cli-asociado-tipo">{asociado.crm_type}</span>}
          <button type="button" className="cli-asociado-cierra" onClick={onClose} aria-label={t("Close", "Cerrar")}>✕</button>
        </div>
        {filas === null && <p className="cli-asociaciones-nota">{t("Loading…", "Cargando…")}</p>}
        {filas && filas.length === 0 && (
          <p className="cli-asociaciones-nota">
            {tiendasEnTexto(asociado.stores)}{asociado.stores.length ? " · " : ""}
            {t("You can't see this customer's details.", "No puedes ver los datos de este cliente.")}
          </p>
        )}
        {filas && filas.length > 1 && (
          <nav className="cli-asociado-tiendas-nav" aria-label={t("Stores of this company", "Tiendas de esta empresa")}>
            {filas.map((f) => (
              <button key={f.id} type="button" aria-pressed={actual?.id === f.id} onClick={() => setElegida(f.id)}>{nombreDeTienda(f.store)}</button>
            ))}
          </nav>
        )}
        {actual && <div className="cli-asociado-ficha">{pintaFicha(actual)}</div>}
      </div>
    </div>
  );
}
