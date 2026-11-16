import { describe, expect, it } from "vitest";
import { enParalelo } from "./concurrencia";

const esperar = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe("enParalelo", () => {
  it("devuelve los resultados en el orden de la entrada, aunque terminen en otro orden", async () => {
    const salida = await enParalelo([30, 5, 20, 1], 4, async (ms, i) => {
      await esperar(ms);
      return `${i}:${ms}`;
    });
    expect(salida).toEqual(["0:30", "1:5", "2:20", "3:1"]);
  });

  it("nunca tiene más de `limite` en vuelo a la vez", async () => {
    let enVuelo = 0;
    let maximo = 0;
    await enParalelo(Array.from({ length: 23 }, (_, i) => i), 5, async () => {
      enVuelo++;
      maximo = Math.max(maximo, enVuelo);
      await esperar(2);
      enVuelo--;
    });
    expect(maximo).toBe(5);
  });

  it("con una lista vacía no llama a nada y devuelve []", async () => {
    let llamadas = 0;
    expect(await enParalelo([], 5, async () => ++llamadas)).toEqual([]);
    expect(llamadas).toBe(0);
  });

  it("un límite menor que uno se trata como uno (secuencial, en orden)", async () => {
    const orden: number[] = [];
    await enParalelo([1, 2, 3], 0, async (x) => {
      orden.push(x);
    });
    expect(orden).toEqual([1, 2, 3]);
  });

  it("si una tarea lanza, la promesa rechaza, como el bucle secuencial que sustituye", async () => {
    await expect(
      enParalelo([1, 2, 3], 2, async (x) => {
        if (x === 2) throw new Error("boom");
        return x;
      }),
    ).rejects.toThrow("boom");
  });
});
