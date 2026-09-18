import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  nombresEnLinea, normalizaTienda, quienPierdeLaTienda, ROLES_SIN_FILTRO_DE_TIENDA,
  seFiltraPorTienda, tiendasMarcadas, veTodasLasTiendas,
} from "./visibilidad-tienda";
import type { Profile, UserRole } from "./types";

/**
 * Qué tiendas ve cada persona (D-315, migración 131).
 *
 * **Quien decide es la política RLS**, así que aquí no hay ninguna copia en TypeScript de esa
 * decisión: lo que se prueba del `.sql` es el `.sql`, leyéndolo. Lo que se prueba de TypeScript es
 * lo que TypeScript decide de verdad: a quién se le ofrece el ajuste y a quién hay que avisar.
 *
 * Ninguna prueba toca la base ni aplica nada.
 */

const leer = (r: string) => readFileSync(r, "utf8").split("\r\n").join("\n");
const sql = leer("supabase/migrations/131_visibilidad_por_tienda.sql");
const sql083 = leer("supabase/migrations/083_deliveries_access.sql");

/**
 * Solo el SQL que se ejecuta, sin las líneas de comentario.
 *
 * Hace falta: la cabecera de la 131 lleva la **reversión** escrita, y la reversión es una copia de la
 * política vieja. Buscar un ancla en el fichero entero encontraba esa copia y medía el comentario en
 * vez del `alter policy` de verdad — dos de estas pruebas empezaron así, y pasaban o fallaban por
 * razones que no tenían nada que ver con lo que decían medir.
 */
const vivo = (texto: string) => texto.split("\n").filter((l) => !l.trim().startsWith("--")).join("\n");
const sqlVivo = vivo(sql);
const sql083Vivo = vivo(sql083);
const dialogo = leer("src/components/UserDialog.tsx");
const datos = leer("src/app/(app)/data/page.tsx");
const proveedor = leer("src/lib/data-provider.tsx");

const persona = (extra: Partial<Profile> = {}): Profile => ({
  id: "u1", full_name: "Ana", role: "sales", ...extra,
} as Profile);

describe("a quién le aplica el límite", () => {
  it("a ventas, office, gerente y logística sí", () => {
    for (const rol of ["sales", "accounting", "manager", "logistics"] as const) {
      expect(seFiltraPorTienda(rol), rol).toBe(true);
    }
  });

  it("al admin nunca, y al chofer y al almacén tampoco: tienen su propia rama", () => {
    for (const rol of ["admin", "driver", "warehouse"] as const) {
      expect(seFiltraPorTienda(rol), rol).toBe(false);
    }
  });

  it("y esa lista es la MISMA que excluye la política, leída del .sql", () => {
    // La prueba de verdad de esta pareja: si alguien añade un rol a la función de Postgres y no a la
    // constante, el diálogo ofrecería un ajuste que la base ignora, y al revés escondería uno que sí
    // aplica. Se comparan como conjuntos, no como texto.
    const m = sql.match(/p\.role in \(([^)]*)\)/);
    expect(m, "no encontré la lista de roles sin filtro en la 131").toBeTruthy();
    const enSql = (m![1].match(/'([^']+)'/g) ?? []).map((s) => s.slice(1, -1));
    expect([...enSql].sort()).toEqual([...ROLES_SIN_FILTRO_DE_TIENDA].sort());
  });

  it("sin rol, no se filtra", () => {
    expect(seFiltraPorTienda(null)).toBe(false);
    expect(seFiltraPorTienda(undefined)).toBe(false);
  });
});

describe("qué cuenta como «tiene tiendas marcadas»", () => {
  it("nada marcado es ver todas, que es como queda todo el mundo al aplicar la 131", () => {
    expect(veTodasLasTiendas(persona())).toBe(true);
    expect(veTodasLasTiendas(persona({ visible_stores: [] }))).toBe(true);
    expect(veTodasLasTiendas(persona({ visible_stores: null }))).toBe(true);
  });

  it("con una tienda marcada, ya no", () => {
    expect(veTodasLasTiendas(persona({ visible_stores: ["Tienda A"] }))).toBe(false);
  });

  it("el admin ve todas aunque tenga tiendas marcadas", () => {
    expect(veTodasLasTiendas(persona({ role: "admin", visible_stores: ["Tienda A"] }))).toBe(true);
  });

  it("los blancos y las repetidas no cuentan, y el orden se respeta", () => {
    expect(tiendasMarcadas(persona({ visible_stores: ["  ", "B", "b", "A"] }))).toEqual(["B", "A"]);
    expect(veTodasLasTiendas(persona({ visible_stores: ["   ", ""] }))).toBe(true);
  });

  it("los nombres se comparan sin espacios y sin mayúsculas, porque son texto libre", () => {
    expect(normalizaTienda("  McAllen ")).toBe("mcallen");
    expect(normalizaTienda(null)).toBe("");
  });
});

