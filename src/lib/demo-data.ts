import type { Delivery, Profile, Settings } from "@/lib/types";
import type { AppNotification } from "@/lib/notifications";
import { palletDuration, todayISO } from "@/lib/utils";

// ============================================================
// Demo dataset for LOCAL DEMO MODE.
//
// Kept pure (no React, no browser APIs) so the same data the app seeds can be
// driven through the business logic in tests — see demo-data.test.ts.
//
// It deliberately covers every branch the UI has to handle: all 9 stages, all
// 6 stores, every order type, assigned + unassigned drivers, overdue orders,
// re-deliveries, POD with signature/photos/GPS, fee'd and un-fee'd orders,
// and windows that trip each scheduling rule.
// ============================================================

export const uid = () =>
  typeof crypto !== "undefined" && crypto.randomUUID
    ? crypto.randomUUID()
    : "id_" + Math.random().toString(36).slice(2) + Date.now().toString(36);

export const DEMO_USERS: Profile[] = [
  { id: "u-admin", full_name: "You (Admin)", role: "admin", store: null },
  { id: "u-sales", full_name: "Sam Sales", role: "sales", store: "Edinburg" },
  { id: "u-sales2", full_name: "Sofia Ventas", role: "sales", store: null },
  { id: "u-mgr", full_name: "Maria Manager", role: "manager", store: null },
  { id: "u-log", full_name: "Laura Logistics", role: "logistics", store: null },
  { id: "u-wh", full_name: "Wade Warehouse", role: "warehouse", store: "Pharr" },
  // Drivers are users like everyone else — the Assigned Driver list is built
  // from whoever holds the "driver" role.
  { id: "u-drv", full_name: "Diego Driver", role: "driver", store: "McAllen" },
  { id: "u-drv2", full_name: "Carlos R.", role: "driver", store: "McAllen" },
  { id: "u-drv3", full_name: "Miguel A.", role: "driver", store: "Pharr" },
  { id: "u-drv4", full_name: "Fleet Truck 3", role: "driver", store: "Brownsville" },
];

export function demoSettings(): Settings {
  return {
    id: 1,
    app_name: "RTG·HUB",
    stores: [
      { name: "Brownsville", address: "3000 Central Blvd, Brownsville TX" },
      { name: "Weslaco", address: "1000 W Expressway 83, Weslaco TX" },
      { name: "Pharr", address: "1201 W US-83, Pharr TX" },
      { name: "McAllen", address: "2400 N 23rd St, McAllen TX" },
      { name: "Mission", address: "1100 E Expressway 83, Mission TX" },
      { name: "Edinburg", address: "2500 W University Dr, Edinburg TX" },
    ],
    order_types: ["Customer", "Intertienda", "Transfer"],
    order_type_rules: {
      Customer:    { storeToStore: false, docRef: "invoice" }, // external customer delivery
      Intertienda: { storeToStore: true,  docRef: "any", homeIsDestination: true }, // receiving branch: any one doc, rep's store is the destination
      Transfer:    { storeToStore: true,  docRef: "estimate" }, // branch-to-branch: single Estimate #
    },
    pickup_locations: [
      { name: "Rio Supply Yard", address: "800 S Main St, McAllen TX" },
    ],
    delivery_locations: [
      { name: "Sharyland Job Site", address: "3300 Shary Rd, Mission TX" },
    ],
    // Test data — every account already used in the demo deliveries below,
    // with a contact + phone attached, so picking one on an order shows the
    // auto-fill right away instead of the fields staying blank.
    accounts: [
      { name: "Rio Tile Co.", contact: "Ana Garza", phone: "9561234567" },
      { name: "Casa Bella", contact: "Rosa Martinez", phone: "9565550103" },
      { name: "Delta Construction", contact: "Luis Treviño", phone: "9565550188" },
      { name: "Palm Grove Homes", contact: "Hector Ruiz", phone: "9565550104" },
      { name: "Mid-Valley Supply", contact: "Elena Ramos", phone: "9565550105" },
      { name: "Hidalgo Interiors", contact: "Marco Silva", phone: "9565550142" },
      { name: "Sunrise Flooring", contact: "Diana Cantu", phone: "9565550151" },
      { name: "Vista Kitchens", contact: "Hector Ruiz", phone: "9565550110" },
      { name: "Valley Builders", contact: "Jorge Peña", phone: "9565550162" },
      { name: "Coastal Homes", contact: "Karla Salinas", phone: "9565550173" },
      { name: "Mission Remodel", contact: "Ana Garza", phone: "9565550184" },
      { name: "Walk-in Customer", contact: "Front desk", phone: "9565550100" },
      { name: "Sharyland Job Site", contact: "Site foreman", phone: "9565550195" },
      { name: "Edinburg branch", contact: "Store manager", phone: "9565550120", intertienda: true },
      { name: "Brownsville branch", contact: "Store manager", phone: "9565550130", intertienda: true },
      { name: "New Lead LLC", contact: "Sam Peterson", phone: "9565550140" },
      { name: "QA Test Account", contact: "QA Tester", phone: "9565550199" },
    ],
    pickup_min_per_pallet: 4,
    delivery_min_per_pallet: 5,
    // RingCentral calling / auto-SMS start switched OFF — an admin opts in.
    rc_calls_enabled: false,
    rc_auto_sms_enabled: false,
    manager_pending_cutoff: "16:00",
    sales_pending_cutoff: "16:15",
    driver_colors: {
      "Diego Driver": "#2456c9",
      "Carlos R.": "#0f8a8a",
      "Miguel A.": "#d1782e",
      "Fleet Truck 3": "#7c4dbc",
    },
  };
}

