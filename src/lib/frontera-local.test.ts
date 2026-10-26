import { describe, it, expect } from "vitest";
import { suggestDeliveryFee } from "./pricing";
import { puntoEnZonaLocal } from "./delivery-zone";

// D-NEXT · «DICE QUE NO ES LOCAL PERO SI ES»: una orden sin pin a Hidalgo salía NO LOCAL · TX.
const sinPin = (delivery_address: string) => suggestDeliveryFee({ delivery_address, route_miles: 9.3 }, {});

describe("ciudad de la dirección, sin pin", () => {
  it.each([
    ["3004 E Sabinal Ave, Hidalgo, TX, USA", "Hidalgo"],
    ["3004 E Sabinal Ave, Hidalgo, TX 78557, USA", "Hidalgo"],
    ["3004 E Sabinal Ave, Hidalgo, TX 78557", "Hidalgo"],
    ["3004 E Sabinal Ave, Hidalgo, Texas, United States", "Hidalgo"],
    ["3004 e sabinal ave, hidalgo, tx, usa", "hidalgo"],
    ["1120 E Expressway 83, Pharr, Hidalgo County, Texas, 78577, United States", "Pharr"],
  ])("%s → %s, local", (dir, ciudad) => {
    const r = sinPin(dir);
    expect(r.city).toBe(ciudad);
    expect(r.zoneSource).toBe("city");
    expect(r.zone).toBe("local");
    expect(r.needsApproval).toBe(false);
  });

  it("nunca el estado ni el país", () => {
    for (const d of ["10 Main St, Reynosa, Tamaulipas, Mexico", "10 Main St, Raymondville, TX, USA"]) {
      const r = sinPin(d);
      expect(["TX", "USA", "Tamaulipas", "Mexico"]).not.toContain(r.city);
      expect(r.zone).toBe("nonlocal");
    }
  });

  it("los pueblos de la frontera por defecto", () => {
    for (const c of ["Granjeno", "Progreso", "Los Indios"]) expect(sinPin(`1 A St, ${c}, TX, USA`).zone).toBe("local");
  });
});

describe("el borde sur va por el río", () => {
  it.each([
    ["sur de Hidalgo", 26.09, -98.26],
    ["lado US del puente de Pharr", 26.07, -98.19],
    ["Granjeno", 26.135, -98.30],
    ["Progreso", 26.09, -97.957],
    ["Los Indios", 26.05, -97.745],
    ["Brownsville sur", 25.8804, -97.4112],
  ])("%s dentro", (_n, lat, lng) => expect(puntoEnZonaLocal(lat, lng)).toBe(true));

  it.each([
    ["Reynosa", 26.08, -98.29],
    ["Río Bravo", 25.99, -98.09],
    ["Matamoros", 25.88, -97.504],
    ["Raymondville", 26.482, -97.78],
  ])("%s fuera", (_n, lat, lng) => expect(puntoEnZonaLocal(lat, lng)).toBe(false));
});
