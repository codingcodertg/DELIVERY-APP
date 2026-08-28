// ---- Roles ----------------------------------------------------------------
export type UserRole = "admin" | "manager" | "sales" | "warehouse" | "driver" | "logistics" | "accounting";

export interface Profile {
  id: string;
  full_name: string;
  /** Login name for people with no email address. They sign in as
   * `<username>@users.rdztilegroup.net` (see lib/username), which is derived,
   * never looked up. Null for anyone who signs in with a real email. */
  username?: string | null;
  role: UserRole;
  /** Extra capabilities granted to this specific person by an admin, on top of
   * whatever their role already allows (see Capability in lib/constants). */
  permissions?: string[] | null;
  // Store a warehouse worker / driver belongs to. Scopes what they see
  // (they only handle orders picked up from their store). null for others.
  store?: string | null;
  avatar_url?: string | null;
  /** Role INSIDE the recruiting module (admin|manager|recruiter). Independent
   * of `role` above — a deliveries `sales` user can also be a recruiting
   * `admin`. Null = no role there. See D-050. */
  recruiting_role?: string | null;
  /** Which modules besides deliveries itself this identity may enter. Today
   * "recruiting" and/or "timetracker", or empty. Empty/null = deliveries
   * only. See D-050. */
  module_access?: string[] | null;
  /** Role INSIDE the timetracker module (admin|employee). Independent of
   * `role` above, same shape as recruiting_role. Null = no role there.
   * See D-064. */
  timetracker_role?: string | null;
  /** employee | manager | owner inside clock-in (071). Null = no access. */
}

// ---- Workflow stages ------------------------------------------------------
// draft → pending → approved → fulfilling → ready → delivered
// off-ramps: rejected (manager), canceled
export type Stage =
  | "draft"
  | "pending"
  | "approved"
  | "rejected"
  | "fulfilling"
  | "ready"
  | "picked_up"
  | "delivered"
  | "canceled";

// ---- Role-targeted notes --------------------------------------------------
/** Who a note is primarily meant for. Everyone still sees every note; the tag
 * just says whose attention it wants. "everyone" is a general note. */
export type NoteRole = "everyone" | "sales" | "warehouse" | "logistics" | "driver";

/** A short heads-up left on an order and tagged with the role it's for — e.g.
 * "Warehouse: double-wrap this one". Added on demand so an order with no notes
 * shows nothing, keeping the form uncluttered. */
export interface RoleNote {
  id: string;
  role: NoteRole;
  text: string;
  by: string | null;        // author user id
  by_name: string | null;   // author display name (denormalized for display)
  at: string;               // ISO timestamp
}

/** One row of the NOT-LOCAL, miles-based delivery-fee table. */
export interface FeeBracket {
  /** Upper bound of driving miles for this bracket; null = "and up". */
  max_miles: number | null;
  /** Standard "list" price for this bracket, in $. */
  list: number;
  /** Discounted price a rep may offer for this bracket, in $. */
  discount: number;
}

// ---- Delivery order -------------------------------------------------------
export interface Delivery {
  id: string;
  /** Internal sequential number — kept for the DB sequence, sorting, and
   * split-load links. Not shown in the UI; order_code is the human-facing id. */
  order_no: number;
  /** Human-facing order id, e.g. "FA100" (year letter · week letter · counter).
   * Assigned at creation from the created date. See lib/order-code.ts. */
  order_code: string | null;
  /** Split-load letter. When a driver can only load part of an order, it
   * splits: the loaded part becomes e.g. #1001a and the remainder is a new
   * linked order #1001b (same order_no, next letter). Null = never split. */
  order_suffix: string | null;

  stage: Stage;
  rejected_reason: string | null;
  /** True for orders created in Teaching (training) mode — kept in the same
   * table but shown only while teaching mode is on. */
  is_training: boolean;

  // Re-delivery tracking: when an order has to be delivered again (warehouse
  // error, damage, etc.) it's re-recorded as a NEW order linked to the original,
  // with a reason — so repeats are measurable for the end-of-week review.
  redelivery_of: string | null;       // original delivery id, or null
  redelivery_reason: string | null;

