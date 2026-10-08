import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  accionesDeLaFicha, accionPrincipal, MOTIVO_OCUPADO, ORDEN_DE_PRINCIPAL, type EntradaDeAcciones, type IdDeAccion,
} from "./acciones-de-la-ficha";
import {
  canApprove, canCreate, canDeliver, ordersLikeOfficeManager, preparaEnLaFicha, puedeAnular, puedeDeshacer, puedeEntregarYa,
  recogeEnLaFicha, STAGES,
} from "./constants";
import { puedeAgregarMaterial } from "./agregar-material";
import { puedeDejarEnTienda } from "./leave-at-store";
import type { AlcanceDeEdicion } from "./edicion-de-ventas";
import type { Stage, UserRole } from "./types";

// D-497 · Los botones de acción de la ficha en UN menú «Acciones ▾», con la principal fuera.
// El dueño (2026-10-07): «The action buttons will be a drop-down in the form view in the delivery app because is taking
// to many buttoms so now make it a dropdown».

const leer = (r: string) => readFileSync(join(process.cwd(), r), "utf8").split("\r\n").join("\n");
const plano = (s: string) => s.replace(/\s+/g, " ");

const CERRADO = { anular: false, rechazar: false, recoger: false, dejar: false, pod: false, motivoDeSalto: false, reentrega: false };

function entrada(role: UserRole, stage: Stage, cambios: Partial<EntradaDeAcciones> = {}): EntradaDeAcciones {
  return {
    yo: { id: "yo", role, full_name: "Yo Mismo", permissions: null },
    pedido: { stage, created_by: "yo", assigned_sales_rep: null, assigned_driver: "Yo Mismo", store: "Pharr" },
    edicion: "nada",
    etapaDeEnvio: "pending",
    puedeRecibirla: false,
    deshaceAqui: false,
    borraAqui: false,
    ocupado: false,
    salidaEn: null,
    llegadaEn: null,
    abierto: CERRADO,
    ...cambios,
  };
}
const principal = (e: EntradaDeAcciones) => accionesDeLaFicha(e).principal?.id ?? null;
const menu = (e: EntradaDeAcciones) => accionesDeLaFicha(e).menu.map((a) => a.id);

// ---------------------------------------------------------------------------------------------------------------
// 1 · La principal, por rol y etapa
// ---------------------------------------------------------------------------------------------------------------

describe("la principal: el paso que hace avanzar la orden para quien la mira", () => {
  it("ventas (su orden): enviar el borrador, reenviar la rechazada; en una pendiente no tiene ninguna", () => {
    expect(principal(entrada("sales", "draft", { edicion: "todo" }))).toBe("enviar");
    expect(principal(entrada("sales", "rejected", { edicion: "solo_fecha" }))).toBe("reenviar");
    expect(principal(entrada("sales", "pending", { edicion: "solo_fecha" }))).toBeNull();
    expect(principal(entrada("sales", "delivered"))).toBeNull();
  });

  it("gerente: aprobar, comenzar, marcar listo y recoger (D-397); en reparto y entregada, ninguna", () => {
    const g = (stage: Stage) => principal(entrada("manager", stage, { edicion: "todo" }));
    expect([g("pending"), g("approved"), g("fulfilling"), g("ready"), g("picked_up"), g("delivered"), g("canceled")])
      .toEqual(["aprobar", "comenzar", "marcar_listo", "recoger", null, null, null]);
  });

  it("almacén: comenzar, marcar listo, recoger, y en reparto marcar entregado — o RECIBIR la que llega a su tienda (D-409)", () => {
    const a = (stage: Stage, recibe = false) => principal(entrada("warehouse", stage, { puedeRecibirla: recibe }));
    expect([a("approved"), a("fulfilling"), a("ready"), a("picked_up")]).toEqual(["comenzar", "marcar_listo", "recoger", "marcar_entregado"]);
    expect(a("picked_up", true)).toBe("recibir");
    expect(a("pending")).toBeNull();
  });

  it("chofer: recoger y marcar entregado", () => {
    expect(principal(entrada("driver", "ready"))).toBe("recoger");
    expect(principal(entrada("driver", "picked_up"))).toBe("marcar_entregado");
    expect(principal(entrada("driver", "delivered"))).toBeNull();
  });

  it("logística y office aprueban la pendiente; office también envía su borrador", () => {
    expect(principal(entrada("logistics", "pending"))).toBe("aprobar");
    expect(principal(entrada("logistics", "approved"))).toBeNull();
    expect(principal(entrada("accounting", "pending"))).toBe("aprobar");
    expect(principal(entrada("accounting", "draft", { etapaDeEnvio: "approved" }))).toBe("enviar");
  });

  it("admin, en cada etapa", () => {
    const a = (stage: Stage) => principal(entrada("admin", stage, { edicion: "todo" }));
    expect(STAGES.map((s) => [s.key, a(s.key as Stage)])).toEqual([
      ["draft", "enviar"], ["pending", "aprobar"], ["rejected", "reenviar"], ["approved", "comenzar"],
      ["fulfilling", "marcar_listo"], ["ready", "recoger"], ["picked_up", "marcar_entregado"], ["delivered", null], ["canceled", null],
    ]);
  });

  it("`accionPrincipal`: la primera de su lista que esté, y ninguna con un paso abierto", () => {
    expect(accionPrincipal(["imprimir", "marcar_entregado", "editar"], [])).toBe("marcar_entregado");
    expect(accionPrincipal(["recibir", "marcar_entregado"], [])).toBe("recibir");
    expect(accionPrincipal(["imprimir", "editar"], [])).toBeNull();
    expect(accionPrincipal(["aprobar"], ["anular"])).toBeNull();
    expect(ORDEN_DE_PRINCIPAL).toEqual(["enviar", "reenviar", "aprobar", "comenzar", "marcar_listo", "recoger", "recibir", "marcar_entregado"]);
  });
});

