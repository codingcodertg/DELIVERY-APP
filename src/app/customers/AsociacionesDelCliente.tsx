"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import type { AlmacenDeClientes } from "@/lib/customers/almacen";
import { candidatosParaAsociar, planDeCambios, tiendasEnTexto, type Asociado, type AsociacionPendiente, type EmpresaParaAsociar } from "@/lib/customers/asociaciones";
import { enOrdenDeTienda, principalDe } from "@/lib/customers/empresas";
import { nombreDeTienda, type Cliente } from "@/lib/customers/reglas";

type T = (en: string, es: string) => string;

/**
 * D-884 (249): «En asociación con». Entre EMPRESAS: la ven todas las tiendas. Al ver, las pastillas; cada una abre la
 * asociada EN EL SITIO, como tarjeta (nunca se salta a otra página).
 *
 * D-886 (250): se cambian SOLO desde la edición (`editable`), varias a la vez: el buscador marca varias empresas, la ✕
 * marca las que se quitan, y un solo botón lo manda junto (`almacen.proponerAsociaciones`). El admin de Clientes
 * (`esAdmin`) aplica directo; vendedor y gerente crean solicitudes que el admin aprueba en «Solicitudes de cliente». Lo
 * propuesto sale como «pendiente de aprobación» hasta que se decide. El no admin solo encuentra empresas de sus tiendas
 * (la base lo exige en el buscador y al proponer).
 *
 * Sin la 249 (el código llega antes que la migración): sin asociaciones no se pinta nada al ver, y editando sale
 * «pendiente de instalar». Sin `almacen.asociados` (dobles de las pruebas), nada.
 */