  // Data columns (from the spec)
  order_type: string | null;
  store: string | null;
  po2: string | null;
  so_num: string | null;
  invoice_num: string | null;
  /** Internal reference for store-to-store moves (Transfer): an estimate #
   * instead of a customer invoice / PO / SO. */
  estimate_num: string | null;
  input_date: string | null;
  input_time: string | null;
  delivery_date: string | null;
  pickup_name: string | null;
  pickup_address: string | null;
  pickup_duration: string | null;
  // What the salesperson is charging the customer for this delivery (USD).
  delivery_fee: number | null;
  est_pallets: number | null;        // estimated by sales
  actual_pallets: number | null;      // revised/confirmed by warehouse
  assigned_driver: string | null;
  /** This order's stop position (0-based) in its driver's route for the day,
   * set by the Logistics Manager's route optimizer. null = not sequenced yet
   * (newly assigned, or the driver's route hasn't been optimized/reordered). */
  route_seq: number | null;
  /** Which load/trip of the driver's day this order rides on. A driver can run
   * several routes in a day, each a separate truckload out from the pickup and
   * back. null or 1 = the first load. route_seq is sequenced within the load. */
  load_no: number | null;
  /** Who decided this order's truckload. true = the optimizer grouped it and
   * may regroup it; false = a person put it there on purpose, so optimizing
   * leaves the grouping alone. Without this the two are indistinguishable and
   * the optimizer must either trample deliberate splits or never regroup. */
  load_auto: boolean;
  delivery_duration: string | null;
  /** Named dropoff point (saved site name), paired with delivery_address. */
  delivery_name: string | null;
  delivery_address: string | null;
  /** Set by the driver at delivery when they had to drop off somewhere OTHER
   * than delivery_address (an override, reported in the audit log). Null =
   * delivered at the ordered address. */
  delivered_address?: string | null;
  delivery_windows: string | null;
  account: string | null;
  contact: string | null;
  delivery_phone: string | null;
  delivery_notes: string | null;
  /** Role-targeted notes added on demand (see RoleNote). Optional so existing
   * rows / constructors don't need it; read defensively with `?? []`. */
  role_notes?: RoleNote[] | null;
  /** Set when an order that missed its day is reprogrammed for a later date and
   * flagged to go out FIRST thing the next morning. Drives a badge + bumps the
   * stop to the front of the driver's route. */
  morning_priority?: boolean | null;

  // Auto-computed route (pickup → delivery) from the routing service.
  route_miles: number | null;
  route_duration: string | null;   // e.g. "1 h 12 min"
  route_provider: string | null;   // Google Maps / Mapbox / OpenStreetMap
  route_traffic: boolean | null;   // true when the ETA includes live traffic

  // Proof of delivery (captured by the driver at the doorstep).
  pod_received_by: string | null;   // who signed for it
  pod_signature: string | null;     // signature image as a data: URL
  pod_delivered_at: string | null;  // when it was actually handed over
  /** Photos of the material taken by the driver (data: URLs), e.g. the load on
   * the truck or the goods dropped at the door. */
  photos: string[] | null;

  // When the driver set off toward the pickup (drive-to-pickup leg). Used as
  // the start of "active" time for the idle-time KPI when present.
  departed_at: string | null;
  // When the driver reached the delivery stop — splits transit into driving
  // (pickup → arrived) and dwell/service at the stop (arrived → delivered).
  arrived_at: string | null;
  // GPS stamps — where the driver actually was at each milestone. Captured from
  // the device at the moment of the action (no continuous tracking).
  pickup_lat: number | null;
  pickup_lng: number | null;
  pickup_gps_at: string | null;
  pod_lat: number | null;
  pod_lng: number | null;
  pod_accuracy: number | null;      // metres of uncertainty reported by the device