// ---------------------------------------------------------------------------------------------------------------
// 2 · Lo que lleva el menú, en casos que se reconocen
// ---------------------------------------------------------------------------------------------------------------

describe("el menú, en las fichas de todos los días", () => {
  it("gerente en una programada: «Comenzar preparación» fuera; siete opciones dentro y «Cancelar orden» la última", () => {
    const e = entrada("manager", "approved", { edicion: "todo", deshaceAqui: true });
    expect(principal(e)).toBe("comenzar");
    expect(menu(e)).toEqual(["editar", "desbloquear", "entregar_ya", "deshacer", "imprimir", "duplicar", "anular"]);
  });

  it("gerente en una pendiente: «Aprobar» fuera; «Rechazar…» y «Cancelar orden» al final, en rojo", () => {
    const fa = accionesDeLaFicha(entrada("manager", "pending", { edicion: "todo" }));
    expect(fa.principal?.id).toBe("aprobar");
    expect(fa.menu.map((a) => [a.id, a.peligro])).toEqual([
      ["editar", false], ["imprimir", false], ["duplicar", false], ["rechazar", true], ["anular", true],
    ]);
  });

  it("ventas en su pendiente: sin principal, y «Editar fecha» (D-480) con «Agregar material» (D-339)", () => {
    const fa = accionesDeLaFicha(entrada("sales", "pending", { edicion: "solo_fecha" }));
    expect(fa.principal).toBeNull();
    expect(fa.menu.map((a) => a.id)).toEqual(["editar", "agregar_material", "imprimir", "duplicar"]);
    expect(fa.menu[0].texto).toEqual({ en: "Edit date", es: "Editar fecha" });
  });

  it("chofer en reparto: «Marcar entregado» fuera; «Llegué a la parada» y «Dejar en tienda» (D-224) dentro, sin comprobante", () => {
    const e = entrada("driver", "picked_up");
    expect(principal(e)).toBe("marcar_entregado");
    expect(menu(e)).toEqual(["llegue", "dejar_en_tienda"]);
  });

  it("chofer con una lista: «Recoger» fuera e «Iniciar viaje» dentro", () => {
    expect(menu(entrada("driver", "ready"))).toEqual(["iniciar_viaje"]);
  });

  it("almacén en una entregada de su tienda: «Deshacer etapa», «Registrar reentrega» y el comprobante", () => {
    const e = entrada("warehouse", "delivered", { deshaceAqui: true });
    expect(principal(e)).toBeNull();
    expect(menu(e)).toEqual(["deshacer", "reentrega", "imprimir"]);
  });

  it("admin en un borrador ajeno: «Eliminar» es la última, tras «Cancelar orden»", () => {
    const fa = accionesDeLaFicha(entrada("admin", "draft", { edicion: "todo", borraAqui: true }));
    expect(fa.principal?.id).toBe("enviar");
    expect(fa.menu.map((a) => a.id)).toEqual(["editar", "imprimir", "duplicar", "anular", "eliminar"]);
  });

  it("los textos son los de los botones de antes, en los dos idiomas", () => {
    const fa = accionesDeLaFicha(entrada("manager", "ready", { edicion: "todo", deshaceAqui: true }));
    const de = (id: IdDeAccion) => [...fa.menu, ...(fa.principal ? [fa.principal] : [])].find((a) => a.id === id)!;
    expect(de("recoger").texto).toEqual({ en: "🚚 Pick up", es: "🚚 Recoger" });
    expect(de("entregar_ya").texto).toEqual({ en: "✓ Mark delivered now", es: "✓ Marcar entregada ya" });
    expect(de("entregar_ya").titulo).toEqual({ en: "Close it as delivered, without a signature", es: "Cerrarla como entregada, sin firma" });
    // «Deshacer etapa» dice a dónde vuelve, como su `title` de antes.
    expect(de("deshacer").titulo).toEqual({ en: "Back to Preparing", es: "Volver a Preparando" });
    expect(de("duplicar").texto).toEqual({ en: "⧉ Duplicate", es: "⧉ Duplicar" });
    expect(de("imprimir").texto).toEqual({ en: "🖨 Slip", es: "🖨 Comprobante" });
  });
});

