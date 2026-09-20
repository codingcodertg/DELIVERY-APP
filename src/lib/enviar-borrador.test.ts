import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { esEnvioDeBorrador, etapaAlEnviar, laBaseAceptaElEnvioAprobado } from "./enviar-borrador";
import { canTransition } from "./constants";
import type { QuienCrea } from "./cuenta-aprobacion";
import type { Stage, UserRole } from "./types";

/**
 * Enviar un borrador decide la etapa con la misma regla que crearlo (D-313).
 *
 * El dueño: *«auto approve all orders for now until further change»*. Con las tiendas aprobando
 * solas, crear dejaba la orden aprobada y **enviar un borrador** la mandaba igual a `pending`.
 */

const leer = (r: string) => readFileSync(join(process.cwd(), r), "utf8").split("\r\n").join("\n");
const plano = (s: string) => s.replace(/\s+/g, " ");

/** Nadie pide aprobación por ninguna vía: el caso del que se parte y se va cambiando un dato. */
const base: QuienCrea = {
  creaComoOficina: false, tiendaAutoAprueba: false, cuentaPideAprobacion: false, intertiendaSinPo: false,
};

describe("en qué etapa aterriza un borrador al enviarlo", () => {
  it("sin nada que la apruebe, sigue yendo a pendiente", () => {
    expect(etapaAlEnviar("sales", base)).toBe("pending");
    expect(etapaAlEnviar("manager", base)).toBe("pending");
  });

  it("ventas desde una tienda que aprueba sola: aprobada", () => {
    expect(etapaAlEnviar("sales", { ...base, tiendaAutoAprueba: true })).toBe("approved");
    expect(etapaAlEnviar("driver", { ...base, tiendaAutoAprueba: true })).toBe("approved");
  });

  it("oficina la aprueba aunque la tienda NO apruebe sola — es quien aprueba", () => {
    for (const rol of ["manager", "accounting"] as UserRole[]) {
      expect([rol, etapaAlEnviar(rol, { ...base, creaComoOficina: true })]).toEqual([rol, "approved"]);
    }
  });

  it("la cuenta marcada manda sobre todo lo demás (D-292), igual que al crear", () => {
    expect(etapaAlEnviar("sales", { ...base, tiendaAutoAprueba: true, cuentaPideAprobacion: true })).toBe("pending");
    expect(etapaAlEnviar("manager", { ...base, creaComoOficina: true, cuentaPideAprobacion: true })).toBe("pending");
  });

  it("una Intertienda sin PO sigue yendo a pendiente", () => {
    expect(etapaAlEnviar("sales", { ...base, tiendaAutoAprueba: true, intertiendaSinPo: true })).toBe("pending");
    expect(etapaAlEnviar("manager", { ...base, creaComoOficina: true, intertiendaSinPo: true })).toBe("pending");
  });

  it("un rol al que la base le diría que no se queda en pendiente, no se estrella", () => {
    // `create` se puede conceder a mano a cualquiera (`permissions`). Almacén y logística verían el
    // botón de enviar; la 127 no les acepta el salto a `approved`, así que la pantalla no lo intenta.
    for (const rol of ["warehouse", "logistics"] as UserRole[]) {
      expect([rol, etapaAlEnviar(rol, { ...base, tiendaAutoAprueba: true })]).toEqual([rol, "pending"]);
    }
  });

  it("el admin se salta el guard, así que le vale la tienda", () => {
    expect(etapaAlEnviar("admin", { ...base, tiendaAutoAprueba: true })).toBe("approved");
    // Pero no inventa: sin nada que la apruebe, su borrador también va a pendiente.
    expect(etapaAlEnviar("admin", base)).toBe("pending");
  });

  it("nunca aprueba lo que crear no habría aprobado: sin `naceAprobada`, ningún rol la levanta", () => {
    const roles: UserRole[] = ["admin", "manager", "accounting", "sales", "driver", "warehouse", "logistics"];
    for (const rol of roles) expect([rol, etapaAlEnviar(rol, base)]).toEqual([rol, "pending"]);
  });
});