  // Planned delivery location, for the dispatch map + driver navigation.
  // Auto-geocoded from delivery_address and cached here the first time the
  // map needs it — OR set manually (a dropped pin) when there's no real
  // address yet, e.g. a construction site. "manual" pins are never
  // overwritten by re-geocoding.
  delivery_lat: number | null;
  delivery_lng: number | null;
  delivery_pin_source: "geocoded" | "manual" | null;

  /** Who took each photo, keyed by its URL. Written automatically whenever
   * photos are saved (see data-provider). Absent for anything uploaded before
   * this existed — an unattributed photo, not a wrong one. */
  photo_meta?: Record<string, { by: string; at: string }> | null;

  created_by: string | null;
  /** Set when an office/admin/driver creates the order on behalf of a sales
   * rep (see OrderModal's Sales Rep picker). `created_by` always stays the
   * actual creator; this is who the order is FOR — see lib/utils.ts's
   * orderOwner() for the one place that resolves "whose order is this". */
  assigned_sales_rep: string | null;
  approved_by: string | null;
  approved_at: string | null;
  /** Customer satisfaction on a delivered order: 1–5 stars + an optional note.
   * Recorded from the order form. Feeds the CSAT KPI. */
  csat_rating?: number | null;
  csat_comment?: string | null;
  created_at: string;
  updated_at: string;
}

/** A window when a driver is unavailable (vacation / sick / vehicle
 * maintenance / other). Consumed by the dispatch board + optimizer. */
export interface DriverAvailability {
  id: string;
  driver_id: string;
  kind: "vacation" | "sick" | "maintenance" | "other";
  start_date: string;
  end_date: string;
  note: string | null;
  created_by: string | null;
  created_at: string;
}

// A driver work session: clock-in → clock-out. ended_at null means the driver
// is on the clock right now. Idle time = on-clock time minus time actively
// working a delivery (pickup → delivered).
export interface DriverShift {
  id: string;
  driver_id: string;
  started_at: string;
  ended_at: string | null;
  note: string | null;
  /** Opaque per-install id of the phone that clocked in. Only that phone
   * reports position for this shift, so a second device signed into the same
   * account (the office checking something) doesn't mix its own position into
   * the driver's day. Null = unknown, which tracks permissively. */
  device_id: string | null;
  created_at: string;
}

/** One GPS fix from a driver's phone, sent only while they're on shift.
 * `accuracy_m` is the radius the device claims the point is good to — a coarse
 * fix is shown differently rather than trusted like a precise one. */
export interface DriverLocation {
  id: string;
  driver_id: string;
  lat: number;
  lng: number;
  accuracy_m: number | null;
  speed_mps: number | null;
  heading: number | null;
  battery_pct: number | null;
  recorded_at: string;
  created_at: string;
}

/** A logistics-manager record of something a driver did that cost the company
 * money (wasted trips, damage, bad attitude leading to inefficiency, etc.).
 * `cost` is the estimated $ impact; `delivery_id` optionally links the order it
 * relates to. */
export interface DriverIncident {
  id: string;
  driver_name: string;
  delivery_id: string | null;
  incident_date: string;   // yyyy-mm-dd
  description: string;
  cost: number;
  created_by: string | null;
  created_at: string;
}

export interface OrderEvent {
  id: string;
  delivery_id: string;
  kind: string;
  note: string | null;
  created_by: string | null;
  created_at: string;
}

/** A named place with a map-searchable address (stores, driver home bases). */
export interface NamedLocation {
  name: string;
  address: string;
  /** Stores only: when true, orders sold from this store skip manager approval
   * and are created already Approved. Undefined/false = normal approval flow. */
  auto_approve?: boolean;
  /** Confirmed geocoded pinpoint, saved when an admin taps "Verify" and the
   * address is found. Its presence means the address is verified; routing can
   * use this exact point instead of re-geocoding. Cleared when the address is
   * edited (so it always reflects a real confirmation). */
  lat?: number | null;
  lng?: number | null;
}

/** A saved customer/site account — picking it on an order auto-fills who to
 * contact there, the same way picking a saved pickup/dropoff fills its address. */
