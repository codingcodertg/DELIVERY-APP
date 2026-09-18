import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { ASSIGNED_KIND, assignmentNotification } from "./notifications";

/**
 * La notificación de «orden asignada» al chofer no había funcionado nunca (D-308).
 *
 * Medido: 0 filas con `kind='assigned'` en `public.notifications` en toda la historia. La causa: el
 * insert de `updateDelivery` llevaba `.select("id")` para dar el id a `/api/push`, y `INSERT …
 * RETURNING` aplica la política de SELECT a la fila devuelta — `notif read own` (`user_id =
 * auth.uid()`). Quien asigna no es el chofer, así que Postgres rechazaba la sentencia entera, y el
 * código descartaba el `error`. Los demás inserts de notificaciones van sin `.select()` y funcionan.
 *
 * El arreglo no necesita migración: el id se genera en el cliente, se inserta sin RETURNING y el
 * push se lanza con ese id. Y se barre `src/` para que ningún insert en `notifications` vuelva a
 * llevar `.select(`, que es cómo el mismo patrón entraría por otro `kind`.
 */

const leer = (r: string) => readFileSync(r, "utf8").split("\r\n").join("\n");
const sinComentarios = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
const provider = sinComentarios(leer("src/lib/data-provider.tsx"));
const mapa = sinComentarios(leer("src/app/(app)/map/page.tsx"));

function ficherosDeSrc(dir = "src"): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) return ficherosDeSrc(p);
    return /\.(ts|tsx)$/.test(n) && !/\.test\.tsx?$/.test(n) ? [p.replace(/\\/g, "/")] : [];
  });
}

/** Cada `from("notifications").insert(` de src/, con lo que sigue en la misma sentencia. */
function insertsEnNotificaciones(src: string): string[] {
  const out: string[] = [];
  const re = /from\("notifications"\)\s*\.insert\(/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) {
    // Hasta el final de la sentencia: el primer `;` que cierra el `await`.
    const fin = src.indexOf(";", m.index);
    out.push(src.slice(m.index, fin === -1 ? m.index + 200 : fin));
  }
  return out;
}

describe("ningún insert en notifications pide la fila de vuelta", () => {
  const encontrados = ficherosDeSrc().flatMap((f) => insertsEnNotificaciones(sinComentarios(leer(f))).map((s) => ({ f, s })));

  it("los inserts existen (control): el de asignar, los dos de la campana y el de ayuda", () => {
    expect(encontrados.length).toBeGreaterThanOrEqual(4);
    expect(encontrados.map((e) => e.f)).toContain("src/lib/data-provider.tsx");
  });

  it("y ninguno lleva .select( — el RETURNING es lo que la política de lectura rechaza", () => {
    for (const e of encontrados) expect(e.s, `${e.f}: ${e.s.slice(0, 80)}`).not.toContain(".select(");
  });

  it("el detector ve un .select( pegado a un insert (control)", () => {
    expect(insertsEnNotificaciones('await x.from("notifications").insert([s]).select("id");')[0]).toContain(".select(");
  });
});

describe("el aviso de asignación", () => {
  const sitio = provider.slice(provider.indexOf('if ("assigned_driver" in patch'), provider.indexOf("void ubicarSiHaceFalta(id"));

  it("genera el id en el cliente e inserta sin pedirlo de vuelta", () => {
    expect(sitio).toContain("const id = globalThis.crypto?.randomUUID?.();");
    expect(sitio).toContain('.from("notifications").insert([id ? { id, ...seed } : seed])');
    expect(sitio).not.toContain(".select(");
  });

  it("registra el error en vez de descartarlo, como los otros dos inserts", () => {
    expect(sitio).toContain('if (error) console.error("notification insert failed:", error.message);');
    expect(sitio).not.toContain("const { data: made }");
  });

  it("y empuja al teléfono con ESE id, solo si hubo id y el insert no falló", () => {
    expect(sitio).toContain("if (id && !error) {");
    expect(sitio).toContain("body: JSON.stringify({ notification_id: id }),");
  });

  it("sin randomUUID no se inventa un id: se inserta sin él y no se empuja", () => {
    // Un id que no sea uuid reventaría la columna; sin push, la campana sigue llegando por tiempo real.
    expect(sitio).toContain("insert([id ? { id, ...seed } : seed])");
    expect(sitio).not.toMatch(/Date\.now\(\)-\$\{|Math\.random/);
  });
});

describe("el mapa ya no avisa dos veces", () => {
  it("no empuja semillas «assigned» a mano: updateDelivery ya avisa, y con la regla de assignmentNotification", () => {
    expect(mapa).not.toContain('kind: "assigned"');
    expect(mapa).not.toContain("pushNotifs(notifs)");
  });

  it("la regla que avisa sigue siendo la de siempre: no al chofer por su propia acción, no a quien no es chofer", () => {
    const users = [
      { id: "d1", full_name: "Dani", role: "driver" as const },
      { id: "s1", full_name: "Dani", role: "sales" as const },
    ];
    expect(assignmentNotification({ driverName: "Dani", order_no: 1, delivery_id: "o", users: users as never, actorId: "x" })?.user_id).toBe("d1");
    expect(assignmentNotification({ driverName: "Dani", order_no: 1, delivery_id: "o", users: users as never, actorId: "d1" })).toBeNull();
    expect(ASSIGNED_KIND).toBe("assigned");
  });
});
