import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * La guardia de etapas (`public.guard_delivery_stage()`, un trigger sobre `deliveries`) se redefine ENTERA en muchas
 * migraciones, y cada redefinición copia la anterior. El 17 de noviembre de 2026 la 321 la copió de la 173 en vez de
 * la 244: seis permisos (de las 185, 187, 188/213, 191/192, 196 y 244) dejaron de existir en producción durante ocho
 * días («No puedes editar una orden en etapa lista»). Las pruebas no lo vieron porque excluían la 321, la 322 y la 346
 * por nombre, «porque eran copias». Esta prueba lee las redefiniciones tal cual están en el repo.
 */

const DIR = join(process.cwd(), "supabase/migrations");
const leer = (fichero: string) => readFileSync(join(DIR, fichero), "utf8").replace(/\r\n/g, "\n");
const plano = (s: string) => s.replace(/\s+/g, " ");
const RE_DEF = /create or replace function public\.guard_delivery_stage\(\)/i;

type Definicion = { fichero: string; cuerpo: string };

/** Cada migración que define el guard, en orden numérico, con el texto de la función (de su cabecera a su `end`). */
function definiciones(): Definicion[] {
  return readdirSync(DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort((a, b) => parseInt(a, 10) - parseInt(b, 10) || a.localeCompare(b))
    .flatMap((fichero) => {
      const texto = leer(fichero);
      const m = RE_DEF.exec(texto);
      if (!m) return [];
      const resto = texto.slice(m.index);
      const fin = /end\s+\$function\$|end\s+\$\$/i.exec(resto);
      if (!fin) throw new Error(`${fichero}: la función no termina en «end $function$» ni en «end $$»`);
      return [{ fichero, cuerpo: resto.slice(0, fin.index + fin[0].length) }];
    });
}

/** Las líneas que cuentan: sin comentarios, sin sangrado, sin `;` final, y la cabecera en minúsculas. */
function lineas(cuerpo: string): string[] {
  return cuerpo.split("\n")
    .map((l) => l.replace(/\s+--.*$/, "").trim())
    .filter((l) => l && !l.startsWith("--"))
    .map((l) => l.replace(/^create or replace function/i, "create or replace function").replace(/;$/, ""));
}

/** Las líneas de `anterior` que `nueva` ya no tiene (comparadas tal cual, como conjunto). */
function perdidas(anterior: string, nueva: string): string[] {
  const enNueva = new Set(lineas(nueva));
  return [...new Set(lineas(anterior))].filter((l) => !enNueva.has(l));
}

/** Los `current_setting('rtg.<marca>'` que usa una definición: la marca con la que una orden se deja pasar. */
function marcas(cuerpo: string): Set<string> {
  return new Set([...cuerpo.matchAll(/current_setting\('(rtg\.[a-z_]+)'/g)].map((m) => m[1]));
}

/**
 * Líneas que una redefinición quita A PROPÓSITO. Para quitar un permiso del guard: añade aquí la línea exacta (tal como
 * la da `lineas()`: sin sangrado ni `;`) con el número de la decisión que lo quitó. Sin entrada aquí, la prueba de
 * «no se pierde nada» falla. Hoy vacía: la 349 no quita ninguna línea de la anterior.
 */
const QUITADAS_A_PROPOSITO: { linea: string; decision: string }[] = [];

/** Lo que la última redefinición tiene que seguir diciendo, pase lo que pase con el resto del guard. */
const PERMISOS_QUE_NO_SE_PUEDEN_PERDER = [
  "probe.role_notes := OLD.role_notes",
  "probe.order_suffix := OLD.order_suffix",
  "old_stage = 'picked_up' and new_stage = 'picked_up'",
  "r = 'sales' and new_stage = 'canceled'",
  "r = 'driver' and new_stage = 'canceled' and old_stage = 'picked_up'",
];

const DEFINICIONES = definiciones();
const ULTIMA = DEFINICIONES.at(-1)!;
const ANTERIOR = DEFINICIONES.at(-2)!;

/** La definición de la migración cuyo número es `n` (`"244"` → la 244). */
function de(n: string): Definicion {
  const d = DEFINICIONES.find((x) => x.fichero.startsWith(`${n}_`));
  if (!d) throw new Error(`la ${n} no define el guard`);
  return d;
}

describe("la guardia de etapas no pierde permisos al redefinirse", () => {
  it("hay definiciones y la última es la 349 (control)", () => {
    expect(DEFINICIONES.length).toBeGreaterThanOrEqual(3);
    expect(ULTIMA.fichero).toBe("349_guardia_recupera_permisos.sql");
    expect(ANTERIOR.fichero).toBe("346_intertienda_cliente.sql");
  });

  it("la última usa cada marca `rtg.*` que usa cualquier definición anterior", () => {
    const anteriores = new Set(DEFINICIONES.slice(0, -1).flatMap((d) => [...marcas(d.cuerpo)]));
    // Control: el analizador ve las tres marcas que sabemos que existen; si no, la lista de abajo estaría vacía.
    for (const m of ["rtg.reprogramar_orden", "rtg.tomar_orden", "rtg.relevo"]) expect(anteriores.has(m), m).toBe(true);
    for (const m of anteriores) {
      expect(ULTIMA.cuerpo, `${ULTIMA.fichero} no usa ${m}`).toContain(`current_setting('${m}'`);
    }
  });

  it("la última lleva los cinco permisos que la 321 y la 346 dejaron fuera", () => {
    for (const fragmento of PERMISOS_QUE_NO_SE_PUEDEN_PERDER) {
      expect(plano(ULTIMA.cuerpo), fragmento).toContain(fragmento);
    }
  });

  it("respecto de la anterior no desaparece ninguna línea, salvo las que están en QUITADAS_A_PROPOSITO", () => {
    const permitidas = new Set(QUITADAS_A_PROPOSITO.map((q) => q.linea));
    const sinPermiso = perdidas(ANTERIOR.cuerpo, ULTIMA.cuerpo).filter((l) => !permitidas.has(l));
    expect(sinPermiso, `${ANTERIOR.fichero} → ${ULTIMA.fichero}`).toEqual([]);
  });

  it("la 321, la 322 y la 346 NO son copias fieles de la 244: cada una pierde líneas (queda escrito el incidente)", () => {
    const base = de("244");
    for (const n of ["321", "322", "346"]) {
      expect(perdidas(base.cuerpo, de(n).cuerpo).length, `la ${n} pierde líneas de la 244`).toBeGreaterThan(0);
    }
    // Lo que la 346 dejó fuera de la 244 (y la 349 recupera): los seis permisos, en sus líneas distintivas.
    const enLa346 = perdidas(base.cuerpo, de("346").cuerpo);
    for (const l of [
      "probe.role_notes := OLD.role_notes",
      "probe.order_suffix := OLD.order_suffix",
      "if current_setting('rtg.tomar_orden', true) = OLD.id::text then",
      "or (r = 'sales' and new_stage = 'canceled' and old_stage in ('pending','approved','fulfilling','ready') and (OLD.created_by = auth.uid() or OLD.assigned_sales_rep = auth.uid()))",
    ]) {
      expect(enLa346, l).toContain(l);
    }
  });

  it("el detector ve la pérdida del incidente: de la 244 a la 321 faltan líneas, entre ellas el permiso de la nota", () => {
    const faltan = perdidas(de("244").cuerpo, de("321").cuerpo);
    expect(faltan.length).toBeGreaterThan(0);
    expect(faltan).toContain("probe.role_notes := OLD.role_notes");
  });
});