describe("qué roles acepta la base en ese salto", () => {
  it("oficina sí, y sin depender de la tienda", () => {
    for (const rol of ["manager", "accounting", "admin"] as UserRole[]) {
      expect([rol, laBaseAceptaElEnvioAprobado(rol, false)]).toEqual([rol, true]);
    }
  });

  it("ventas y chofer solo con la tienda aprobando sola, que es el `auto` del guard", () => {
    for (const rol of ["sales", "driver"] as UserRole[]) {
      expect([rol, laBaseAceptaElEnvioAprobado(rol, true), laBaseAceptaElEnvioAprobado(rol, false)])
        .toEqual([rol, true, false]);
    }
  });

  it("el resto, no", () => {
    for (const rol of ["warehouse", "logistics"] as UserRole[]) {
      expect([rol, laBaseAceptaElEnvioAprobado(rol, true)]).toEqual([rol, false]);
    }
  });
});

describe("qué salto es «enviar»", () => {
  it("lo define de dónde SALE, y aterriza en cualquiera de las dos", () => {
    for (const desde of ["draft", "rejected"] as Stage[]) {
      for (const hacia of ["pending", "approved"] as Stage[]) {
        expect([desde, hacia, esEnvioDeBorrador(desde, hacia)]).toEqual([desde, hacia, true]);
      }
    }
  });

  it("desbloquear una aprobada NO es enviar, aunque acabe en pendiente", () => {
    expect(esEnvioDeBorrador("approved", "pending")).toBe(false);
    // Ni aprobar una pendiente, que es el gesto del gerente y tiene su propio botón.
    expect(esEnvioDeBorrador("pending", "approved")).toBe(false);
  });

  it("anular no es enviar", () => {
    expect(esEnvioDeBorrador("draft", "canceled")).toBe(false);
    expect(esEnvioDeBorrador("rejected", "canceled")).toBe(false);
  });
});

describe("la app deja pasar el salto que ahora se da", () => {
  it("`canTransition` lo permite desde borrador y desde rechazada", () => {
    // Sin esto, los dos proveedores lo rechazan antes de salir del navegador: la lista de saltos
    // legales solo tenía `pending`.
    expect(canTransition("draft", "approved")).toBe(true);
    expect(canTransition("rejected", "approved")).toBe(true);
  });

  it("y lo que D-049 impedía sigue impedido: no se salta al almacén", () => {
    expect(canTransition("draft", "fulfilling")).toBe(false);
    expect(canTransition("draft", "ready")).toBe(false);
    expect(canTransition("draft", "delivered")).toBe(false);
    expect(canTransition("rejected", "fulfilling")).toBe(false);
  });
});