// ---------------------------------------------------------------------------------------------------------------
// 3 · Lo abierto quita su botón, como antes; y con un paso a medio hacer no hay principal
// ---------------------------------------------------------------------------------------------------------------

describe("pasos abiertos: su Atrás y su Confirmar a la vista, y la principal al menú", () => {
  it("anulando: «Cancelar orden» sale del menú, y «Aprobar» pasa al menú mientras tanto", () => {
    const fa = accionesDeLaFicha(entrada("manager", "pending", { abierto: { ...CERRADO, anular: true } }));
    expect(fa.pasos).toEqual(["anular"]);
    expect(fa.principal).toBeNull();
    expect(fa.menu.map((a) => a.id)).toEqual(["aprobar", "imprimir", "duplicar", "rechazar"]);
  });

  it("rechazando: no queda ni «Rechazar…» ni «Aprobar» (antes los sustituían Atrás y Confirmar rechazo)", () => {
    const fa = accionesDeLaFicha(entrada("manager", "pending", { abierto: { ...CERRADO, rechazar: true } }));
    expect(fa.pasos).toEqual(["rechazar"]);
    expect(fa.menu.map((a) => a.id)).not.toContain("rechazar");
    expect(fa.menu.map((a) => a.id)).not.toContain("aprobar");
  });

  it("contando la carga (oficina): ni «Recoger» ni «Iniciar viaje»", () => {
    const fa = accionesDeLaFicha(entrada("warehouse", "ready", { abierto: { ...CERRADO, recoger: true } }));
    expect(fa.pasos).toEqual(["recoger"]);
    expect(fa.principal).toBeNull();
    expect(fa.menu.map((a) => a.id)).toEqual(["imprimir"]);
  });

  it("dejando en tienda: su formulario fuera, y «Marcar entregado» al menú mientras tanto", () => {
    const fa = accionesDeLaFicha(entrada("driver", "picked_up", { abierto: { ...CERRADO, dejar: true } }));
    expect(fa.pasos).toEqual(["dejar"]);
    expect(fa.principal).toBeNull();
    expect(fa.menu.map((a) => a.id)).toEqual(["marcar_entregado", "llegue"]);
  });

  it("con la firma (POD) abierta no hay botones de la parada", () => {
    const fa = accionesDeLaFicha(entrada("driver", "picked_up", { abierto: { ...CERRADO, pod: true } }));
    expect([fa.principal, fa.menu, fa.pasos]).toEqual([null, [], []]);
  });

  it("con el motivo de D-361 abierto salen sus dos opciones; con la reentrega abierta, la suya", () => {
    expect(menu(entrada("manager", "ready", { deshaceAqui: true }))).toEqual(expect.arrayContaining(["entregar_ya", "deshacer"]));
    const conMotivo = menu(entrada("manager", "ready", { deshaceAqui: true, abierto: { ...CERRADO, motivoDeSalto: true } }));
    expect(conMotivo).not.toContain("entregar_ya");
    expect(conMotivo).not.toContain("deshacer");
    expect(menu(entrada("manager", "delivered"))).toContain("reentrega");
    expect(menu(entrada("manager", "delivered", { abierto: { ...CERRADO, reentrega: true } }))).not.toContain("reentrega");
  });

  it("«En camino desde…» y «Llegó…» son avisos a la vista, no opciones", () => {
    const sale = accionesDeLaFicha(entrada("driver", "ready", { salidaEn: "2026-10-07T15:21:00Z" }));
    expect(sale.avisos).toEqual([{ id: "en_camino", desde: "2026-10-07T15:21:00Z" }]);
    expect(sale.menu.map((a) => a.id)).not.toContain("iniciar_viaje");
    const llega = accionesDeLaFicha(entrada("driver", "picked_up", { llegadaEn: "2026-10-07T16:05:00Z" }));
    expect(llega.avisos).toEqual([{ id: "llego", desde: "2026-10-07T16:05:00Z" }]);
    expect(llega.menu.map((a) => a.id)).toEqual(["dejar_en_tienda"]);
    // El gerente recoge pero no conduce: ni «Iniciar viaje» ni el aviso.
    expect(accionesDeLaFicha(entrada("manager", "ready", { salidaEn: "2026-10-07T15:21:00Z" })).avisos).toEqual([]);
  });
});