export interface AccountRecord {
  name: string;
  contact: string;
  phone: string;
  /** The account's usual delivery site — filled in (along with contact/phone)
   * when the account is picked on a customer order, so recurring customers
   * don't get re-typed. Optional; older saved accounts won't have it. */
  address?: string;
  /** An internal branch account (store-to-store). Picking it on an order
   * defaults the type to Intertienda; a customer account defaults to Customer. */
  intertienda?: boolean;
}

/** Explicit field-requirement rules for one order type. Replaces guessing the
 * rules from the type's name. */
export interface OrderTypeRule {
  /** Store-to-store move (branch → branch): the destination is another store,
   * so no external customer contact/phone is collected. */
  storeToStore?: boolean;
  /** Which document reference the type uses:
   *  - "invoice": Invoice # (and a delivery fee) required
   *  - "any": any one of PO # / SO # / Invoice #
   *  - "po": PO # required, specifically
   *  - "none": no document reference required (shows the PO/SO/Invoice fields)
   *  - "estimate": shows a single optional Estimate # field instead */
  docRef?: "invoice" | "any" | "po" | "none" | "estimate";
  /** The rep's own store is the DESTINATION, not the origin (a "receiving"
   * branch move, e.g. Intertienda). On a new order the delivery defaults to the
   * rep's store and the rep chooses the "Sold From" (origin) store instead of
   * it being auto-locked to their own. */
  homeIsDestination?: boolean;
}

/** A how-to video shown in the account view's Tutorials section. Hosted
 * externally (YouTube / Loom / Vimeo / Drive) and embedded by its link. */
export interface Tutorial {
  id: string;
  title: string;
  description?: string | null;
  url: string;
  added_by?: string | null;
  added_at?: string;
}

export interface Settings {
  id: number;
  app_name: string;
  stores: NamedLocation[];
  order_types: string[];
  /** Per-type field rules, keyed by the order-type name. Types without an
   * entry fall back to name-keyword defaults (see required.ts). */
  order_type_rules?: Record<string, OrderTypeRule>;
  /** Saved pickup points (warehouses, yards, suppliers). Picking a name fills
   * the address; a new one typed on an order can be saved back here. */
  pickup_locations?: NamedLocation[];
  /** Saved dropoff points (recurring customer sites, job sites). */
  delivery_locations?: NamedLocation[];
  /** Saved accounts — picking one on an order auto-fills its contact name
   * + phone. A new account typed on an order can be saved back here. */
  accounts?: AccountRecord[];
  // NOTE: drivers are NOT stored here — they're users with the "driver" role.
  // Use driverNames(users) from lib/constants. Keeping them in one place stops
  // the Settings list and the Users list drifting apart.
  // Minutes of duration added per pallet, used to auto-calculate the
  // pickup and delivery durations on each order. Editable by admins.
  pickup_min_per_pallet: number;
  delivery_min_per_pallet: number;

  // ---- RingCentral integrations (opt-in, OFF by default) ----
  // Both cost money / contact customers, so nothing fires unless an admin
  // deliberately turns it on here.
  /** Show the "Call via RingCentral" (RingOut) buttons. */
  rc_calls_enabled: boolean;
  /** Automatically text the customer their tracking link when an order is created. */
  rc_auto_sms_enabled: boolean;

  /** Admin-editable "What I can do" list per role, shown on each Account page.
   * Absent / empty for a role = fall back to the built-in bilingual defaults. */
  role_permissions?: Partial<Record<UserRole, string[]>>;

  // ---- End-of-day pending-approval deadline (configurable) ----
  // Once it's this time of day and an order is still "pending", its row
  // turns red and an escalation notification fires: managers first, then
  // (a bit later) the sales rep who submitted it. Both "HH:MM", 24h.
  manager_pending_cutoff?: string;
  sales_pending_cutoff?: string;

  /** Named driver colors for the delivery map (assigned by a manager/admin in
   * Settings). Driver full name → any CSS color string. */
  driver_colors?: Record<string, string>;

