import { describe, expect, it } from "vitest";
import { descargable, hostsDeFotos, leeTarjetas, planDe } from "./importa-de-axen.mjs";

const JSON_DE_PRUEBA = [
  { slug: "jose-perez", full_name: "Jose Perez", role_es: "Marketing", role_en: "Marketing", store: "brownsville",
    phone: "+19568171588", whatsapp: "+19566172659", email: "jose@axen-growth.com",
    photo_url: "https://contratista.example.supabase.co/storage/v1/object/public/avatars/jose.png", cover_url: "" },
  { slug: "ana-x", full_name: "Ana X", store: "", photo_url: "http://contratista.example.supabase.co/a.jpg", cover_url: "" },
  { slug: "editar", full_name: "Reservada", store: "pharr" },
  { slug: "ana-x", full_name: "Repetida", store: "pharr" },
];

describe("importa-de-axen (lo que no escribe)", () => {
  it("valida el JSON: descarta slugs reservados y repetidos, y deja la tienda vacía si no es de las seis", () => {
    const { tarjetas, errores } = leeTarjetas(JSON_DE_PRUEBA);
    expect(tarjetas.map((t) => t.slug)).toEqual(["jose-perez", "ana-x", "ana-x"]);
    expect(tarjetas[1].store).toBeNull();
    expect(errores.some((e) => e.includes("editar"))).toBe(true);
    expect(errores.some((e) => e.includes("repetido"))).toBe(true);
  });

  it("solo baja fotos por https y de un host que aparece en el propio JSON", () => {
    const { tarjetas } = leeTarjetas(JSON_DE_PRUEBA);
    const hosts = hostsDeFotos(tarjetas);
    expect([...hosts]).toEqual(["contratista.example.supabase.co"]);
    expect(descargable("https://contratista.example.supabase.co/x.png", hosts)).toBe(true);
    expect(descargable("http://contratista.example.supabase.co/x.png", hosts)).toBe(false);
    expect(descargable("https://otro.example.com/x.png", hosts)).toBe(false);
    expect(descargable("file:///etc/passwd", hosts)).toBe(false);
  });

  it("el plan dice qué fotos bajaría y cuáles se omiten", () => {
    const { tarjetas } = leeTarjetas(JSON_DE_PRUEBA);
    const hosts = hostsDeFotos(tarjetas);
    expect(planDe(tarjetas[0], hosts)).toContain("fotos: foto");
    expect(planDe(tarjetas[1], hosts)).toContain("URL no permitida");
  });
});