describe("guardando: todo apagado y diciendo por qué", () => {
  it("cada opción y la principal llevan el motivo; la reentrega, que nunca se apagaba, sigue encendida", () => {
    const fa = accionesDeLaFicha(entrada("admin", "delivered", { ocupado: true, edicion: "todo", deshaceAqui: true }));
    expect(fa.menu.map((a) => [a.id, a.deshabilitada])).toEqual([
      ["editar", MOTIVO_OCUPADO], ["deshacer", MOTIVO_OCUPADO], ["reentrega", null], ["imprimir", MOTIVO_OCUPADO], ["duplicar", MOTIVO_OCUPADO],
    ]);
    expect(accionesDeLaFicha(entrada("driver", "picked_up", { ocupado: true })).principal?.deshabilitada).toEqual(MOTIVO_OCUPADO);
    expect(accionesDeLaFicha(entrada("driver", "picked_up")).principal?.deshabilitada).toBeNull();
  });
});

// ---------------------------------------------------------------------------------------------------------------
// 4 · Las mismas condiciones que tenían los botones: la ficha de antes, reconstruida, contra la de ahora
// ---------------------------------------------------------------------------------------------------------------

/**
 * Qué botones pintaba la ficha ANTES de D-497, copiado de lo que se quitó: `StageActions` entero, el pie
 * («Eliminar», «Duplicar»), la fila de D-361 y el bloque de la reentrega. Es la referencia: si la función nueva
 * enseña algo que antes no se enseñaba, o se deja algo, esta comparación lo dice.
 */