describe("a quién hay que avisar antes de renombrar una tienda", () => {
  const usuarios = [
    persona({ id: "a", full_name: "Ana", visible_stores: ["Tienda A"] }),
    persona({ id: "b", full_name: "Beto", visible_stores: ["tienda a ", "Tienda B"] }),
    persona({ id: "c", full_name: "Caro", visible_stores: ["Tienda B"] }),
    persona({ id: "d", full_name: "Dani", role: "admin", visible_stores: ["Tienda A"] }),
    persona({ id: "e", full_name: "Eva" }),
  ];

  it("los que la tienen marcada, y comparando sin mayúsculas ni espacios", () => {
    expect(quienPierdeLaTienda(usuarios, "Tienda A")).toEqual(["Ana", "Beto"]);
  });

  it("el admin no sale: no se filtra, así que no pierde nada", () => {
    expect(quienPierdeLaTienda(usuarios, "Tienda A")).not.toContain("Dani");
  });

  it("quien no tiene nada marcado tampoco", () => {
    expect(quienPierdeLaTienda(usuarios, "Tienda B")).toEqual(["Beto", "Caro"]);
  });

  it("una tienda que nadie tiene marcada no avisa de nada", () => {
    expect(quienPierdeLaTienda(usuarios, "Tienda Z")).toEqual([]);
    expect(quienPierdeLaTienda(usuarios, "  ")).toEqual([]);
  });

  it("los nombres se dicen en una línea, y muchos se resumen", () => {
    const mas = (n: number) => `${n} más`;
    expect(nombresEnLinea([], "y", mas)).toBe("");
    expect(nombresEnLinea(["Ana"], "y", mas)).toBe("Ana");
    expect(nombresEnLinea(["Ana", "Beto"], "y", mas)).toBe("Ana y Beto");
    expect(nombresEnLinea(["Ana", "Beto", "Caro", "Dani"], "y", mas)).toBe("Ana, Beto, Caro y 1 más");
  });
});

