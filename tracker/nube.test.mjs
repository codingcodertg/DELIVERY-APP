import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { paginaEnVivoHTML } from "./pagina-en-vivo.mjs";

/**
 * El tracker en la base (migración 144) y la página que el dueño abre con su usuario.
 *
 * **Lo que se puede medir aquí y lo que no.** Sin Postgres, las reglas de la migración se comprueban
 * leyendo el `.sql`: no es lo mismo que ejecutarla, y por eso la matriz de 12 casos con `ROLLBACK`
 * del plan la corre el orquestador contra la base. Lo que estas pruebas sí impiden es que alguien
 * cambie el fichero y deshaga la regla sin enterarse — que es el otro camino por el que se pierde.
 */

const SQL = readFileSync(join(process.cwd(), "supabase", "migrations", "144_tracker_tareas.sql"), "utf8");

/**
 * El cuerpo del trigger, sin comentarios.
 *
 * Hace falta porque la primera versión de la prueba de abajo se puso roja por MI PROPIO COMENTARIO:
 * el `.sql` explica que no lleva el `if auth.uid() is null then return NEW` de los `guard_*`, y la
 * negativa no distingue la prosa del código. Y el bloque de auto-comprobación también nombra esa
 * cadena dentro de un `position(...)`, así que tampoco vale mirar el fichero entero.
 */
const CUERPO_TRIGGER = (() => {
  const i = SQL.indexOf("create or replace function public.tracker_guard_completado()");
  const j = SQL.indexOf("drop trigger if exists", i);
  return SQL.slice(i, j).replace(/^\s*--.*$/gm, "");
})();

describe("la 144: «Completado» solo lo pone el dueño desde su sesión", () => {
  it("el trigger NO lleva el «sin sesión, pasa todo» de los guard_*", () => {
    // Es la línea que decide todo. Los guard_* de este repo empiezan con
    // `if auth.uid() is null then return NEW` (009_routes.sql:26) y aquí eso sería justo al revés de
    // lo pedido: quien no debe poder cerrar una tarea es, sobre todo, un script.
    expect(CUERPO_TRIGGER).not.toContain("auth.uid() is null then return NEW");
    expect(CUERPO_TRIGGER).toContain("if auth.uid() is null then");
    expect(CUERPO_TRIGGER).toContain("raise exception 'tracker: «Completado» solo se pone desde la sesion del dueno");
    // Control: que el recorte no esté vacío. Sin esto, un `indexOf` que fallara dejaría la negativa
    // pasando sobre una cadena de cero caracteres, que es el verde más silencioso que hay.
    expect(CUERPO_TRIGGER.length).toBeGreaterThan(400);
  });

  it("y además exige que la sesión sea de admin", () => {
    expect(CUERPO_TRIGGER).toContain("if not public.is_admin() then");
  });

  it("el sello de quién cerró lo pone la base, no el cliente", () => {
    // Un campo de auditoría que el cliente puede escribir no es auditoría.
    expect(SQL).toContain("NEW.completado_por := auth.uid();");
    expect(SQL).toContain("NEW.completado_en  := now();");
  });

  it("y al deshacer se borra el sello, para que no quede mintiendo", () => {
    expect(SQL).toContain("NEW.completado_por := null;");
    expect(SQL).toContain("NEW.completado_en  := null;");
  });

  it("la migración se comprueba a sí misma al aplicarse", () => {
    // El bloque `do $chk$` es lo que convierte «lo escribí bien» en «la base lo confirma», y corre
    // en la misma transacción: si algo no cuadra, la migración entera se deshace.
    expect(SQL).toContain("do $chk$");
    expect(SQL).toContain("se esperaban 4 politicas para authenticated");
    expect(SQL).toContain("hay una politica FOR ALL para authenticated");
    expect(SQL).toContain("el trigger dejaria pasar a service-role");
  });
});