function botonesDeAntes(e: EntradaDeAcciones): Set<string> {
  const me = e.yo; const stage = e.pedido.stage; const ab = e.abierto; const b = new Set<string>();
  if (me.role !== "driver") b.add("imprimir");
  if (e.edicion !== "nada") b.add("editar");
  if (canCreate(me)) { if (stage === "draft") b.add("enviar"); if (stage === "rejected") b.add("reenviar"); }
  if (puedeAnular(me.role, stage)) b.add(ab.anular ? "paso:anular" : "anular");
  if (canApprove(me) && stage === "pending") { if (!ab.rechazar) { b.add("rechazar"); b.add("aprobar"); } else b.add("paso:rechazar"); }
  if (canApprove(me) && stage === "approved") b.add("desbloquear");
  if (puedeAgregarMaterial(me, e.pedido)) b.add("agregar_material");
  if (preparaEnLaFicha(me)) { if (stage === "approved") b.add("comenzar"); if (stage === "fulfilling") b.add("marcar_listo"); }
  if (recogeEnLaFicha(me) && stage === "ready") {
    if (!ab.recoger) {
      if (canDeliver(me) && !e.salidaEn) b.add("iniciar_viaje"); else if (canDeliver(me) && e.salidaEn) b.add("aviso:en_camino");
      b.add("recoger");
    } else b.add("paso:recoger");
  }
  if (e.puedeRecibirla && stage === "picked_up" && !ab.pod) b.add("recibir");
  else if (canDeliver(me) && stage === "picked_up" && !ab.pod) {
    if (!e.llegadaEn) b.add("llegue"); else b.add("aviso:llego");
    // <LeaveAtStore>: se pintaba si `puedeDejarEnTienda`; abierto, su formulario en el sitio del botón.
    if (puedeDejarEnTienda(e.pedido, me, canDeliver(me))) b.add(ab.dejar ? "paso:dejar" : "dejar_en_tienda");
    b.add("marcar_entregado");
  }
  if (e.borraAqui) b.add("eliminar");
  if (canCreate(me)) b.add("duplicar");
  if ((puedeEntregarYa(me.role, stage) || e.deshaceAqui) && !ab.motivoDeSalto) {
    if (puedeEntregarYa(me.role, stage)) b.add("entregar_ya");
    if (e.deshaceAqui) b.add("deshacer");
  }
  if (stage === "delivered" && (["admin", "warehouse", "driver"].includes(me.role) || ordersLikeOfficeManager(me.role)) && !ab.reentrega) b.add("reentrega");
  return b;
}

function botonesDeAhora(e: EntradaDeAcciones): Set<string> {
  const fa = accionesDeLaFicha(e);
  return new Set([
    ...(fa.principal ? [fa.principal.id] : []), ...fa.menu.map((a) => a.id),
    ...fa.pasos.map((p) => "paso:" + p), ...fa.avisos.map((a) => "aviso:" + a.id),
  ]);
}

/** Todas las fichas posibles que importan: cada rol (y ventas con permiso de aprobar), cada etapa, y lo que cambia. */
function* todas(): Generator<EntradaDeAcciones> {
  const quienes: { role: UserRole; permissions: string[] | null }[] = [
    ...(["admin", "manager", "sales", "warehouse", "driver", "logistics", "accounting"] as UserRole[]).map((role) => ({ role, permissions: null })),
    { role: "sales", permissions: ["approve"] },
  ];
  const abiertos = [CERRADO, ...Object.keys(CERRADO).map((k) => ({ ...CERRADO, [k]: true })), Object.fromEntries(Object.keys(CERRADO).map((k) => [k, true])) as typeof CERRADO];
  for (const q of quienes) for (const s of STAGES) for (const edicion of ["todo", "nada"] as AlcanceDeEdicion[]) for (const abierto of abiertos)
    for (const hora of [null, "2026-10-07T15:00:00Z"]) for (const recibe of [false, true]) for (const borra of [false, true])
      for (const suyo of [true, false]) {
        const stage = s.key as Stage;
        // `deshaceAqui` sale de `puedeDeshacer` en la ficha: nunca es cierto sin paso atrás.
        for (const deshace of [false, puedeDeshacer(q.role, stage, true)]) {
          yield {
            yo: { id: "yo", role: q.role, full_name: "Yo Mismo", permissions: q.permissions },
            pedido: { stage, created_by: suyo ? "yo" : "otro", assigned_sales_rep: null, assigned_driver: suyo ? "Yo Mismo" : "Otro", store: "Pharr" },
            edicion, etapaDeEnvio: "pending", puedeRecibirla: recibe, deshaceAqui: deshace, borraAqui: borra, ocupado: false,
            salidaEn: hora, llegadaEn: hora, abierto,
          };
        }
      }
}

