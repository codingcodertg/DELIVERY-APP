import Link from "next/link";

export const dynamic = "force-dynamic";

/**
 * La raíz del módulo de promociones, **a propósito mínima**: la fase A solo monta el módulo (la
 * tarjeta, la casilla en Usuarios y el grupo de cada tienda en Datos). Subir el Excel es la fase B y
 * la tabla de decisiones la C.
 *
 * Existe ahora por la misma razón por la que existe `erp/page.tsx` (G-1, D-198): un módulo con
 * tarjeta y sin raíz da un 404, y un 404 se lee como una avería en vez de como «todavía no».
 * Prefiere decir en qué punto está y qué falta por configurar.
 *
 * No lee nada de la base: las tablas de la 140 están vacías hasta que alguien suba una ronda, y una
 * consulta que siempre devuelve cero filas solo añadiría una forma de fallar.
 */
export default function PromosIndex() {
  return (
    <div style={{ maxWidth: 720, margin: "0 auto", padding: "32px 16px" }}>
      <h1 style={{ marginTop: 0 }}>🏷️ RTG PROMOS</h1>
      <div className="card">
        <p style={{ marginTop: 0 }}>
          Aquí se aprobarán o rechazarán los productos en promoción, tienda por tienda.
          <br />
          <span className="hint">
            Here you will approve or reject promo products, store by store.
          </span>
        </p>
        <p>
          <b>Todavía no hay ninguna ronda.</b> Una ronda es un Excel de promociones subido por un
          administrador; la pantalla para subirlo llega en el siguiente paso.
          <br />
          <span className="hint">
            No promo round yet. A round is a promo workbook uploaded by an admin; the upload screen
            comes next.
          </span>
        </p>
        <p className="hint" style={{ marginBottom: 0 }}>
          Mientras tanto, lo que ya se puede dejar listo: en <b>Datos → Tiendas</b>, el{" "}
          <b>grupo de promociones</b> de cada tienda. Sin él, nadie puede aprobar nada — las tiendas
          que comparten grupo deciden juntas.
          <br />
          Meanwhile, what can already be set up: each store&apos;s <b>promo group</b>, in{" "}
          <b>Data → Stores</b>. Without it nobody can approve anything — stores sharing a group
          decide together.
        </p>
      </div>
      <p style={{ marginTop: 16 }}>
        <Link href="/home">← Volver / Back</Link>
      </p>
    </div>
  );
}