describe("la migración 131", () => {
  it("parte de la definición VIGENTE de la política, la de 083, sin tocarla", () => {
    // `create or replace`/`alter policy` reemplazan entero: copiar una versión vieja borraría en
    // silencio lo que añadió una posterior. El trozo por rol se compara literal con el de 083.
    const porRol = (texto: string) => {
      const i = texto.indexOf("or case (select p.role from public.profiles p");
      expect(i, "no encontré la rama por rol").toBeGreaterThan(-1);
      return texto.slice(i, texto.indexOf("end", i)).replace(/\s+/g, " ").trim();
    };
    expect(porRol(sqlVivo)).toBe(porRol(sql083Vivo));
  });

  it("y le añade la tienda como una cláusula más, sin quitar el acceso al módulo", () => {
    const politica = sqlVivo.slice(sqlVivo.indexOf('alter policy "auth read deliveries"'));
    expect(politica).toContain("(select public.has_deliveries_access())");
    expect(politica).toContain("public.tiendas_visibles()");
  });

  it("la llamada va envuelta en (select …): una vez por consulta, no por fila", () => {
    // La 080 existe justo porque un helper por fila se ejecutaba una vez por fila, y `deliveries` es
    // la tabla más leída de la app. Sin el envoltorio esto se nota en producción, no en las pruebas.
    const politica = sqlVivo.slice(sqlVivo.indexOf('alter policy "auth read deliveries"'), sqlVivo.indexOf("do $$"));
    //
    // Son CUATRO desde que la cláusula mira las tres columnas: el `is null` y una por columna. El
    // número guarda que no se caiga una columna en silencio; lo que de verdad se exige es que
    // NINGUNA vaya suelta, porque una sola sin `(select …)` vuelve a ser una llamada por fila.
    const llamadas = [...politica.matchAll(/public\.tiendas_visibles\(\)/g)];
    expect(llamadas.length).toBe(4);
    for (const m of llamadas) {
      expect(politica.slice(Math.max(0, m.index - 8), m.index)).toContain("(select ");
    }
  });

  it("la cláusula mira las TRES columnas de tienda, no solo «Vendido desde»", () => {
    // D-309, pedido del dueño: «in intertienda orders people from both pickup and delivery store can
    // see the order». Desde D-312, `store` y `pickup_name` son la tienda que MANDA el material y
    // `delivery_name` la que lo RECIBE. Con `store` a secas, a quien se le marcara la tienda que
    // recibe dejaba de ver justo las Intertiendas que iba a recibir — y eso no falla, no aparecen.
    const politica = sqlVivo.slice(sqlVivo.indexOf('alter policy "auth read deliveries"'), sqlVivo.indexOf("do $$"));
    for (const col of ["store", "pickup_name", "delivery_name"]) {
      expect(politica, col).toContain(`or lower(btrim(coalesce(${col}, ''))) = any ((select public.tiendas_visibles())::text[])`);
    }
  });

  it("y la migración se niega a quedarse mirando solo `store`", () => {
    // La autocomprobación corre EN LA BASE, que es donde se ve lo que quedó puesto: una prueba de
    // texto no puede saber qué política hay aplicada.
    expect(sql).toContain("qual like '%pickup_name%' and qual like '%delivery_name%'");
    expect(sql).toContain("raise exception 'la clausula de tienda quedo mirando solo store");
  });

  it("el ensayo mide la Intertienda por las dos tiendas, y que el filtro sigue filtrando", () => {
    // 11a sin 11b no mediría nada nuevo, y 11b sin 11c lo pasaría un filtro que no filtra nada.
    expect(sql).toContain("-- 11a. El vendedor de la tienda que MANDA la ve.");
    expect(sql).toContain("-- 11b. El de la tienda que RECIBE tambien.");
    expect(sql).toContain("-- 11c. Y no se abrio la puerta a todo");
    // Y dice de dónde salen los nombres en vez de inventárselos: son datos del dueño.
    expect(sql).toContain("order_type = 'Intertienda'");
    expect(sql).toContain("ESTE CASO NO SE PUEDE MEDIR");
  });

  it("deja pasar el sandbox de enseñanza y las órdenes sin tienda", () => {
    const clausula = sql.slice(sql.lastIndexOf("or (select public.tiendas_visibles()) is null") - 40);
    expect(clausula).toContain("is_training");
    expect(clausula).toContain("btrim(coalesce(store, '')) = ''");
  });

  it("compara normalizando, igual que el navegador, en las tres columnas", () => {
    for (const col of ["store", "pickup_name", "delivery_name"]) {
      expect(sql, col).toContain(`lower(btrim(coalesce(${col}, ''))) = any ((select public.tiendas_visibles())::text[])`);
    }
    expect(sql).toContain("array_agg(lower(btrim(x)))");
  });

  it("y el ANY lleva su `::text[]`, o la migración ni siquiera se aplica", () => {
    // Esto no lo puede ver ninguna prueba de texto por su cuenta, y por eso está escrito aquí:
    // `x = any ((select f()))` lo parsea Postgres como la forma SUBCONSULTA de ANY —compara `x`
    // contra cada FILA devuelta— y la única fila es un `text[]`, así que al aplicarla revienta con
    // `operator does not exist: text = text[]`. Los paréntesis dobles no la vuelven expresión de
    // array; el cast sí. Se descubrió ensayando la migración contra la base, no leyéndola.
    //
    // El cast se conserva junto al `(select ...)` a propósito: la otra forma que funciona
    // (`= any (public.tiendas_visibles())`) perdería la evaluación única por consulta.
    const politica = sqlVivo.slice(sqlVivo.indexOf('alter policy "auth read deliveries"'), sqlVivo.indexOf("do $$"));
    const conAny = politica.split("\n").filter((l) => l.includes("= any ((select public.tiendas_visibles())"));
    expect(conAny.length, "esperaba una comparación por cada columna de tienda").toBe(3);
    // Las TRES lo llevan: una sola sin el cast y la migración no llega a aplicarse.
    for (const l of conAny) expect(l).toContain("(select public.tiendas_visibles())::text[]");
  });

  it("vacío = ve todas, dicho en la función y no en la pantalla", () => {
    const fn = sql.slice(sql.indexOf("create or replace function public.tiendas_visibles"), sql.indexOf("revoke execute on function public.tiendas_visibles"));
    expect(fn).toContain("when p.visible_stores is null then null");
    expect(fn).toContain("when cardinality(p.visible_stores) = 0 then null");
  });

  it("mete visible_stores en el guardia, que es lo que hace que esto sea seguridad", () => {
    // Sin esto, la persona a la que se le limita la visibilidad escribe `visible_stores = '{}'` en su
    // propia fila —099 se lo permite— y vuelve a verlo todo.
    const guardia = sql.slice(sql.indexOf("create or replace function public.guard_profile_privileged_columns"), sql.indexOf("end $$;"));
    expect(guardia).toContain("NEW.visible_stores is distinct from OLD.visible_stores");
    for (const col of ["permissions", "store", "username", "erp_role", "title", "title_color"]) {
      expect(guardia, col).toContain(`NEW.${col} `);
    }
  });

  it("parte la política de escritura, que era la que anulaba la de lectura", () => {
    // D-100 lo dejó escrito y esta rama lo confirmó ensayando contra producción: `auth write
    // deliveries` es de tipo ALL, ALL incluye SELECT, y las permisivas se suman con OR. Con ella
    // puesta, la rama del chofer, la del almacén y la cláusula de tienda no deciden nada.
    expect(sqlVivo).toContain('drop policy if exists "auth write deliveries" on public.deliveries;');
    for (const [nombre, comando] of [
      ["deliveries insert", "for insert to authenticated"],
      ["deliveries update", "for update to authenticated"],
      ["deliveries delete", "for delete to authenticated"],
    ] as const) {
      const i = sqlVivo.indexOf(`create policy "${nombre}" on public.deliveries`);
      expect(i, nombre).toBeGreaterThan(-1);
      expect(sqlVivo.slice(i, sqlVivo.indexOf(";", i)), nombre).toContain(comando);
    }
  });

  it("y nadie gana ni pierde permiso de escribir: las tres llevan el mismo has_deliveries_access()", () => {
    // El corte va hasta el `alter policy` de lectura, no hasta el título del bloque: en `sqlVivo` no
    // hay comentarios, así que un ancla que viva en uno no existe y el `slice` se comía media
    // migración. Lo enseñó esta misma prueba, contando 5 donde tenían que ser 4.
    const bloque = sqlVivo.slice(
      sqlVivo.indexOf('drop policy if exists "auth write deliveries"'),
      sqlVivo.indexOf('alter policy "auth read deliveries"'),
    );
    // insert lleva with check; update, las dos; delete, using. Seis en total, todas la misma función.
    expect((bloque.match(/\(select public\.has_deliveries_access\(\)\)/g) ?? []).length).toBe(4);
    expect(bloque).not.toContain("tiendas_visibles");
  });

  it("NINGUNA migración lleva su propio begin/commit", () => {
    // Esta prueba nació al revés: exigía que el cambio de políticas fuera en una transacción propia,
    // y por eso llevaba `begin;`/`commit;`. **Se aplicó sola a producción durante un ensayo**
    // el 2026-09-17: un `begin` anidado es solo un WARNING en Postgres, pero el `commit` de dentro
    // CIERRA la transacción de fuera, así que el `ROLLBACK` del ensayo ya no deshacía nada.
    //
    // La atomicidad la pone quien aplica, envolviendo el fichero entero. Ninguna de las 123
    // migraciones anteriores llevaba transacción propia: la convención existía y la rompí.
    //
    // Se mira el repo entero, no solo esta: la siguiente vez el error será en otro fichero.
    const dir = join(process.cwd(), "supabase/migrations");
    const culpables = readdirSync(dir)
      .filter((f) => f.endsWith(".sql"))
      .filter((f) => vivo(readFileSync(join(dir, f), "utf8").split("\r\n").join("\n"))
        .split("\n")
        .some((l) => /^\s*(begin|commit|rollback)\s*;/i.test(l)));
    expect(culpables, "estas migraciones se aplicarían solas dentro de un ensayo con ROLLBACK").toEqual([]);
  });

  it("y se comprueba que no quede NINGUNA otra política que otorgue SELECT", () => {
    // Es la comprobación que habría cazado esto el primer día: una sola de tipo ALL vuelve a anularlo
    // todo, y no se nota porque la pantalla filtra igual.
    expect(sql).toContain("and permissive = 'PERMISSIVE' and cmd in ('ALL', 'SELECT')");
    expect(sql).toContain("raise exception 'hay otra politica que otorga SELECT sobre deliveries");
    expect(sql).toContain("raise exception 'faltan politicas de escritura en deliveries'");
  });

  it("el ensayo incluye al chofer y al almacén, que es a quienes les cambia lo que ven", () => {
    expect(sql).toContain("-- 8. El chofer pasa a ver SOLO lo suyo");
    expect(sql).toContain("-- 9. El almacen pasa a ver solo sus cinco etapas");
    expect(sql).toContain("-- 10. Escribir NO cambia para nadie");
  });

  it("se comprueba a sí misma, trae la matriz por rol con ROLLBACK y se inscribe", () => {
    expect(sql).toContain("raise exception 'la politica quedo sin la clausula de tienda'");
    expect(sql).toContain("raise exception 'el guardia de profiles quedo sin visible_stores");
    expect((sql.match(/rollback;/g) ?? []).length).toBeGreaterThanOrEqual(7);
    expect(sql).toContain("-- @ledger-below");
    expect(sql).toContain("values ('131_visibilidad_por_tienda.sql'");
  });

  it("y el ensayo empieza por contar lo de ANTES", () => {
    // Sin el punto de partida, «ve solo las de su tienda» podría estar pasando porque no ve ninguna.
    expect(sql).toContain("-- 0. Punto de partida");
  });
});

