import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { accionDeEnergia, GRACIA_DE_ENERGIA_MS, SE_VA, VUELVE } from "./pausa-de-energia";

/**
 * D-NEXT · Un parpadeo de energía no termina la jornada.
 *
 * El caso que se mide primero es el real: los dos cortes del 2026-10-10 en la laptop del dueño,
 * de nueve y de seis segundos, que costaron 16 y 31 minutos sin grabar.
 */

const leer = (r: string) => readFileSync(r, "utf8").split("\r\n").join("\n");
const T0 = Date.UTC(2026, 9, 10, 16, 16, 39); // el bloqueo medido, 11:16:39 hora local

describe("los dos cortes medidos el 2026-10-10", () => {
  it("nueve segundos bloqueado: la misma sesión sigue, y esos nueve no se pagan", () => {
    const pausa = accionDeEnergia({ evento: "lock-screen", ahoraMs: T0, pausadoDesdeMs: null, corriendo: true });
    expect(pausa).toEqual({ tipo: "pausa", desdeMs: T0 });

    const vuelta = accionDeEnergia({
      evento: "unlock-screen", ahoraMs: T0 + 9_000, pausadoDesdeMs: T0, corriendo: true,
    });
    expect(vuelta).toEqual({ tipo: "sigue", fueraSegundos: 9 });
  });

  it("seis segundos: lo mismo — no es que nueve pasen por poco", () => {
    expect(accionDeEnergia({ evento: "lock-screen", ahoraMs: T0, pausadoDesdeMs: T0 - 6_000, corriendo: true }))
      .toEqual({ tipo: "nada" }); // ya había pausa abierta: no se reinicia el reloj
    expect(accionDeEnergia({ evento: "resume", ahoraMs: T0, pausadoDesdeMs: T0 - 6_000, corriendo: true }))
      .toEqual({ tipo: "sigue", fueraSegundos: 6 });
  });
});

describe("dónde está la raya", () => {
  it("justo en la gracia sigue; un milisegundo más para", () => {
    const en = accionDeEnergia({ evento: "resume", ahoraMs: T0 + GRACIA_DE_ENERGIA_MS, pausadoDesdeMs: T0, corriendo: true });
    const pasado = accionDeEnergia({ evento: "resume", ahoraMs: T0 + GRACIA_DE_ENERGIA_MS + 1, pausadoDesdeMs: T0, corriendo: true });
    expect([en.tipo, pasado.tipo]).toEqual(["sigue", "para"]);
  });

  it("una suspensión de tres horas para Y declara las tres horas como tiempo fuera", () => {
    // Esto es lo que evita que el cierre pague el sueño: al volver de un `suspend` el reloj de
    // pared ha saltado, y `netSeconds` resta inactividad de `durationSeconds`.
    const tresHoras = 3 * 60 * 60_000;
    expect(accionDeEnergia({ evento: "resume", ahoraMs: T0 + tresHoras, pausadoDesdeMs: T0, corriendo: true }))
      .toEqual({ tipo: "para", fueraSegundos: 10_800 });
  });
});

describe("lo que no debe pasar", () => {
  it("sin cronómetro corriendo no se pausa ni se para, con ningún aviso", () => {
    // Cada aviso con la pausa en el estado que NO lo atajaría por otro camino: los de «se va» sin
    // pausa abierta (con una abierta devuelven "nada" igual, y entonces la prueba no mediría la
    // guarda de `corriendo`), y los de «vuelve» con una abierta.
    for (const evento of SE_VA) {
      expect([evento, accionDeEnergia({ evento, ahoraMs: T0, pausadoDesdeMs: null, corriendo: false }).tipo])
        .toEqual([evento, "nada"]);
    }
    for (const evento of VUELVE) {
      expect([evento, accionDeEnergia({ evento, ahoraMs: T0 + 9_000, pausadoDesdeMs: T0, corriendo: false }).tipo])
        .toEqual([evento, "nada"]);
    }
  });

  it("un `resume` sin pausa abierta no inventa tiempo fuera ni para la jornada", () => {
    for (const evento of VUELVE) {
      expect([evento, accionDeEnergia({ evento, ahoraMs: T0, pausadoDesdeMs: null, corriendo: true }).tipo])
        .toEqual([evento, "nada"]);
    }
  });

  it("el reloj hacia atrás no resta tiempo pagado ni dispara el cierre", () => {
    // Esta máquina registró hoy un cambio de hora del sistema (Kernel-General 1).
    expect(accionDeEnergia({ evento: "resume", ahoraMs: T0 - 60_000, pausadoDesdeMs: T0, corriendo: true }))
      .toEqual({ tipo: "sigue", fueraSegundos: 0 });
  });

  it("un aviso que no es de energía no toca el cronómetro", () => {
    for (const evento of ["on-battery", "shutdown", "", "LOCK-SCREEN"]) {
      expect([evento, accionDeEnergia({ evento, ahoraMs: T0 + 9_000, pausadoDesdeMs: T0, corriendo: true }).tipo])
        .toEqual([evento, "nada"]);
    }
  });
});

describe("la pantalla lo usa, y ya no para a la primera", () => {
  it("el cronómetro decide con la función probada y suma el tiempo fuera a inactividad", () => {
    const p = leer("src/components/timetracker/Cronometro.tsx");
    expect(p).toContain("accionDeEnergia(");
    // Lo que se arregló: antes el `lock-screen` llamaba a `stopRef.current()` en el mismo if.
    expect(p).not.toContain('if (reason !== "suspend" && reason !== "lock-screen") return;');
    const i = p.indexOf("accionDeEnergia(");
    const tramo = p.slice(i, i + 900);
    expect(tramo).toContain("idleRef.current += accion.fueraSegundos;");
    // Sin jsdom no se puede renderizar el componente (vitest corre en `node`), así que lo que se
    // fija es el texto del discriminador: con un `if (true)` ahí, «para» nunca pararía y ninguna
    // prueba de la librería se enteraría — se comprobó con ese mutante exacto.
    expect(tramo).toContain('if (accion.tipo === "sigue") {');
    expect(tramo).toContain("stopRef.current()");
    // Y que el camino de parar venga DESPUÉS del `return` del de seguir, no antes.
    expect(tramo.indexOf("stopRef.current()")).toBeGreaterThan(tramo.indexOf('if (accion.tipo === "sigue") {'));
  });
});
