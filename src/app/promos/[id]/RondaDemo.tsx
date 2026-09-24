"use client";

import { useEffect, useState } from "react";
import { esDecisorDePromos, puedeVerPrivadasDePromos, type ProductoDeCatalogo } from "@/lib/promos/tabla";
import { DECISIONES_DEMO, GRUPOS_DEMO_LISTA, PRODUCTOS_DEMO, RONDAS_DEMO, TIENDAS_CON_GRUPO_DEMO } from "@/lib/promos/demo";
import { tiendasSinGrupoDePromos } from "@/lib/promos/entrada";
import { TablaDeRonda } from "./TablaDeRonda";

/** Donde el modo demo guarda quién eres: la misma clave que escribe el selector «Ver como». */
const ME_DEMO = "rtg_deliveries_local_me";

/**
 * La ronda en **modo demo**, con el rol que diga «Ver como».
 *
 * La primera versión clavaba `rol="admin"`, y así un vendedor de mentira veía «Cerrar ronda» y —lo
 * que importa— **no había forma de medir las dos vistas que más importan**: qué ve y qué no ve un
 * vendedor, y qué puede hacer un gerente. El demo existe justo para eso, porque la queja del dueño
 * fue visual.
 *
 * Es un componente de cliente porque «Ver como» vive en `localStorage`, y una página de servidor no
 * lo puede leer. Mientras no se sepa el rol no se pinta nada: pintar como admin y cambiar medio
 * segundo después sería enseñar lo que no toca.
 *
 * **El demo SIMULA lo que la base haría**, y aquí eso importa: en la app de verdad, si alguien
 * puede ver el costo se deduce del dato —`promo_catalog.private` llegó nulo o no— pero en demo no
 * hay base que lo decida. Así que se enmascara aquí con `puedeVerPrivadasDePromos`, el gemelo de
 * `promo_can_see_private()`. Sin eso, el demo le enseñaría el costo a un vendedor y estaría
 * mintiendo sobre lo único que el módulo se pasó una migración entera cerrando.
 */
export function RondaDemo({ ronda }: { ronda: { id: string; label: string; closed_at: string | null } }) {
  const [rol, setRol] = useState<string | null>(null);

  useEffect(() => {
    const lee = () => {
      try {
        const crudo = localStorage.getItem(ME_DEMO);
        const me = crudo ? JSON.parse(crudo) : null;
        setRol(typeof me?.role === "string" ? me.role : "admin");
      } catch { setRol("admin"); }
    };
    lee();
    // El selector escribe en `localStorage` desde OTRA parte del árbol, así que no llega ningún
    // aviso por React. `storage` solo suena entre pestañas; para la misma, se vuelve a mirar al
    // recuperar el foco, que es lo que pasa al volver de cambiar el rol.
    window.addEventListener("focus", lee);
    return () => window.removeEventListener("focus", lee);
  }, []);

  if (rol === null) return null;

  const puedeVerPrivadas = puedeVerPrivadasDePromos(rol);
  const hayProductos = ronda.id === "demo-ronda-1";
  const productos: ProductoDeCatalogo[] = hayProductos
    ? PRODUCTOS_DEMO.map((p) => (puedeVerPrivadas ? p : { ...p, private: null }))
    : [];

  // En demo, quien no es admin pertenece al primer grupo: sin tienda no habría nada que mirar y la
  // vista del gerente —la que hay que medir— no se podría ver. Lo que NO se simula es quién decide:
  // eso sale de la misma función que usa la app, así que un vendedor sigue sin poder.
  const grupo = rol === "admin" ? null : GRUPOS_DEMO_LISTA[0];

  return (
    <TablaDeRonda
      ronda={ronda}
      productos={productos}
      decisiones={hayProductos ? DECISIONES_DEMO : []}
      rol={rol}
      userId={null}
      grupo={grupo}
      esDecisor={esDecisorDePromos({ rol, grupo })}
      esAdmin={rol === "admin"}
      gruposDelLibro={GRUPOS_DEMO_LISTA}
      rondas={RONDAS_DEMO}
      tiendasSinGrupo={tiendasSinGrupoDePromos(TIENDAS_CON_GRUPO_DEMO)}
    />
  );
}
