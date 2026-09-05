import { describe, it, expect } from "vitest";
import {
  ACCOUNTS_KEY, LEGACY_EMAIL_KEY, MAX_ACCOUNTS,
  parseAccounts, upsertAccount, removeAccount, loadAccounts, saveAccounts,
  type RememberedAccount, type StorageLike,
} from "./remembered-accounts";

// D-NEXT. El login pasó de recordar UN email a una lista de cuentas por aparato. Lo que se
// vigila aquí: que el valor viejo migre sin perderse, que la lista quede por uso reciente,
// que quitar quite, y que el tope se aplique. Sin dibujar nada: la lógica es pura.

const acc = (identifier: string, lastUsedAt: number, displayName = ""): RememberedAccount =>
  ({ identifier, displayName, lastUsedAt });

function fakeStorage(init: Record<string, string> = {}): StorageLike & { data: Record<string, string> } {
  const data = { ...init };
  return {
    data,
    getItem: (k) => (k in data ? data[k] : null),
    setItem: (k, v) => { data[k] = v; },
    removeItem: (k) => { delete data[k]; },
  };
}

describe("migración del email recordado de antes", () => {
  it("con lista vacía, el email viejo pasa a ser la única cuenta", () => {
    const list = parseAccounts(null, "maximo", 1000);
    expect(list).toEqual([{ identifier: "maximo", displayName: "", lastUsedAt: 1000 }]);
  });

  it("con lista ya existente, el email viejo entra al final y sin duplicar", () => {
    const raw = JSON.stringify([acc("ana@rtg.com", 500)]);
    expect(parseAccounts(raw, "maximo", 1000).map((a) => a.identifier)).toEqual(["ana@rtg.com", "maximo"]);
    expect(parseAccounts(raw, "ANA@rtg.com ", 1000)).toHaveLength(1);
  });

  it("loadAccounts borra la clave vieja y deja la lista escrita en la nueva", () => {
    const s = fakeStorage({ [LEGACY_EMAIL_KEY]: "maximo" });
    const list = loadAccounts(s, 1000);
    expect(list.map((a) => a.identifier)).toEqual(["maximo"]);
    expect(s.data[LEGACY_EMAIL_KEY]).toBeUndefined();
    expect(JSON.parse(s.data[ACCOUNTS_KEY])).toHaveLength(1);
  });

  it("JSON roto o con forma rara no revienta la pantalla de entrada", () => {
    expect(parseAccounts("{not json", null, 0)).toEqual([]);
    expect(parseAccounts(JSON.stringify({ a: 1 }), null, 0)).toEqual([]);
    expect(parseAccounts(JSON.stringify([{ identifier: "" }, null, { identifier: "ok" }]), null, 0)).toHaveLength(1);
    expect(loadAccounts({ getItem: () => { throw new Error("blocked"); }, setItem() {}, removeItem() {} })).toEqual([]);
  });
});

describe("orden por uso reciente", () => {
  it("parseAccounts devuelve la más reciente primero, venga como venga", () => {
    const raw = JSON.stringify([acc("a", 1), acc("c", 3), acc("b", 2)]);
    expect(parseAccounts(raw, null, 0).map((a) => a.identifier)).toEqual(["c", "b", "a"]);
  });

  it("entrar con una cuenta la sube arriba y le pone la fecha nueva", () => {
    const list = [acc("a", 3), acc("b", 2), acc("c", 1)];
    const out = upsertAccount(list, { identifier: "c" }, 10);
    expect(out.map((a) => a.identifier)).toEqual(["c", "a", "b"]);
    expect(out[0].lastUsedAt).toBe(10);
    expect(list.map((a) => a.identifier)).toEqual(["a", "b", "c"]); // no muta
  });

  it("la misma cuenta escrita con otras mayúsculas o espacios no se duplica", () => {
    const out = upsertAccount([acc("Ana@RTG.com", 1, "Ana")], { identifier: " ana@rtg.com" }, 2);
    expect(out).toHaveLength(1);
    expect(out[0].identifier).toBe("ana@rtg.com");
  });

  it("si esta vez no se pudo leer el nombre, conserva el de la vez anterior", () => {
    const out = upsertAccount([acc("ana", 1, "Ana Pérez")], { identifier: "ana", displayName: "" }, 2);
    expect(out[0].displayName).toBe("Ana Pérez");
    expect(upsertAccount(out, { identifier: "ana", displayName: "Ana P." }, 3)[0].displayName).toBe("Ana P.");
  });
});

describe("quitar", () => {
  it("quita solo esa cuenta, sin mirar mayúsculas", () => {
    const list = [acc("a", 2), acc("B", 1)];
    expect(removeAccount(list, "b ").map((a) => a.identifier)).toEqual(["a"]);
    expect(removeAccount(list, "zzz")).toHaveLength(2);
  });

  it("saveAccounts con lista vacía quita la clave en vez de dejar []", () => {
    const s = fakeStorage({ [ACCOUNTS_KEY]: "[]" });
    saveAccounts(s, []);
    expect(s.data[ACCOUNTS_KEY]).toBeUndefined();
    saveAccounts(s, [acc("a", 1)]);
    expect(JSON.parse(s.data[ACCOUNTS_KEY])).toHaveLength(1);
  });
});

describe("tope de cuentas por aparato", () => {
  it(`nunca guarda más de ${MAX_ACCOUNTS}: se cae la menos reciente`, () => {
    let list: RememberedAccount[] = [];
    for (let i = 1; i <= MAX_ACCOUNTS + 3; i++) list = upsertAccount(list, { identifier: `u${i}` }, i);
    expect(list).toHaveLength(MAX_ACCOUNTS);
    expect(list[0].identifier).toBe(`u${MAX_ACCOUNTS + 3}`);
    expect(list.some((a) => a.identifier === "u1")).toBe(false);
    expect(list.some((a) => a.identifier === "u3")).toBe(false);
    expect(list.some((a) => a.identifier === "u4")).toBe(true);
  });

  it("volver a entrar con una cuenta que ya está no cuenta como una más", () => {
    let list: RememberedAccount[] = [];
    for (let i = 1; i <= MAX_ACCOUNTS; i++) list = upsertAccount(list, { identifier: `u${i}` }, i);
    const out = upsertAccount(list, { identifier: "u1" }, 100);
    expect(out).toHaveLength(MAX_ACCOUNTS);
    expect(out[0].identifier).toBe("u1");
    expect(out.some((a) => a.identifier === "u2")).toBe(true);
  });
});