describe("`schema.sql` reabre la lectura, y por qué su bucle no se toca", () => {
  const esquema = leer("supabase/schema.sql");

  it("el bucle de la línea base crea la de escritura `for all`, que incluye SELECT", () => {
    // Es la MISMA forma que la 131 tiene que deshacer. Reconstruir el esquema sobre una base viva la
    // devuelve, y con ella el filtro por tienda deja de decidir nada sin que falle nada.
    const bucle = esquema.slice(esquema.indexOf("foreach t in array array['profiles'"), esquema.indexOf("end $$;", esquema.indexOf("foreach t in array array['profiles'")));
    expect(bucle).toContain(`create policy "auth write %1$s" on public.%1$s for all to authenticated`);
    expect(bucle).toContain(`create policy "auth read %1$s" on public.%1$s for select to authenticated using (true)`);
  });

  it("y 083 le hace `alter policy` a secas: quitarla de la línea base rompe la reconstrucción", () => {
    // Esta es la medición que decide NO arreglar el bucle. `alter policy` sobre una política que no
    // existe es un error, y una migración ya aplicada no se edita.
    expect(sql083Vivo).toContain(`alter policy "auth write deliveries" on public.deliveries`);
    expect(sql083Vivo).not.toContain(`create policy "auth write deliveries"`);
  });

  it("así que lo que hay es el aviso, escrito donde se cometería el error", () => {
    const antes = esquema.slice(0, esquema.indexOf("foreach t in array array['profiles'"));
    expect(antes).toContain("VOLVER A CORRERLO CONTRA UNA BASE VIVA LA ABRE ENTERA");
    expect(antes).toContain("083_deliveries_access.sql:69");
    expect(antes).toContain("hay que volver a aplicar las migraciones numeradas, en orden");
  });

  it("y la 131 se niega a convivir con cualquier otra política que otorgue SELECT", () => {
    // Es lo único que cazaría una reconstrucción a posteriori: el registro de migraciones no se
    // entera de que el esquema se volvió a correr.
    expect(sql).toContain("and permissive = 'PERMISSIVE' and cmd in ('ALL', 'SELECT')");
  });
});