  /** Each driver's truck capacity in pallets, set by Logistics/admin in the
   * Routes tool. When a driver's assigned pallets exceed this, the route
   * optimizer splits their day into multiple round trips back to their home
   * store to reload. Driver full name → pallet count. */
  driver_capacity?: Record<string, number>;

  /** Fleet-wide default truck capacity in pallets — used for any driver who
   * doesn't have their own capacity set. Raise it so a truck carries several
   * orders in one trip (drop → drop) instead of reloading between them. */
  default_truck_capacity?: number;

  /** Named "route buckets" (e.g. "Route 1", "Route 2") used to build routes in
   * the Routes Manager before a real driver exists. Orders assigned to a bucket
   * park under its name (assigned_driver) until the whole route is handed off to
   * an actual driver. Just the bucket names; the orders live on the deliveries. */
  route_buckets?: string[];

  /** Fixed Orders-table columns for the Sales role, set by an admin in Settings.
   * Sales reps get no "Columns" picker of their own — this is the one list
   * they see, company-wide. Falls back to ROLE_DEFAULT_COLUMNS.sales if unset. */
  sales_columns?: string[] | null;

  /** Where the in-app Help button sends its emails. Any user can tap Help to
   * email this address; an admin sets it in Settings. Falls back to
   * DEFAULT_HELP_EMAIL when unset. */
  help_email?: string;

  /** Optional support phone number. When set, the Help button shows a "Call"
   * link that opens the user's phone dialer (tel:) with this number. */
  help_phone?: string;

  /** When true, a driver can't mark an order Delivered until proof exists — at
   * least one material photo OR a captured signature. Off by default. */
  require_pod?: boolean;
  /** Whether the customer signature pad is offered at delivery. Off means
   * proof rests on the material photos alone. */
  pod_signature_enabled?: boolean;

  /** Per-user customer visibility on the Accounts page, set by an admin on the
   * Users page. "all" = sees every customer (with a Mine/All toggle); "own" =
   * only customers from orders they own. User id → scope. Missing = "all"
   * (preserves the previous behavior for Manager/Logistics). */
  customer_scope?: Record<string, "all" | "own">;

  // ---- Delivery cost model (Epic D) — drives the fuel-cost / cost-per-delivery
  // KPIs, derived from each order's route_miles. All optional; a KPI shows "—"
  // until the pieces it needs are set. ----
  /** Fuel price, $ per gallon. */
  fuel_price?: number | null;
  /** Fleet average fuel economy, miles per gallon. */
  fleet_mpg?: number | null;
  /** Flat overhead cost charged per delivery/stop, in $. */
  cost_per_delivery?: number | null;

  /** How-to videos shown in the account view (admin-managed, everyone views). */
  tutorials?: Tutorial[];

  // ---- Local-zone delivery pricing ----
  // A delivery to a city in `local_cities` is LOCAL → a flat fee (list vs a
  // discounted price). Anything outside is NOT LOCAL → priced by driving miles
  // via `nonlocal_fee_brackets` and flagged as needing manager approval. All
  // optional; code falls back to seeded defaults (see lib/pricing).
  /** Cities that count as the LOCAL delivery zone. */
  local_cities?: string[];
  /** LOCAL flat fee — the standard "list" price, in $. */
  local_fee_list?: number | null;
  /** LOCAL flat fee — the discounted price a rep may offer, in $. */
  local_fee_discount?: number | null;
  /** NOT-LOCAL fee by driving miles: the first bracket whose `max_miles` ≥ the
   * order's route miles wins (`max_miles: null` = "and up"). */
  nonlocal_fee_brackets?: FeeBracket[];
  /** Extra charge ($) added to the delivery fee when the order is for same-day
   * delivery (delivery date = today). Default 0 = feature off. */
  same_day_surcharge?: number | null;

  /** Market Map prospect CRM — status per external place id (Google/OSM).
   * A lightweight sales tracker layered over the live places. */
  prospect_status?: Record<string, {
    status: "contacted" | "interested" | "partner" | "not_interested";
    note?: string | null;
    updated_at?: string;
    updated_by?: string | null;
  }>;
}