/**
 * Un día de calendario relativo al HOY DEL NEGOCIO (D-191), no al de la máquina.
 *
 * Hacía `new Date()` + `setDate` + `localISO`: la fecha local de la máquina. Pero `isOverdue`
 * compara `delivery_date < todayISO()`, y `todayISO()` es el hoy en el huso del negocio
 * (America/Chicago), a propósito. En el runner de CI (UTC), entre la medianoche UTC y la
 * medianoche de Chicago la máquina ya va un día por delante del negocio: `iso(-1)` daba el
 * "hoy" del negocio, los pedidos de "ayer" dejaban de estar vencidos, y
 * `demo-data.test.ts` fallaba solo a esas horas (PR #7, 03:57 UTC). Ahora el desplazamiento
 * se hace sobre `todayISO()`, en calendario puro (mediodía UTC para que ningún huso lo
 * mueva de día), así que la demo y la lógica comparten la misma definición de "hoy".
 */
const iso = (daysFromToday: number): string => {
  const d = new Date(todayISO() + "T12:00:00Z");
  d.setUTCDate(d.getUTCDate() + daysFromToday);
  return d.toISOString().slice(0, 10);
};
// Instantes (created_at, approved_at…), no días: un timestamp UTC es el mismo en cualquier
// huso y nadie lo compara por día de calendario. Se queda como está.
const stamp = (minsAgo: number) => new Date(Date.now() - minsAgo * 60000).toISOString();

// A 1x1 transparent PNG — stands in for a real signature/photo in the demo.
const TINY_PNG =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";

