import { describe, expect, it } from "vitest";
import { ciudadDeEntrega } from "./ciudad-de-entrega";
import { cityFromAddress } from "./utils";

/** La ciudad de una dirección de entrega, para la columna «Ciudad de entrega» del Gestor de Rutas (D-408). */

describe("ciudadDeEntrega", () => {
  it("las del demo y las escritas a mano: «calle, Ciudad TX»", () => {
    expect(ciudadDeEntrega("4500 N 23rd St, McAllen TX")).toBe("McAllen");
    expect(ciudadDeEntrega("1400 W Freddy Gonzalez Dr, Edinburg TX")).toBe("Edinburg");
    expect(ciudadDeEntrega("845 Paredes Line Rd, Brownsville TX")).toBe("Brownsville");
    expect(ciudadDeEntrega("1200 S Texas Blvd, Weslaco TX")).toBe("Weslaco");
    expect(ciudadDeEntrega("1102 W Expressway 83, Weslaco")).toBe("Weslaco");
    expect(ciudadDeEntrega("100 Main St, McAllen, TX")).toBe("McAllen");
    expect(ciudadDeEntrega("123 Main St, McAllen, TX 78501")).toBe("McAllen");
    expect(ciudadDeEntrega("4500 N 23rd St, McAllen TX 78504")).toBe("McAllen");
    expect(ciudadDeEntrega("4500 N 23rd St, McAllen TX 78504-1234")).toBe("McAllen");
  });
  it("las que da un geocodificador: Google («…, Pharr, TX 78577, USA») y Nominatim, con condado, estado, zip y país", () => {
    expect(ciudadDeEntrega("1120 E Expressway 83, Pharr, TX 78577, USA")).toBe("Pharr");
    expect(ciudadDeEntrega("1120 E Expressway 83, Pharr, Hidalgo County, Texas, 78577, United States")).toBe("Pharr");
    expect(ciudadDeEntrega("1120, East Expressway 83, Pharr, Hidalgo County, Texas, 78577, United States of America")).toBe("Pharr");
    expect(ciudadDeEntrega("Calle 5 123, Centro, Reynosa, Tamps., 88500, México")).toBe("Reynosa");
    expect(ciudadDeEntrega("Av. Constitución 400, Monterrey, N.L., México")).toBe("Monterrey");
  });
  it("la sigla de un estado que no es Texas también se quita, en su trozo o pegada a la ciudad", () => {
    expect(ciudadDeEntrega("Av. Juárez 10, Monterrey, NL 64000, MX")).toBe("Monterrey");
    expect(ciudadDeEntrega("Av. Juárez 10, Monterrey NL")).toBe("Monterrey");  });
  it("una ciudad de varias palabras sale entera, y en minúsculas se le quita el estado igual", () => {
    expect(ciudadDeEntrega("500 Main, Rio Grande City, TX 78582")).toBe("Rio Grande City");
    expect(ciudadDeEntrega("12 Palm Blvd, South Padre Island TX")).toBe("South Padre Island");
    expect(ciudadDeEntrega("  100  norte ave,  san juan tx ")).toBe("san juan");
    expect(ciudadDeEntrega("100 Norte Ave, Alamo Texas")).toBe("Alamo");
  });
  it("una calle con nombre de ciudad no engaña: manda el trozo de la ciudad", () => {
    expect(ciudadDeEntrega("2 McAllen Ave, Pharr TX")).toBe("Pharr");
    expect(ciudadDeEntrega("3 Mission Blvd, Edinburg, TX")).toBe("Edinburg");
  });
  it("sin ciudad, «» (la celda pinta «—»): vacía, nula, solo la calle, o calle y ciudad sin coma", () => {
    expect(ciudadDeEntrega("")).toBe("");
    expect(ciudadDeEntrega(null)).toBe("");
    expect(ciudadDeEntrega(undefined)).toBe("");
    expect(ciudadDeEntrega(" , , ")).toBe("");
    expect(ciudadDeEntrega("123 Main St")).toBe("");
    expect(ciudadDeEntrega("123 sin ciudad 78501")).toBe("");
    expect(ciudadDeEntrega("123 Main St McAllen TX 78501")).toBe("");
    // Acaba en la calle aunque haya más trozos detrás que se quitan.
    expect(ciudadDeEntrega("123 Main St, TX 78501, USA")).toBe("");
  });
  it("un solo trozo que es la ciudad se devuelve; un «TX» suelto no se vacía", () => {
    expect(ciudadDeEntrega("McAllen")).toBe("McAllen");
    expect(ciudadDeEntrega("McAllen TX")).toBe("McAllen");
    expect(ciudadDeEntrega("TX")).toBe("TX");
  });
  it("por qué no `cityFromAddress`: con estas mismas direcciones da la calle o el código postal", () => {
    expect(cityFromAddress("4500 N 23rd St, McAllen TX")).toBe("4500 N 23rd St");
    expect(cityFromAddress("1120 E Expressway 83, Pharr, Hidalgo County, Texas, 78577, United States")).toBe("78577");
  });
});