describe("la 144: las políticas", () => {
  it("son cuatro, una por comando, y ninguna FOR ALL para authenticated", () => {
    // Una permisiva FOR ALL también concede SELECT, y las permisivas se suman con OR: una sola
    // política ancha deja sin efecto a las demás. Aquí ya se pagó.
    for (const cmd of ["for select to authenticated", "for insert to authenticated",
      "for update to authenticated", "for delete to authenticated"]) {
      expect([cmd, SQL.includes(cmd)], cmd).toEqual([cmd, true]);
    }
    expect(SQL).not.toContain("for all to authenticated");
  });

  it("las cuatro miran `is_admin()`", () => {
    const bloque = SQL.slice(SQL.indexOf('create policy "tracker select admin"'), SQL.indexOf("do $srv$"));
    expect(bloque.split("public.is_admin()").length - 1).toBe(5);   // 4 using + 1 with check del update
  });

  it("y `service_role` va explícito, sin fiarlo a `bypassrls`", () => {
    // Si la suposición de bypassrls fuera falsa, las políticas `to authenticated` dejarían la tabla
    // cerrada también para los scripts: para otro rol no hay NINGUNA política aplicable.
    expect(SQL).toContain("where rolname = 'service_role'");
    expect(SQL).toContain("grant select, insert, update, delete on public.tracker_tareas to service_role");
  });

  it("la RLS está activada y forzada", () => {
    expect(SQL).toContain("enable row level security");
    expect(SQL).toContain("force  row level security");
  });
});

describe("la 144: la forma que exige este repo", () => {
  it("no trae `begin` ni `commit` propios", () => {
    // Un commit dentro cierra la transacción de fuera: la 124 se aplicó sola en un ensayo con
    // ROLLBACK justo por esto.
    const cuerpo = SQL.split("-- @ledger-below")[0];
    expect(cuerpo).not.toMatch(/^\s*begin\s*;/im);
    expect(cuerpo).not.toMatch(/^\s*commit\s*;/im);
  });

  it("se auto-inscribe en el registro, tras el marcador", () => {
    const [, ledger] = SQL.split("-- @ledger-below");
    expect(ledger).toContain("insert into public.schema_migrations");
    expect(ledger).toContain("'144_tracker_tareas.sql'");
    expect(ledger).toContain("on conflict (name) do nothing");
  });

  it("y el checksum inscrito es el que calcula `migrate-status`", () => {
    // El sha se toma del cuerpo ANTERIOR al marcador, para que el propio registro no lo cambie.
    // Sin esta prueba, un retoque del `.sql` deja el checksum viejo y `migrate-status` diría
    // «cambiada» para siempre.
    const salida = execFileSync(process.execPath,
      [join(process.cwd(), "scripts", "db", "migrate-status.mjs"), "--sum", "144_tracker_tareas.sql"],
      { encoding: "utf8" });
    const calculado = salida.match(/'([0-9a-f]{64})'/)?.[1];
    const inscrito = SQL.split("-- @ledger-below")[1].match(/'([0-9a-f]{64})'/)?.[1];
    expect([calculado, inscrito]).toEqual([inscrito, inscrito]);
  });
});

describe("la página en vivo", () => {
  const html = paginaEnVivoHTML({ url: "https://ejemplo.supabase.co", anonKey: "eyJhbGciOiJIUzI1NiJ9.anon.firma" });

  it("NO lleva ninguna llave de servicio, y se niega si se la pasan", () => {
    // Es la que lo abre todo saltándose la RLS. En una página que puede acabar en un bucket público,
    // eso no es un descuido: es publicar la base entera.
    expect(html).not.toContain("service_role");
    expect(html).not.toContain("SUPABASE_SERVICE");
    expect(() => paginaEnVivoHTML({ url: "https://x.co", anonKey: "algo.service_role.algo" })).toThrow(/service-role/);
  });

  it("no lleva NINGUNA tarea dentro: las pide al abrirse", () => {
    // Esto es lo que permite subirla a un bucket público sin publicar de paso todo lo que el dueño
    // ha pedido en dos meses.
    expect(html).not.toMatch(/"T-\d{4}"/);
    expect(html).toContain('.from("tracker_tareas").select("*")');
  });

  it("el botón cierra de UN clic y sin diálogo, y el mismo botón deshace", () => {
    // El dueño: «si yo le doy a comprobar que se cambie sin pedir diálogo».
    expect(html).not.toContain("confirm(");
    expect(html).toContain("data-cerrar");
    expect(html).toContain("Marcar completado");
    expect(html).toContain("\\u2713 Completado");
  });

  it("y un update que la RLS rechaza NO se lee como guardado", () => {
    // PostgREST devuelve limpio y sin filas cuando la RLS filtra. Leer eso como éxito es el fallo:
    // el dueño vería la tarea cerrada en su pantalla y abierta en la base.
    expect(html).toContain("if (error || !data?.length)");
    expect(html).toContain("t.estado = antes;");
  });

  it("la librería viene del CDN con la versión fijada, no de `@latest`", () => {
    expect(html).toContain("cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/+esm");
    expect(html).not.toContain("@latest");
  });
});
