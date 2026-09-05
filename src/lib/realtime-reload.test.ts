import { describe, it, expect } from "vitest";
import { ALL_QUERIES, QUERY_OF_TABLE, queriesForTables, queriesBefore } from "./realtime-reload";

// G-15 (D-NEXT). Antes, cualquier evento realtime recargaba las nueve consultas del proveedor.
// Esta prueba es la MEDICIÓN antes/después que pidió el orquestador, sobre el caso real: un
// chofer marca "entregado", que escribe deliveries + order_events y llega como dos eventos a
// todas las sesiones abiertas.

describe("un 'entregado' del chofer en una sesión ajena", () => {
  const entregado = ["deliveries", "order_events"];

  it("antes: las nueve consultas (y 18 si los dos eventos no coinciden en el mismo debounce)", () => {
    expect(queriesBefore(entregado)).toHaveLength(9);
    expect(queriesBefore(["deliveries"]).length + queriesBefore(["order_events"]).length).toBe(18);
  });

  it("después: exactamente dos, las de las tablas que cambiaron", () => {
    expect(queriesForTables(entregado)).toEqual(["deliveries", "order_events"]);
    expect(queriesForTables(["deliveries"]).length + queriesForTables(["order_events"]).length).toBe(2);
  });
});

describe("queriesForTables", () => {
  it("cada tabla enganchada recarga UNA consulta, la suya", () => {
    for (const [table, q] of Object.entries(QUERY_OF_TABLE)) {
      expect(queriesForTables([table])).toEqual([q]);
    }
    expect(Object.keys(QUERY_OF_TABLE)).toHaveLength(8); // driver_locations va aparte, aplicada al punto
  });

  it("sin duplicados y en el orden de reloadAll, venga como venga la ráfaga", () => {
    expect(queriesForTables(["order_events", "deliveries", "deliveries", "settings"])).toEqual(["settings", "deliveries", "order_events"]);
  });

  it("una tabla que nadie mapeó cae a todo: mejor una recarga de más que un estado viejo", () => {
    expect(queriesForTables(["deliveries", "tabla_nueva"])).toEqual([...ALL_QUERIES]);
  });

  it("ráfaga vacía: nada", () => {
    expect(queriesForTables([])).toEqual([]);
    expect(queriesBefore([])).toEqual([]);
  });
});