describe("la pantalla llama a la decisión, no la copia", () => {
  const modal = leer("src/components/OrderModal.tsx");
  const llano = plano(modal);

  it("la etapa de envío sale de `etapaAlEnviar`, con los cuatro datos", () => {
    const i = llano.indexOf("const etapaDeEnvio = etapaAlEnviar(me.role, {");
    expect(i).toBeGreaterThan(-1);
    const args = llano.slice(i, llano.indexOf("});", i));
    for (const dato of ["creaComoOficina: ordersLikeOfficeManager(me.role)", "tiendaAutoAprueba: storeAutoApprove",
      "cuentaPideAprobacion", "intertiendaSinPo: intertiendaNeedsPo"]) {
      expect(args, dato).toContain(dato);
    }
  });

  it("enviar y reenviar mandan la orden a esa etapa, no a `pending` a secas", () => {
    expect(llano).toContain('if (stage === "draft") btns.push(<button key="submit"');
    expect(llano).toContain('if (stage === "rejected") btns.push(<button key="resub"');
    // El mutante que devuelve `onMove("pending")` a cualquiera de los dos cae aquí.
    const enviar = llano.slice(llano.indexOf('<button key="submit"'));
    const reenviar = llano.slice(llano.indexOf('<button key="resub"'));
    expect(enviar.slice(0, enviar.indexOf("</button>"))).toContain("onClick={() => onMove(etapaDeEnvio)}");
    expect(reenviar.slice(0, reenviar.indexOf("</button>"))).toContain("onClick={() => onMove(etapaDeEnvio)}");
  });

  it("y el botón dice cuál de las dos va a pasar", () => {
    // Un botón que aprueba y sigue diciendo «Enviar a aprobación» miente sobre lo que hace: detrás
    // no queda nadie por revisarla.
    expect(llano).toContain("const aprueba = etapaDeEnvio === \"approved\";");
    const enviar = llano.slice(llano.indexOf('<button key="submit"'));
    const etiqueta = enviar.slice(enviar.indexOf("disabled={busy}>"), enviar.indexOf("</button>"));
    expect(etiqueta).toContain("aprueba ?");
    expect(etiqueta).toContain('t("Submit (approved)", "Enviar (aprobada)")');
    expect(etiqueta).toContain('t("Submit for approval", "Enviar a aprobación")');
    const reenviar = llano.slice(llano.indexOf('<button key="resub"'));
    const etiqueta2 = reenviar.slice(reenviar.indexOf("disabled={busy}>"), reenviar.indexOf("</button>"));
    expect(etiqueta2).toContain('t("Resubmit (approved)", "Reenviar (aprobada)")');
    expect(etiqueta2).toContain('t("Resubmit", "Reenviar")');
  });

  it("el corte duro de D-049 se mira por de dónde sale, no por a dónde va", () => {
    // Si siguiera siendo solo `to === "pending"`, enviar desde una tienda que aprueba sola se
    // saltaría entera la puerta de los bultos y el documento.
    expect(llano).toContain('if ((to === "pending" || esEnvioDeBorrador(existing.stage, to)) && blockSubmit(existing)) return;');
  });

  it("enviar NO vuelve a mandar el SMS de seguimiento", () => {
    // Se manda al CREAR, y un borrador ya pasó por ahí: `save()` lo llama cuando `isNew`. Añadirlo
    // aquí sería un segundo SMS al cliente por la misma orden.
    const move = modal.slice(modal.indexOf("const move = async (to: Stage"), modal.indexOf("const depart = async ()"));
    expect(move).not.toContain("autoSendTracking");
    expect((modal.match(/await autoSendTracking\(row\)/g) ?? []).length).toBe(2);
  });

  it("los sellos de aprobación los pone `setStage`, no el botón", () => {
    // No se escriben aquí a propósito: `setStage` ya los pone cuando la etapa que llega es
    // `approved`, y dos sitios escribiendo lo mismo acaban discrepando.
    const proveedor = plano(leer("src/lib/data-provider.tsx"));
    expect(proveedor).toContain('if (stage === "approved") { patch.approved_by = me?.id ?? null; patch.approved_at = new Date().toISOString(); }');
    const local = plano(leer("src/lib/local-data-provider.tsx"));
    expect(local).toContain('if (stage === "approved") { patch.approved_by = me.id; patch.approved_at = new Date().toISOString(); }');
  });
});

