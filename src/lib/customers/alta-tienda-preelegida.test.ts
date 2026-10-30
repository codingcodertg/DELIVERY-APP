import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { tiendaPreelegida } from "./alta";

/** En el alta (y la solicitud) de cliente, la tienda de quien pide queda marcada de entrada, como el vendedor (D-NEXT). */

const leer = (r: string) => readFileSync(join(process.cwd(), r), "utf8").split("\r\n").join("\n");
const sinComentarios = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

describe("tiendaPreelegida", () => {
  it("entiende el nombre de la tienda (lo que guarda profiles.store) y el código, sin mayúsculas", () => {
    expect(tiendaPreelegida("RDZ Brownsville")).toBe("BRO");
    expect(tiendaPreelegida("rdz mcallen ")).toBe("MCA");
    expect(tiendaPreelegida("phr")).toBe("PHR");
  });
  it("sin tienda, o con una desconocida, no marca nada", () => {
    expect(tiendaPreelegida(null)).toBe("");
    expect(tiendaPreelegida("")).toBe("");
    expect(tiendaPreelegida("Tela")).toBe("");
  });
});

describe("el camino hasta la ficha", () => {
  it("la página lee profiles.store y lo manda; la lista se lo pasa a la ventana", () => {
    const pagina = sinComentarios(leer("src/app/customers/page.tsx"));
    expect(pagina).toContain('select("full_name, role, module_access, store")');
    expect(pagina).toContain("miTienda = (data?.store as string | null | undefined) ?? null;");
    expect(pagina).toContain("miTienda={miTienda} />");
    const lista = sinComentarios(leer("src/app/customers/Clientes.tsx"));
    expect(lista).toContain("miTienda={miTienda}");
  });
  it("en el alta, la tienda va marcada de entrada en las casillas y en form.store; en una ficha ya creada, no", () => {
    const ficha = sinComentarios(leer("src/app/customers/FichaDeCliente.tsx"));
    expect(ficha).toContain('const tiendaPre = useMemo(() => (nuevo ? tiendaPreelegida(miTienda) : ""), [nuevo, miTienda]);');
    expect(ficha).toContain("const [tiendasAlta, setTiendasAlta] = useState<string[]>(() => (tiendaPre ? [tiendaPre] : []));");
    expect(ficha).toContain("...(tiendaPre ? { store: tiendaPre } : {})");
  });
});
