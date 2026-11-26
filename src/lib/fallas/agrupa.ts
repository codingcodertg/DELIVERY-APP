// Agrupar y filtrar las fallas para la pantalla «Fallas de la app». Puro: lo usan la página (servidor), el demo y las
// pruebas. Una fila de la tabla es una HUELLA: todas las filas con la misma huella suman sus `veces`, cuentan a sus
// usuarios distintos y dicen cuándo se vieron la primera y la última vez.

export interface FilaDeFalla {
  id: string;
  created_at: string;
  origen: string;
  app: string;
  ruta: string;
  mensaje: string;
  pila: string | null;
  componente: string | null;
  user_id: string | null;
  rol: string | null;
  version: string | null;
  navegador: string | null;
  escritorio: boolean;
  huella: string;
  veces: number;
  ultima_vez: string;
  usuarios: string[] | null;
}

export interface GrupoDeFallas {
  huella: string;
  primera: string;
  ultima: string;
  veces: number;
  origen: string;
  app: string;
  ruta: string;
  mensaje: string;
  pila: string;
  componente: string | null;
  version: string | null;
  usuarios: number;
  navegadores: string[];
  versiones: string[];
  escritorio: boolean;
  filas: FilaDeFalla[];
}

export interface FiltrosDeFallas {
  app?: string | null;
  origen?: string | null;
  /** Fechas AAAA-MM-DD, incluidas. */
  desde?: string | null;
  hasta?: string | null;
}

/** Quita las filas que no pasan los filtros. La fecha se compara por su día (UTC de la base). */
export function filtraFallas(filas: readonly FilaDeFalla[], f: FiltrosDeFallas): FilaDeFalla[] {
  return filas.filter((r) => {
    if (f.app && r.app !== f.app) return false;
    if (f.origen && r.origen !== f.origen) return false;
    const dia = r.ultima_vez.slice(0, 10);
    if (f.desde && dia < f.desde) return false;
    if (f.hasta && dia > f.hasta) return false;
    return true;
  });
}

/** Agrupa por huella. El orden: lo visto más recientemente primero. */
export function agrupaFallas(filas: readonly FilaDeFalla[]): GrupoDeFallas[] {
  const porHuella = new Map<string, FilaDeFalla[]>();
  for (const f of filas) {
    const lista = porHuella.get(f.huella);
    if (lista) lista.push(f);
    else porHuella.set(f.huella, [f]);
  }
  const grupos: GrupoDeFallas[] = [];
  for (const [huella, lista] of porHuella) {
    const ordenadas = [...lista].sort((a, b) => (a.ultima_vez < b.ultima_vez ? 1 : a.ultima_vez > b.ultima_vez ? -1 : 0));
    const ultima = ordenadas[0];
    const usuarios = new Set<string>();
    for (const f of lista) {
      if (f.user_id) usuarios.add(f.user_id);
      for (const u of f.usuarios ?? []) usuarios.add(u);
    }
    grupos.push({
      huella,
      primera: lista.reduce((m, f) => (f.created_at < m ? f.created_at : m), lista[0].created_at),
      ultima: ultima.ultima_vez,
      veces: lista.reduce((s, f) => s + (f.veces || 0), 0),
      origen: ultima.origen,
      app: ultima.app,
      ruta: ultima.ruta,
      mensaje: ultima.mensaje,
      pila: ultima.pila ?? "",
      componente: ultima.componente,
      version: ultima.version,
      usuarios: usuarios.size,
      navegadores: [...new Set(lista.map((f) => f.navegador).filter((n): n is string => !!n))],
      versiones: [...new Set(lista.map((f) => f.version).filter((v): v is string => !!v))],
      escritorio: lista.some((f) => f.escritorio),
      filas: ordenadas,
    });
  }
  return grupos.sort((a, b) => (a.ultima < b.ultima ? 1 : a.ultima > b.ultima ? -1 : 0));
}