describe("127: la base acepta exactamente eso", () => {
  const dir = "supabase/migrations";
  const nombre = "127_borrador_enviado_nace_aprobado.sql";
  const sql = leer(`${dir}/${nombre}`);
  const ejecutable = sql.split("\n").map((l) => l.replace(/--.*$/, "")).join("\n");
  const guard = (texto: string) => {
    const i = texto.search(/create or replace function public\.guard_delivery_stage\(\)/i);
    const j = texto.search(/\bend \$function\$\s*;/i);
    if (i < 0 || j < 0) throw new Error("no encuentro el guard");
    return texto.slice(i, j);
  };
  /** Las migraciones que definen el guard, en orden: la lista crece y la vigente es la última. */
  const conGuard = readdirSync(join(process.cwd(), dir))
    .filter((f) => f.endsWith(".sql") && leer(`${dir}/${f}`).includes("function public.guard_delivery_stage"))
    .sort();

  /**
   * De cuál se copió esta: la **inmediatamente anterior en la lista**, no «la penúltima».
   *
   * Nació como `conGuard.at(-2)` y eso valía solo mientras la 127 fuera la última. Dejó de serlo
   * con la 138 y las dos pruebas de abajo cayeron — que es justo para lo que estaban, pero lo que
   * hay que fijar es de dónde se copió, no qué puesto ocupa. Es el mismo patrón que ya usaban los
   * bloques de la 123 y la 125.
   */
  const yo = conGuard.indexOf(nombre);

  it("parte de la definición que estaba vigente al escribirla: la 125", () => {
    expect(yo).toBeGreaterThanOrEqual(1);
    expect(conGuard[yo - 1]).toBe("125_ventas_pone_la_factura.sql");
  });

  it("es la ANTERIOR con dos cambios y ninguno más", () => {
    const anterior = plano(guard(leer(`${dir}/${conGuard[yo - 1]}`).split("\n").map((l) => l.replace(/--.*$/, "")).join("\n")));
    const mio = plano(guard(ejecutable));
    // Primero, que los dos cambios ESTÉN: sin esto, un guard idéntico a la 125 pasaría la
    // comparación de abajo sin más.
    expect(mio).toContain("or (r in ('sales','driver') and new_stage = 'approved' and old_stage in ('draft','pending','rejected') and auto)");
    expect(mio).toContain("or (old_stage in ('draft','rejected') and new_stage = 'approved')");
    // Y ahora, que sea lo ÚNICO: se deshacen los dos y tiene que quedar la 125 letra por letra.
    const deshecho = plano(mio
      .replace("old_stage in ('draft','pending','rejected') and auto)", "old_stage in ('draft','pending') and auto)")
      .replace("or (old_stage in ('draft','rejected') and new_stage = 'approved') ", ""));
    expect(deshecho).toBe(anterior);
  });

  it("no se perdió por el camino lo de la 125, la 123 ni la 122", () => {
    // `create or replace` reemplaza la función ENTERA: copiar de una definición vieja borra en
    // silencio lo que vino después. La migración lo comprueba en la base; esto, en el repo.
    const mio = plano(guard(ejecutable));
    expect(mio).toContain("probe.invoice_num := OLD.invoice_num;");               // 125
    expect(mio).toContain("public.account_requires_approval(NEW.account)");        // 123
    expect(mio).toContain("A delivered order is not canceled");                    // 122
  });

  it("y lo dice al aplicarse, no solo aquí", () => {
    const chk = sql.slice(sql.indexOf("do $chk$"));
    for (const perdida of ["127: se perdio lo de la 125", "127: se perdio lo de la 123", "127: se perdio lo de la 122"]) {
      expect(chk, perdida).toContain(perdida);
    }
  });

  it("no lleva transacción propia ni escribe datos", () => {
    // Un `commit` dentro cierra el de fuera y un ensayo con ROLLBACK deja de serlo: le pasó a la 124.
    expect(ejecutable).not.toMatch(/^\s*(begin|commit|rollback)\s*;/im);
    expect(ejecutable).not.toMatch(/\b(update|delete from|insert into)\s+public\.deliveries\b/i);
  });

  it("se auto-inscribe en el registro", () => {
    const despues = sql.slice(sql.indexOf("-- @ledger-below"));
    expect(despues).toContain("insert into public.schema_migrations (name, checksum)");
    expect(despues).toContain(`values ('${nombre}'`);
  });
});