export function demoDeliveries(settings: Settings): Delivery[] {
  const storeAddr = (n: string) => settings.stores.find((s) => s.name === n)?.address ?? null;

  const base = (n: number, over: Partial<Delivery>): Delivery => ({
    id: uid(),
    order_no: n,
    order_code: null,
    order_suffix: null,
    stage: "draft",
    rejected_reason: null,
    is_training: false,
    redelivery_of: null,
    redelivery_reason: null,
    order_type: "Customer",
    store: "McAllen",
    po2: null,
    so_num: null,
    invoice_num: null,
    estimate_num: null,
    input_date: iso(-2),
    input_time: "0900",
    delivery_date: iso(0),
    pickup_name: null,
    pickup_address: null,
    pickup_duration: null,
    delivery_fee: null,
    est_pallets: null,
    actual_pallets: null,
    assigned_driver: null,
    delivery_duration: null,
    delivery_name: null,
    delivery_address: null,
    delivery_windows: null,
    account: null,
    contact: null,
    delivery_phone: null,
    delivery_notes: null,
    route_miles: null,
    route_duration: null,
    route_provider: null,
    route_traffic: null,
    pod_received_by: null,
    pod_signature: null,
    pod_delivered_at: null,
    departed_at: null,
    arrived_at: null,
    photos: null,
    pickup_lat: null,
    pickup_lng: null,
    pickup_gps_at: null,
    pod_lat: null,
    pod_lng: null,
    pod_accuracy: null,
    delivery_lat: null,
    delivery_lng: null,
    delivery_pin_source: null,
    route_seq: null,
    load_no: null,
    load_auto: false,
    created_by: "u-sales",
    assigned_sales_rep: null,
    approved_by: null,
    approved_at: null,
    created_at: stamp(60 * 24),
    updated_at: stamp(30),
    ...over,
  });

  // Every real order needs a named contact + a reachable phone, so rotate a few
  // so the demo looks like a real book of business rather than one customer.
  const CONTACTS = [
    { contact: "Ana Garza", delivery_phone: "9565550101" },
    { contact: "Luis Treviño", delivery_phone: "9565550102" },
    { contact: "Rosa Martinez", delivery_phone: "9565550103" },
    { contact: "Hector Ruiz", delivery_phone: "9565550104" },
    { contact: "Elena Ramos", delivery_phone: "9565550105" },
    { contact: "Marco Silva", delivery_phone: "9565550106" },
  ];

  /** Order with pallet-derived durations + a resolved route, like a real one. */
  const mk = (n: number, pallets: number, miles: number | null, over: Partial<Delivery>): Delivery =>
    base(n, {
      est_pallets: pallets,
      pickup_duration: palletDuration(pallets, settings.pickup_min_per_pallet),
      delivery_duration: palletDuration(pallets, settings.delivery_min_per_pallet),
      ...(miles != null
        ? { route_miles: miles, route_duration: `${Math.round(miles * 2.4)} min`, route_provider: "OpenStreetMap", route_traffic: false }
        : {}),
      pickup_name: over.store ? `RDZ ${over.store} Warehouse` : null,
      pickup_address: over.store ? storeAddr(over.store as string) : null,
      // The dropoff is normally the customer's own site, so it takes their name
      // unless the order names a specific site (a branch, a job site).
      delivery_name: over.account ?? null,
      ...CONTACTS[n % CONTACTS.length],
      ...over,
    });

  const rows: Delivery[] = [
    // ---- Drafts (sales still working on them) ----
    mk(1001, 1, null, { stage: "draft", store: "Weslaco", account: "New Lead LLC", created_by: "u-sales" }),
    mk(1002, 3, 7.4, { stage: "draft", store: "Edinburg", account: "Hidalgo Interiors", invoice_num: "INV-2201",
      delivery_address: "1400 W Freddy Gonzalez Dr, Edinburg TX", delivery_windows: "0900-1100",
      delivery_fee: 60, contact: "Rosa", delivery_phone: "9565550142", created_by: "u-sales2" }),

    // ---- Pending approval ----
    mk(1003, 4, 5.2, { stage: "pending", store: "McAllen", account: "Rio Tile Co.", so_num: "SO-1001", po2: "PO-88",
      invoice_num: "INV-3001", delivery_fee: 75, delivery_address: "123 Main St, McAllen TX",
      delivery_windows: "0800-1200", contact: "Ana", delivery_phone: "9561234567" }),
    mk(1004, 6, 9.1, { stage: "pending", store: "Pharr", account: "Delta Construction", invoice_num: "INV-3002",
      delivery_fee: 110, delivery_address: "900 E Ferguson St, Pharr TX", delivery_windows: "1300-1500",
      contact: "Luis", delivery_phone: "9565550188", created_by: "u-sales2" }),
    mk(1005, 2, 3.8, { stage: "pending", store: "Mission", account: "Casa Bella", invoice_num: "INV-3003",
      delivery_fee: 55, delivery_address: "220 N Shary Rd, Mission TX", delivery_windows: "1000-1200" }),

    // ---- Rejected (bounced back to sales) ----
    mk(1006, 5, 6.0, { stage: "rejected", store: "Brownsville", account: "Palm Grove Homes", invoice_num: "INV-3004",
      rejected_reason: "Customer credit hold — confirm payment first.",
      delivery_address: "77 Palm Dr, Brownsville TX", delivery_windows: "0900-1100", delivery_fee: 80 }),

    // ---- Approved, waiting on the warehouse ----
    mk(1007, 8, 3.1, { stage: "approved", store: "Pharr", account: "Valley Builders", so_num: "SO-1002",
      invoice_num: "INV-3005", delivery_fee: 120, delivery_address: "500 Cage Blvd, Pharr TX",
      delivery_windows: "1300-1700", approved_by: "u-mgr", approved_at: stamp(180), assigned_driver: "Miguel A.",
      delivery_lat: 26.1830, delivery_lng: -98.1780, delivery_pin_source: "geocoded" }),
    mk(1008, 3, 4.6, { stage: "approved", store: "McAllen", account: "Rio Tile Co.", invoice_num: "INV-3006",
      delivery_fee: 70, delivery_address: "3100 N 10th St, McAllen TX", delivery_windows: "0830-1030",
      approved_by: "u-mgr", approved_at: stamp(120),
      delivery_lat: 26.2210, delivery_lng: -98.2280, delivery_pin_source: "geocoded" }),
    // Intra-Tienda transfer — only needs ONE of PO/SO/Invoice.
    mk(1009, 10, 12.5, { stage: "approved", store: "McAllen", order_type: "Intertienda", account: "Edinburg branch",
      so_num: "TR-4401", delivery_name: "Edinburg", delivery_address: storeAddr("Edinburg"),
      delivery_windows: "1400-1600", approved_by: "u-mgr", approved_at: stamp(90), assigned_driver: "Diego Driver",
      delivery_lat: 26.3017, delivery_lng: -98.1633, delivery_pin_source: "geocoded" }),

    // ---- In the warehouse ----
    mk(1010, 2, 6.4, { stage: "fulfilling", store: "Brownsville", account: "Coastal Homes", so_num: "SO-1003",
      invoice_num: "INV-3007", assigned_driver: "Fleet Truck 3",
      delivery_address: "77 Palm Dr, Brownsville TX", delivery_windows: "0900-1100", delivery_fee: 65,
      approved_by: "u-mgr", approved_at: stamp(240),
      delivery_lat: 25.9050, delivery_lng: -97.4950, delivery_pin_source: "geocoded" }),
    // Late-afternoon slot — Carlos already runs #1014 at 1300-1500 today.
    mk(1011, 7, 8.2, { stage: "fulfilling", store: "Weslaco", account: "Mid-Valley Supply", invoice_num: "INV-3008",
      assigned_driver: "Carlos R.", delivery_fee: 95,
      delivery_address: "1200 S Texas Blvd, Weslaco TX", delivery_windows: "1530-1730",
      approved_by: "u-mgr", approved_at: stamp(300),
      delivery_lat: 26.1610, delivery_lng: -97.9880, delivery_pin_source: "geocoded" }),
    mk(1012, 4, 5.5, { stage: "ready", store: "McAllen", account: "Sunrise Flooring", invoice_num: "INV-3009",
      assigned_driver: "Diego Driver", delivery_fee: 85,
      delivery_address: "4500 N 23rd St, McAllen TX", delivery_windows: "0800-1000",
      approved_by: "u-mgr", approved_at: stamp(360),
      delivery_lat: 26.2350, delivery_lng: -98.2250, delivery_pin_source: "geocoded" }),
    mk(1013, 6, 11.0, { stage: "ready", store: "Mission", account: "Sharyland Job Site", delivery_name: "Sharyland Job Site",
      invoice_num: "INV-3010", assigned_driver: "Diego Driver", delivery_fee: 130,
      delivery_address: "3300 Shary Rd, Mission TX", delivery_windows: "1100-1300",
      approved_by: "u-mgr", approved_at: stamp(400),
      delivery_lat: 26.2080, delivery_lng: -98.3010, delivery_pin_source: "geocoded" }),

    // ---- Out for delivery (GPS stamped at pickup) ----
    mk(1014, 5, 7.7, { stage: "picked_up", store: "McAllen", account: "Vista Kitchens", invoice_num: "INV-3011",
      assigned_driver: "Carlos R.", delivery_fee: 100,
      delivery_address: "2100 Trenton Rd, McAllen TX", delivery_windows: "1300-1500",
      approved_by: "u-mgr", approved_at: stamp(500), contact: "Hector", delivery_phone: "9565550110",
      pickup_lat: 26.2034, pickup_lng: -98.23, pickup_gps_at: stamp(45) }),
    mk(1015, 3, 4.2, { stage: "picked_up", store: "Pharr", account: "Delta Construction", invoice_num: "INV-3012",
      assigned_driver: "Miguel A.", delivery_fee: 60, delivery_address: "700 W Polk Ave, Pharr TX",
      delivery_windows: "0900-1100", approved_by: "u-mgr", approved_at: stamp(520),
      pickup_lat: 26.1948, pickup_lng: -98.1836, pickup_gps_at: stamp(50) }),

    // ---- Delivered (full proof of delivery) ----
    mk(1016, 5, 4.0, { stage: "delivered", store: "Mission", account: "Mission Remodel", so_num: "SO-1004",
      invoice_num: "INV-3013", assigned_driver: "Fleet Truck 3",
      delivery_address: "9 Conway Ave, Mission TX", delivery_windows: "0900-1100", delivery_fee: 90,
      approved_by: "u-mgr", approved_at: stamp(1500), delivery_date: iso(-1), updated_at: stamp(1400),
      pod_received_by: "Rosa Martinez", pod_signature: TINY_PNG, pod_delivered_at: stamp(1400),
      pod_lat: 26.2159, pod_lng: -98.3253, pod_accuracy: 8, photos: [TINY_PNG] }),
    mk(1017, 9, 6.9, { stage: "delivered", store: "McAllen", account: "Rio Tile Co.", invoice_num: "INV-3014",
      assigned_driver: "Diego Driver", delivery_fee: 140, delivery_address: "5000 N 10th St, McAllen TX",
      delivery_windows: "1300-1500", approved_by: "u-mgr", approved_at: stamp(3000), delivery_date: iso(-3),
      updated_at: stamp(2900), pod_received_by: "Jorge L.", pod_signature: TINY_PNG, pod_delivered_at: stamp(2900),
      photos: [TINY_PNG, TINY_PNG] }),
    mk(1018, 2, 2.4, { stage: "delivered", store: "Weslaco", account: "Mid-Valley Supply", invoice_num: "INV-3015",
      assigned_driver: "Carlos R.", delivery_fee: 45, delivery_address: "300 E 6th St, Weslaco TX",
      delivery_windows: "0830-1030", approved_by: "u-mgr", approved_at: stamp(4400), delivery_date: iso(-5),
      updated_at: stamp(4300), pod_received_by: "Elena R.", pod_delivered_at: stamp(4300) }),
    // Delivered LATE — completed after its promised date (drags on-time %).
    mk(1019, 4, 5.1, { stage: "delivered", store: "Edinburg", account: "Hidalgo Interiors", invoice_num: "INV-3016",
      assigned_driver: "Miguel A.", delivery_fee: 75, delivery_address: "2500 W University Dr, Edinburg TX",
      delivery_windows: "1000-1200", approved_by: "u-mgr", approved_at: stamp(7000), delivery_date: iso(-6),
      updated_at: stamp(5000), pod_received_by: "Marco", pod_delivered_at: stamp(5000) }),

    // ---- OVERDUE — past their date and still not delivered ----
    mk(1020, 6, 8.8, { stage: "ready", store: "Brownsville", account: "Palm Grove Homes", invoice_num: "INV-3017",
      assigned_driver: "Fleet Truck 3", delivery_fee: 105, delivery_address: "1500 Boca Chica Blvd, Brownsville TX",
      delivery_windows: "0900-1100", delivery_date: iso(-2), approved_by: "u-mgr", approved_at: stamp(3000) }),
    mk(1021, 3, 3.3, { stage: "approved", store: "Pharr", account: "Casa Bella", invoice_num: "INV-3018",
      delivery_fee: 50, delivery_address: "410 N Cage Blvd, Pharr TX", delivery_windows: "1400-1600",
      delivery_date: iso(-1), approved_by: "u-mgr", approved_at: stamp(2000) }),

    // ---- Pickup / Will Call / Transfer — no customer invoice required ----
    mk(1022, 2, null, { stage: "ready", store: "McAllen", order_type: "Customer", account: "Walk-in Customer",
      invoice_num: "INV-3034",
      delivery_address: "2400 N 23rd St, McAllen TX", delivery_windows: "1000-1200", delivery_fee: 0,
      approved_by: "u-mgr", approved_at: stamp(800),
      delivery_lat: 26.2034, delivery_lng: -98.2300, delivery_pin_source: "geocoded" }),
    // Not yet assigned — Fleet Truck 3 is already booked 0900-1100 today (#1010),
    // so dispatch has to pick someone else for this run.
    mk(1023, 12, 15.2, { stage: "approved", store: "Weslaco", order_type: "Transfer", account: "Brownsville branch",
      delivery_name: "Brownsville", delivery_address: storeAddr("Brownsville"), delivery_windows: "0830-1030",
      approved_by: "u-mgr", approved_at: stamp(700),
      delivery_lat: 25.9010, delivery_lng: -97.4995, delivery_pin_source: "geocoded" }),

    // ---- Extra dispatch load for today — route planning has plenty to work
    // with: several stops per driver (worth optimizing) and a healthy
    // unassigned pool (worth assigning). All pre-pinned so Routes/Map show
    // them immediately without waiting on live geocoding. ----
    mk(1026, 3, 6.1, { stage: "ready", store: "Weslaco", account: "Coastal Homes", invoice_num: "INV-3020",
      delivery_fee: 55, delivery_address: "800 N Texas Blvd, Weslaco TX", delivery_windows: "0700-0900",
      assigned_driver: "Carlos R.", approved_by: "u-mgr", approved_at: stamp(200),
      delivery_lat: 26.1450, delivery_lng: -97.9950, delivery_pin_source: "geocoded" }),
    mk(1027, 5, 7.3, { stage: "approved", store: "Weslaco", account: "Palm Grove Homes", invoice_num: "INV-3021",
      delivery_fee: 90, delivery_address: "500 S Border Ave, Weslaco TX", delivery_windows: "0900-1100",
      assigned_driver: "Carlos R.", approved_by: "u-mgr", approved_at: stamp(150),
      delivery_lat: 26.1700, delivery_lng: -98.0100, delivery_pin_source: "geocoded" }),
    mk(1028, 2, 4.9, { stage: "approved", store: "Weslaco", account: "Vista Kitchens", invoice_num: "INV-3022",
      delivery_fee: 50, delivery_address: "300 W Business 83, Mercedes TX", delivery_windows: "1100-1300",
      assigned_driver: "Carlos R.", approved_by: "u-mgr", approved_at: stamp(130),
      delivery_lat: 26.1490, delivery_lng: -97.9200, delivery_pin_source: "geocoded" }),

    mk(1029, 6, 3.4, { stage: "fulfilling", store: "Pharr", account: "Rio Tile Co.", invoice_num: "INV-3023",
      delivery_fee: 80, delivery_address: "1000 W Sam Houston Blvd, Pharr TX",
      delivery_windows: "1700-1900", assigned_driver: "Miguel A.", approved_by: "u-mgr", approved_at: stamp(220),
      delivery_lat: 26.2000, delivery_lng: -98.1900, delivery_pin_source: "geocoded" }),
    mk(1030, 4, 2.8, { stage: "ready", store: "Pharr", account: "Sunrise Flooring", invoice_num: "INV-3024",
      delivery_fee: 65, delivery_address: "600 E Kelly Ave, Pharr TX",
      delivery_windows: "1100-1300", assigned_driver: "Miguel A.", approved_by: "u-mgr", approved_at: stamp(260),
      delivery_lat: 26.1750, delivery_lng: -98.1700, delivery_pin_source: "geocoded" }),
    mk(1031, 7, 9.0, { stage: "approved", store: "Pharr", account: "Hidalgo Interiors", invoice_num: "INV-3025",
      delivery_fee: 100, delivery_address: "1800 E Palm Dr, Edinburg TX", delivery_windows: "0700-0900",
      assigned_driver: "Miguel A.", approved_by: "u-mgr", approved_at: stamp(190),
      delivery_lat: 26.2950, delivery_lng: -98.1550, delivery_pin_source: "geocoded" }),

    mk(1032, 8, 5.6, { stage: "approved", store: "Brownsville", account: "Valley Builders", invoice_num: "INV-3026",
      delivery_fee: 115, delivery_address: "2200 Boca Chica Blvd, Brownsville TX", delivery_windows: "1100-1300",
      assigned_driver: "Fleet Truck 3", approved_by: "u-mgr", approved_at: stamp(170),
      delivery_lat: 25.9300, delivery_lng: -97.4800, delivery_pin_source: "geocoded" }),
    mk(1033, 3, 4.1, { stage: "ready", store: "Brownsville", account: "Mid-Valley Supply", invoice_num: "INV-3027",
      delivery_fee: 60, delivery_address: "500 Ruben Torres Blvd, Brownsville TX",
      delivery_windows: "1300-1500", assigned_driver: "Fleet Truck 3", approved_by: "u-mgr", approved_at: stamp(140),
      delivery_lat: 25.8800, delivery_lng: -97.5100, delivery_pin_source: "geocoded" }),

    mk(1034, 5, 3.9, { stage: "fulfilling", store: "McAllen", account: "Casa Bella", invoice_num: "INV-3028",
      delivery_fee: 80, delivery_address: "1600 S 23rd St, McAllen TX",
      delivery_windows: "1000-1100", assigned_driver: "Diego Driver", approved_by: "u-mgr", approved_at: stamp(160),
      delivery_lat: 26.1900, delivery_lng: -98.2450, delivery_pin_source: "geocoded" }),

    // ---- Unassigned pool — needs a driver picked in Route Planning ----
    mk(1035, 4, null, { stage: "approved", store: "McAllen", account: "Vista Kitchens", invoice_num: "INV-3029",
      delivery_fee: 70, delivery_address: "2900 Ware Rd, McAllen TX", delivery_windows: "0900-1100",
      approved_by: "u-mgr", approved_at: stamp(110),
      delivery_lat: 26.2280, delivery_lng: -98.2150, delivery_pin_source: "geocoded" }),
    mk(1036, 6, null, { stage: "approved", store: "Pharr", account: "Delta Construction", invoice_num: "INV-3030",
      delivery_fee: 95, delivery_address: "1400 N Jackson Rd, Pharr TX", delivery_windows: "1200-1400",
      approved_by: "u-mgr", approved_at: stamp(100),
      delivery_lat: 26.1650, delivery_lng: -98.1950, delivery_pin_source: "geocoded" }),
    mk(1037, 3, null, { stage: "ready", store: "Edinburg", account: "Rio Tile Co.", invoice_num: "INV-3031",
      delivery_fee: 55, delivery_address: "2100 Sugar Rd, Edinburg TX",
      delivery_windows: "1400-1600", approved_by: "u-mgr", approved_at: stamp(90),
      delivery_lat: 26.3100, delivery_lng: -98.1450, delivery_pin_source: "geocoded" }),
    mk(1038, 5, null, { stage: "approved", store: "Mission", account: "Sunrise Flooring", invoice_num: "INV-3032",
      delivery_fee: 85, delivery_address: "1700 Doherty Ave, Mission TX", delivery_windows: "0800-1000",
      approved_by: "u-mgr", approved_at: stamp(80),
      delivery_lat: 26.2250, delivery_lng: -98.3400, delivery_pin_source: "geocoded" }),
    mk(1039, 4, null, { stage: "fulfilling", store: "Weslaco", account: "Coastal Homes", invoice_num: "INV-3033",
      delivery_fee: 65, delivery_address: "900 N Kansas Ave, Weslaco TX",
      delivery_windows: "1000-1200", approved_by: "u-mgr", approved_at: stamp(70),
      delivery_lat: 26.1500, delivery_lng: -98.0050, delivery_pin_source: "geocoded" }),

    // ---- Canceled + a re-delivery of #1016 ----
    mk(1024, 4, 4.4, { stage: "canceled", store: "Mission", account: "Casa Bella", invoice_num: "INV-3019",
      delivery_fee: 999, delivery_address: "100 Bryan Rd, Mission TX", delivery_windows: "0900-1100" }),
  ];

  // A re-delivery linked to #1016 (warehouse error) — repeats are measurable.
  const original = rows.find((r) => r.order_no === 1016)!;
  rows.push(
    mk(1025, 5, 4.0, {
      stage: "approved", store: "Mission", account: "Mission Remodel", invoice_num: "INV-3013",
      delivery_address: "9 Conway Ave, Mission TX", delivery_windows: "1300-1500", delivery_fee: 0,
      approved_by: "u-mgr", approved_at: stamp(20),
      delivery_lat: 26.2120, delivery_lng: -98.3230, delivery_pin_source: "geocoded",
      redelivery_of: original.id, redelivery_reason: "Wrong pallet loaded — 2 boxes damaged.",
    }),
  );

  // ---- Bulk unassigned pool for testing Route Planning ----
  // 30 more same-day orders, no driver yet, spread across every store — a
  // big sandbox for assigning drivers and optimizing routes. Left unassigned
  // (rather than pre-assigned) so they never trip the double-booking check.
  const cityPoints: Record<string, [number, number]> = {
    Brownsville: [25.9018, -97.4975],
    Weslaco: [26.1595, -97.9903],
    Pharr: [26.1948, -98.1836],
    McAllen: [26.2034, -98.2300],
    Mission: [26.2159, -98.3253],
    Edinburg: [26.3017, -98.1633],
  };
  const cities = Object.keys(cityPoints);
  const bulkAccounts = [
    "Rio Tile Co.", "Casa Bella", "Delta Construction", "Palm Grove Homes", "Mid-Valley Supply",
    "Hidalgo Interiors", "Sunrise Flooring", "Vista Kitchens", "Valley Builders", "Coastal Homes",
  ];
  const bulkStages: Delivery["stage"][] = ["approved", "fulfilling", "ready"];
  const bulkWindows = ["0800-1000", "0900-1100", "1000-1200", "1100-1300", "1300-1500", "1400-1600"];
  for (let i = 0; i < 30; i++) {
    const n = 1040 + i;
    const city = cities[i % cities.length];
    const [lat, lng] = cityPoints[city];
    rows.push(mk(n, 2 + (i % 8), null, {
      stage: bulkStages[i % bulkStages.length],
      store: city,
      account: bulkAccounts[i % bulkAccounts.length],
      invoice_num: `INV-3${100 + i}`,
      delivery_fee: 40 + (i % 10) * 8,
      delivery_address: `${100 + i * 7} Test Rd, ${city} TX`,
      delivery_windows: bulkWindows[i % bulkWindows.length],
      approved_by: "u-mgr",
      approved_at: stamp(60 + i * 5),
      delivery_lat: lat + ((i % 7) - 3) * 0.012,
      delivery_lng: lng + ((i % 5) - 2) * 0.012,
      delivery_pin_source: "geocoded",
    }));
  }

  // ---- Tomorrow's delivery run — 20 orders dated iso(1) across all stores,
  // mixed stages (pending/approved/fulfilling/ready) so every queue has
  // next-day work: managers see approvals due, warehouse sees prep, and
  // Route Planning has an assignable next-day pool. ----
  type TmrRow = [account: string, storeName: string, pallets: number, stage: Delivery["stage"], addr: string, windows: string, driver: string | null];
  const TOMORROW_ROWS: TmrRow[] = [
    ["Rio Tile Co.", "McAllen", 6, "pending", "801 N 10th St, McAllen TX", "0800-1200", null],
    ["Casa Bella", "McAllen", 3, "pending", "4501 N 2nd St, McAllen TX", "0900-1300", null],
    ["Valley Builders", "Pharr", 10, "approved", "612 S Cage Blvd, Pharr TX", "0800-1100", null],
    ["Delta Construction", "Pharr", 2, "pending", "300 E Ferguson Ave, Pharr TX", "1300-1700", null],
    ["Sunrise Flooring", "Mission", 8, "approved", "2201 E Griffin Pkwy, Mission TX", "0900-1200", null],
    ["Palm Grove Homes", "Mission", 4, "fulfilling", "1500 N Shary Rd, Mission TX", "1000-1400", "Fleet Truck 3"],
    ["Coastal Homes", "Brownsville", 12, "approved", "845 Paredes Line Rd, Brownsville TX", "0800-1200", null],
    ["Hidalgo Interiors", "Brownsville", 5, "fulfilling", "3300 Boca Chica Blvd, Brownsville TX", "1430-1700", "Fleet Truck 3"],
    ["Mid-Valley Supply", "Weslaco", 7, "pending", "600 S Texas Blvd, Weslaco TX", "0900-1200", null],
    ["Vista Kitchens", "Weslaco", 3, "approved", "1900 W Pike Blvd, Weslaco TX", "1000-1500", null],
    ["Valley Builders", "Edinburg", 9, "pending", "410 S Closner Blvd, Edinburg TX", "0800-1100", null],
    ["Casa Bella", "Edinburg", 6, "approved", "3100 S Sugar Rd, Edinburg TX", "1300-1700", null],
    ["Delta Construction", "McAllen", 4, "ready", "7000 N Ware Rd, McAllen TX", "0800-1000", "Carlos R."],
    ["Rio Tile Co.", "Pharr", 11, "ready", "1100 E Hall Acres Rd, Pharr TX", "0900-1200", "Miguel A."],
    ["Sunrise Flooring", "Mission", 2, "pending", "900 E 9th St, Mission TX", "1400-1700", null],
    ["Coastal Homes", "Brownsville", 8, "pending", "2500 Ruben Torres Blvd, Brownsville TX", "0800-1200", null],
    ["Palm Grove Homes", "Edinburg", 5, "fulfilling", "1800 E Richardson Rd, Edinburg TX", "1000-1300", "Carlos R."],
    ["Mid-Valley Supply", "Weslaco", 6, "approved", "231 N International Blvd, Weslaco TX", "0900-1300", null],
    ["Vista Kitchens", "Mission", 3, "ready", "4200 N Conway Ave, Mission TX", "1400-1700", "Miguel A."],
    ["Hidalgo Interiors", "McAllen", 7, "approved", "5800 N 10th St, McAllen TX", "1300-1600", null],
  ];
  TOMORROW_ROWS.forEach(([account, storeName, pallets, stage, addr, windows, driver], i) => {
    const [lat, lng] = cityPoints[storeName];
    rows.push(mk(1070 + i, pallets, 3 + (i % 9), {
      stage,
      store: storeName,
      account,
      so_num: `SO-2${100 + i}`,
      invoice_num: `INV-4${100 + i}`,
      delivery_fee: 45 + (i % 10) * 9,
      delivery_date: iso(1),
      delivery_address: addr,
      delivery_windows: windows,
      assigned_driver: driver,
      delivery_lat: lat + ((i % 7) - 3) * 0.011,
      delivery_lng: lng + ((i % 5) - 2) * 0.011,
      delivery_pin_source: "geocoded",
      ...(stage !== "pending" ? { approved_by: "u-mgr", approved_at: stamp(30 + i * 4) } : {}),
    }));
  });

  return rows.sort((a, b) => b.order_no - a.order_no);
}

export function demoNotifications(deliveries: Delivery[]): AppNotification[] {
  const find = (n: number) => deliveries.find((d) => d.order_no === n);
  const p1 = find(1003), p2 = find(1007), p3 = find(1016);
  const out: AppNotification[] = [];
  if (p1) out.push({ id: uid(), user_id: "u-mgr", delivery_id: p1.id, order_no: 1003, kind: "pending",
    message: "Order #1003 is awaiting your approval", read: false, created_at: stamp(6) });
  if (p2) {
    out.push({ id: uid(), user_id: "u-wh", delivery_id: p2.id, order_no: 1007, kind: "approved",
      message: "Order #1007 was approved — ready to fulfill", read: false, created_at: stamp(20) });
    out.push({ id: uid(), user_id: "u-sales", delivery_id: p2.id, order_no: 1007, kind: "approved",
      message: "Your order #1007 was approved", read: false, created_at: stamp(20) });
  }
  if (p3) out.push({ id: uid(), user_id: "u-sales", delivery_id: p3.id, order_no: 1016, kind: "delivered",
    message: "Order #1016 was delivered", read: true, created_at: stamp(180) });
  return out;
}