describe("las pantallas", () => {
  it("el diálogo ofrece las casillas solo a quien la política filtra", () => {
    expect(dialogo).toContain('m.key === "deliveries" && seFiltraPorTienda(u.role)');
  });

  it("y avisa de que marcar casillas le cambia los números", () => {
    expect(dialogo).toContain("Solo estas tiendas — la lista de órdenes, el mapa, Cuentas, Resumen y los totales del panel pasan a ser de ellas.");
    expect(dialogo).toContain("Sin nada marcado: ve todas las tiendas, como hasta ahora.");
  });

  it("con un aviso aparte para logística, que es quien planifica", () => {
    expect(dialogo).toContain('u.role === "logistics"');
    expect(dialogo).toContain("el Gestor de Rutas solo enseña las paradas de esas tiendas");
  });

  it("Datos pregunta antes de renombrar, y no renombra si dicen que no", () => {
    const commit = datos.slice(datos.indexOf("const commit = async"), datos.indexOf("const remove = async"));
    expect(commit).toContain("avisoAlRenombrar(prev.name, name)");
    // `await` y `return`: sin el return, avisaría y renombraría igual.
    expect(commit).toContain("if (aviso && !(await confirmAction(aviso");
    expect(commit.slice(commit.indexOf("if (aviso &&"))).toContain("return;");
    // Y el aviso se calcula ANTES de escribir el registro nuevo.
    expect(commit.indexOf("avisoAlRenombrar(prev.name, name)")).toBeLessThan(commit.indexOf("registroDeLugar("));
  });

  it("y solo cuando el nombre cambia de verdad", () => {
    expect(datos).toContain("normalizaTienda(prev.name) !== normalizaTienda(name)");
  });

  it("el proveedor baja la columna, o el diálogo pintaría las casillas siempre vacías", () => {
    expect(proveedor).toContain("role, store, visible_stores, permissions");
  });

  it("y el cambio queda en el registro de seguridad, como los demás privilegios", () => {
    expect(proveedor).toContain('logSecurityClient(userId, "visible_stores_changed"');
  });
});