describe("las mismas condiciones de antes, en todas las fichas posibles", () => {
  // Más de 30 000 fichas: los fallos se juntan y se comprueban al final (un `expect` por ficha no cabe en el tiempo de
  // una prueba cuando corre la suite entera).
  it("cada acción aparece exactamente cuando aparecía su botón (y cada paso abierto, cuando aparecía su Atrás/Confirmar)", () => {
    let vistas = 0;
    const distintas: unknown[] = [];
    for (const e of todas()) {
      const antes = [...botonesDeAntes(e)].sort().join();
      const ahora = [...botonesDeAhora(e)].sort().join();
      if (antes !== ahora && distintas.length < 5) distintas.push({ rol: e.yo.role, permisos: e.yo.permissions, etapa: e.pedido.stage, e, antes, ahora });
      vistas++;
    }
    expect(distintas).toEqual([]);
    expect(vistas).toBeGreaterThan(30000);
  }, 60000);

  it("y en todas: la principal no se repite en el menú, lo destructivo va al final, y la principal es la primera que toca", () => {
    const PELIGROSAS = ["rechazar", "anular", "eliminar"];
    const fallos: string[] = [];
    for (const e of todas()) {
      const fa = accionesDeLaFicha(e);
      const ids = fa.menu.map((a) => a.id);
      const donde = `${e.yo.role}/${e.pedido.stage}`;
      if (new Set(ids).size !== ids.length) fallos.push(donde + ": repetida");
      if (fa.principal) {
        if (ids.includes(fa.principal.id)) fallos.push(donde + ": la principal también en el menú");
        if (fa.pasos.length) fallos.push(donde + ": principal con un paso abierto");
        if (ORDEN_DE_PRINCIPAL.find((id) => id === fa.principal!.id || ids.includes(id)) !== fa.principal.id) fallos.push(donde + ": no es la primera que toca");
      } else if (fa.pasos.length === 0 && ids.some((id) => ORDEN_DE_PRINCIPAL.includes(id))) {
        fallos.push(donde + ": sin principal habiendo una");
      }
      const primeraRoja = fa.menu.findIndex((a) => a.peligro);
      if (primeraRoja >= 0 && fa.menu.slice(primeraRoja).some((a) => !a.peligro)) fallos.push(donde + ": algo normal tras lo destructivo");
      if (fa.menu.some((a) => a.peligro !== PELIGROSAS.includes(a.id))) fallos.push(donde + ": rojo donde no toca");
    }
    expect(fallos.slice(0, 5)).toEqual([]);
  }, 60000);
});

// ---------------------------------------------------------------------------------------------------------------
// 5 · La ficha usa la función (y enchufa cada acción a lo que hacía su botón)
// ---------------------------------------------------------------------------------------------------------------