export function AsociacionesDelCliente({ cliente, almacen, lista = [], editable = false, esAdmin = false, pintaFicha, t }: {
  cliente: Pick<Cliente, "id" | "account" | "company_id">;
  almacen: AlmacenDeClientes;
  /** Los clientes ya cargados: el buscador de respaldo si la base no tiene la 250. */
  lista?: readonly Cliente[];
  editable?: boolean;
  /** Admin de Clientes: lo que guarda se aplica sin aprobación. */
  esAdmin?: boolean;
  /** Cómo se pinta la ficha de una asociada abierta (las tarjetas de solo lectura de la ficha). */
  pintaFicha: (c: Cliente) => ReactNode;
  t: T;
}) {
  const empresa = cliente.company_id ?? null;
  const [asociados, setAsociados] = useState<Asociado[] | null>(null);
  const [pendientes, setPendientes] = useState<AsociacionPendiente[]>([]);
  const [sinInstalar, setSinInstalar] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [busca, setBusca] = useState("");
  const [resultados, setResultados] = useState<EmpresaParaAsociar[]>([]);
  const [elegidas, setElegidas] = useState<EmpresaParaAsociar[]>([]);
  const [quitar, setQuitar] = useState<number[]>([]);
  const [nota, setNota] = useState("");
  const [ocupado, setOcupado] = useState(false);
  const [abierta, setAbierta] = useState<Asociado | null>(null);
  const [vuelta, setVuelta] = useState(0);

  useEffect(() => {
    if (!empresa || !almacen.asociados) return;
    let vivo = true;
    void almacen.asociados(empresa).then((r) => {
      if (!vivo) return;
      if (r.ok) { setAsociados(r.valor); setSinInstalar(false); }
      else if (r.sinTabla) { setAsociados([]); setSinInstalar(true); }
      else { setAsociados([]); setError(r.error); }
    });
    if (almacen.asociacionesPendientes) {
      void almacen.asociacionesPendientes(empresa).then((r) => { if (vivo) setPendientes(r.ok ? r.valor : []); });
    }
    return () => { vivo = false; };
  }, [empresa, almacen, vuelta]);

  const yaAsociadas = useMemo(() => (asociados ?? []).map((a) => a.company_id), [asociados]);
  const fuera = useMemo(
    () => new Set([...yaAsociadas, ...pendientes.filter((p) => p.op === "add").map((p) => p.company_id), ...elegidas.map((e) => e.company_id), empresa ?? ""]),
    [yaAsociadas, pendientes, elegidas, empresa],
  );

  // El buscador: la base (250, con la regla de tiendas) o, sin ella, la lista ya cargada.
  useEffect(() => {
    if (!editable || !empresa) return;
    const q = busca.trim();
    if (q.length < 2) { setResultados([]); return; }
    let vivo = true;
    const h = setTimeout(() => {
      if (almacen.buscarParaAsociar) {
        void almacen.buscarParaAsociar(q).then((r) => { if (vivo) setResultados(r.ok ? r.valor : []); });
      } else {
        setResultados(candidatosParaAsociar(lista, empresa, yaAsociadas, q).map(({ company_id, account, stores, crm_type }) => ({ company_id, account, stores, crm_type })));
      }
    }, 200);
    return () => { vivo = false; clearTimeout(h); };
  }, [busca, editable, empresa, almacen, lista, yaAsociadas]);
  const candidatos = resultados.filter((c) => !fuera.has(c.company_id)).slice(0, 8);

  if (!empresa || !almacen.asociados) return null;
  if (!editable && (!asociados || asociados.length === 0) && pendientes.length === 0) return null;

  const plan = planDeCambios(asociados ?? [], pendientes, elegidas.map((e) => e.company_id), quitar);
  const hayCambios = plan.add.length + plan.remove.length > 0;
  const puedeGuardar = editable && !!almacen.proponerAsociaciones && !sinInstalar;
  const quitaPendiente = (companyId: string) => pendientes.some((p) => p.op === "remove" && p.company_id === companyId);

  const guarda = async () => {
    if (!almacen.proponerAsociaciones || ocupado || !hayCambios) return;
    setOcupado(true); setError(null); setAviso(null);
    const r = await almacen.proponerAsociaciones(cliente.id, plan.add, plan.remove, nota);
    setOcupado(false);
    if (!r.ok) {
      setError(r.duplicado ? t("Already associated or already waiting for approval.", "Ya están asociados o ya esperan aprobación.")
        : r.sinPermiso ? t("You can't make that change (only customers of your store).", "No puedes hacer ese cambio (solo clientes de tu tienda).") : r.error);
      return;
    }
    setElegidas([]); setQuitar([]); setNota(""); setBusca("");
    setAviso(r.valor.solicitudes.length
      ? t(`Sent for approval (${r.valor.solicitudes.length}). It changes once an admin approves it.`, `Enviado a aprobación (${r.valor.solicitudes.length}). Cambia cuando lo apruebe un admin.`)
      : t("Associations saved ✓", "Asociaciones guardadas ✓"));
    setVuelta((v) => v + 1);
  };

  return (
    <section className="cli-asociaciones" data-asociaciones={asociados?.length ?? 0} data-editable={editable || undefined}>
      <div className="cli-asociaciones-fila">
        <span className="cli-asociaciones-rotulo">🤝 {t("In association with:", "En asociación con:")}</span>
        {asociados?.map((a) => {
          const marcada = quitar.includes(a.id);
          const enEspera = quitaPendiente(a.company_id);
          return (
            <span key={a.id} className="cli-asociado" data-asociado={a.company_id} data-archivado={a.archivado || undefined} data-por-quitar={marcada || undefined}>
              <button type="button" className="cli-asociado-abre" onClick={() => setAbierta(a)}
                style={marcada ? { textDecoration: "line-through" } : undefined}
                title={[a.crm_type, tiendasEnTexto(a.stores)].filter(Boolean).join(" · ")}>
                {a.account}
                {a.stores.length > 0 && <span className="cli-asociado-tiendas">{tiendasEnTexto(a.stores)}</span>}
              </button>
              {enEspera && <span className="cli-asociado-tiendas" data-pendiente-quitar={a.company_id}>⏳ {t("removal pending approval", "quitar: pendiente de aprobación")}</span>}
              {puedeGuardar && !enEspera && (
                <button type="button" className="cli-asociado-quita" disabled={ocupado} aria-pressed={marcada}
                  onClick={() => setQuitar((q) => (marcada ? q.filter((x) => x !== a.id) : [...q, a.id]))}
                  aria-label={marcada ? t(`Keep association with ${a.account}`, `Mantener asociación con ${a.account}`) : t(`Remove association with ${a.account}`, `Quitar asociación con ${a.account}`)}
                  data-quita-asociado={a.company_id}>{marcada ? "↩" : "✕"}</button>
              )}
            </span>
          );
        })}
        {pendientes.filter((p) => p.op === "add").map((p) => (
          <span key={`p${p.id}`} className="cli-asociado" data-asociado-pendiente={p.company_id} style={{ borderStyle: "dashed" }}>
            <span className="cli-asociado-abre">{p.account}<span className="cli-asociado-tiendas">⏳ {t("pending approval", "pendiente de aprobación")}</span></span>
          </span>
        ))}
        {elegidas.map((e) => (
          <span key={`e${e.company_id}`} className="cli-asociado" data-asociado-elegido={e.company_id} style={{ borderStyle: "dashed" }}>
            <span className="cli-asociado-abre">+ {e.account}</span>
            <button type="button" className="cli-asociado-quita" onClick={() => setElegidas((l) => l.filter((x) => x.company_id !== e.company_id))}
              aria-label={t(`Don't add ${e.account}`, `No añadir ${e.account}`)}>✕</button>
          </span>
        ))}
        {editable && asociados?.length === 0 && pendientes.length === 0 && elegidas.length === 0 && !sinInstalar && (
          <span className="cli-asociaciones-nota">{t("None yet.", "Ninguna todavía.")}</span>
        )}
      </div>

      {editable && sinInstalar && (
        <p className="cli-asociaciones-nota" data-asociaciones-pendiente>
          {t("Associations: setup pending (migration 249).", "Asociaciones: pendiente de instalar (migración 249).")}
        </p>
      )}

      {puedeGuardar && (
        <div className="cli-asociaciones-buscador">
          <input
            type="search"
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            placeholder={t("Add associated customers: name, phone, contact…", "Añadir clientes asociados: nombre, teléfono, contacto…")}
            aria-label={t("Search customers to associate", "Buscar clientes para asociar")}
            data-busca-asociado
            disabled={ocupado}
          />
          {busca.trim().length >= 2 && (
            <ul className="cli-asociaciones-sugerencias" role="listbox" aria-multiselectable="true" aria-label={t("Customers", "Clientes")}>
              {candidatos.length === 0 && <li className="cli-asociaciones-nota">{t("No customer matches.", "Ningún cliente coincide.")}</li>}
              {candidatos.map((c) => (
                <li key={c.company_id} role="option" aria-selected={false}>
                  <button type="button" onClick={() => setElegidas((l) => [...l, c])} disabled={ocupado} data-candidato-asociado={c.company_id}>
                    <span className="cli-candidato-nombre">{c.account}</span>
                    <span className="cli-candidato-detalle">{[tiendasEnTexto(c.stores), c.crm_type].filter(Boolean).join(" · ")}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          {hayCambios && (
            <div className="mt-2 flex flex-wrap items-center gap-2" data-guardar-asociaciones-caja>
              {!esAdmin && (
                <input type="text" value={nota} onChange={(e) => setNota(e.target.value)} placeholder={t("Note for the admin (optional)", "Nota para el admin (opcional)")}
                  aria-label={t("Note for the admin", "Nota para el admin")} data-nota-asociacion />
              )}
              <button type="button" className="btn btn-primary btn-sm" disabled={ocupado} onClick={() => void guarda()} data-guardar-asociaciones>
                {esAdmin ? t("Save associations", "Guardar asociaciones") : t("Send for approval", "Enviar a aprobación")}
                {` (+${plan.add.length} / −${plan.remove.length})`}
              </button>
            </div>
          )}
        </div>
      )}

      {aviso && <p className="cli-asociaciones-nota" role="status" data-aviso-asociaciones>{aviso}</p>}
      {error && <p className="cli-asociaciones-error" role="status">{error}</p>}

      {abierta && (
        <TarjetaDeAsociado asociado={abierta} almacen={almacen} pintaFicha={pintaFicha} onClose={() => setAbierta(null)} t={t} />
      )}
    </section>
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
