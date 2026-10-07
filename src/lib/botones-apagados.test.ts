import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

// D-489. El dueño, 2026-10-06: «ya no quiero que queden esos botones así como faded, porque
// parecen que estuvieran desactivados… quita eso en toda la app… para que no haya botones más
// faded al menos que sí estén bloqueados». Se corrigió en el ORIGEN —las clases— y estas pruebas
// vigilan que no vuelva: que lo apagado sea solo lo deshabilitado (o bloqueado de verdad).

const leer = (ruta: string) => readFileSync(join(process.cwd(), ruta), "utf8").split("\r\n").join("\n");
const tt = leer("src/app/timetracker/timetracker.css");
const globales = leer("src/app/globals.css");

function tsx(dir: string): string[] {
  const out: string[] = [];
  for (const n of readdirSync(dir)) {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) out.push(...tsx(p));
    else if (p.endsWith(".tsx")) out.push(p);
  }
  return out;
}

describe("Time Tracker: el botón secundario y las pestañas de pantalla no parecen apagados", () => {
  it(".btn-ghost ya no es el relleno gris --tt-chip: lleva borde y tinte del acento", () => {
    expect(tt).not.toContain(".timetracker-module .btn-ghost{background:var(--tt-chip)");
    expect(tt).toContain(".timetracker-module .btn-ghost{background:color-mix(in srgb, var(--tt-accent) 12%, transparent);color:var(--tt-txt);box-shadow:inset 0 0 0 1.5px var(--tt-accent)}");
    // En la barra oscura los botones llevan su fondo propio en línea; sin el borde azul encima.
    expect(tt).toContain(".timetracker-module .topbar .btn-ghost{box-shadow:none}");
  });
  it("las pestañas DENTRO de una pantalla usan el color de texto, con borde, no el gris de la barra", () => {
    expect(tt).toContain(".timetracker-module .tabs button{color:var(--tt-txt)}");
    expect(tt).toContain(".timetracker-module .tabs button:not(.active){box-shadow:inset 0 0 0 1px var(--tt-line)}");
  });
  it("una opción (.motivo) no marcada se lee con el texto normal, no con el gris de etiqueta ni en mayúsculas", () => {
    expect(tt).toContain(".timetracker-module .motivo{color:var(--tt-txt);text-transform:none;letter-spacing:normal}");
  });
  it("apagado de verdad solo queda lo deshabilitado", () => {
    expect(tt).toContain(".timetracker-module button:disabled{opacity:.5;cursor:not-allowed}");
    expect(tt).toContain(".timetracker-module .motivo:has(input:disabled){opacity:.5;cursor:not-allowed}");
  });
  it("tu nombre en la barra (lleva a Mi cuenta) ya no va al 80 %", () => {
    expect(tt).not.toMatch(/a\.tt-me\{[^}]*opacity/);
  });
});

describe("en toda la app: lo inactivo apaga su TEXTO, no sus botones", () => {
  it("existe la clase, en el hub y con el gris del módulo dentro de Time Tracker", () => {
    expect(globales).toContain(".atenuado, .atenuado td { color: var(--gray); }");
    expect(tt).toContain(".timetracker-module .atenuado,.timetracker-module .atenuado td{color:var(--tt-muted)}");
    expect(globales).toContain(".chip.chip-vacio { border-style: dashed; }");
  });
  it("ninguna fila, bloque de pregunta ni botón se apaga con opacity en línea (salvo un candado de verdad)", () => {
    const malos: string[] = [];
    for (const f of tsx(join(process.cwd(), "src"))) {
      const lineas = readFileSync(f, "utf8").split(/\r?\n/);
      lineas.forEach((l, i) => {
        if (!/opacity: ?0?\.\d/.test(l)) return;
        // Una ruta BLOQUEADA con candado sí se ve apagada: es lo que pidió el dueño («al menos que
        // sí estén bloqueados»). Está pegada a su aria-disabled.
        if (l.includes("bloqueada(u.key) ? { opacity: 0.5 }")) return;
        // La fila que se está ARRASTRANDO se ve translúcida mientras dura el gesto: es la sombra del
        // arrastre, no un estado en reposo.
        if (l.includes("esLaArrastrada ? { opacity: 0.5 }")) return;
        // La etiqueta que lleva ese estilo: la última que se abre en esta línea o en las de antes.
        let tag = "";
        for (let j = i; j >= Math.max(0, i - 4) && !tag; j--) {
          const hasta = j === i ? lineas[j].indexOf("opacity") : lineas[j].length;
          const abiertas = [...lineas[j].slice(0, hasta).matchAll(/<[a-z]+\b[^<]*/g)];
          if (abiertas.length) tag = abiertas[abiertas.length - 1][0];
        }
        if (/^<(tr|button)\b|className="(q-block|chip|acct-row)/.test(tag)) malos.push(`${f}:${i + 1}`);
      });
    }
    expect(malos).toEqual([]);
  });
  it("las filas que se apagaban ahora llevan la clase", () => {
    expect(leer("src/app/timetracker/(timetracker)/people/page.tsx")).toContain('<tr className={inactive ? "atenuado" : undefined}>');
    expect(leer("src/components/timetracker/VehiclesSection.tsx")).toContain('<tr key={v.id} className={v.active ? undefined : "atenuado"}>');
    expect(leer("src/components/timetracker/GeofenceSection.tsx")).toContain('<tr key={f.id} className={f.active ? undefined : "atenuado"}>');
    expect(leer("src/app/recruiting/(recruiting)/employees/page.tsx")).toContain('className={deBaja ? "atenuado" : undefined}>');
    expect(leer("src/app/recruiting/(recruiting)/questions/page.tsx")).toContain('className={"q-block" + (q.active ? "" : " atenuado")}');
    expect(leer("src/components/recruiting/ModalHost.tsx")).toContain('<div key={q.id} className={"q-block" + (a.skipped ? " atenuado" : "")}>');
    expect(leer("src/app/(app)/track/page.tsx")).toContain('className={"chip" + (d === fecha ? " on" : "") + (!has && d !== fecha ? " chip-vacio" : "")}');
  });
  it("Recruiting: ningún botón con el texto en gris (Cancelar, Cerrar, Quitar…) — son btn-ghost", () => {
    const malos: string[] = [];
    for (const f of tsx(join(process.cwd(), "src"))) {
      const t = readFileSync(f, "utf8");
      if (/className="(btn|chip)[^"]*" style=\{\{ color: "var\(--gray\)" \}\}/.test(t)) malos.push(f);
    }
    expect(malos).toEqual([]);
    expect(leer("src/components/recruiting/ModalHost.tsx")).toContain('<button className="btn btn-ghost btn-sm" onClick={() => toggleSkip(q.id)}>');
  });
});