describe("la ficha (OrderModal) pinta lo que dice la función", () => {
  const ficha = plano(leer("src/components/OrderModal.tsx"));
  const acciones = ficha.slice(ficha.indexOf("function StageActions({"), ficha.indexOf("// Click-to-call the customer via RingCentral"));

  it("`StageActions` llama a `accionesDeLaFicha` con el estado real de la ficha", () => {
    expect(acciones).toContain("const fa = accionesDeLaFicha({");
    expect(acciones).toContain("yo: me, pedido: { ...pedido, stage }, edicion, etapaDeEnvio, puedeRecibirla, deshaceAqui, borraAqui, ocupado: busy,");
    expect(acciones).toContain("salidaEn: departedAt, llegadaEn: arrivedAt,");
    expect(acciones).toContain("anular: showCancel, rechazar: showReject, recoger: pickupConfirmOpen, dejar: dejarAbierto, pod: podOpen,");
    expect(acciones).toContain("motivoDeSalto: motivoDeSaltoAbierto, reentrega: reentregaAbierta,");
    // Y la ficha le pasa lo que solo ella sabe calcular (las tiendas).
    expect(ficha).toContain("deshaceAqui={deshaceAqui} borraAqui={borraAqui} motivoDeSaltoAbierto={showEntregarYa || showDeshacer}");
    expect(ficha).toContain("reentregaAbierta={showRedeliver}");
  });

  it("cada acción hace lo que hacía su botón", () => {
    for (const enchufe of [
      "enviar: () => onMove(etapaDeEnvio),", "reenviar: () => onMove(etapaDeEnvio),", 'aprobar: () => onMove("approved"),',
      "comenzar: onRequestStart,", "marcar_listo: onRequestReady,", 'recoger: me.role === "driver" ? onQuickPickup : onRequestPickup,',
      "recibir: onReceive,", "marcar_entregado: onRequestDeliver,", "editar: onEdit,", "agregar_material: onAddMaterial,",
      "iniciar_viaje: onDepart,", "llegue: onArrive,", "dejar_en_tienda: () => setDejarAbierto(true),", 'desbloquear: () => onMove("pending"),',
      "entregar_ya: onEntregarYa,", "deshacer: onDeshacer,", "reentrega: onReentrega,", "imprimir: onPrint,", "duplicar: onDuplicate,",
      "rechazar: () => setShowReject(true),", "anular: () => setShowCancel(true),", "eliminar: onDelete,",
    ]) expect(acciones, enchufe).toContain(enchufe);
    expect(ficha).toContain('onEntregarYa={() => { setMotivoDeSalto(""); setShowEntregarYa(true); }}');
    expect(ficha).toContain('onDeshacer={() => { setMotivoDeSalto(""); setShowDeshacer(true); }}');
    expect(ficha).toContain("onReentrega={() => setShowRedeliver(true)}");
    expect(ficha).toContain("onDuplicate={() => void duplicate()} onDelete={() => void remove()}");
  });

  it("pinta el menú con `fa.menu`, los pasos con su Atrás y su Confirmar, y la principal con `fa.principal`", () => {
    expect(acciones).toContain('<MenuDeAcciones rotulo={t("Actions", "Acciones")} opciones={fa.menu.map((a) => ({');
    expect(acciones).toContain("deshabilitada: a.deshabilitada && tx(a.deshabilitada), alPulsar: alPulsar[a.id],");
    expect(acciones).toContain('{fa.pasos.includes("anular") && (');
    expect(acciones).toContain('disabled={busy || !cancelListo} onClick={() => onMove("canceled")}');
    expect(acciones).toContain('{fa.pasos.includes("rechazar") && (');
    expect(acciones).toContain('onClick={() => onMove("rejected", rejectReason.trim())}');
    expect(acciones).toContain('{fa.pasos.includes("recoger") && (');
    expect(acciones).toContain('<LeaveAtStore pedido={pedido} me={me} disabled={busy} abierto={dejarAbierto} onAbierto={setDejarAbierto} />');
    expect(acciones).toContain("const p = fa.principal;");
    expect(acciones).toContain('className={"btn " + p.estilo} onClick={alPulsar[p.id]} disabled={!!p.deshabilitada}');
    // Ya no queda la lista de botones a mano.
    expect(acciones).not.toContain("btns.push(");
  });

  it("«Dejar en tienda» (D-224): el mismo control compartido, abierto desde el menú; cerrado no pinta su propio botón", () => {
    const control = plano(leer("src/components/LeaveAtStore.tsx"));
    expect(control).toContain("const deFuera = abiertoDeFuera !== undefined;");
    expect(control).toContain("const setAbierto = (v: boolean) => { if (deFuera) onAbierto?.(v); else setAbiertoPropio(v); };");
    expect(control).toContain("if (!abierto) { if (deFuera) return null;");
    // Y la regla de quién lo ve es la misma en el menú que en el control.
    expect(leer("src/lib/acciones-de-la-ficha.ts")).toContain("if (puedeDejarEnTienda(pedido, yo, canDeliver(yo))) {");
    expect(control).toContain("if (!puedeDejarEnTienda(pedido, me, canDeliver(me))) return null;");
  });

  it("viendo la orden, el pie es solo `stageActions` (oficina) o «Cerrar» (chofer); Duplicar y Eliminar ya no están sueltos", () => {
    const pie = ficha.slice(ficha.indexOf('{paso === "completo" && ( <div className="modal-actions">'), ficha.indexOf("{viewSig && existing?.pod_signature"));
    expect(pie).toContain(') : existing && me.role === "driver" ? (');
    expect(pie).toContain(") : existing ? ( stageActions ) : null}");
    expect(pie).toContain("{editing && existing && borraAqui && (");
    expect(pie).not.toContain("onClick={duplicate}");
    // Las filas sueltas de D-361 y de la reentrega quedan solo con su formulario.
    expect(ficha).not.toContain('>✓ {t("Mark delivered now", "Marcar entregada ya")}</button>');
    expect(ficha).not.toContain('🔁 {t("Record re-delivery", "Registrar reentrega")}</button>');
  });
});
