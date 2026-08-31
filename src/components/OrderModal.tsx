"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useData } from "@/lib/data-provider";
import { usePrefs } from "@/lib/prefs";
import { useConfirm } from "@/lib/confirm";
import { canApprove, canCreate, canDeliver, canEditFields, canFulfill, DELIVERY_WINDOW_PRESETS, driverNames, ROLE_INFO, roleLabel, SATURDAY_WINDOW, stageInfo, stageLabel, WEEKDAY_ALL_DAY_WINDOW } from "@/lib/constants";
import { colLabel, deliveryColumns, fmtDate, fmtDateTime, fmtMilitary, fmtMoney, fmtWindows, nowMilitary, orderLabel, palletDuration, palletVariance, telClean, todayISO } from "@/lib/utils";
import { suggestDeliveryFee } from "@/lib/pricing";
import { printDeliverySlip } from "@/lib/slip";
import { AddressInput } from "@/components/AddressInput";
import { LocationCombo } from "@/components/LocationCombo";
import { PhotoUpload } from "@/components/PhotoUpload";
import { PhotoLightbox } from "@/components/PhotoLightbox";
import { SignaturePad } from "@/components/SignaturePad";
import { MapView } from "@/components/MapView";
import { suggestDriver, windowConflicts } from "@/lib/dispatch";
import { checkSchedule } from "@/lib/scheduling";
import { isStoreToStore, orderTypeRule, missingFields, missingKeys, submitBlockers, type MissingField } from "@/lib/required";
import { captureLocationSplit, geoAvailable, mapLink, type GeoStamp } from "@/lib/geo";
import type { AccountRecord, Delivery, NamedLocation, NoteRole, Profile, RoleNote, Settings, Stage } from "@/lib/types";

type Draft = Partial<Delivery>;

// A new order starts with NO order type. It decides which paperwork is
// required (Intra-Tienda / Pickup / Transfer differ), so it has to be a
// deliberate choice — defaulting it to "Delivery" silently picked for the rep
// and meant the required-field highlight could never fire.
const EMPTY: Draft = {
  stage: "draft",
  input_date: todayISO(),
  // Most orders run all day; reps narrow the window only when the customer asks.
  delivery_windows: "0830-1730",
};

// Standard cancellation reasons (#10) — a fixed pick-list keeps the data clean
// for the end-of-week review, mirroring how rejections capture a reason.
const CANCEL_REASONS: { en: string; es: string }[] = [
  { en: "Customer canceled", es: "Cliente canceló" },
  { en: "Duplicate order", es: "Orden duplicada" },
  { en: "Out of stock", es: "Sin existencias" },
  { en: "Rescheduled", es: "Reprogramada" },
  { en: "Wrong information", es: "Información incorrecta" },
  { en: "Other", es: "Otro" },
];

/** Create / edit / view a delivery order with role-gated fields + workflow actions. */
export function OrderModal({
  me,
  existing,
  startEditing,
  onClose,
}: {
  me: Profile;
  existing: Delivery | null;
  startEditing: boolean;
  onClose: () => void;
}) {
  const { settings, users, deliveries, addDelivery, updateDelivery, deleteDelivery, setStage, eventsFor, addNote, saveSettings, notify } =
    useData();
  const { lang, t } = usePrefs();
  const confirmAction = useConfirm();
  const isNew = !existing;
  const stage: Stage = existing?.stage ?? "draft";
  const editable = isNew || (startEditing && canEditFields(me.role, stage));
  const [editing, setEditing] = useState(editable);
  // A rep assigned to a store starts new orders there (still changeable).
  const [d, setD] = useState<Draft>(existing ?? { ...EMPTY, ...(me.store ? { store: me.store } : {}) });

  // Delivery-window default follows the weekday: Saturdays run the shorter
  // all-day window (8:30–3:30), every other day runs the full weekday all-day
  // window (8:30–5:30). Switching the date between a Saturday and a weekday
  // flips the default BOTH ways — but only when the field is empty or on the
  // other day's default, so a manually-chosen custom window is never fought.
  useEffect(() => {
    if (!editing || !d.delivery_date) return;
    const isSat = new Date(d.delivery_date + "T12:00:00").getDay() === 6;
    const want = isSat ? SATURDAY_WINDOW : WEEKDAY_ALL_DAY_WINDOW;
    const other = isSat ? WEEKDAY_ALL_DAY_WINDOW : SATURDAY_WINDOW;
    if (!d.delivery_windows || d.delivery_windows === other) {
      setD((p) => (p.delivery_windows === want ? p : { ...p, delivery_windows: want }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [d.delivery_date, editing]);
  const [busy, setBusy] = useState(false);
  const [rejectReason, setRejectReason] = useState("");
  const [showReject, setShowReject] = useState(false);
  const [cancelReason, setCancelReason] = useState("");
  const [showCancel, setShowCancel] = useState(false);
  const [redeliverReason, setRedeliverReason] = useState("");
  const [redeliverCharge, setRedeliverCharge] = useState("");
  const [showRedeliver, setShowRedeliver] = useState(false);
  const [routing, setRouting] = useState(false);
  const [routeErr, setRouteErr] = useState("");
  const [showPod, setShowPod] = useState(false);
  // Pallet confirmations: warehouse confirms the count on "Mark ready";
  // the driver confirms what actually fit on the truck at pickup (a short
  // load splits the order into #Na / #Nb).
  const [showReadyConfirm, setShowReadyConfirm] = useState(false);
  const [readyPallets, setReadyPallets] = useState("");
  // La tarifa que el almacén confirma al AGARRAR la orden (D-146). Estuvo un rato en
  // "Marcar listo" (D-143) y se movió aquí: la tarifa mal puesta se ve al abrir la orden,
  // y descubrirla al final —con las pallets ya montadas y el camión esperando— es tarde
  // para preguntarle nada a ventas. Se precarga con la que puso ventas: lo normal es que
  // esté bien, y obligar a teclearla siempre convertiría la comprobación en un trámite.
  const [showStartConfirm, setShowStartConfirm] = useState(false);
  const [startFee, setStartFee] = useState("");
  // Order view opens on a compact preview; the full detail table is behind a toggle.
  const [showAllDetails, setShowAllDetails] = useState(false);
  // New order: start on a small initial step (Order Type + Delivery Address to
  // price the fee) before the whole form. Store-to-store types skip it.
  const [showFullForm, setShowFullForm] = useState(!isNew);
  const [showPickupConfirm, setShowPickupConfirm] = useState(false);
  const [pickupPallets, setPickupPallets] = useState("");
  const [podName, setPodName] = useState("");
  const [podSig, setPodSig] = useState<string | null>(null);
  // Driver override: delivered somewhere other than the ordered address.
  const [deliveredElsewhere, setDeliveredElsewhere] = useState(false);
  const [deliveredAddress, setDeliveredAddress] = useState("");
  const [noteText, setNoteText] = useState("");
  const [notingBusy, setNotingBusy] = useState(false);
  const [photoBusy, setPhotoBusy] = useState(false);
  // A signature shown 90px tall isn't a signature anyone can check.
  const [viewSig, setViewSig] = useState(false);
  const [showPinPicker, setShowPinPicker] = useState(false);
  const [pinDraft, setPinDraft] = useState<[number, number] | null>(null);
  const [pinLookupBusy, setPinLookupBusy] = useState(false);
  // After a successful delivery we keep the modal open on a success screen so the
  // driver can print the slip; holds the fully-updated (delivered) order.
  const [justDelivered, setJustDelivered] = useState<Delivery | null>(null);
  // Held in a ref so the auto-close timer below isn't restarted every time the
  // parent hands down a fresh onClose.
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  /**
   * Fill in coordinates that arrived after the milestone was already saved.
   *
   * The stage change is what the driver is waiting on, so it never waits for
   * GPS; when the fix shows up a moment later this quietly patches it onto the
   * order. Silent by design — the driver has moved on and there's nothing for
   * them to do about it either way.
   */
  const attachLateFix = async (
    id: string,
    pending: Promise<GeoStamp | null>,
    kind: "pickup" | "pod",
  ) => {
    const gps = await pending;
    if (!gps) return;
    // Quiet on purpose. This lands seconds after the driver already moved on;
    // an error toast here reads as "your delivery failed" when the delivery is
    // long since saved. It said exactly that until v1.3.6.
    await updateDelivery(id, kind === "pickup"
      ? { pickup_lat: gps.lat, pickup_lng: gps.lng, pickup_gps_at: gps.at }
      : { pod_lat: gps.lat, pod_lng: gps.lng, pod_accuracy: gps.accuracy },
      { quiet: true });
  };
  // A backdrop click only closes when the press STARTED on the backdrop too —
  // otherwise a click whose mouseup lands on the just-opened overlay (or a drag
  // release) would instantly close the modal that the same click just opened.
  const overlayDownRef = useRef(false);
  // Local mirrors of the drive-to-pickup / arrival stamps, so the "En route" /
  // "Arrived" indicator updates instantly (the `existing` prop isn't re-synced
  // from the store while the modal stays open).
  const [departedAt, setDepartedAt] = useState<string | null>(existing?.departed_at ?? null);
  const [arrivedAt, setArrivedAt] = useState<string | null>(existing?.arrived_at ?? null);

  const events = existing ? eventsFor(existing.id) : [];
  const userName = (id: string | null | undefined) =>
    users.find((u) => u.id === id)?.full_name ?? "—";
  // A small colored pill showing a person's role, shown beside their name in
  // the order history (created / assigned / approved / event log).
  const roleTag = (id: string | null | undefined) => {
    const role = users.find((u) => u.id === id)?.role;
    if (!role) return null;
    return (
      <span className="sema" style={{ background: ROLE_INFO[role].color, color: "#fff", marginLeft: 6 }}>
        {roleLabel(role, lang)}
      </span>
    );
  };

  const set = (k: keyof Delivery, v: unknown) => setD((p) => ({ ...p, [k]: v }));

  // A non-sales creator (office, admin, driver) is placing the order on behalf
  // of a sales rep, so it needs to be assigned to one — that's who the order
  // shows up "owned by" everywhere else (own-orders filters, dashboard credit).
  // Intratienda and Transfer are store-to-store — no customer, so no sales rep
  // to credit. Only customer Delivery orders placed on someone's behalf need one.
  // A store can be flagged "auto-approve" (Data page) — orders sold from it
  // skip manager approval and are created already Approved, for any creator.
  const storeAutoApprove = !!settings.stores.find((s) => s.name === d.store)?.auto_approve;
  // Belt and braces. The PO is now a REQUIRED field for Intertienda (the "po"
  // docRef rule), so submitting without one is refused before this is reached
  // and it should never fire. Kept because the alternative — if validation is
  // ever bypassed — is auto-approving a transfer with no paperwork, and the
  // wrong outcome there is worse than an extra approval step.
  //
  // Until today this rule ran ALONE: validation accepted "any one of PO / SO /
  // invoice", so an Intertienda with only an invoice passed, then landed in
  // Pending with no explanation. Seven orders on 2026-08-17 alone.
  const intertiendaNeedsPo = d.order_type === "Intertienda" && !(d.po2 || "").trim();

  // Store-to-store moves (Intertienda / Transfer) have no external customer, so
  // no sales rep to credit. Only external-customer orders placed on someone's
  // behalf need one.
  const needsSalesRep = isNew && (me.role === "manager" || me.role === "admin" || me.role === "driver")
    && !isStoreToStore(d.order_type, settings.order_type_rules);
  const salesReps = useMemo(() => users.filter((u) => u.role === "sales"), [users]);

  // ---- Required fields (#31) — see lib/required.ts for the rules ----
  // Live list of what's still missing, used to highlight the empty fields.
  const computeMissing = (draft: Draft): MissingField[] => {
    const base = missingFields(draft, settings.order_type_rules);
    if (needsSalesRep && !draft.assigned_sales_rep) {
      return [...base, { key: "assigned_sales_rep", en: "Sales Rep", es: "Vendedor" }];
    }
    return base;
  };
  const missing = computeMissing(d);
  const missingSet = new Set(missingKeys(d, settings.order_type_rules));
  if (needsSalesRep && !d.assigned_sales_rep) missingSet.add("assigned_sales_rep");

  // Pickup and delivery can't be the same place — an order that "goes" nowhere.
  const normAddr = (s: string | null | undefined) => (s || "").trim().toLowerCase().replace(/\s+/g, " ");
  const pickupEqualsDropoff = !!normAddr(d.pickup_address) && normAddr(d.pickup_address) === normAddr(d.delivery_address);

  // ---- Duplicate-order warning (#34): same account + date + PO already logged ----
  const duplicateOf = (draft: Draft): Delivery | undefined =>
    deliveries.find((x) =>
      x.id !== existing?.id &&
      x.stage !== "canceled" &&
      !!draft.account && (x.account || "").trim().toLowerCase() === draft.account.trim().toLowerCase() &&
      (draft.delivery_date || "") === (x.delivery_date || "") &&
      (draft.po2 || "").trim() === (x.po2 || "").trim() &&
      !!(draft.po2 || "").trim(),
    );

  // ---- Duplicate-invoice warning: same customer invoice # already logged on
  // another (non-canceled) order. Invoice numbers are supposed to be unique
  // per delivery, so this is almost always a typo or a re-entry mistake. ----
  const duplicateInvoiceOf = (draft: Draft): Delivery | undefined =>
    deliveries.find((x) =>
      x.id !== existing?.id &&
      x.stage !== "canceled" &&
      !!(draft.invoice_num || "").trim() &&
      (x.invoice_num || "").trim().toLowerCase() === (draft.invoice_num || "").trim().toLowerCase(),
    );
  const invoiceDup = duplicateInvoiceOf(d);
  // Sharing an invoice across deliveries (one invoice, several drops) is
  // intentional — set when the rep links a past order's invoice, so the
  // duplicate-invoice guard doesn't fight it. Cleared on a manual edit.
  const [sharedInvoice, setSharedInvoice] = useState(false);
  // Past orders' invoices the rep can optionally attach this delivery to (most
  // recent first, one entry per distinct invoice).
  const pastInvoiceOptions = useMemo(() => {
    const seen = new Set<string>();
    return deliveries
      .filter((x) => x.id !== existing?.id && x.stage !== "canceled" && !!(x.invoice_num || "").trim())
      .sort((a, b) => b.order_no - a.order_no)
      .filter((x) => { const inv = x.invoice_num!.trim().toLowerCase(); if (seen.has(inv)) return false; seen.add(inv); return true; })
      .slice(0, 100)
      .map((x) => ({ invoice: x.invoice_num!.trim(), label: `${x.invoice_num} · #${orderLabel(x)}${x.account ? ` · ${x.account}` : ""}` }));
  }, [deliveries, existing?.id]);

  // Local-zone pricing suggestion for the edit form (fee by miles).
  // Only ever a SUGGESTION: the fee stays blank until the rep picks List or
  // Discount (or types an amount). It used to auto-fill with List once the
  // miles resolved, which quietly committed a price nobody had agreed to.
  const feeSuggestion = suggestDeliveryFee(d, settings);
  /**
   * Esta orden va a salir sin cobrar nada (D-147).
   *
   * Vacío y $0 cuentan igual. Cero es un valor legítimo —una entrega de cortesía, una
   * reentrega que se come la casa— y justo por eso hay que **verlo y confirmarlo**: desde
   * fuera, un cero deliberado y uno olvidado son idénticos.
   *
   * Solo para los tipos que se cobran. Quién se cobra ya lo decide `required.ts` (la tarifa
   * es obligatoria donde el documento es la factura), así que se le pregunta en vez de
   * volver a decidirlo aquí: dos reglas discrepando sobre la misma orden es como se acaba
   * marcando en rojo cada traslado entre tiendas, que nunca llevó tarifa.
   */
  const seCobra = orderTypeRule(d.order_type, settings.order_type_rules).docRef === "invoice";
  const sinCobrar = seCobra && (existing?.delivery_fee == null || Number(existing.delivery_fee) === 0);

  // A brand-new order defaults to Order Type "Customer" and the store the
  // salesperson is assigned to in Settings (runs once, after settings load).
  // Office (manager) and accounting default to "Intertienda" instead — most
  // of what they log is store-to-store, not a customer delivery.
  const defaultedRef = useRef(false);
  useEffect(() => {
    if (!isNew || defaultedRef.current || settings.order_types.length === 0) return;
    defaultedRef.current = true;
    const defaultType = (me.role === "manager" || me.role === "accounting") && settings.order_types.includes("Intertienda")
      ? "Intertienda" : "Customer";
    setD((p) => {
      let next = p;
      if (!p.order_type && settings.order_types.includes(defaultType)) next = withTypeDefaults(next, defaultType);
      if (!next.store && me.store) {
        const st = settings.stores.find((s) => s.name === me.store);
        next = { ...next, store: me.store, pickup_name: me.store, pickup_address: st?.address ?? next.pickup_address };
      }
      return next;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isNew, settings.order_types.length, me.role]);

  /** Hard gate (D-049): pallets and the document reference actually refuse a
   * draft → pending submission — there's nothing to plan a truck for or bill
   * against without them. Every other required field stays a dismissible
   * warning below. Never called for a draft save. */
  const blockSubmit = (draft: Partial<Delivery>): boolean => {
    const blockers = submitBlockers(draft, settings.order_type_rules);
    if (!blockers.length) return false;
    const list = blockers.map((m) => `• ${t(m.en, m.es)}`).join("\n");
    notify(t(
      `Can't submit for approval — still missing:\n\n${list}`,
      `No se puede enviar a aprobación — todavía falta:\n\n${list}`,
    ));
    return true;
  };

  /** Shared pre-submit gate. Pallets/document hard-block (above); everything
   * else is listed and the rep chooses whether to continue. */
  const passesChecks = async (draft: Draft): Promise<boolean> => {
    if (blockSubmit(draft)) return false;
    // 1. Required fields — list them and let the rep decide.
    const miss = computeMissing(draft);
    if (miss.length) {
      const list = miss.map((m) => `• ${t(m.en, m.es)}`).join("\n");
      if (!(await confirmAction(t(
        `These required fields are still empty:\n\n${list}\n\nContinue anyway?`,
        `Estos campos obligatorios están vacíos:\n\n${list}\n\n¿Continuar de todos modos?`,
      )))) return false;
    }
    const dup = duplicateOf(draft);
    if (dup && !(await confirmAction(t(
      `Order #${orderLabel(dup)} already has the same account, delivery date and PO. Create anyway?`,
      `La orden #${orderLabel(dup)} ya tiene la misma cuenta, fecha y PO. ¿Crear de todos modos?`,
    )))) return false;

    const dupInv = duplicateInvoiceOf(draft);
    if (dupInv && !sharedInvoice && !(await confirmAction(t(
      `⚠ Duplicate invoice: order #${orderLabel(dupInv)} already uses invoice #${dupInv.invoice_num}. Create anyway?`,
      `⚠ Factura duplicada: la orden #${orderLabel(dupInv)} ya usa la factura #${dupInv.invoice_num}. ¿Crear de todos modos?`,
    )))) return false;

    // Scheduling capacity rules — warn, but let the rep request it anyway.
    const warns = checkSchedule(
      { id: existing?.id, store: draft.store, delivery_date: draft.delivery_date, delivery_windows: draft.delivery_windows },
      deliveries,
    );
    if (warns.length) {
      const list = warns.map((w) => `• ${t(w.en, w.es)}`).join("\n");
      if (!(await confirmAction(t(`⚠ Scheduling conflict:\n\n${list}\n\nRequest anyway?`, `⚠ Conflicto de programación:\n\n${list}\n\n¿Solicitar de todos modos?`)))) return false;
    }
    return true;
  };

  // Live scheduling warnings shown while editing the date/window.
  const scheduleWarnings = checkSchedule(
    { id: existing?.id, store: d.store, delivery_date: d.delivery_date, delivery_windows: d.delivery_windows },
    deliveries,
  );

  // Durations are auto-derived from pallet count × the admin-set per-pallet rates.
  const pickupDur = palletDuration(d.est_pallets, settings.pickup_min_per_pallet);
  const deliveryDur = palletDuration(d.est_pallets, settings.delivery_min_per_pallet);

  /** Merge computed durations into a payload; stamp input date/time on creation. */
  const withDurations = (base: Draft): Draft => {
    const payload: Draft = { ...base, pickup_duration: pickupDur, delivery_duration: deliveryDur };
    if (payload.est_pallets === ("" as unknown)) payload.est_pallets = null;
    // Input date + time are recorded automatically the moment the order is created.
    if (isNew) {
      payload.input_date = todayISO();
      payload.input_time = nowMilitary();
    }
    return payload;
  };

  // Automatically text the customer their live tracking link when an order is
  // created. No-ops silently if there's no phone or SMS isn't configured.
  const autoSendTracking = async (row: Delivery) => {
    // Opt-in only: admins switch this on in Settings (off by default).
    if (!settings.rc_auto_sms_enabled) return;
    const phone = telClean(row.delivery_phone);
    if (phone.replace(/\D/g, "").length < 7) return;
    const url = `${location.origin}/track/${row.id}`;
    const who = row.contact ? `${row.contact}, ` : "";
    const date = row.delivery_date ? fmtDate(row.delivery_date) : "";
    const win = row.delivery_windows ? ` ${fmtWindows(row.delivery_windows)}` : "";
    const message = t(
      `Hi ${who}your RDZ delivery #${orderLabel(row)} is scheduled${date ? ` for ${date}${win}` : ""}. Track it live here: ${url}`,
      `Hola ${who}su entrega RDZ #${orderLabel(row)} está programada${date ? ` para el ${date}${win}` : ""}. Siga su estado aquí: ${url}`,
    );
    try {
      const res = await fetch("/api/notify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ channel: "sms", to: phone, message }),
      });
      const b = await res.json().catch(() => ({}));
      if (b.ok) notify(t("Tracking SMS sent to customer", "SMS de seguimiento enviado al cliente"));
    } catch { /* non-blocking */ }
  };

  const save = async () => {
    const payload = withDurations(d);
    // Hard rule: pickup and delivery address may never be identical.
    if (pickupEqualsDropoff) {
      notify(t("Pickup and delivery address can't be the same.", "La dirección de recolección y de entrega no pueden ser iguales."));
      return;
    }
    // Enforce required fields once an order is past the draft stage.
    if ((payload.stage ?? "draft") !== "draft" && !(await passesChecks(payload))) return;
    setBusy(true);
    if (isNew) {
      const row = await addDelivery(payload);
      setBusy(false);
      if (row) { notify(t(`Order #${orderLabel(row)} created`, `Orden #${orderLabel(row)} creada`)); await autoSendTracking(row); onClose(); }
    } else {
      const ok = await updateDelivery(existing!.id, payload);
      setBusy(false);
      if (ok) { notify(t("Saved", "Guardado")); setEditing(false); }
    }
  };

  // Remembers the last origin→destination pair we routed, so the auto-calc
  // effect doesn't re-fire for an address that's already been resolved.
  const lastRouted = useRef<string>("");

  const runRoute = async (origin: string, destination: string, manual: boolean) => {
    if (!origin) { if (manual) setRouteErr(t("Add a pickup address (or store) first.", "Agregue primero una dirección de recolección (o tienda).")); return; }
    if (!destination) { if (manual) setRouteErr(t("Add a delivery address first.", "Agregue primero una dirección de entrega.")); return; }
    setRouteErr("");
    lastRouted.current = `${origin}→${destination}`;
    setRouting(true);
    try {
      const res = await fetch("/api/distance", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ origin, destination }),
      });
      const body = await res.json();
      if (!res.ok) {
        // Let a manual retry re-run this pair.
        lastRouted.current = "";
        if (manual) setRouteErr(body.error || t("Could not calculate route.", "No se pudo calcular la ruta."));
        return;
      }
      setD((p) => ({
        ...p,
        route_miles: body.miles,
        route_duration: body.duration_text,
        route_provider: body.provider,
        route_traffic: body.traffic,
      }));
    } catch {
      lastRouted.current = "";
      if (manual) setRouteErr(t("Network error — is the machine online?", "Error de red — ¿la máquina está en línea?"));
    } finally {
      setRouting(false);
    }
  };

  // Store-to-store move (Intertienda / Transfer): the destination is another
  // known store chosen from the dropdown, and there's no external customer, so
  // account/contact/phone don't apply and are locked. Driven by the order
  // type's configured rule (Data → Order types), not the name.
  const storeToStore = isStoreToStore(d.order_type, settings.order_type_rules);
  // Store-to-store still routes the DESTINATION to another store (dropdown
  // instead of a free address); the customer/contact fields stay visible.
  const isIntraStore = storeToStore;
  // "Receiving" types (Intertienda): the rep's own store is the DESTINATION, so
  // the delivery defaults to it and the rep picks the "Sold From" (origin).
  const homeIsDestination = orderTypeRule(d.order_type, settings.order_type_rules).homeIsDestination === true;
  // Which document-reference fields this type shows: "estimate" (Transfer) uses
  // a single Estimate #; everything else uses the Invoice # / PO # / SO # trio.
  const docRef = orderTypeRule(d.order_type, settings.order_type_rules).docRef ?? "invoice";

  // Apply a newly-chosen order type's directional defaults. For a receiving
  // type the rep's store becomes the destination and Sold From is theirs to
  // pick; otherwise Sold From defaults back to the rep's store.
  const withTypeDefaults = (p: Draft, newType: string): Draft => {
    const rule = orderTypeRule(newType, settings.order_type_rules);
    const next: Draft = { ...p, order_type: newType };
    if (rule.homeIsDestination && me.store) {
      const home = settings.stores.find((s) => s.name === me.store);
      next.delivery_name = me.store;
      next.delivery_address = home?.address ?? p.delivery_address ?? "";
      if (!p.store || p.store === me.store) next.store = ""; // rep chooses the origin
    } else if (!p.store && me.store) {
      next.store = me.store; // normal direction: Sold From is the rep's store
    }
    return next;
  };
  // Which store the current delivery address belongs to (for the dropdown value).
  const deliveryStore = settings.stores.find((s) => s.address && s.address === d.delivery_address)?.name || "";

  // Routing origin: an explicit pickup address wins; otherwise fall back to the
  // selected store's saved (map-searchable) address, then its bare name.
  const storeAddress = settings.stores.find((s) => s.name === d.store)?.address || "";
  const routeOrigin = (d.pickup_address || storeAddress || d.store || "").trim();

  const calcRoute = () =>
    runRoute(routeOrigin, (d.delivery_address || "").trim(), true);

  // Dropping a manual pin also fills in Delivery Address from a reverse
  // geocode of that point, so the field isn't left blank — the rep can
  // still edit it by hand afterward (e.g. to add gate code instructions).
  // Reverse-geocode a point → fill the Delivery Address. Shared by "drop" (so
  // the address appears as soon as the pin lands) and "Save pin".
  const geocodePin = async (lat: number, lng: number) => {
    setPinLookupBusy(true);
    try {
      const res = await fetch("/api/reverse-geocode", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ lat, lng }),
      });
      if (res.ok) {
        const body = await res.json();
        if (body.address) set("delivery_address", body.address);
      }
    } catch { /* best-effort — the pin itself is already saved either way */ }
    setPinLookupBusy(false);
  };

  // Dropping the pin previews it AND fills the address right away.
  const dropPin = (lat: number, lng: number) => {
    setPinDraft([lat, lng]);
    void geocodePin(lat, lng);
  };

  const savePin = async (lat: number, lng: number) => {
    set("delivery_lat", lat); set("delivery_lng", lng); set("delivery_pin_source", "manual");
    setShowPinPicker(false);
    // Fill the address if the drop didn't already (e.g. geocode was still in flight).
    if (!(d.delivery_address || "").trim()) await geocodePin(lat, lng);
  };

  // Look up the typed delivery address on the map so the rep can confirm the
  // exact spot before pricing/dispatch — geocodes it and opens the map there.
  const lookupAddress = async () => {
    const addr = (d.delivery_address || "").trim();
    if (!addr) { notify(t("Enter a delivery address first.", "Ingrese primero una dirección de entrega.")); return; }
    setPinLookupBusy(true);
    try {
      const res = await fetch("/api/geocode-point", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ address: addr }) });
      const body = await res.json();
      if (res.ok && body.lat != null) { setPinDraft([body.lat, body.lng]); setShowPinPicker(true); }
      else notify(t("Couldn't find that address on the map — check it or drop a pin.", "No se encontró esa dirección en el mapa — revísela o marque un pin."));
    } catch {
      notify(t("Network error looking up the address.", "Error de red al buscar la dirección."));
    }
    setPinLookupBusy(false);
  };

  // Auto-calculate the route as soon as both ends of the trip are known.
  // Debounced so we route once the user stops typing, and skipped if this
  // exact address pair was already resolved.
  useEffect(() => {
    if (!editing) return;
    const origin = routeOrigin;
    const destination = (d.delivery_address || "").trim();
    if (!origin || !destination) return;
    if (`${origin}→${destination}` === lastRouted.current) return;
    const timer = setTimeout(() => runRoute(origin, destination, false), 900);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editing, d.pickup_address, d.store, d.delivery_address]);

  const move = async (to: Stage, note?: string) => {
    if (!existing) return;
    // Submitting (or resubmitting) into Pending goes through the same hard
    // gate as creating an order there — this is the button a draft actually
    // leaves through, and it used to skip validation entirely (D-049).
    if (to === "pending" && blockSubmit(existing)) return;
    setBusy(true);
    // Stamp the driver's location when they collect the load (never blocks).
    let extra: Partial<Delivery> | undefined;
    let latePickupFix: Promise<GeoStamp | null> | null = null;
    if (to === "picked_up") {
      // Always stamp the pickup time (feeds the pickup/transit KPIs); add GPS
      // coords too when the driver allows location, but never require them.
      const { immediate, eventual } = captureLocationSplit();
      const gps = await immediate;
      extra = gps
        ? { pickup_lat: gps.lat, pickup_lng: gps.lng, pickup_gps_at: gps.at }
        : { pickup_gps_at: new Date().toISOString() };
      // No fix yet? Save now and attach the coordinates when they land, rather
      // than holding the driver at a spinner while the GPS chip wakes up.
      if (!gps) latePickupFix = eventual;
    }
    const ok = await setStage(existing.id, to, note, extra);
    if (ok && latePickupFix) void attachLateFix(existing.id, latePickupFix, "pickup");
    setBusy(false);
    if (ok) { notify(t(`Moved to ${stageLabel(to, lang)}`, `Movido a ${stageLabel(to, lang)}`)); onClose(); }
  };

  // Driver sets off toward the pickup — stamps departed_at (drive-to-pickup
  // leg) without changing the stage. Feeds the idle-time KPI. Keeps the dialog
  // open so they can then tap "Pick up" when they've loaded.
  const depart = async () => {
    if (!existing) return;
    const now = new Date().toISOString();
    setBusy(true);
    const ok = await updateDelivery(existing.id, { departed_at: now });
    setBusy(false);
    if (ok) { setDepartedAt(now); notify(t("En route to pickup", "En camino a recoger")); }
  };

  // Driver reaches the delivery stop — stamps arrived_at without changing the
  // stage. Splits transit into driving vs dwell/service time at the stop.
  const arrive = async () => {
    if (!existing) return;
    const now = new Date().toISOString();
    setBusy(true);
    const ok = await updateDelivery(existing.id, { arrived_at: now });
    setBusy(false);
    if (ok) { setArrivedAt(now); notify(t("Arrived at stop", "Llegó a la parada")); }
  };

  // El almacén confirma la TARIFA al agarrar la orden (D-146). Es el primer momento en que
  // alguien que no es ventas mira la orden entera, y todavía queda margen para preguntar.
  const confirmStart = async () => {
    if (!existing) return;
    const fee = Number(startFee);
    // Cero es una tarifa legítima (recogida, envío de cortesía); lo que no vale es vacío o
    // negativo.
    if (startFee.trim() === "" || !Number.isFinite(fee) || fee < 0) {
      notify(t("Confirm the delivery fee.", "Confirme la tarifa de entrega."));
      return;
    }
    const cambio = fee !== (existing.delivery_fee ?? null);
    setBusy(true);
    // La tarifa viaja en la MISMA escritura que el cambio de etapa: en dos, un fallo entre
    // medias dejaría la orden en preparación con la tarifa vieja y nadie sabría que se
    // corrigió a medias.
    const nota = cambio
      ? t(`Fee corrected to $${fee} (was $${existing.delivery_fee ?? 0})`, `Tarifa corregida a $${fee} (era $${existing.delivery_fee ?? 0})`)
      : t(`Fee confirmed $${fee}`, `Tarifa confirmada $${fee}`);
    const ok = await setStage(existing.id, "fulfilling", nota, { delivery_fee: fee });
    setBusy(false);
    if (ok) {
      setShowStartConfirm(false);
      notify(cambio ? t(`Preparing — fee corrected to $${fee}`, `Preparando — tarifa corregida a $${fee}`) : t("Preparing", "Preparando"));
    }
  };

  // Warehouse confirms the real pallet count as part of marking the order
  // ready — actual_pallets is stamped in the same write as the stage move.
  const confirmReady = async () => {
    if (!existing) return;
    const n = Number(readyPallets);
    if (!Number.isFinite(n) || n <= 0) { notify(t("Enter the confirmed pallet count.", "Ingrese la cantidad confirmada de pallets.")); return; }
    setBusy(true);
    const ok = await setStage(existing.id, "ready", t(`Pallets confirmed: ${n}`, `Pallets confirmadas: ${n}`), { actual_pallets: n });
    setBusy(false);
    if (ok) { notify(t(`Ready — ${n} pallets confirmed`, `Listo — ${n} pallets confirmadas`)); onClose(); }
  };

  // --- Role-targeted notes (add on demand, everyone sees them tagged) ---
  const makeNote = (role: NoteRole, text: string): RoleNote => ({
    id: globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`,
    role, text: text.trim(), by: me.id, by_name: me.full_name ?? null, at: new Date().toISOString(),
  });
  // View mode: an existing order — persist the note straight to the DB.
  const addRoleNote = async (role: NoteRole, text: string) => {
    if (!existing || !text.trim()) return;
    await updateDelivery(existing.id, { role_notes: [...(existing.role_notes ?? []), makeNote(role, text)] });
  };
  const removeRoleNote = async (id: string) => {
    if (!existing) return;
    await updateDelivery(existing.id, { role_notes: (existing.role_notes ?? []).filter((x) => x.id !== id) });
  };
  // Create / edit mode: the order may not exist yet, so notes live in the draft
  // and get saved together with the order.
  const addDraftNote = (role: NoteRole, text: string) => {
    if (!text.trim()) return;
    set("role_notes", [...(d.role_notes ?? []), makeNote(role, text)]);
  };
  const removeDraftNote = (id: string) => set("role_notes", (d.role_notes ?? []).filter((x) => x.id !== id));

  // Driver confirms what actually fit on the truck. A short load splits the
  // order: this one becomes #Na (loaded part, out for delivery) and the
  // remainder is re-staged as a new linked order #Nb for another trip.
  /**
   * Mark the order loaded and on its way.
   *
   * `quickTotal` is the driver's one-tap path: they take the whole load as
   * counted, with no pallet prompt and no split. The office keeps the detailed
   * flow (confirm a count, split a partial load) by calling with no argument.
   */
  const confirmPickup = async (quickTotal?: number) => {
    if (!existing) return;
    const total = existing.actual_pallets ?? existing.est_pallets ?? 0;
    const quick = quickTotal != null;
    const n = quick ? quickTotal : Number(pickupPallets);
    if (!quick) {
      if (!Number.isFinite(n) || n <= 0) { notify(t("Enter the loaded pallet count.", "Ingrese la cantidad de pallets cargadas.")); return; }
      if (total > 0 && n > total) { notify(t(`Only ${total} pallets on this order.`, `Esta orden solo tiene ${total} pallets.`)); return; }
    }
    setBusy(true);
    const { immediate, eventual } = captureLocationSplit();
    const gps = await immediate;
    const gpsExtra = gps
      ? { pickup_lat: gps.lat, pickup_lng: gps.lng, pickup_gps_at: gps.at }
      : { pickup_gps_at: new Date().toISOString() };
    if (!gps) void attachLateFix(existing.id, eventual, "pickup");
    // A driver who physically loads an order that was never assigned to anyone
    // becomes its driver. Otherwise it goes "out for delivery" belonging to
    // nobody: it vanishes from every driver's queue (they only see their own)
    // and no one is accountable for it.
    const claim = me.role === "driver" && !existing.assigned_driver
      ? { assigned_driver: me.full_name }
      : {};

    if (!quick && total > 0 && n < total) {
      const mySuffix = existing.order_suffix ?? "a";
      const nextSuffix = String.fromCharCode(mySuffix.charCodeAt(0) + 1);
      const rest = total - n;
      // Remainder: same order number with the next letter, re-staged for a
      // new trip with no driver yet.
      const { id: _id, created_at: _ca, updated_at: _ua, created_by: _cb, route_seq: _rs,
        pickup_lat: _plat, pickup_lng: _plng, pickup_gps_at: _pgps, departed_at: _dep, ...src } = existing;
      const rowB = await addDelivery({
        ...src,
        order_no: existing.order_no,
        order_suffix: nextSuffix,
        est_pallets: rest,
        actual_pallets: rest,
        stage: "ready",
        assigned_driver: null,
        delivery_notes: [existing.delivery_notes, t(`Split of #${existing.order_code || existing.order_no}${mySuffix} — ${rest} pallets left behind.`, `División de #${existing.order_code || existing.order_no}${mySuffix} — quedaron ${rest} pallets.`)].filter(Boolean).join("\n"),
      });
      if (!rowB) { setBusy(false); return; }
      const ok = await setStage(
        existing.id, "picked_up",
        t(`Partial load: ${n} of ${total} pallets — remainder split to #${existing.order_code || existing.order_no}${nextSuffix}`,
          `Carga parcial: ${n} de ${total} pallets — resto dividido a #${existing.order_code || existing.order_no}${nextSuffix}`),
        { ...gpsExtra, ...claim, order_suffix: mySuffix, actual_pallets: n },
      );
      setBusy(false);
      if (ok) {
        notify(t(`Out for delivery as #${existing.order_code || existing.order_no}${mySuffix} — #${existing.order_code || existing.order_no}${nextSuffix} staged with ${rest} pallets`,
          `En reparto como #${existing.order_code || existing.order_no}${mySuffix} — #${existing.order_code || existing.order_no}${nextSuffix} preparada con ${rest} pallets`));
        onClose();
      }
      return;
    }
    const ok = await setStage(
      existing.id,
      "picked_up",
      n > 0 ? t(`Loaded: ${n} pallets`, `Cargadas: ${n} pallets`) : t("Loaded", "Cargada"),
      // Never write a 0 pallet count over a blank one — a missing number from
      // the office shouldn't become a wrong number from the truck.
      { ...gpsExtra, ...claim, ...(n > 0 ? { actual_pallets: n } : {}) },
    );
    setBusy(false);
    if (ok) { notify(t("Out for delivery", "En reparto")); onClose(); }
  };

  // Proof of delivery: stamp the signer + signature, then move to delivered.
  /** What still stands between this order and "delivered", in the order the
   * driver would hit it. Null when nothing does. Drives both the inline
   * warning and the disabled state, so the two can never disagree. */
  // Signatures are OFF unless an admin turns them on (see Settings). Off by
  // default because most deliveries here don't need one, and an empty
  // signature box between the driver and "delivered" is pure friction.
  const signatureOn = settings.pod_signature_enabled === true;

  /**
   * Is there anything left to actually collect at the tailgate?
   *
   * With signatures off and the proof requirement already met — either the
   * office doesn't demand proof, or the photos are already on the order — the
   * popup would only ask for a name nobody made mandatory. So pressing
   * Delivered goes straight through instead of putting a form in the way.
   *
   * When proof IS still owed, the sheet opens and says so; one tap is never
   * worth letting a delivery skip the evidence the office asked for.
   */
  const podOwed = !!settings.require_pod && !existing?.photos?.length;
  const podFormNeeded = signatureOn || podOwed;

  /**
   * Who took each photo, ready for the grid.
   *
   * Resolved here rather than stored on the row: a name and a role change over
   * time, and the caption should show what someone IS, not what their title
   * was the day they pressed the shutter.
   */
  const photoCredits = useMemo(() => {
    const meta = existing?.photo_meta;
    if (!meta) return undefined;
    const out: Record<string, { name: string; role: string } | undefined> = {};
    for (const [url, info] of Object.entries(meta)) {
      const who = users.find((u) => u.id === info?.by);
      if (who) out[url] = { name: who.full_name, role: roleLabel(who.role, lang) };
    }
    return out;
  }, [existing?.photo_meta, users, lang]);

  /**
   * The order's history as one list, oldest first.
   *
   * Creation and approval live on the delivery row while everything else lives
   * in the event log, so they were rendered as two separate blocks — and the
   * event block runs newest-first. The result read backwards through its own
   * middle. Merging them and sorting by time is the only way the sequence
   * means anything.
   */
  const orderTimeline = useMemo(() => {
    if (!existing) return [];
    type Row = { key: string; label: string; by: string | null; at: string; note?: string | null };
    const rows: Row[] = [];
    if (existing.created_at) {
      rows.push({ key: "created", label: t("Created by", "Creado por"), by: existing.created_by, at: existing.created_at });
    }
    if (existing.approved_at) {
      rows.push({ key: "approved", label: t("Approved by", "Aprobado por"), by: existing.approved_by, at: existing.approved_at });
    }
    for (const e of events) {
      // Creation and approval already have a row of their own above; only drop
      // the approval event when that row is actually shown, so an approval is
      // never hidden entirely.
      if (e.kind === "created") continue;
      if (e.kind === "approved" && existing.approved_at) continue;
      rows.push({ key: e.id, label: eventLabel(e.kind, lang), by: e.created_by, at: e.created_at, note: e.note });
    }
    // Creation is pinned first no matter what the clock says. An auto-approving
    // store stamps approved_at during creation, and on FQ119 it landed two
    // seconds EARLIER — so a faithful sort put "Approved" above "Created",
    // which is the same kind of nonsense this whole change set out to fix.
    // An order cannot precede its own creation.
    const rank = (r: Row) => (r.key === "created" ? 0 : 1);
    return rows.sort((a, b) =>
      rank(a) - rank(b) || new Date(a.at).getTime() - new Date(b.at).getTime());
  }, [existing, events, lang, t]);

  const podBlocker: string | null = (() => {
    if (!existing) return null;
    if (podFormNeeded && !podName.trim()) return t("Enter who received the delivery.", "Ingrese quién recibió la entrega.");
    if (deliveredElsewhere && !deliveredAddress.trim()) {
      return t("Enter the address where you actually delivered.", "Ingrese la dirección donde entregó realmente.");
    }
    if (settings.require_pod && !podSig && !(existing.photos?.length)) {
      // With signatures switched off there's only one way to satisfy this, so
      // say that rather than offering a choice the driver doesn't have.
      return signatureOn
        ? t("A signature or a material photo is required before delivering.", "Se requiere una firma o una foto del material antes de entregar.")
        : t("A material photo is required before delivering.", "Se requiere una foto del material antes de entregar.");
    }
    return null;
  })();

  const deliverWithPod = async () => {
    if (!existing) return;
    // Same check that greys out the button and prints the warning above it —
    // kept in one place so the two can't drift apart and leave a driver
    // pressing a button that silently refuses.
    if (podBlocker) { notify(podBlocker); return; }
    setBusy(true);
    // Stamp where the driver actually is. Never blocks: resolves to null if the
    // device refuses, has no signal, or the page isn't served over HTTPS — and
    // a fix that's still coming is attached afterwards rather than waited on.
    const { immediate, eventual } = captureLocationSplit();
    const gps = await immediate;
    if (!gps) void attachLateFix(existing.id, eventual, "pod");
    const altAddr = deliveredElsewhere ? deliveredAddress.trim() : "";
    const pod = {
      pod_received_by: podName.trim() || null,
      pod_signature: podSig,
      pod_delivered_at: new Date().toISOString(),
      pod_lat: gps?.lat ?? null,
      pod_lng: gps?.lng ?? null,
      pod_accuracy: gps?.accuracy ?? null,
      delivered_address: altAddr || null,
    };
    // The audit note reports an off-address delivery loudly so the office sees it.
    const note = altAddr
      ? t(`⚠ Delivered at a DIFFERENT address: ${altAddr} (ordered: ${existing.delivery_address || "—"}). Received by ${podName.trim()}`,
          `⚠ Entregado en OTRA dirección: ${altAddr} (pedido: ${existing.delivery_address || "—"}). Recibido por ${podName.trim()}`)
      : podName.trim()
        ? t(`Received by ${podName.trim()}`, `Recibido por ${podName.trim()}`)
        : t("Delivered", "Entregado");
    // Persist POD fields + the stage move in ONE write so nothing clobbers them.
    const ok = await setStage(existing.id, "delivered", note, pod);
    setBusy(false);
    if (ok) {
      notify(t("Delivered — proof captured", "Entregado — comprobante guardado"));
      // Keep the dialog open on a success screen so the driver can print the slip.
      setShowPod(false);
      setJustDelivered({ ...existing, stage: "delivered", ...pod, updated_at: new Date().toISOString() });
    }
  };

  // Auto-assign suggestion (#6): least-loaded driver across active orders.
  const suggestAndSet = () => {
    const name = suggestDriver(driverNames(users), deliveries);
    if (name) { set("assigned_driver", name); notify(t(`Suggested: ${name}`, `Sugerido: ${name}`)); }
    else notify(t("No drivers configured.", "No hay choferes configurados."));
  };

  // Window conflict (#5): other active orders with the same driver + date + overlapping window.
  const conflicts = (existing || d.assigned_driver)
    ? windowConflicts({ id: existing?.id, assigned_driver: d.assigned_driver, delivery_date: d.delivery_date, delivery_windows: d.delivery_windows }, deliveries)
    : [];

  const remove = async () => {
    if (!existing) return;
    if (!(await confirmAction(
      t(`Delete order #${orderLabel(existing)}? This cannot be undone.`, `¿Eliminar la orden #${orderLabel(existing)}? No se puede deshacer.`),
      { danger: true, confirmLabel: t("Delete", "Eliminar") },
    ))) return;
    await deleteDelivery(existing.id);
    notify(t("Order deleted", "Orden eliminada"));
    onClose();
  };

  // Log a repeat delivery (warehouse error, damage, etc.) as a NEW order linked
  // to this one, re-entering the flow as "approved" for the warehouse to redo.
  // The link + reason make repeats measurable for the end-of-week review.
  const recordRedelivery = async () => {
    if (!existing || !redeliverReason.trim()) return;
    setBusy(true);
    const src = existing;
    const payload: Draft = {
      // sales/customer data carries over
      order_type: src.order_type, store: src.store, account: src.account,
      po2: src.po2, so_num: src.so_num, invoice_num: src.invoice_num,
      est_pallets: src.est_pallets, delivery_date: src.delivery_date,
      delivery_windows: src.delivery_windows, pickup_address: src.pickup_address,
      pickup_duration: src.pickup_duration, delivery_duration: src.delivery_duration,
      delivery_address: src.delivery_address, contact: src.contact,
      delivery_phone: src.delivery_phone, delivery_notes: src.delivery_notes,
      route_miles: src.route_miles, route_duration: src.route_duration,
      route_provider: src.route_provider, route_traffic: src.route_traffic,
      // warehouse redoes these
      actual_pallets: null, assigned_driver: src.assigned_driver,
      // The additional charge (if any) for redoing the delivery becomes the new
      // order's delivery fee — blank/empty means a free re-delivery ($0).
      delivery_fee: redeliverCharge.trim() === "" ? 0 : Number(redeliverCharge),
      // re-delivery linkage
      stage: "approved", redelivery_of: src.id, redelivery_reason: redeliverReason.trim(),
    };
    const row = await addDelivery(payload);
    setBusy(false);
    if (row) {
      const chg = Number(redeliverCharge);
      if (chg > 0) await addNote(row.id, `Re-delivery additional charge: $${chg.toFixed(2)}`);
      notify(t(`Re-delivery logged as #${orderLabel(row)}`, `Reentrega registrada como #${orderLabel(row)}`));
      setRedeliverCharge(""); setRedeliverReason("");
      onClose();
    }
  };

  // Clone this order into a fresh draft (repeat customers, standing orders).
  // Copies the customer/order data, resets all workflow + fulfillment fields.
  const duplicate = async () => {
    if (!existing) return;
    setBusy(true);
    const s = existing;
    const payload: Draft = {
      order_type: s.order_type, store: s.store, account: s.account,
      po2: s.po2, so_num: s.so_num, invoice_num: null,
      est_pallets: s.est_pallets, delivery_windows: s.delivery_windows,
      pickup_name: s.pickup_name, pickup_address: s.pickup_address, pickup_duration: s.pickup_duration,
      delivery_address: s.delivery_address, delivery_duration: s.delivery_duration,
      contact: s.contact, delivery_phone: s.delivery_phone, delivery_notes: s.delivery_notes,
      route_miles: s.route_miles, route_duration: s.route_duration,
      route_provider: s.route_provider, route_traffic: s.route_traffic,
      delivery_date: todayISO(), stage: "draft",
    };
    const row = await addDelivery(payload);
    setBusy(false);
    if (row) { notify(t(`Duplicated as #${orderLabel(row)} (draft)`, `Duplicada como #${orderLabel(row)} (borrador)`)); onClose(); }
  };

  // ---- Saved pickup / dropoff points ----
  // Pickup options = the stores (always valid pickup points) + any saved extras.
  const pickupOptions = useMemo(() => {
    const seen = new Set<string>();
    return [...settings.stores, ...(settings.pickup_locations ?? [])].filter((l) => {
      if (!l.name || seen.has(l.name)) return false;
      seen.add(l.name);
      return true;
    });
  }, [settings.stores, settings.pickup_locations]);

  const deliveryOptions = settings.delivery_locations ?? [];

  // Account options: saved accounts (with a contact + phone attached) plus
  // every distinct account name already used on a past order that hasn't
  // been saved with contact info yet — so the list is never missing one,
  // but only saved accounts auto-fill Contact / Delivery Phone Number.
  const savedAccounts = settings.accounts ?? [];
  const accountOptions = useMemo(() => {
    const seen = new Set<string>();
    for (const a of savedAccounts) if (a.name.trim()) seen.add(a.name.trim());
    for (const x of deliveries) {
      const a = (x.account || "").trim();
      if (a) seen.add(a);
    }
    return [...seen].sort((a, b) => a.localeCompare(b));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deliveries, settings.accounts]);

  // Account names (lowercased) that already have at least one Intertienda order
  // in their history — picking such an account defaults the new order to
  // Intertienda, even if it was never saved with the branch flag.
  const intertiendaAccounts = useMemo(() => {
    const s = new Set<string>();
    for (const x of deliveries) {
      if (x.order_type === "Intertienda") {
        const a = (x.account || "").trim().toLowerCase();
        if (a) s.add(a);
      }
    }
    return s;
  }, [deliveries]);

  const saveAccount = (rec: AccountRecord) => {
    const next = [...savedAccounts.filter((a) => a.name.toLowerCase() !== rec.name.toLowerCase()), rec];
    saveSettings({ accounts: next });
    notify(t(`Saved "${rec.name}" as an account`, `"${rec.name}" guardado como cuenta`));
  };

  const savePickupLocation = (loc: NamedLocation) => {
    saveSettings({ pickup_locations: [...(settings.pickup_locations ?? []), loc] });
    notify(t(`Saved "${loc.name}" as a pickup point`, `"${loc.name}" guardado como punto de recolección`));
  };

  const saveDeliveryLocation = (loc: NamedLocation) => {
    saveSettings({ delivery_locations: [...(settings.delivery_locations ?? []), loc] });
    notify(t(`Saved "${loc.name}" as a dropoff site`, `"${loc.name}" guardado como sitio de entrega`));
  };

  const info = stageInfo(stage);

  // ---- Unsaved-changes lock ----
  // The form must never vanish mid-typing. Any edit makes it "dirty", and the
  // backdrop / ✕ then ask before discarding.
  const dirty = editing && JSON.stringify(d) !== JSON.stringify(existing ?? EMPTY);
  const requestClose = async () => {
    if (dirty && !(await confirmAction(t(
      "You have unsaved changes to this order. Discard them?",
      "Tiene cambios sin guardar en esta orden. ¿Descartarlos?",
    ), { danger: true, confirmLabel: t("Discard", "Descartar") }))) return;
    onClose();
  };

  // Field editability: sales owns order data, warehouse owns fulfillment data.
  const salesFields = editing && (isNew || me.role === "sales" || me.role === "admin" || me.role === "manager");
  // True when an existing order is being pushed to a LATER delivery date (a
  // reprogram) — the cue to offer the "deliver first thing in the morning" flag.
  const rescheduledForward = !!existing?.delivery_date && !!d.delivery_date && d.delivery_date > existing.delivery_date;
  const whFields = editing && (me.role === "warehouse" || me.role === "admin");
  // Warehouse may edit only pallets + prepared status; temp & driver are admin-only.
  const adminFields = editing && me.role === "admin";
  // The Warehouse / Fulfillment section is only shown to warehouse & admin.
  const showWarehouse = me.role === "warehouse" || me.role === "admin";

  // Close the confirmation by itself. Nothing on that screen needs an action,
  // and a driver with the tailgate open shouldn't have to dismiss it.
  useEffect(() => {
    if (!justDelivered) return;
    const id = setTimeout(() => onCloseRef.current(), 1000);
    return () => clearTimeout(id);
  }, [justDelivered]);

  // ---------- DELIVERED SUCCESS SCREEN ----------
  // A one-second confirmation, not a form. The driver has already done the
  // work; this exists only to show it landed — delivered, who signed, and the
  // signature itself — then get out of the way so they can drive on.
  if (justDelivered) {
    return (
      <div className="overlay" onClick={onClose}>
        <div className="modal" style={{ maxWidth: 460, textAlign: "center" }}>
          <div style={{ fontSize: 44 }}>✅</div>
          <h3 style={{ marginTop: 8 }}>{t("Delivered", "Entregado")} #{orderLabel(justDelivered)}</h3>
          {justDelivered.pod_received_by && (
            <div className="sub" style={{ justifyContent: "center" }}>
              {t("Received by", "Recibido por")} <b>{justDelivered.pod_received_by}</b>
            </div>
          )}
          {justDelivered.pod_signature && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={justDelivered.pod_signature} alt={t("Signature", "Firma")} style={{ maxHeight: 110, background: "#fff", border: "1px solid var(--line)", borderRadius: 8, margin: "10px auto 0", display: "block" }} />
          )}
        </div>
      </div>
    );
  }

  // The workflow buttons for the order being viewed. Built once here because
  // they render in two different places: the modal footer for office roles, and
  // inside the driver's delivery card (under the notes) for drivers.
  const stageActions = existing ? (
    <StageActions me={me} stage={stage} busy={busy}
      onEdit={() => setEditing(true)}
      onMove={move}
      showReject={showReject}
      setShowReject={setShowReject}
      rejectReason={rejectReason}
      showCancel={showCancel}
      setShowCancel={setShowCancel}
      cancelReason={cancelReason}
      onPrint={() => printDeliverySlip(existing, settings, users, lang)}
      onRequestDeliver={() => { if (podFormNeeded) setShowPod(true); else void deliverWithPod(); }}
      podOpen={showPod}
      onRequestStart={() => { setStartFee(existing.delivery_fee != null ? String(existing.delivery_fee) : ""); setShowStartConfirm(true); }}
      readyConfirmOpen={showReadyConfirm}
      onRequestReady={() => { setReadyPallets(String(existing.actual_pallets ?? existing.est_pallets ?? "")); setShowReadyConfirm(true); }}
      onConfirmReady={confirmReady}
      onCancelReady={() => setShowReadyConfirm(false)}
      pickupConfirmOpen={showPickupConfirm}
      onRequestPickup={() => { setPickupPallets(String(existing.actual_pallets ?? existing.est_pallets ?? "")); setShowPickupConfirm(true); }}
      onConfirmPickup={() => confirmPickup()}
      onQuickPickup={() => confirmPickup(existing.actual_pallets ?? existing.est_pallets ?? 0)}
      onCancelPickup={() => setShowPickupConfirm(false)}
      departedAt={departedAt}
      onDepart={depart}
      arrivedAt={arrivedAt}
      onArrive={arrive}
    />
  ) : null;

  return (
    <>
    {/* Viewing an existing order: clicking the backdrop closes it. While EDITING
        (or creating), a backdrop click does nothing — the only way out is the ✕
        or a button, so a stray click can't discard in-progress edits. */}
    <div className="overlay"
      onMouseDown={(e) => { overlayDownRef.current = e.target === e.currentTarget; }}
      onClick={(e) => { if (e.target === e.currentTarget && overlayDownRef.current && !isNew && !editing) requestClose(); }}>
      <div className="modal">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12 }}>
          <div>
            <h3>
              {isNew ? t("New delivery order", "Nueva orden de entrega") : `${t("Order", "Orden")} #${orderLabel(existing!)}`}
              {dirty && <span className="sema" style={{ background: "var(--amber)", color: "#fff", marginLeft: 8 }}>● {t("Unsaved", "Sin guardar")}</span>}
            </h3>
            <div className="sub" style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
              {isNew ? t("Fill in the order details, then save as draft or submit for approval.", "Complete los datos de la orden, luego guárdela como borrador o envíela a aprobación.") : (
                <>
                  <span className="sema" style={{ background: info.color, color: "#fff" }}>{stageLabel(stage, lang)}</span>
                  {/* The two things a driver reads off the paperwork, right at
                      the top instead of buried in the detail rows below. Both
                      wrap fully — an order can carry several invoices, and a
                      half-shown number is worse than none. */}
                  {existing?.order_type && <span className="hdr-chip">{existing.order_type}</span>}
                  {existing?.invoice_num && (
                    <span className="hdr-chip hdr-chip-num">
                      INV {existing.invoice_num}
                    </span>
                  )}
                </>
              )}
            </div>
          </div>
          <button className="btn btn-sm" onClick={requestClose}>✕</button>
        </div>

        {/* ---------- VIEW MODE ---------- */}
        {!editing && existing && (
          <>
            {me.role === "driver" ? (
              <DriverDeliveryScreen order={existing} settings={settings} notify={notify} t={t} actions={stageActions} />
            ) : showAllDetails ? (
              // Full detail table (opened from the preview).
              <>
                <button className="btn btn-ghost btn-sm" style={{ marginBottom: 10 }} onClick={() => setShowAllDetails(false)}>
                  ◂ {t("Back to preview", "Volver al resumen")}
                </button>
                <div className="detail-grid">
                  {deliveryColumns(existing).slice(1)
                    // Route/redelivery details only show when they actually have a
                    // value. Assigned Driver hides-when-empty for a salesperson but
                    // always shows for logistics (they own dispatch).
                    .filter(([k, v]) => {
                      if (!v && ["Route Miles", "Est. Travel Time", "Re-delivery reason"].includes(k)) return false;
                      if (k === "Assigned Driver" && !v && me.role === "sales") return false;
                      return true;
                    })
                    .map(([k, v]) => (
                      <div className="detail-row" key={k}>
                        <span className="dk">{colLabel(k, lang)}</span>
                        <span className="dv">{v || "—"}</span>
                      </div>
                    ))}
                </div>
              </>
            ) : (
              // Compact preview — the essentials at a glance (two pairs per row).
              // The toggle sits at the top-left, above the preview.
              <>
                <button className="btn btn-ghost btn-sm" style={{ marginBottom: 8 }} onClick={() => setShowAllDetails(true)}>
                  {t("Show all details ▾", "Ver todos los detalles ▾")}
                </button>
                <div className="card" style={{ padding: 14 }}>
                  <div className="detail-grid">
                    {([
                      [t("Account", "Cuenta"), existing.account || "—"],
                      [t("Delivery Fee", "Costo de Entrega"), existing.delivery_fee == null ? "—" : fmtMoney(existing.delivery_fee)],
                      [t("Delivery Date", "Fecha de Entrega"), existing.delivery_date || "—"],
                      [t("Delivery Windows", "Ventana de Entrega"), fmtWindows(existing.delivery_windows)],
                      [t("Invoice / Estimate #", "Factura / Estimación #"), existing.invoice_num || existing.estimate_num || "—"],
                      [t("Actual Pallets", "Pallets Reales"), existing.actual_pallets == null ? "—" : String(existing.actual_pallets)],
                      [t("Pickup Address", "Dir. Recolección"), existing.pickup_address || "—"],
                      [t("Delivery Address", "Dir. Entrega"), existing.delivery_address || "—"],
                      [t("Route Miles", "Millas"), existing.route_miles == null ? "—" : `${existing.route_miles} mi`],
                      [t("Travel Time", "Tiempo de Viaje"), existing.route_duration || "—"],
                    ] as [string, string][]).map(([k, v]) => (
                      <div className="detail-row" key={k}>
                        <span className="dk">{k}</span>
                        <span className="dv">{v}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </>
            )}

            {/* Role-targeted notes — added on demand, everyone sees them tagged. */}
            <RoleNotes notes={existing.role_notes ?? []} me={me} onAdd={addRoleNote} onRemove={removeRoleNote} t={t} lang={lang} />

            {existing.rejected_reason && (
              <div className="card" style={{ marginTop: 14, background: "#fef6f6", borderColor: "var(--red)" }}>
                <b style={{ color: "var(--red)" }}>{t("Rejection reason:", "Motivo del rechazo:")}</b> {existing.rejected_reason}
              </div>
            )}
            {existing.redelivery_of && (
              <div className="card" style={{ marginTop: 14, background: "#fff7ec", borderColor: "var(--amber)" }}>
                <b style={{ color: "var(--amber)" }}>{t("🔁 Re-delivery", "🔁 Reentrega")}</b>
                {existing.redelivery_reason ? ` — ${existing.redelivery_reason}` : ""}
                <div className="hint" style={{ marginTop: 4 }}>{t("This order repeats an earlier delivery. Logged for the end-of-week review.", "Esta orden repite una entrega anterior. Registrada para la revisión de fin de semana.")}</div>
              </div>
            )}
            {settings.rc_calls_enabled && me.role !== "driver" && telClean(existing.delivery_phone).replace(/\D/g, "").length >= 7 && (
              <div style={{ marginTop: 14 }}>
                <div className="section-label" style={{ marginTop: 0 }}>{t("Call the customer", "Llamar al cliente")}</div>
                <CallClientButton phone={telClean(existing.delivery_phone)} notify={notify} t={t} />
                <div className="hint" style={{ marginTop: 6 }}>{t("Your RingCentral line rings first, then connects to", "Su línea RingCentral suena primero y luego conecta con")} {existing.contact || existing.account || t("the customer", "el cliente")} ({existing.delivery_phone}).</div>
              </div>
            )}
            {/* Sending live tracking is limited to office (manager), logistics,
                admin and drivers. Sales & warehouse only get "Copy link" below;
                accounting gets neither — it bills for the delivery, it doesn't
                tell the customer where the truck is. */}
            {me.role !== "sales" && me.role !== "warehouse" && me.role !== "accounting" && (
              <ShareTracking order={existing} enabled={!!settings.rc_auto_sms_enabled} notify={notify} t={t} />
            )}
            {me.role !== "accounting" && (
            <div style={{ marginTop: 10 }}>
              <button className="btn btn-ghost btn-sm" onClick={() => {
                const url = `${location.origin}/track/${existing.id}`;
                navigator.clipboard?.writeText(url).then(
                  () => notify(t("Tracking link copied", "Enlace de seguimiento copiado")),
                  () => window.prompt(t("Copy this tracking link:", "Copie este enlace de seguimiento:"), url),
                );
              }}>🔗 {t("Copy tracking link", "Copiar enlace")}</button>
            </div>
            )}
            {canDeliver(me) && me.role !== "driver" && existing.delivery_address && (
              <NavButtons
                origin={(existing.pickup_address || settings.stores.find((s) => s.name === existing.store)?.address || existing.store || "").trim()}
                destination={existing.delivery_address}
                t={t}
              />
            )}
            {/* ---------- Material photos (driver captures; sales reps don't see these) ---------- */}
            {me.role !== "sales" && (canDeliver(me) || (existing.photos?.length ?? 0) > 0) && (
              <>
                <div className="section-label">
                  📷 {t("Material photos", "Fotos del material")}
                  {(existing.photos?.length ?? 0) > 0 && <span className="count-tag" style={{ marginLeft: 8 }}>{existing.photos!.length}</span>}
                </div>
                <PhotoUpload
                  photos={existing.photos ?? []}
                  credits={photoCredits}
                  disabled={!canDeliver(me) || photoBusy}
                  onChange={async (next) => {
                    setPhotoBusy(true);
                    await updateDelivery(existing.id, { photos: next });
                    setPhotoBusy(false);
                    notify(t("Photos updated", "Fotos actualizadas"));
                  }}
                  t={t}
                />
                <div className="hint">{t("Photo of the load / material. On a phone this opens the camera.", "Foto de la carga / material. En el teléfono abre la cámara.")}</div>
              </>
            )}

            {/* Customer satisfaction was removed from the order view. In
                fifty-three orders it was never once filled in — a control
                nobody uses still costs a reading of the screen every time
                someone opens a delivered order. The csat_rating /
                csat_comment columns are left in place, so nothing is lost if
                it ever comes back. */}

            {/* Private notes (the old Activity & notes): only visible to the
                order's creator, an admin, or the office manager. */}
            {(me.role === "admin" || me.role === "manager" || existing.created_by === me.id) && (
              <>
            <div className="section-label">{t("Private notes", "Notas privadas")}</div>
            <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
              <input
                value={noteText}
                onChange={(e) => setNoteText(e.target.value)}
                placeholder={t("Add a note for the team…", "Agregar una nota para el equipo…")}
                onKeyDown={async (e) => {
                  if (e.key === "Enter" && noteText.trim() && !notingBusy) {
                    setNotingBusy(true); await addNote(existing.id, noteText); setNoteText(""); setNotingBusy(false);
                  }
                }}
              />
              <button className="btn btn-ghost" disabled={!noteText.trim() || notingBusy}
                onClick={async () => { setNotingBusy(true); await addNote(existing.id, noteText); setNoteText(""); setNotingBusy(false); }}>
                {t("Post", "Enviar")}
              </button>
            </div>
            {/* Assignment has no timestamp, so it isn't a step in the story —
                it stays a plain fact above it. */}
            {existing.assigned_sales_rep && (
              <div className="detail-row"><span className="dk">{t("Assigned to", "Asignado a")}</span><span className="dv">{userName(existing.assigned_sales_rep)}{roleTag(existing.assigned_sales_rep)}</span></div>
            )}
            {/* ONE timeline, oldest first — the order the work actually
                happened in.
                It used to read in two directions at once: "Created" and
                "Approved" were pinned on top ascending, then the events ran
                newest-first underneath, so a delivery at 1:32pm appeared ABOVE
                the pickup at 10:21am that made it possible. */}
            {orderTimeline.map((row) => (
              <div className="log-row" key={row.key}>
                <span style={{ fontWeight: 700, minWidth: 90 }}>{row.label}</span>
                <span style={{ color: "var(--gray)" }}>{userName(row.by)}{roleTag(row.by)}</span>
                <span style={{ color: "var(--gray)" }}>{fmtDateTime(row.at)}</span>
                {row.note && <span>— {row.note}</span>}
              </div>
            ))}
              </>
            )}
          </>
        )}

        {/* ---------- INITIAL NEW-ORDER STEP ---------- */}
        {/* A short first screen for a NEW order: pick the type and delivery
            address to price the fee, then Next to the whole form. Store-to-store
            types (Intertienda / Transfer) skip it — no customer fee to calc. */}
        {editing && isNew && !showFullForm && (
          <>
            <div className="section-label" style={{ marginTop: 0 }}>{t("New order", "Nueva orden")}</div>
            <div className="grid g2">
              <Sel
                label={t("Order Type", "Tipo de Orden")}
                val={d.order_type}
                opts={settings.order_types}
                on={(v) => { setD((p) => withTypeDefaults(p, v)); if (v && isStoreToStore(v, settings.order_type_rules)) setShowFullForm(true); }}
                disabled={!salesFields}
                placeholder={t("Select order type", "Seleccione tipo de orden")}
                invalid={missingSet.has("order_type")}
              />
              <Sel
                label={t("Store (Sold From)", "Tienda (Vendido Desde)")}
                val={d.store}
                opts={settings.stores.map((s) => s.name)}
                on={(v) => {
                  const st = settings.stores.find((s) => s.name === v);
                  setD((p) => ({ ...p, store: v, pickup_name: v || p.pickup_name, pickup_address: st?.address ? st.address : p.pickup_address }));
                }}
                disabled={!salesFields || (me.role === "sales" && !!me.store && !homeIsDestination)}
                placeholder={t("Select store", "Seleccione tienda")}
                invalid={missingSet.has("store")}
              />
            </div>
            <AddressInput
              label={t("Delivery Address", "Dirección de Entrega")}
              value={d.delivery_address}
              onChange={(v) => set("delivery_address", v)}
              disabled={!salesFields}
              placeholder={t("Search the address…", "Buscar la dirección…")}
            />

            {/* Confirm the address on the map (look it up) or drop an exact pin. */}
            <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", marginTop: 4, marginBottom: showPinPicker ? 8 : 0 }}>
              <button className="btn btn-ghost btn-sm" disabled={!salesFields || pinLookupBusy} onClick={lookupAddress}>
                🔎 {t("Look up address on map", "Buscar dirección en el mapa")}
              </button>
              <button className="btn btn-ghost btn-sm" disabled={!salesFields} onClick={() => {
                setPinDraft(d.delivery_lat != null && d.delivery_lng != null ? [d.delivery_lat, d.delivery_lng] : null);
                setShowPinPicker((s) => !s);
              }}>
                📍 {t("Set exact location on map", "Marcar ubicación exacta en el mapa")}
              </button>
              {pinLookupBusy ? (
                <span className="hint">{t("Looking up the address…", "Buscando la dirección…")}</span>
              ) : d.delivery_lat != null && d.delivery_lng != null && (
                <span className="hint">
                  {d.delivery_pin_source === "manual"
                    ? t("Exact pin set — the driver will navigate straight to it.", "Pin exacto marcado — el chofer navegará directo a él.")
                    : t("Location found from the address above.", "Ubicación encontrada a partir de la dirección de arriba.")}
                </span>
              )}
            </div>
            {showPinPicker && (
              <div className="card" style={{ marginBottom: 12 }}>
                <div className="hint" style={{ marginBottom: 8 }}>
                  {t("Move the mouse to preview the spot, then right-click to drop the pin.", "Mueva el mouse para previsualizar el punto y haga clic derecho para marcarlo.")}
                </div>
                <MapView
                  pickable
                  pickedPoint={pinDraft}
                  center={pinDraft ?? (d.delivery_lat != null && d.delivery_lng != null ? [d.delivery_lat, d.delivery_lng] : undefined)}
                  onPick={(lat, lng) => dropPin(lat, lng)}
                  height={280}
                />
                <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
                  <button className="btn btn-primary btn-sm" disabled={!pinDraft} onClick={() => { if (pinDraft) savePin(pinDraft[0], pinDraft[1]); }}>{t("Save pin", "Guardar pin")}</button>
                  {(d.delivery_lat != null || pinDraft) && (
                    <button className="btn btn-ghost btn-sm" onClick={() => {
                      set("delivery_lat", null); set("delivery_lng", null); set("delivery_pin_source", null);
                      setPinDraft(null); setShowPinPicker(false);
                    }}>{t("Clear pin", "Quitar pin")}</button>
                  )}
                  <button className="btn btn-ghost btn-sm" onClick={() => setShowPinPicker(false)}>{t("Cancel", "Cancelar")}</button>
                </div>
              </div>
            )}

            <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap", marginTop: 4 }}>
              <button className="btn btn-ghost" onClick={calcRoute} disabled={routing}>
                {routing ? t("Calculating…", "Calculando…") : t("🚚 Calculate distance & fee", "🚚 Calcular distancia y tarifa")}
              </button>
              <span className="hint" style={{ margin: 0 }}>{t("Route Miles", "Millas")}: <b>{d.route_miles != null ? `${d.route_miles} mi` : "—"}</b></span>
              <span className="hint" style={{ margin: 0 }}>{t("Delivery Fee", "Costo de Entrega")}: <b>{d.delivery_fee == null ? "—" : fmtMoney(d.delivery_fee)}</b></span>
            </div>
            {routeErr && <div className="hint" style={{ color: "var(--red)" }}>{routeErr}</div>}
            {(feeSuggestion.list != null || feeSuggestion.discount != null) && (
              <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginTop: 8 }}>
                <span className="hint" style={{ margin: 0 }}>{t("Suggested fee:", "Tarifa sugerida:")}</span>
                {feeSuggestion.list != null && (
                  <button type="button" className={"btn btn-sm " + (d.delivery_fee === feeSuggestion.list ? "btn-primary" : "btn-ghost")} onClick={() => set("delivery_fee", d.delivery_fee === feeSuggestion.list ? null : feeSuggestion.list)}>{d.delivery_fee === feeSuggestion.list ? "✓ " : ""}{t("List", "Lista")} {fmtMoney(feeSuggestion.list)}</button>
                )}
                {feeSuggestion.discount != null && (
                  <button type="button" className={"btn btn-sm " + (d.delivery_fee === feeSuggestion.discount ? "btn-primary" : "btn-ghost")} onClick={() => set("delivery_fee", d.delivery_fee === feeSuggestion.discount ? null : feeSuggestion.discount)}>{d.delivery_fee === feeSuggestion.discount ? "✓ " : ""}{t("Discount", "Descuento")} {fmtMoney(feeSuggestion.discount)}</button>
                )}
              </div>
            )}
            {feeSuggestion.needsApproval && (d.delivery_address || "").trim() && (
              <div className="hint" style={{ color: "var(--amber)", fontWeight: 600, marginTop: 6 }}>
                ⚠ {t("Not local — requires manager approval.", "No local — requiere aprobación del gerente.")}
              </div>
            )}
            {feeSuggestion.sameDay && (
              <div className="hint" style={{ color: "var(--amber)", fontWeight: 600, marginTop: 6 }}>
                ⚡ {t(`Same-day delivery — includes ${fmtMoney(feeSuggestion.sameDaySurcharge)} surcharge.`, `Entrega mismo día — incluye recargo de ${fmtMoney(feeSuggestion.sameDaySurcharge)}.`)}
              </div>
            )}

            <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 18 }}>
              <button className="btn btn-primary" onClick={() => setShowFullForm(true)} disabled={!salesFields}>{t("Next →", "Siguiente →")}</button>
            </div>
          </>
        )}

        {/* ---------- EDIT MODE (full form) ---------- */}
        {editing && (!isNew || showFullForm) && (
          <>
            <div className="section-label">{t("Order", "Orden")}</div>
            {/* Sales Rep with the "same invoice as a past order" toggle beside it
                (top-right). Ticking the box reveals a searchable picker of past
                invoices; picking one fills the invoice # and marks it shared. */}
            {(needsSalesRep || salesFields) && (
              <div className="grid g2">
                {needsSalesRep ? (
                  <div className="field">
                    <label>{t("Sales Rep", "Vendedor")}{missingSet.has("assigned_sales_rep") && <span className="req-star"> *</span>}</label>
                    <select
                      className={missingSet.has("assigned_sales_rep") ? "invalid" : ""}
                      value={d.assigned_sales_rep ?? ""}
                      onChange={(e) => set("assigned_sales_rep", e.target.value || null)}
                    >
                      <option value="">{t("Select sales rep…", "Seleccione vendedor…")}</option>
                      {salesReps.map((u) => <option key={u.id} value={u.id}>{u.full_name}</option>)}
                    </select>
                  </div>
                ) : <div />}
                {salesFields && (
                  <div className="field" style={{ alignSelf: "flex-end" }}>
                    <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer", textTransform: "none", letterSpacing: 0 }}>
                      <input
                        type="checkbox"
                        style={{ width: "auto", margin: 0 }}
                        checked={sharedInvoice}
                        onChange={(e) => setSharedInvoice(e.target.checked)}
                      />
                      🔗 {t("Same invoice as a past order", "Misma factura que una orden anterior")}
                    </label>
                    {sharedInvoice && pastInvoiceOptions.length > 0 && (
                      <PastInvoicePicker
                        options={pastInvoiceOptions}
                        current={d.invoice_num ?? ""}
                        onPick={(inv) => setD((p) => ({ ...p, invoice_num: inv }))}
                        t={t}
                      />
                    )}
                    {invoiceDup && (
                      <div className="hint" style={{ color: sharedInvoice ? "var(--green)" : "var(--red)", fontWeight: 600, marginTop: 4 }}>
                        {sharedInvoice
                          ? t(`Sharing invoice #${invoiceDup.invoice_num} with order #${orderLabel(invoiceDup)}.`, `Compartiendo la factura #${invoiceDup.invoice_num} con la orden #${orderLabel(invoiceDup)}.`)
                          : t(`Duplicate — order #${orderLabel(invoiceDup)} already uses #${invoiceDup.invoice_num}.`, `Duplicada — la orden #${orderLabel(invoiceDup)} ya usa #${invoiceDup.invoice_num}.`)}
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
            {/* ---- Schedule ---- */}
            <div className="grid g2">
              <Txt label={t("Delivery Date", "Fecha de Entrega")} type="date" val={d.delivery_date} on={(v) => set("delivery_date", v)} disabled={!salesFields} invalid={missingSet.has("delivery_date")} />
              <WindowSel val={d.delivery_windows} on={(v) => set("delivery_windows", v)} disabled={!salesFields} invalid={missingSet.has("delivery_windows")} t={t} />
            </div>
            {/* Reprogramming a missed order: offer to send it out first thing the
                next morning. Shows when an existing order is pushed to a LATER
                date, or whenever the flag is already on. */}
            {(rescheduledForward || d.morning_priority) && (
              <label className="check" style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 8, cursor: salesFields ? "pointer" : "default" }}>
                <input
                  type="checkbox"
                  checked={!!d.morning_priority}
                  disabled={!salesFields}
                  onChange={(e) => set("morning_priority", e.target.checked)}
                  style={{ width: "auto" }}
                />
                <span>⏰ {t("Priority — deliver first thing in the morning", "Prioridad — entregar a primera hora de la mañana")}</span>
              </label>
            )}
            {scheduleWarnings.length > 0 && (
              <div className="card" style={{ marginTop: 10, background: "#fff7ec", borderColor: "var(--amber)" }}>
                <b style={{ color: "#b9791a" }}>⚠ {t("Scheduling conflict", "Conflicto de programación")}</b>
                <ul style={{ margin: "6px 0 0 18px", fontSize: 12.5, lineHeight: 1.5 }}>
                  {scheduleWarnings.map((w) => <li key={w.code}>{t(w.en, w.es)}</li>)}
                </ul>
                <div className="hint" style={{ marginTop: 4 }}>{t("You can still submit — you'll be asked to confirm.", "Aún puede enviarla — se le pedirá confirmar.")}</div>
              </div>
            )}

            {/* ---- Customer / contact ---- */}
            <div className="grid g3">
              <AccountCombo
                val={d.account}
                on={(v) => {
                  // Picking an account pre-fills who to contact there, the phone,
                  // the usual delivery address and the order type (all still
                  // editable). A SAVED account uses its stored record; any other
                  // account falls back to its most recent past order, so a
                  // customer that's only in the order history still pre-fills.
                  const rec = savedAccounts.find((a) => a.name.toLowerCase() === v.toLowerCase());
                  const past = rec ? undefined : [...deliveries]
                    .filter((x) => (x.account || "").trim().toLowerCase() === v.trim().toLowerCase())
                    .sort((a, b) => b.order_no - a.order_no)[0];
                  const isIntertienda = rec?.intertienda || intertiendaAccounts.has(v.trim().toLowerCase());
                  const fillAddr = rec?.address ?? past?.delivery_address ?? "";
                  setD((p) => {
                    const withAcct: Draft = {
                      ...p,
                      account: v,
                      contact: rec ? rec.contact : (past?.contact ?? p.contact),
                      delivery_phone: rec ? rec.phone : (past?.delivery_phone ?? p.delivery_phone),
                      // Do NOT auto-fill the delivery address — the rep picks the
                      // right site from this customer's saved sites (populated
                      // below), since a customer can have several drop-offs.
                    };
                    // Order type: saved flag → Intertienda/Customer; otherwise the
                    // last order's own type; otherwise the branch/customer default.
                    const wantType = !v.trim() ? null
                      : rec ? (isIntertienda ? "Intertienda" : "Customer")
                      : (past?.order_type && settings.order_types.includes(past.order_type)
                          ? past.order_type
                          : (isIntertienda ? "Intertienda" : "Customer"));
                    return wantType && settings.order_types.includes(wantType)
                      ? withTypeDefaults(withAcct, wantType)
                      : withAcct;
                  });
                  // Save this customer's known delivery addresses as sites so the
                  // rep can pick one (a nameless site uses the address as its name).
                  if (v.trim() && !isIntertienda) {
                    const addrs = new Set<string>();
                    if (fillAddr) addrs.add(fillAddr);
                    for (const x of deliveries) {
                      if ((x.account || "").trim().toLowerCase() === v.trim().toLowerCase() && (x.delivery_address || "").trim()) {
                        addrs.add(x.delivery_address!.trim());
                      }
                    }
                    const sites = settings.delivery_locations ?? [];
                    const have = new Set(sites.map((s) => (s.address || "").trim()));
                    const toAdd = [...addrs].filter((a) => a && !have.has(a)).map((a) => ({ name: a, address: a }));
                    if (toAdd.length) saveSettings({ delivery_locations: [...sites, ...toAdd] });
                  }
                }}
                options={accountOptions}
                disabled={!salesFields}
                placeholder={t("Select account…", "Seleccione cuenta…")}
                t={t}
              />
              <Txt label={t("Contact name", "Nombre de Contacto")} val={d.contact} on={(v) => set("contact", v)} disabled={!salesFields} invalid={missingSet.has("contact")} />
              <Txt label={t("Number", "Número")} val={d.delivery_phone} on={(v) => set("delivery_phone", v)} disabled={!salesFields} invalid={missingSet.has("delivery_phone")} />
            </div>
            {salesFields && !!d.account?.trim() && !!d.contact?.trim() && !!d.delivery_phone?.trim() &&
              !savedAccounts.some((a) => a.name.toLowerCase() === d.account!.trim().toLowerCase() && a.contact === d.contact && a.phone === d.delivery_phone
                && (a.address ?? "") === (storeToStore ? (a.address ?? "") : (d.delivery_address ?? ""))) && (
                <button
                  className="btn btn-ghost btn-sm"
                  style={{ marginTop: -6, marginBottom: 10 }}
                  onClick={() => saveAccount({
                    name: d.account!.trim(),
                    contact: d.contact!.trim(),
                    phone: d.delivery_phone!.trim(),
                    // Remember the delivery site for customer accounts (not for
                    // store-to-store, where the "address" is a store).
                    address: storeToStore ? undefined : (d.delivery_address?.trim() || undefined),
                    intertienda: d.order_type === "Intertienda",
                  })}
                >
                  💾 {t("Save this contact + address for the account", "Guardar contacto + dirección de la cuenta")}
                </button>
            )}

            {/* ---- Order type · fee · pallets ---- */}
            <div className="grid g3">
              <Sel label={t("Order Type", "Tipo de Orden")} val={d.order_type} opts={settings.order_types} on={(v) => setD((p) => withTypeDefaults(p, v))} disabled={!salesFields} placeholder={t("Select order type", "Seleccione tipo de orden")} invalid={missingSet.has("order_type")} />
              <Txt label={t("Delivery Fee charged ($)", "Costo de Entrega cobrado ($)")} type="number" val={d.delivery_fee ?? ""} on={(v) => set("delivery_fee", v === "" ? null : Number(v))} disabled={!salesFields} placeholder="0.00" invalid={missingSet.has("delivery_fee")} />
              <Txt label={t("Est. Pallets (sales)", "Pallets Est. (ventas)")} type="number" val={d.est_pallets ?? ""} on={(v) => set("est_pallets", v === "" ? null : Number(v))} disabled={!salesFields} invalid={missingSet.has("est_pallets")} />
            </div>

            {/* ---- Local-zone fee suggestion ---- */}
            {salesFields && (d.delivery_address || "").trim() && (
              <div className="card" style={{ marginTop: -4, marginBottom: 10, padding: 10 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                  <span className="sema" style={{ background: feeSuggestion.zone === "local" ? "var(--green)" : "var(--red)", color: "#fff" }}>
                    {feeSuggestion.zone === "local" ? t("LOCAL", "LOCAL") : t("NOT LOCAL", "NO LOCAL")}
                  </span>
                  {feeSuggestion.city && <span className="hint" style={{ margin: 0 }}>{feeSuggestion.city}</span>}
                  {d.route_miles != null && <span className="hint" style={{ margin: 0 }}>· {d.route_miles} mi</span>}
                </div>
                {(feeSuggestion.list != null || feeSuggestion.discount != null) ? (
                  <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginTop: 8 }}>
                    <span className="hint" style={{ margin: 0 }}>{t("Suggested fee:", "Tarifa sugerida:")}</span>
                    {feeSuggestion.list != null && (
                      <button type="button" className={"btn btn-sm " + (d.delivery_fee === feeSuggestion.list ? "btn-primary" : "btn-ghost")} onClick={() => set("delivery_fee", d.delivery_fee === feeSuggestion.list ? null : feeSuggestion.list)}>
                        {d.delivery_fee === feeSuggestion.list ? "✓ " : ""}{t("List", "Lista")} {fmtMoney(feeSuggestion.list)}
                      </button>
                    )}
                    {feeSuggestion.discount != null && (
                      <button type="button" className={"btn btn-sm " + (d.delivery_fee === feeSuggestion.discount ? "btn-primary" : "btn-ghost")} onClick={() => set("delivery_fee", d.delivery_fee === feeSuggestion.discount ? null : feeSuggestion.discount)}>
                        {d.delivery_fee === feeSuggestion.discount ? "✓ " : ""}{t("Discount", "Descuento")} {fmtMoney(feeSuggestion.discount)}
                      </button>
                    )}
                  </div>
                ) : (
                  <div className="hint" style={{ marginTop: 6 }}>{t("Calculate the route below to price this delivery by miles.", "Calcule la ruta abajo para cotizar esta entrega por millas.")}</div>
                )}
                {feeSuggestion.needsApproval && (
                  <div className="hint" style={{ color: "var(--amber)", fontWeight: 600, marginTop: 6 }}>
                    ⚠ {t("Not local — requires manager approval.", "No local — requiere aprobación del gerente.")}
                  </div>
                )}
                {feeSuggestion.sameDay && (
                  <div className="hint" style={{ color: "var(--amber)", fontWeight: 600, marginTop: 6 }}>
                    ⚡ {t(`Same-day delivery — includes ${fmtMoney(feeSuggestion.sameDaySurcharge)} surcharge.`, `Entrega mismo día — incluye recargo de ${fmtMoney(feeSuggestion.sameDaySurcharge)}.`)}
                  </div>
                )}
                {feeSuggestion.discount != null && d.delivery_fee != null && d.delivery_fee < feeSuggestion.discount && (
                  <div className="hint" style={{ color: "var(--amber)", fontWeight: 600, marginTop: 6 }}>
                    ⚠ {t("Price match (below discount) — requires approval.", "Igualar precio (menor al descuento) — requiere aprobación.")}
                  </div>
                )}
              </div>
            )}

            {/* ---- Document references ---- */}
            {docRef === "estimate" ? (
              // Transfer: a single internal estimate number, no customer paperwork.
              <div className="grid g2">
                <Txt label={t("Estimate #", "Estimación #")} val={d.estimate_num} on={(v) => set("estimate_num", v)} disabled={!salesFields} invalid={missingSet.has("estimate_num")} />
              </div>
            ) : (
              <>
                <div className="grid g3">
                  <Txt label={t("Invoice #", "Factura #")} val={d.invoice_num} on={(v) => { set("invoice_num", v); setSharedInvoice(false); }} disabled={!salesFields} invalid={missingSet.has("invoice_num") || (!!invoiceDup && !sharedInvoice)} />
                  <Txt label="PO #" val={d.po2} on={(v) => set("po2", v)} disabled={!salesFields} invalid={missingSet.has("po2")} />
                  <Txt label="SO #" val={d.so_num} on={(v) => set("so_num", v)} disabled={!salesFields} invalid={missingSet.has("so_num")} />
                </div>
              </>
            )}

            {/* ---- Store (Sold From) + its address ---- */}
            <div className="grid g2">
              <Sel label={t("Store (Sold From)", "Tienda (Vendido Desde)")} val={d.store} opts={settings.stores.map((s) => s.name)} on={(v) => {
                // Choosing a saved store auto-fills the pickup name + address from it.
                const st = settings.stores.find((s) => s.name === v);
                setD((p) => ({
                  ...p,
                  store: v,
                  pickup_name: v || p.pickup_name,
                  pickup_address: st?.address ? st.address : p.pickup_address,
                }));
              }} disabled={!salesFields || (me.role === "sales" && !!me.store && !homeIsDestination)} placeholder={t("Select store", "Seleccione tienda")} invalid={missingSet.has("store")} />
              <div className="field">
                <label>{t("Store address", "Dirección de tienda")}</label>
                <input value={settings.stores.find((s) => s.name === d.store)?.address ?? ""} disabled placeholder={t("from the selected store", "de la tienda seleccionada")} />
              </div>
            </div>

            {/* ---- Pickup ---- */}
            <div className="grid g2">
              <LocationCombo
                nameLabel={t("Pickup Name", "Nombre de Recolección")}
                addressLabel={t("Pickup Address", "Dirección de Recolección")}
                name={d.pickup_name}
                address={d.pickup_address}
                options={pickupOptions}
                onName={(v) => set("pickup_name", v)}
                onAddress={(v) => set("pickup_address", v)}
                onSave={savePickupLocation}
                disabled={!salesFields}
                nameInvalid={missingSet.has("pickup_name")}
                addressInvalid={missingSet.has("pickup_address")}
                namePlaceholder={t("Select a pickup point…", "Seleccione un punto de recolección…")}
                addressPlaceholder={t("Search an address…", "Busca una dirección…")}
                t={t}
              />
            </div>

            {/* ---- Delivery ---- */}
            {isIntraStore ? (
              // Intra-store transfer: the destination is another known store, picked
              // from the dropdown — but the dropoff address is always shown too.
              <div className="grid g2">
                <Sel
                  label={t("Store destination", "Tienda destino")}
                  val={deliveryStore}
                  opts={settings.stores.map((s) => s.name)}
                  on={(v) => {
                    const st = settings.stores.find((s) => s.name === v);
                    // The destination store IS the dropoff name for a transfer.
                    setD((p) => ({ ...p, delivery_name: v, delivery_address: st?.address ?? "", contact: v || p.contact }));
                  }}
                  disabled={!salesFields}
                  placeholder={t("Select destination store", "Seleccione tienda destino")}
                  invalid={missingSet.has("delivery_name") || missingSet.has("delivery_address")}
                />
                <Txt label={t("Delivery Address", "Dirección de Entrega")} val={d.delivery_address} on={(v) => set("delivery_address", v)} disabled={!salesFields} placeholder={t("filled from the destination store", "se completa desde la tienda destino")} />
              </div>
            ) : (
              <div className="grid g2">
                <LocationCombo
                  nameLabel={t("Dropoff Name", "Nombre de Destino")}
                  addressLabel={t("Delivery Address (dropoff)", "Dirección de Entrega (destino)")}
                  name={d.delivery_name}
                  address={d.delivery_address}
                  options={deliveryOptions}
                  onName={(v) => set("delivery_name", v)}
                  onAddress={(v) => set("delivery_address", v)}
                  onSave={saveDeliveryLocation}
                  disabled={!salesFields}
                  nameInvalid={missingSet.has("delivery_name")}
                  addressInvalid={missingSet.has("delivery_address")}
                  namePlaceholder={t("Select a saved site…", "Seleccione un sitio guardado…")}
                  addressPlaceholder={t("Start typing an address…", "Empiece a escribir una dirección…")}
                  t={t}
                />
              </div>
            )}

            {/* ---------- Exact pin (for sites with no real address yet, e.g. a construction site) ---------- */}
            <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", marginBottom: showPinPicker ? 8 : 0 }}>
              <button className="btn btn-ghost btn-sm" disabled={!salesFields} onClick={() => {
                setPinDraft(d.delivery_lat != null && d.delivery_lng != null ? [d.delivery_lat, d.delivery_lng] : null);
                setShowPinPicker((s) => !s);
              }}>
                📍 {t("Set exact location on map", "Marcar ubicación exacta en el mapa")}
              </button>
              {pinLookupBusy ? (
                <span className="hint">{t("Looking up the address…", "Buscando la dirección…")}</span>
              ) : d.delivery_lat != null && d.delivery_lng != null && (
                <span className="hint">
                  {d.delivery_pin_source === "manual"
                    ? t("Exact pin set — the driver will navigate straight to it.", "Pin exacto marcado — el chofer navegará directo a él.")
                    : t("Location found from the address above.", "Ubicación encontrada a partir de la dirección de arriba.")}
                </span>
              )}
            </div>
            {showPinPicker && (
              <div className="card" style={{ marginBottom: 12 }}>
                <div className="hint" style={{ marginBottom: 8 }}>
                  {t("Move the mouse to preview the spot, then right-click to drop the pin — useful when there's no formal address yet (a construction site, a lot).", "Mueva el mouse para previsualizar el punto y haga clic derecho para marcarlo — útil cuando aún no hay una dirección formal (un sitio de construcción, un lote).")}
                </div>
                <MapView
                  pickable
                  pickedPoint={pinDraft}
                  center={pinDraft ?? (d.delivery_lat != null && d.delivery_lng != null ? [d.delivery_lat, d.delivery_lng] : undefined)}
                  onPick={(lat, lng) => dropPin(lat, lng)}
                  height={280}
                />
                <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
                  <button className="btn btn-primary btn-sm" disabled={!pinDraft} onClick={() => {
                    if (!pinDraft) return;
                    savePin(pinDraft[0], pinDraft[1]);
                  }}>{t("Save pin", "Guardar pin")}</button>
                  {(d.delivery_lat != null || pinDraft) && (
                    <button className="btn btn-ghost btn-sm" onClick={() => {
                      set("delivery_lat", null); set("delivery_lng", null); set("delivery_pin_source", null);
                      setPinDraft(null); setShowPinPicker(false);
                    }}>{t("Clear pin", "Quitar pin")}</button>
                  )}
                  <button className="btn btn-ghost btn-sm" onClick={() => setShowPinPicker(false)}>{t("Cancel", "Cancelar")}</button>
                </div>
              </div>
            )}

            {pickupEqualsDropoff && (
              <div className="hint" style={{ color: "var(--red)", fontWeight: 600, marginBottom: 10 }}>
                ⚠ {t("Pickup and delivery address are the same — they must be different.", "La dirección de recolección y de entrega son iguales — deben ser diferentes.")}
              </div>
            )}

            {/* Delivery notes are now entered here as role-targeted notes
                (tag "Driver"/"Everyone") — the old single Delivery Notes field
                was folded into this "Add note" section. */}
            <RoleNotes notes={d.role_notes ?? []} me={me} onAdd={addDraftNote} onRemove={removeDraftNote} t={t} lang={lang} />

            <div className="section-label">{t("Route", "Ruta")}</div>
            <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
              <button className="btn btn-ghost" onClick={calcRoute} disabled={routing}>
                {routing ? t("Calculating…", "Calculando…") : t("🚚 Auto-calculate distance & ETA", "🚚 Calcular distancia y tiempo")}
              </button>
              {/* Miles are auto-calculated only — read-only, never hand-typed. */}
              <div style={{ width: 110 }}>
                <div className="hint" style={{ marginBottom: 2 }}>{t("Miles", "Millas")}</div>
                <div style={{ fontFamily: "Archivo", fontSize: 18, fontWeight: 700 }}>
                  {d.route_miles != null ? `${d.route_miles} mi` : "—"}
                </div>
              </div>
              {d.route_duration && (
                <div style={{ display: "flex", gap: 14, alignItems: "center", flexWrap: "wrap" }}>
                  <span><b style={{ fontFamily: "Archivo", fontSize: 18 }}>{d.route_duration}</b> {t("drive", "manejo")}</span>
                  <span className="sema" style={{ background: d.route_traffic ? "var(--green)" : "var(--gray)", color: "#fff" }}>
                    {d.route_traffic ? t("live traffic", "tráfico en vivo") : t("typical", "típico")} · {d.route_provider}
                  </span>
                </div>
              )}
            </div>
            <div className="hint">{t("Miles come from the live routing service — press Auto-calculate to fill them in.", "Las millas provienen del servicio de ruteo en vivo — presione Calcular para llenarlas.")}</div>
            {routeErr && <div className="hint" style={{ color: "var(--red)" }}>{routeErr}</div>}
            {!routing && !routeErr && (d.delivery_address || "").trim() && d.route_miles == null && (
              <div className="hint" style={{ color: "var(--amber)" }}>⚠ {t("Delivery address not verified yet — recalculate to confirm it maps to a real location.", "Dirección de entrega no verificada — recalcule para confirmar que corresponde a una ubicación real.")}</div>
            )}

            {showWarehouse && (
              <>
                <div className="section-label">{t("Warehouse / Preparing", "Almacén / Preparación")}</div>
                <div className="grid g2">
                  <Txt label={t("Actual Pallets (warehouse)", "Pallets Reales (almacén)")} type="number" val={d.actual_pallets ?? ""} on={(v) => set("actual_pallets", v === "" ? null : Number(v))} disabled={!whFields} placeholder={d.est_pallets != null ? t(`est. ${d.est_pallets}`, `est. ${d.est_pallets}`) : ""} />
                  <Sel label={t("Assigned Driver", "Chofer Asignado")} val={d.assigned_driver} opts={driverNames(users)} on={(v) => set("assigned_driver", v)} disabled={!adminFields} placeholder={t("Unassigned", "Sin asignar")} />
                </div>
                {(() => {
                  const v = palletVariance(d);
                  return v ? (
                    <div className="hint" style={{ color: "var(--amber)", fontWeight: 600, marginTop: 4 }}>
                      ⚠ {t(
                        `Actual pallets (${v.actual}) differ from the sales estimate (${v.est}) by ${v.diff > 0 ? "+" : ""}${v.diff}.`,
                        `Las pallets reales (${v.actual}) difieren del estimado de ventas (${v.est}) por ${v.diff > 0 ? "+" : ""}${v.diff}.`,
                      )}
                    </div>
                  ) : null;
                })()}
                {adminFields && (
                  <div style={{ display: "flex", gap: 8, marginTop: 8, alignItems: "center", flexWrap: "wrap" }}>
                    <button className="btn btn-ghost btn-sm" onClick={suggestAndSet}>✨ {t("Suggest least-busy driver", "Sugerir chofer menos ocupado")}</button>
                  </div>
                )}
                {conflicts.length > 0 && (
                  <div className="card" style={{ marginTop: 10, background: "#fff7ec", borderColor: "var(--amber)" }}>
                    <b style={{ color: "#b9791a" }}>⚠ {t("Schedule conflict", "Conflicto de horario")}</b>
                    <div className="hint" style={{ marginTop: 2 }}>
                      {t(
                        `${d.assigned_driver} already has an overlapping window this day:`,
                        `${d.assigned_driver} ya tiene una ventana que se traslapa ese día:`,
                      )}{" "}
                      {conflicts.map((c) => `#${orderLabel(c)} (${fmtWindows(c.delivery_windows)})`).join(", ")}
                    </div>
                  </div>
                )}
              </>
            )}
            {!whFields && !salesFields && (
              <div className="hint">{t("You have view-only access to this order at its current stage.", "Tiene acceso de solo lectura a esta orden en su etapa actual.")}</div>
            )}
          </>
        )}

        {/* ---------- REJECT REASON ---------- */}
        {showReject && (
          <div className="field" style={{ marginTop: 14 }}>
            <label>{t("Rejection reason (sent back to sales)", "Motivo del rechazo (se envía a ventas)")}</label>
            <textarea rows={2} value={rejectReason} onChange={(e) => setRejectReason(e.target.value)} placeholder={t("What needs to change?", "¿Qué se necesita cambiar?")} />
          </div>
        )}

        {/* ---------- PALLET CONFIRMATION (pickup) — "ready" is a popup, see below ---------- */}
        {showPickupConfirm && existing && (
          <div className="field" style={{ marginTop: 14 }}>
            <label>{t("How many pallets did you load?", "¿Cuántas pallets cargó?")}</label>
            <input type="number" min={1} value={pickupPallets} onChange={(e) => setPickupPallets(e.target.value)} />
            <div className="hint">
              {t(`Total on this order: ${existing.actual_pallets ?? existing.est_pallets ?? "—"}. Loading fewer splits the order into #${orderLabel({ ...existing, order_suffix: existing.order_suffix ?? "a" })} (this trip) and a new staged trip with the rest.`,
                 `Total de la orden: ${existing.actual_pallets ?? existing.est_pallets ?? "—"}. Cargar menos divide la orden en #${orderLabel({ ...existing, order_suffix: existing.order_suffix ?? "a" })} (este viaje) y un nuevo viaje preparado con el resto.`)}
            </div>
          </div>
        )}

        {/* ---------- PROOF OF DELIVERY ---------- */}

        {/* ---------- POD (view, after delivery) ---------- */}
        {!editing && existing?.pod_received_by && (
          <div className="card" style={{ marginTop: 14 }}>
            <b>✅ {t("Delivered to", "Entregado a")}:</b> {existing.pod_received_by}
            {existing.pod_delivered_at && <span className="hint"> · {fmtDateTime(existing.pod_delivered_at)}</span>}
            {existing.delivered_address && (
              <div style={{ marginTop: 8, padding: "8px 10px", borderRadius: 8, background: "#fff7ec", border: "1px solid var(--amber)", fontSize: 13 }}>
                <b style={{ color: "#b9791a" }}>⚠ {t("Delivered at a different address", "Entregado en otra dirección")}</b>
                <div style={{ marginTop: 2 }}>{existing.delivered_address}</div>
                <div className="hint" style={{ marginTop: 2 }}>{t("Ordered:", "Pedido:")} {existing.delivery_address || "—"}</div>
              </div>
            )}
            {existing.pod_lat != null && existing.pod_lng != null && (
              <div style={{ marginTop: 6, fontSize: 12.5 }}>
                📍 <a className="link-tel" href={mapLink(existing.pod_lat, existing.pod_lng)} target="_blank" rel="noopener noreferrer">
                  {t("Delivered at this location", "Entregado en esta ubicación")}
                </a>
                {existing.pod_accuracy != null && <span className="hint"> (±{existing.pod_accuracy} m)</span>}
              </div>
            )}
            {existing.pod_signature && (
              // eslint-disable-next-line @next/next/no-img-element
              <div style={{ marginTop: 8 }}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={existing.pod_signature}
                  alt="signature"
                  onClick={() => setViewSig(true)}
                  title={t("Open full size", "Ver en grande")}
                  style={{ maxHeight: 90, background: "#fff", border: "1px solid var(--line)", borderRadius: 8, cursor: "zoom-in" }}
                />
              </div>
            )}
          </div>
        )}

        {/* ---------- CANCEL REASON ---------- */}
        {showCancel && (
          <div className="field" style={{ marginTop: 14 }}>
            <label>{t("Cancellation reason (recorded for reporting)", "Motivo de cancelación (registrado para reportes)")}</label>
            <select value={cancelReason} onChange={(e) => setCancelReason(e.target.value)}>
              <option value="">{t("Select a reason…", "Seleccione un motivo…")}</option>
              {CANCEL_REASONS.map((r) => <option key={r.en} value={t(r.en, r.es)}>{t(r.en, r.es)}</option>)}
            </select>
          </div>
        )}

        {/* ---------- RE-DELIVERY: record a repeat ----------
            Shown to exactly the roles the DATABASE allows to log one. The
            guard (see the deliveries_guard_stage trigger) accepts warehouse,
            manager and driver, with admin bypassing it entirely.
            It used to be gated on capabilities — canFulfill || canApprove ||
            canDeliver — which also let accounting and logistics in through
            "approve". Verified against the live database: both are refused
            with "Not allowed to log this re-delivery", so those two roles had
            a button that could only ever throw. */}
        {!editing && existing && existing.stage === "delivered"
          && ["admin", "manager", "warehouse", "driver"].includes(me.role) && (
          showRedeliver ? (
            <div className="field" style={{ marginTop: 14 }}>
              <label>{t("Why does this order need to be delivered again?", "¿Por qué debe entregarse esta orden de nuevo?")}</label>
              <textarea rows={2} value={redeliverReason} onChange={(e) => setRedeliverReason(e.target.value)} placeholder={t("e.g. wrong pallet loaded, damaged in transit…", "ej. pallet equivocada, dañado en tránsito…")} />
              <label style={{ marginTop: 10 }}>{t("Was there an additional charge to the customer for this re-delivery? ($)", "¿Hubo un cargo adicional al cliente por esta reentrega? ($)")}</label>
              <input type="number" min={0} step="0.01" value={redeliverCharge} onChange={(e) => setRedeliverCharge(e.target.value)} placeholder={t("0 = no extra charge", "0 = sin cargo adicional")} style={{ maxWidth: 200 }} />
              <div className="hint">{t("Leave 0 (or blank) if the re-delivery is free. This becomes the delivery fee on the new linked order.", "Deje 0 (o vacío) si la reentrega es gratis. Esto será el costo de entrega en la nueva orden vinculada.")}</div>
              <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
                <button className="btn btn-ghost btn-sm" onClick={() => { setShowRedeliver(false); setRedeliverReason(""); setRedeliverCharge(""); }} disabled={busy}>{t("Cancel", "Cancelar")}</button>
                <button className="btn btn-amber btn-sm" disabled={busy || !redeliverReason.trim()} onClick={recordRedelivery}>{t("Create re-delivery", "Crear reentrega")}</button>
              </div>
            </div>
          ) : (
            <div style={{ marginTop: 14 }}>
              <button className="btn btn-amber btn-sm" onClick={() => setShowRedeliver(true)}>🔁 {t("Record re-delivery", "Registrar reentrega")}</button>
              <div className="hint">{t("Log a repeat of this delivery (warehouse error, damage…) as a new linked order.", "Registra una repetición de esta entrega (error de almacén, daño…) como una nueva orden vinculada.")}</div>
            </div>
          )
        )}

        {/* ---------- STILL MISSING (moved to the bottom, right above the buttons) ---------- */}
        {editing && showFullForm && missing.length > 0 && (
          <div className="card" style={{ marginTop: 14, marginBottom: 0, background: "#fdeaea", borderColor: "var(--red)" }}>
            <b style={{ color: "var(--red)" }}>{t("Still missing", "Faltan")} ({missing.length})</b>
            <ul style={{ margin: "6px 0 0 18px", fontSize: 12.5, lineHeight: 1.5 }}>
              {missing.map((m) => <li key={m.key}>{t(m.en, m.es)}</li>)}
            </ul>
            <div className="hint" style={{ marginTop: 4 }}>{t("Marked in red above. You can still submit — you'll be asked to confirm.", "Marcados en rojo arriba. Aún puede enviar — se le pedirá confirmar.")}</div>
          </div>
        )}

        {/* ---------- ACTIONS ---------- */}
        {/* Hidden during the initial new-order step (which has its own Next). */}
        {showFullForm && (
        <div className="modal-actions">
          {existing && me.role === "admin" && (
            <button className="btn btn-danger" onClick={remove} disabled={busy}>{t("Delete", "Eliminar")}</button>
          )}
          {existing && !editing && canCreate(me) && (
            <button className="btn btn-ghost" onClick={duplicate} disabled={busy} title={t("Create a new draft order from this one", "Crear una nueva orden borrador a partir de esta")}>⧉ {t("Duplicate", "Duplicar")}</button>
          )}
          <span style={{ flex: 1 }} />

          {editing ? (
            <>
              {!isNew && canEditFields(me.role, stage) && (
                <button className="btn btn-ghost" onClick={() => { setEditing(false); setD(existing!); }} disabled={busy}>{t("Cancel edit", "Cancelar edición")}</button>
              )}
              {isNew ? (
                <>
                  <button className="btn btn-danger" onClick={async () => { if (await confirmAction(t("Discard this order? Nothing will be saved.", "¿Descartar esta orden? No se guardará nada."), { danger: true, confirmLabel: t("Discard", "Descartar") })) onClose(); }} disabled={busy}>{t("Discard", "Descartar")}</button>
                  {canCreate(me) && <button className="btn btn-ghost" onClick={save} disabled={busy}>{t("Save draft", "Guardar borrador")}</button>}
                  {canCreate(me) && (
                    <button className="btn btn-primary" disabled={busy} onClick={async () => {
                      // Office Managers approve their own orders on the spot, and
                      // any order sold from an auto-approve store is approved on
                      // creation regardless of who places it — EXCEPT an
                      // Intertienda without a PO #, which must go to Pending.
                      const autoApprove = (me.role === "manager" || storeAutoApprove) && !intertiendaNeedsPo;
                      const payload = withDurations({
                        ...d,
                        stage: autoApprove ? "approved" : "pending",
                        ...(autoApprove ? { approved_by: me.id, approved_at: new Date().toISOString() } : {}),
                      });
                      if (!(await passesChecks(payload))) return;
                      setBusy(true);
                      const row = await addDelivery(payload);
                      setBusy(false);
                      if (row) {
                        notify(autoApprove
                          ? t(`Order #${orderLabel(row)} created and approved`, `Orden #${orderLabel(row)} creada y aprobada`)
                          : t(`Order #${orderLabel(row)} submitted for approval`, `Orden #${orderLabel(row)} enviada a aprobación`));
                        await autoSendTracking(row); onClose();
                      }
                    }}>{me.role === "manager" && !intertiendaNeedsPo
                      ? t("Create order (approved)", "Crear orden (aprobada)")
                      : storeAutoApprove && !intertiendaNeedsPo
                        ? t("Create (auto-approved)", "Crear (auto-aprobada)")
                        : t("Submit for approval", "Enviar a aprobación")}</button>
                  )}
                </>
              ) : (
                <button className="btn btn-primary" onClick={save} disabled={busy}>{t("Save changes", "Guardar cambios")}</button>
              )}
            </>
          ) : existing && me.role === "driver" ? (
            // The driver's run buttons live up in their delivery card (right
            // under the notes), so all that's left down here is the way out.
            <button className="btn btn-ghost" onClick={requestClose}>{t("Close", "Cerrar")}</button>
          ) : existing ? (
            stageActions
          ) : null}
        </div>
        )}
      </div>
    </div>

    {viewSig && existing?.pod_signature && (
      <PhotoLightbox
        photos={[existing.pod_signature]}
        index={0}
        onIndex={() => undefined}
        onClose={() => setViewSig(false)}
        t={t}
      />
    )}

    {/* CONFIRM-PALLETS POPUP — opens after pressing "Mark ready". The only way
        out is Confirm or Discard; a backdrop click does nothing on purpose. */}
    {/* PROOF-OF-DELIVERY POPUP — opened by "Mark delivered". A focused sheet
        rather than a panel further down the order, because the driver is
        doing this one-handed at the tailgate and shouldn't have to hunt for
        the signature box. Backdrop clicks do nothing: half a signature lost
        to a stray tap is worse than an extra tap on "Back". */}
    {showPod && existing && (
      <div className="overlay" style={{ zIndex: 60 }} onClick={(e) => e.stopPropagation()}>
        <div className="modal" style={{ maxWidth: 460 }}>
          <h3 style={{ marginTop: 0 }}>✅ {t("Confirm delivery", "Confirmar entrega")}</h3>
          <div className="hint" style={{ marginTop: -6, marginBottom: 12 }}>
            #{orderLabel(existing)}{existing.account ? ` · ${existing.account}` : ""}
          </div>
              <label>{t("Received by", "Recibido por")}</label>
              <input value={podName} onChange={(e) => setPodName(e.target.value)} placeholder={t("Name of person who received it", "Nombre de quien recibió")} />
              {signatureOn && (
                <>
                  <label style={{ marginTop: 10 }}>{t("Signature", "Firma")}</label>
                  <SignaturePad onChange={setPodSig} />
                </>
              )}

              {/* The camera belongs HERE, not only further up the order.
                  A driver who reached this sheet and was told "a material
                  photo is required" had nowhere in it to take one — so he
                  typed the name, pressed Confirm, and nothing happened. The
                  requirement has to be satisfiable where it is demanded. */}
              {!!settings.require_pod && (
                <div style={{ marginTop: 12 }}>
                  <label>
                    📷 {t("Material photo", "Foto del material")}
                    {!existing.photos?.length && (
                      <span style={{ color: "var(--amber)", marginLeft: 6 }}>· {t("required", "requerida")}</span>
                    )}
                  </label>
                  <PhotoUpload
                    photos={existing.photos ?? []}
                    credits={photoCredits}
                    disabled={photoBusy}
                    onChange={async (next) => {
                      setPhotoBusy(true);
                      await updateDelivery(existing.id, { photos: next });
                      setPhotoBusy(false);
                    }}
                    t={t}
                  />
                </div>
              )}

              {/* Override: delivered somewhere other than the ordered address. */}
              <label style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 12, cursor: "pointer", textTransform: "none", letterSpacing: 0 }}>
                <input type="checkbox" style={{ width: "auto", margin: 0 }} checked={deliveredElsewhere} onChange={(e) => setDeliveredElsewhere(e.target.checked)} />
                📍 {t("I delivered at a different address", "Entregué en otra dirección")}
              </label>
              {deliveredElsewhere && (
                <div className="field" style={{ marginTop: 8 }}>
                  <div className="hint" style={{ marginTop: 0, marginBottom: 4 }}>
                    {t("Ordered address:", "Dirección del pedido:")} {existing?.delivery_address || "—"}
                  </div>
                  <input
                    value={deliveredAddress}
                    onChange={(e) => setDeliveredAddress(e.target.value)}
                    placeholder={t("Address where you actually delivered", "Dirección donde entregó realmente")}
                  />
                  <div className="hint" style={{ color: "var(--amber)", fontWeight: 600, marginTop: 4 }}>
                    ⚠ {t("This will be reported to the office.", "Esto se reportará a la oficina.")}
                  </div>
                </div>
              )}

              <div className="hint" style={{ marginTop: 6 }}>
                {geoAvailable()
                  ? t("📍 Your location will be recorded with this delivery.", "📍 Su ubicación se registrará con esta entrega.")
                  : t("📍 Location can't be recorded here (needs a secure https connection).", "📍 No se puede registrar la ubicación aquí (requiere conexión https segura).")}
              </div>
              {/* Say what's still missing BEFORE the driver taps. This gate used
                  to be invisible until the button was pressed and a toast said
                  no — which reads as "I pressed delivered and nothing happened". */}
              {podBlocker && (
                <div className="hint" style={{ marginTop: 8, color: "var(--amber)", fontWeight: 600 }}>
                  ⚠ {podBlocker}
                </div>
              )}
              {/* Full-size targets: this is tapped standing at a tailgate. */}
              <div className="modal-actions" style={{ marginTop: 14 }}>
                <button className="btn btn-ghost" onClick={() => { setShowPod(false); setPodName(""); setPodSig(null); setDeliveredElsewhere(false); setDeliveredAddress(""); }} disabled={busy}>{t("Cancel", "Cancelar")}</button>
                <button className="btn btn-green" disabled={busy || !!podBlocker} onClick={deliverWithPod}>{t("Confirm delivered", "Confirmar entregado")}</button>
              </div>
        </div>
      </div>
    )}

    {/* Confirmar la TARIFA al agarrar la orden (D-146).

        Estuvo primero en "Marcar listo" (D-143). Se mueve aquí porque el momento importa: al
        agarrarla, la orden todavía está quieta y da tiempo a llamar a ventas; al marcarla lista
        ya está montada y el camión esperando, y ahí una tarifa mal puesta se despacha con un
        clic para no parar la salida.

        Lo importante NO es que el almacén la re-teclee: es que vea al lado LO QUE DEBERÍA SER.
        Pedir que confirme un número que tampoco conoce solo trasladaría el error de sitio. */}
    {showStartConfirm && existing && (
      <div className="overlay" style={{ zIndex: 60 }} onClick={(e) => e.stopPropagation()}>
        <div className="modal" style={{ maxWidth: 420 }}>
          <h3 style={{ marginTop: 0 }}>{t("Confirm the delivery fee", "Confirmar la tarifa de entrega")}</h3>
          <p className="hint" style={{ marginTop: 0 }}>
            {t("Before you start preparing this order, check what is being charged for the delivery.",
               "Antes de comenzar a preparar esta orden, revise lo que se está cobrando por la entrega.")}
          </p>

          <div className="field">
            <label>{t("Delivery fee", "Tarifa de entrega")}</label>
            <input type="number" min={0} step="0.01" autoFocus value={startFee}
              onChange={(e) => setStartFee(e.target.value)} />
            <div className="hint">
              {t("Sales charged:", "Ventas cobró:")}{" "}
              <strong>{existing.delivery_fee != null ? `$${existing.delivery_fee}` : t("nothing", "nada")}</strong>
              {feeSuggestion.list != null ? (
                <>
                  {" · "}
                  {/* Se dice de DÓNDE sale el número —ciudad, zona y millas— y no solo cuál es.
                      Un importe suelto obliga a creérselo; con su origen delante, quien lo mira
                      puede darse cuenta de que la zona o las millas están mal, que es la otra
                      mitad de los errores de tarifa. */}
                  {feeSuggestion.city || t("this address", "esta dirección")}{" · "}
                  {feeSuggestion.zone === "local" ? t("local", "local") : t("out of area", "fuera de zona")}
                  {existing.route_miles != null ? ` · ${existing.route_miles} mi` : ""}
                  {" → "}
                  <strong>${feeSuggestion.list}</strong> {t("list", "lista")}
                  {feeSuggestion.discount != null && feeSuggestion.discount !== feeSuggestion.list
                    && <> · ${feeSuggestion.discount} {t("discounted", "con descuento")}</>}
                </>
              ) : (
                // Sin millas de ruta no hay tarifa que calcular. Se dice, en vez de callar: un
                // hueco sin explicación se lee como que el cálculo falló.
                <> · {t("no route miles yet, so there is nothing to compare against",
                        "aún no hay millas de ruta, así que no hay con qué comparar")}</>
              )}
            </div>
            {/* Nada cobrado: el caso que el aviso de abajo NO veía, porque comparaba contra
                la lista de precios y un hueco no se puede comparar con nada. Es el peor de
                los dos —un número equivocado al menos lo tecleó alguien; uno vacío suele
                significar que nadie miró— así que va aparte y va primero. */}
            {sinCobrar && (
              <div className="banner err" style={{ marginTop: 8 }}>
                🚩 {existing.delivery_fee == null
                  ? t("Nothing was charged for this delivery — the fee is blank.",
                      "No se cobró nada por esta entrega — la tarifa está vacía.")
                  : t("This delivery is going out free — the fee is $0.",
                      "Esta entrega va a salir gratis — la tarifa es $0.")}
                {" "}
                {t("If that is right, confirm it and it stops being flagged.",
                   "Si es correcto, confírmelo y deja de marcarse.")}
                {feeSuggestion.list != null && (
                  <button className="btn btn-ghost btn-sm" style={{ marginLeft: 6 }}
                    onClick={() => setStartFee(String(feeSuggestion.list))}>
                    {t("Charge", "Cobrar")} ${feeSuggestion.list}
                  </button>
                )}
              </div>
            )}
            {/* El aviso solo cuando de verdad NO cuadra. Un aviso que sale siempre deja de
                leerse, y entonces el que importa pasa desapercibido. */}
            {!sinCobrar && feeSuggestion.list != null && existing.delivery_fee != null
              && existing.delivery_fee !== feeSuggestion.list
              && existing.delivery_fee !== feeSuggestion.discount && (
              <div className="banner warn" style={{ marginTop: 8 }}>
                ⚠️ {t(
                  `Charged $${existing.delivery_fee}. For ${feeSuggestion.zone === "local" ? "a local" : "an out-of-area"} delivery of ${existing.route_miles ?? "?"} miles the price is $${feeSuggestion.list}${feeSuggestion.discount != null && feeSuggestion.discount !== feeSuggestion.list ? `, or $${feeSuggestion.discount} discounted` : ""}.`,
                  `Se cobró $${existing.delivery_fee}. Para una entrega ${feeSuggestion.zone === "local" ? "local" : "fuera de zona"} de ${existing.route_miles ?? "?"} millas el precio es $${feeSuggestion.list}${feeSuggestion.discount != null && feeSuggestion.discount !== feeSuggestion.list ? `, o $${feeSuggestion.discount} con descuento` : ""}.`,
                )}
                {" "}
                <button className="btn btn-ghost btn-sm" style={{ marginLeft: 6 }}
                  onClick={() => setStartFee(String(feeSuggestion.list))}>
                  {t("Use", "Usar")} ${feeSuggestion.list}
                </button>
              </div>
            )}
          </div>

          <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 16 }}>
            <button className="btn btn-ghost" onClick={() => setShowStartConfirm(false)} disabled={busy}>{t("Cancel", "Cancelar")}</button>
            <button className="btn btn-primary" onClick={confirmStart} disabled={busy}>{t("Confirm & start preparing", "Confirmar y comenzar preparación")}</button>
          </div>
        </div>
      </div>
    )}

    {showReadyConfirm && existing && (
      <div className="overlay" style={{ zIndex: 60 }} onClick={(e) => e.stopPropagation()}>
        <div className="modal" style={{ maxWidth: 420 }}>
          <h3 style={{ marginTop: 0 }}>{t("Confirm pallets", "Confirmar pallets")}</h3>
          <div className="field">
            <label>{t("How many pallets are ready?", "¿Cuántas pallets están listas?")}</label>
            <input type="number" min={1} autoFocus value={readyPallets} onChange={(e) => setReadyPallets(e.target.value)}
              placeholder={existing.est_pallets != null ? `est. ${existing.est_pallets}` : ""} />
            <div className="hint">{t("Original order amount:", "Cantidad original de la orden:")} {existing.est_pallets ?? "—"}</div>
          </div>

          <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 16 }}>
            <button className="btn btn-ghost" onClick={() => setShowReadyConfirm(false)} disabled={busy}>{t("Discard", "Descartar")}</button>
            <button className="btn btn-green" onClick={confirmReady} disabled={busy}>{t("Confirm & mark ready", "Confirmar y marcar listo")}</button>
          </div>
        </div>
      </div>
    )}
    </>
  );
}

/** Searchable picker of past orders' invoices. Type to filter by invoice #,
 * order id or account; click a match to attach this delivery to that invoice. */
function PastInvoicePicker({ options, current, onPick, t }: {
  options: { invoice: string; label: string }[];
  current: string;
  onPick: (invoice: string) => void;
  t: (en: string, es: string) => string;
}) {
  const [q, setQ] = useState("");
  const needle = q.trim().toLowerCase();
  const filtered = needle ? options.filter((o) => o.label.toLowerCase().includes(needle)) : options;
  return (
    <div style={{ marginTop: 6 }}>
      <input
        placeholder={t("Search invoice, order or account…", "Buscar factura, orden o cuenta…")}
        value={q}
        onChange={(e) => setQ(e.target.value)}
      />
      <div style={{ maxHeight: 170, overflowY: "auto", border: "1px solid #dfe3ea", borderRadius: 8, marginTop: 6 }}>
        {filtered.length === 0 ? (
          <div className="hint" style={{ padding: 8 }}>{t("No matching past invoices.", "Sin facturas anteriores coincidentes.")}</div>
        ) : (
          filtered.slice(0, 50).map((o) => {
            const picked = o.invoice === current;
            return (
              <button
                key={o.invoice}
                type="button"
                onClick={() => onPick(o.invoice)}
                style={{
                  display: "block", width: "100%", textAlign: "left", padding: "7px 10px",
                  background: picked ? "var(--accent)" : "transparent", color: picked ? "#fff" : "inherit",
                  border: "none", borderBottom: "1px solid #eef1f5", cursor: "pointer", fontWeight: picked ? 700 : 400,
                }}
              >
                {picked ? "✓ " : ""}{o.label}
              </button>
            );
          })
        )}
      </div>
    </div>
  );
}

/** Visual meta for each note tag (label + color). */
const NOTE_ROLE_META: Record<NoteRole, { en: string; es: string; emoji: string; bg: string; fg: string }> = {
  everyone:  { en: "Everyone",  es: "Todos",     emoji: "🗣", bg: "#eef1f5", fg: "#3a4a5a" },
  sales:     { en: "Sales",     es: "Ventas",    emoji: "💼", bg: "#e8f0fe", fg: "#1a56c4" },
  warehouse: { en: "Warehouse", es: "Almacén",   emoji: "📦", bg: "#fff3e0", fg: "#b26a00" },
  logistics: { en: "Logistics", es: "Logística", emoji: "🧭", bg: "#e7f6ec", fg: "#1a7f37" },
  driver:    { en: "Driver",    es: "Chofer",    emoji: "🚚", bg: "#f0e9fb", fg: "#6b3fb5" },
};

/** Role-targeted notes: a tagged list plus an on-demand "Add note" composer.
 * Everyone sees every note; the tag says who it's for. Added only when needed,
 * so an order with no notes shows just the "Add note" affordance. */
function RoleNotes({ notes, me, onAdd, onRemove, t, lang }: {
  notes: RoleNote[];
  me: Profile;
  onAdd: (role: NoteRole, text: string) => void | Promise<void>;
  onRemove: (id: string) => void | Promise<void>;
  t: (en: string, es: string) => string;
  lang: string;
}) {
  const [open, setOpen] = useState(false);
  const [role, setRole] = useState<NoteRole>("everyone");
  const [text, setText] = useState("");
  const roleLabel = (r: NoteRole) => (lang === "es" ? NOTE_ROLE_META[r].es : NOTE_ROLE_META[r].en);

  const submit = async () => {
    if (!text.trim()) return;
    await onAdd(role, text);
    setText(""); setRole("everyone"); setOpen(false);
  };

  return (
    <div style={{ marginTop: 14 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
        <div className="section-label" style={{ marginTop: 0 }}>{t("Notes", "Notas")}</div>
        {!open && (
          <button className="btn btn-ghost btn-sm" onClick={() => setOpen(true)}>＋ {t("Add note", "Agregar nota")}</button>
        )}
      </div>

      {notes.length === 0 && !open && (
        <div className="hint" style={{ marginTop: 2 }}>{t("No notes yet.", "Sin notas todavía.")}</div>
      )}

      {notes.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 6 }}>
          {notes.map((n) => {
            const meta = NOTE_ROLE_META[n.role] ?? NOTE_ROLE_META.everyone;
            const canRemove = me.role === "admin" || n.by === me.id;
            return (
              <div key={n.id} className="card" style={{ padding: "8px 10px", display: "flex", alignItems: "flex-start", gap: 8 }}>
                <span style={{ background: meta.bg, color: meta.fg, borderRadius: 6, padding: "2px 7px", fontSize: 12, fontWeight: 700, whiteSpace: "nowrap" }}>
                  {meta.emoji} {roleLabel(n.role)}
                </span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ whiteSpace: "pre-wrap", wordBreak: "break-word" }}>{n.text}</div>
                  <div className="hint" style={{ marginTop: 2 }}>{(n.by_name || t("Someone", "Alguien"))} · {fmtDateTime(n.at)}</div>
                </div>
                {canRemove && (
                  <button className="btn btn-sm btn-ghost" title={t("Remove note", "Eliminar nota")} onClick={() => onRemove(n.id)}>✕</button>
                )}
              </div>
            );
          })}
        </div>
      )}

      {open && (
        <div className="card" style={{ marginTop: 8, padding: 10 }}>
          <label style={{ margin: 0, textTransform: "none", letterSpacing: 0, display: "flex", alignItems: "center", gap: 6 }}>
            {t("For", "Para")}
            <select value={role} onChange={(e) => setRole(e.target.value as NoteRole)} style={{ width: "auto" }}>
              {(["everyone", "sales", "warehouse", "logistics", "driver"] as NoteRole[]).map((r) => (
                <option key={r} value={r}>{roleLabel(r)}</option>
              ))}
            </select>
          </label>
          <textarea rows={2} style={{ marginTop: 8 }} autoFocus value={text} onChange={(e) => setText(e.target.value)}
            placeholder={t("Write a short note…", "Escriba una nota corta…")} />
          <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 8 }}>
            <button className="btn btn-ghost btn-sm" onClick={() => { setOpen(false); setText(""); }}>{t("Cancel", "Cancelar")}</button>
            <button className="btn btn-primary btn-sm" onClick={submit} disabled={!text.trim()}>{t("Add note", "Agregar nota")}</button>
          </div>
        </div>
      )}
    </div>
  );
}

/** The workflow buttons shown in view mode, gated by role + current stage. */
function StageActions({
  me, stage, busy, onEdit, onMove, showReject, setShowReject, rejectReason,
  showCancel, setShowCancel, cancelReason, onPrint, onRequestDeliver, podOpen,
  onRequestStart, readyConfirmOpen, onRequestReady, onConfirmReady, onCancelReady,
  pickupConfirmOpen, onRequestPickup, onConfirmPickup, onCancelPickup, onQuickPickup,
  departedAt, onDepart, arrivedAt, onArrive,
}: {
  me: Profile; stage: Stage; busy: boolean;
  onEdit: () => void;
  onMove: (to: Stage, note?: string) => void;
  showReject: boolean; setShowReject: (v: boolean) => void; rejectReason: string;
  showCancel: boolean; setShowCancel: (v: boolean) => void; cancelReason: string;
  onPrint: () => void; onRequestDeliver: () => void; podOpen: boolean;
  /** Abre el diálogo de tarifa que precede a "Comenzar preparación" (D-146). */
  onRequestStart: () => void;
  readyConfirmOpen: boolean; onRequestReady: () => void; onConfirmReady: () => void; onCancelReady: () => void;
  pickupConfirmOpen: boolean; onRequestPickup: () => void; onConfirmPickup: () => void; onCancelPickup: () => void;
  /** Driver's one-tap pickup: takes the full load, no count prompt. */
  onQuickPickup: () => void;
  departedAt: string | null; onDepart: () => void;
  arrivedAt: string | null; onArrive: () => void;
}) {
  const { t } = usePrefs();
  const btns: React.ReactNode[] = [];

  // Printable delivery slip / packing list. Not for drivers — there's no
  // printer in the truck, and it only crowded the buttons they actually use.
  if (me.role !== "driver") {
    btns.push(<button key="print" className="btn btn-ghost" onClick={onPrint} disabled={busy}>🖨 {t("Slip", "Comprobante")}</button>);
  }

  if (canEditFields(me.role, stage)) {
    btns.push(<button key="edit" className="btn btn-ghost" onClick={onEdit} disabled={busy}>{t("Edit", "Editar")}</button>);
  }

  // Anyone who can create orders also shepherds their own drafts through submit/resubmit/cancel.
  if (canCreate(me)) {
    if (stage === "draft") btns.push(<button key="submit" className="btn btn-primary" onClick={() => onMove("pending")} disabled={busy}>{t("Submit for approval", "Enviar a aprobación")}</button>);
    if (stage === "rejected") btns.push(<button key="resub" className="btn btn-primary" onClick={() => onMove("pending")} disabled={busy}>{t("Resubmit", "Reenviar")}</button>);
    if (stage === "draft" || stage === "rejected") {
      if (!showCancel) {
        btns.push(<button key="cancel" className="btn btn-danger" onClick={() => setShowCancel(true)} disabled={busy}>{t("Cancel order", "Cancelar orden")}</button>);
      } else {
        btns.push(<button key="cancelback" className="btn btn-ghost" onClick={() => setShowCancel(false)} disabled={busy}>{t("Back", "Atrás")}</button>);
        btns.push(<button key="docancel" className="btn btn-danger" disabled={busy || !cancelReason} onClick={() => onMove("canceled", cancelReason)}>{t("Confirm cancel", "Confirmar cancelación")}</button>);
      }
    }
  }

  // Manager
  if (canApprove(me) && stage === "pending") {
    if (!showReject) {
      btns.push(<button key="reject" className="btn btn-danger" onClick={() => setShowReject(true)} disabled={busy}>{t("Reject…", "Rechazar…")}</button>);
      btns.push(<button key="approve" className="btn btn-green" onClick={() => onMove("approved")} disabled={busy}>{t("Approve", "Aprobar")}</button>);
    } else {
      btns.push(<button key="cancelrej" className="btn btn-ghost" onClick={() => setShowReject(false)} disabled={busy}>{t("Back", "Atrás")}</button>);
      btns.push(<button key="dorej" className="btn btn-danger" disabled={busy || !rejectReason.trim()} onClick={() => onMove("rejected", rejectReason.trim())}>{t("Confirm reject", "Confirmar rechazo")}</button>);
    }
  }
  if (canApprove(me) && stage === "approved") {
    btns.push(<button key="unlock" className="btn btn-amber" onClick={() => onMove("pending")} disabled={busy}>{t("Unlock (back to pending)", "Desbloquear (volver a pendiente)")}</button>);
  }

  // Warehouse
  if (canFulfill(me)) {
    // Agarrar la orden pasa por confirmar la tarifa (D-146): el botón ya no mueve la etapa
    // por sí solo, abre el diálogo, y de ahí sale el cambio de etapa junto con la tarifa.
    if (stage === "approved") btns.push(<button key="start" className="btn btn-primary" onClick={onRequestStart} disabled={busy}>{t("Start preparing", "Comenzar preparación")}</button>);
    if (stage === "fulfilling") {
      // Opens the confirm-pallets popup (the actual confirm/discard lives there).
      btns.push(<button key="ready" className="btn btn-green" onClick={onRequestReady} disabled={busy}>{t("Mark ready", "Marcar listo")}</button>);
    }
  }

  // Driver (and warehouse/admin): pick up a ready order, then mark it delivered.
  if (canDeliver(me) && stage === "ready") {
    if (!pickupConfirmOpen) {
      // Drive-to-pickup: stamp "on my way" so the drive counts as active time.
      if (!departedAt) {
        btns.push(<button key="depart" className="btn btn-ghost" onClick={onDepart} disabled={busy} title={t("Start the drive to the pickup point", "Iniciar el viaje al punto de recolección")}>🚗 {t("Start drive", "Iniciar viaje")}</button>);
      } else {
        btns.push(
          <span key="enroute" className="hint" style={{ alignSelf: "center" }}>
            🚗 {t("En route since", "En camino desde")} {new Date(departedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
          </span>,
        );
      }
      // A driver gets ONE button that marks it picked up on the spot. Their
      // hands are full and the truck is loaded — a second "confirm the count"
      // screen only stands between them and the road. The office keeps the
      // two-step flow, where confirming a partial load and splitting the
      // remainder is the point.
      btns.push(
        <button
          key="pickup"
          className="btn btn-primary"
          onClick={me.role === "driver" ? onQuickPickup : onRequestPickup}
          disabled={busy}
          title={t("Mark loaded and go out for delivery", "Marcar cargada y salir en reparto")}
        >🚚 {t("Pick up", "Recoger")}</button>,
      );
    } else {
      btns.push(<button key="pickupback" className="btn btn-ghost" onClick={onCancelPickup} disabled={busy}>{t("Back", "Atrás")}</button>);
      btns.push(<button key="dopickup" className="btn btn-primary" onClick={onConfirmPickup} disabled={busy}>🚚 {t("Confirm load & go", "Confirmar carga y salir")}</button>);
    }
  }
  if (canDeliver(me) && stage === "picked_up" && !podOpen) {
    // Arrival: stamp when the driver reaches the stop, so transit splits into
    // driving vs dwell/service time. Optional — delivery works without it.
    if (!arrivedAt) {
      btns.push(<button key="arrive" className="btn btn-ghost" onClick={onArrive} disabled={busy}>🚦 {t("Arrived at stop", "Llegué a la parada")}</button>);
    } else {
      btns.push(
        <span key="arrived" className="hint" style={{ alignSelf: "center" }}>
          🚦 {t("Arrived", "Llegó")} {new Date(arrivedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
        </span>,
      );
    }
    btns.push(<button key="deliv" className="btn btn-green" onClick={onRequestDeliver} disabled={busy}>{t("Mark delivered", "Marcar entregado")}</button>);
  }

  return <>{btns}</>;
}

// Click-to-call the customer via RingCentral RingOut: rings the agent's line
// first, then connects to the client. Works from a desktop (no dialer app).
function CallClientButton({
  phone, notify, t, className = "btn btn-green btn-sm",
}: {
  phone: string;
  notify: (m: string) => void;
  t: (en: string, es: string) => string;
  className?: string;
}) {
  const [calling, setCalling] = useState(false);
  const [status, setStatus] = useState<string>("");
  const [callId, setCallId] = useState<string>("");
  const [ended, setEnded] = useState(false);

  // Human-readable, bilingual label for a RingCentral call status.
  const label = (s: string) => {
    const map: Record<string, [string, string]> = {
      InProgress: ["Ringing…", "Sonando…"],
      Success: ["Connected", "Conectado"],
      Busy: ["Line busy", "Línea ocupada"],
      NoAnswer: ["No answer", "Sin respuesta"],
      Rejected: ["Rejected", "Rechazada"],
      Error: ["Call error", "Error de llamada"],
      Finished: ["Call ended", "Llamada finalizada"],
      Voicemail: ["Voicemail", "Buzón de voz"],
    };
    const m = map[s]; return m ? t(m[0], m[1]) : s;
  };

  const poll = async (id: string) => {
    // Poll up to ~40s; stop once the call reaches a terminal state.
    const terminal = ["Success", "Busy", "NoAnswer", "Rejected", "Error", "Finished", "Voicemail"];
    for (let i = 0; i < 20; i++) {
      await new Promise((r) => setTimeout(r, 2000));
      try {
        const res = await fetch(`/api/call?id=${encodeURIComponent(id)}`);
        const b = await res.json().catch(() => ({}));
        if (b.callStatus) { setStatus(b.callStatus); if (terminal.includes(b.callStatus)) break; }
      } catch { /* keep polling */ }
    }
  };

  const call = async () => {
    setCalling(true);
    setStatus("");
    setEnded(false);
    setCallId("");
    try {
      const res = await fetch("/api/call", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ to: phone }),
      });
      const b = await res.json().catch(() => ({}));
      if (b.ok) {
        notify(t("Calling… your RingCentral line will ring, then connect to the client.", "Llamando… su línea RingCentral sonará y luego conectará con el cliente."));
        setStatus(b.status || "InProgress");
        if (b.id) { setCallId(b.id); await poll(b.id); }
      } else if (b.dryRun) notify(t("RingCentral calling isn’t configured.", "La llamada por RingCentral no está configurada."));
      else notify(b.error || t("Could not place the call", "No se pudo realizar la llamada"));
    } catch {
      notify(t("Network error placing the call", "Error de red al llamar"));
    } finally {
      setCalling(false);
      setEnded(true);
    }
  };

  const hangUp = async () => {
    if (!callId) return;
    try {
      await fetch(`/api/call?id=${encodeURIComponent(callId)}`, { method: "DELETE" });
      notify(t("Call ended", "Llamada finalizada"));
      setStatus("Finished");
    } catch {
      notify(t("Could not hang up", "No se pudo colgar"));
    }
  };

  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
      {!calling && !ended && (
        <button className={className} onClick={call}>☎ {t("Call via RingCentral", "Llamar por RingCentral")}</button>
      )}
      {calling && (
        <>
          <button className={className} disabled>☎ {t("Calling…", "Llamando…")}</button>
          {callId && <button className="btn btn-danger btn-sm" onClick={hangUp}>🔴 {t("Hang up", "Colgar")}</button>}
        </>
      )}
      {ended && !calling && (
        <button className={className} onClick={call}>🔁 {t("Redial", "Rellamar")}</button>
      )}
      {status && <span className="sema" style={{ background: "var(--ink)", color: "#fff" }}>{label(status)}</span>}
    </span>
  );
}

// Driver-optimized delivery screen: large, glanceable delivery info + client
// contact with one-tap Call / Text / Navigate. "Call client" opens the phone's
// native dialer via a tel: link so the driver rings the customer instantly.
function DriverDeliveryScreen({
  order, settings, notify, t, actions,
}: {
  order: Delivery;
  settings: Settings;
  notify: (m: string) => void;
  t: (en: string, es: string) => string;
  /** The run buttons (start drive / pick up / deliver). Shown right under the
   * notes so they're reachable without scrolling to the modal footer. */
  actions?: React.ReactNode;
}) {
  const phone = telClean(order.delivery_phone);
  const hasPhone = phone.replace(/\D/g, "").length >= 7;
  const dest = (order.delivery_address || "").trim();
  const origin = (order.pickup_address || settings.stores.find((s) => s.name === order.store)?.address || order.store || "").trim();
  // An exact pin (manual or auto-geocoded) is more precise than the address
  // text — used for navigation whenever it's available.
  const hasPin = order.delivery_lat != null && order.delivery_lng != null;
  const destParam = hasPin ? `${order.delivery_lat},${order.delivery_lng}` : dest;
  const gmaps = "https://www.google.com/maps/dir/?api=1" + (origin ? `&origin=${encodeURIComponent(origin)}` : "") + `&destination=${encodeURIComponent(destParam)}&travelmode=driving`;
  const waze = hasPin
    ? `https://www.waze.com/ul?ll=${order.delivery_lat},${order.delivery_lng}&navigate=yes`
    : `https://www.waze.com/ul?q=${encodeURIComponent(dest)}&navigate=yes`;

  // Where the driver collects the load — the pickup point's own name if it has
  // one, otherwise the store it's sold from.
  const pickupPlace = order.pickup_name || order.store;

  return (
    <div className="drv-screen">
      {/* Step 1: collect. Stated up front so the driver knows where to start. */}
      <div className="drv-banner">
        <span className="drv-banner-step">1</span>
        <div>
          <div className="drv-banner-title">
            📦 {pickupPlace
              ? t(`Pick up in ${pickupPlace}`, `Recoger en ${pickupPlace}`)
              : t("Pick up", "Recoger")}
          </div>
          {origin && <div className="drv-banner-sub">{origin}</div>}
        </div>
        {origin && (
          <button
            className="btn btn-ghost btn-sm"
            onClick={() => window.open(`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(origin)}`, "_blank", "noopener")}
          >
            🧭
          </button>
        )}
      </div>

      {/* Step 2: deliver. */}
      <div className="drv-banner drv-banner-drop">
        <span className="drv-banner-step">2</span>
        <div>
          <div className="drv-banner-title">
            🚚 {order.account || order.delivery_name
              ? t(`Deliver to ${order.account || order.delivery_name}`, `Entregar a ${order.account || order.delivery_name}`)
              : t("Deliver", "Entregar")}
          </div>
          <div className="drv-banner-sub">
            {[order.delivery_name && order.delivery_name !== order.account ? order.delivery_name : null, dest]
              .filter(Boolean).join(" · ") || "—"}
          </div>
          {order.delivery_pin_source === "manual" && (
            <div className="drv-banner-sub" style={{ color: "var(--accent)", fontWeight: 700 }}>
              📍 {t("No formal address — an exact pin was dropped for this site. Navigate uses the pin.", "Sin dirección formal — se marcó un pin exacto para este sitio. Navegar usa el pin.")}
            </div>
          )}
        </div>
      </div>

      <div className="drv-row2">
        <div className="drv-block">
          <div className="drv-k">📅 {t("Date", "Fecha")}</div>
          <div className="drv-v">{order.delivery_date ? fmtDate(order.delivery_date) : "—"}</div>
        </div>
        <div className="drv-block">
          <div className="drv-k">⏰ {t("Time window", "Ventana")}</div>
          <div className="drv-v">{fmtWindows(order.delivery_windows)}</div>
        </div>
        <div className="drv-block">
          <div className="drv-k">📦 {t("Pallets", "Pallets")}</div>
          <div className="drv-v">{order.actual_pallets ?? order.est_pallets ?? "—"}</div>
        </div>
      </div>

      <div className="drv-block">
        <div className="drv-k">👤 {t("Client contact", "Contacto del cliente")}</div>
        <div className="drv-v">{order.contact || "—"}{hasPhone && <span className="drv-phone"> · {order.delivery_phone}</span>}</div>
      </div>

      {order.delivery_notes && (
        <div className="drv-block drv-notes">
          <div className="drv-k">📝 {t("Notes", "Notas")}</div>
          <div>{order.delivery_notes}</div>
        </div>
      )}

      {/* The run buttons live here, right after the notes — the driver's next
          action is the first thing in reach, not buried at the bottom. */}
      {actions && <div className="drv-run">{actions}</div>}

      {order.pickup_lat != null && order.pickup_lng != null && (
        <div className="drv-block">
          <div className="drv-k">📍 {t("Picked up at", "Recogido en")}</div>
          <a className="link-tel" href={mapLink(order.pickup_lat, order.pickup_lng)} target="_blank" rel="noopener noreferrer">
            {t("View pickup location", "Ver ubicación de recolección")}
          </a>
          {order.pickup_gps_at && <span className="hint"> · {fmtDateTime(order.pickup_gps_at)}</span>}
        </div>
      )}

      <div className="drv-actions">
        {hasPhone ? (
          <>
            <a className="btn btn-green drv-call" href={`tel:${phone}`}>📞 {t("Call client", "Llamar cliente")}</a>
            {settings.rc_calls_enabled && (
              <CallClientButton phone={phone} notify={notify} t={t} className="btn btn-primary drv-call" />
            )}
            <a className="btn btn-ghost drv-call" href={`sms:${phone}`}>💬 {t("Text", "Mensaje")}</a>
          </>
        ) : (
          // Same pill shape as the call/text buttons it replaces, so the row
          // stays even instead of dropping to loose grey text mid-way through.
          // Not a button: there's nothing to press, and it shouldn't invite a tap.
          <span className="btn drv-call drv-none" aria-disabled="true">
            📵 {t("No client phone", "Sin teléfono")}
          </span>
        )}
        {dest && (
          <>
            <button className="btn btn-primary drv-call" onClick={() => window.open(gmaps, "_blank", "noopener")}>🧭 {t("Navigate", "Navegar")}</button>
            <button className="btn btn-ghost drv-call" onClick={() => window.open(waze, "_blank", "noopener")}>Waze</button>
          </>
        )}
        {/* Live tracking link for the customer — same public /track page the
            office shares, so the driver can hand it over on the spot. */}
        <button className="btn btn-ghost drv-call" onClick={() => {
          const url = `${location.origin}/track/${order.id}`;
          navigator.clipboard?.writeText(url).then(
            () => notify(t("Tracking link copied", "Enlace de seguimiento copiado")),
            () => window.prompt(t("Copy this tracking link:", "Copie este enlace de seguimiento:"), url),
          );
        }}>🔗 {t("Copy tracking link", "Copiar enlace")}</button>
      </div>
    </div>
  );
}

// Share the live tracking link with the customer. Three ways:
//  • Text  — opens the phone's SMS app to the customer's number, pre-filled.
//  • WhatsApp — opens WhatsApp with the message ready to send.
//  • Auto SMS — sends server-side via /api/notify (Twilio). No-op with a clear
//    hint until TWILIO_* env vars are set.
function ShareTracking({
  order, enabled, notify, t,
}: {
  order: Delivery;
  /** Whether sending live tracking to the customer is turned on in Settings.
   * When off, no send buttons show — only the parent's "Copy tracking link". */
  enabled: boolean;
  notify: (m: string) => void;
  t: (en: string, es: string) => string;
}) {
  const [sending, setSending] = useState(false);
  // Which SMS provider (if any) the server is configured to send through.
  const [smsProvider, setSmsProvider] = useState<string | null | undefined>(undefined);
  const phoneDigits = telClean(order.delivery_phone).replace(/[^\d+]/g, "");
  const hasPhone = phoneDigits.replace(/\D/g, "").length >= 7;

  useEffect(() => {
    let alive = true;
    fetch("/api/notify")
      .then((r) => r.json())
      .then((d) => { if (alive) setSmsProvider(d.sms ?? null); })
      .catch(() => { if (alive) setSmsProvider(null); });
    return () => { alive = false; };
  }, []);

  const buildMessage = () => {
    const url = `${location.origin}/track/${order.id}`;
    const who = order.contact ? `${order.contact}, ` : "";
    // Include the estimated delivery date + time window when we have them.
    const date = order.delivery_date ? fmtDate(order.delivery_date) : "";
    const win = order.delivery_windows ? ` ${fmtWindows(order.delivery_windows)}` : "";
    const whenEn = date ? ` for ${date}${win}` : "";
    const whenEs = date ? ` para el ${date}${win}` : "";
    return t(
      `Hi ${who}your RDZ delivery #${orderLabel(order)} is scheduled${whenEn}. Track it live here: ${url}`,
      `Hola ${who}su entrega RDZ #${orderLabel(order)} está programada${whenEs}. Siga su estado aquí: ${url}`,
    );
  };

  const openSms = () => {
    const body = encodeURIComponent(buildMessage());
    // "sms:NUMBER?&body=..." is the form both iOS and Android accept.
    window.location.href = `sms:${phoneDigits}?&body=${body}`;
  };

  const openWhatsApp = () => {
    const num = phoneDigits.replace(/\D/g, "");
    window.open(`https://wa.me/${num}?text=${encodeURIComponent(buildMessage())}`, "_blank", "noopener");
  };

  const autoSms = async () => {
    setSending(true);
    try {
      const res = await fetch("/api/notify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ channel: "sms", to: phoneDigits, message: buildMessage() }),
      });
      const body = await res.json().catch(() => ({}));
      if (body.ok) notify(t(`Tracking SMS sent via ${body.provider || "SMS"}`, `SMS de seguimiento enviado por ${body.provider || "SMS"}`));
      else if (body.dryRun) notify(t("RingCentral isn’t set up yet — add the keys in .env.local and restart.", "RingCentral aún no está configurado — agregue las claves en .env.local y reinicie."));
      else notify(body.error || t("Could not send SMS", "No se pudo enviar el SMS"));
    } catch {
      notify(t("Network error sending SMS", "Error de red al enviar el SMS"));
    } finally {
      setSending(false);
    }
  };

  const configured = smsProvider != null;

  // Live-tracking sending turned off in Settings → hide the whole send section
  // (Send SMS / WhatsApp / SMS app). The parent still offers "Copy tracking link".
  if (!enabled) return null;

  return (
    <div style={{ marginTop: 14 }}>
      <div className="section-label" style={{ marginTop: 0 }}>{t("Send live tracking to customer", "Enviar seguimiento al cliente")}</div>
      {hasPhone ? (
        <>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
            {/* Primary path: server-side send — works on desktop, no phone app needed. */}
            <button className="btn btn-primary btn-sm" onClick={autoSms} disabled={sending || smsProvider === undefined}
              title={configured ? t("Send now via RingCentral", "Enviar ahora por RingCentral") : t("Set up RingCentral in .env.local first", "Configure RingCentral en .env.local primero")}>
              {sending ? t("Sending…", "Enviando…") : `📨 ${t("Send SMS", "Enviar SMS")}${smsProvider ? ` (${smsProvider})` : ""}`}
            </button>
            <button className="btn btn-green btn-sm" onClick={openWhatsApp}>🟢 WhatsApp</button>
            {/* sms: only helps on a phone; offered as a secondary "open SMS app". */}
            <button className="btn btn-ghost btn-sm" onClick={openSms} title={t("Opens your device's SMS app (phone only)", "Abre la app de SMS del dispositivo (solo teléfono)")}>💬 {t("SMS app", "App SMS")}</button>
          </div>
          <div className="hint" style={{ marginTop: 6 }}>
            {smsProvider === undefined
              ? t("Checking SMS setup…", "Comprobando configuración de SMS…")
              : configured
                ? t(`✅ Server SMS is ready (${smsProvider}) — “Send SMS” delivers straight from your desktop.`, `✅ SMS por servidor listo (${smsProvider}) — “Enviar SMS” envía directamente desde el escritorio.`)
                : t("⚠ RingCentral not configured — “Send SMS” won’t work from the desktop until you add the keys in .env.local and restart. WhatsApp works now.", "⚠ RingCentral no configurado — “Enviar SMS” no funcionará desde el escritorio hasta agregar las claves en .env.local y reiniciar. WhatsApp funciona ahora.")}
          </div>
        </>
      ) : (
        <div className="hint">{t("Add a delivery phone number to text the customer their tracking link.", "Agregue un teléfono de entrega para enviar el enlace de seguimiento al cliente.")}</div>
      )}
    </div>
  );
}

// One-tap navigation: hands the trip (pickup → delivery) off to the driver's
// maps app. Google Maps builds full turn-by-turn directions from origin →
// destination; Waze navigates to the dropoff. Opens the native app on a phone.
function NavButtons({ origin, destination, t }: { origin: string; destination: string; t: (en: string, es: string) => string }) {
  const gmaps =
    "https://www.google.com/maps/dir/?api=1" +
    (origin ? `&origin=${encodeURIComponent(origin)}` : "") +
    `&destination=${encodeURIComponent(destination)}&travelmode=driving`;
  const waze = `https://www.waze.com/ul?q=${encodeURIComponent(destination)}&navigate=yes`;
  const open = (url: string) => window.open(url, "_blank", "noopener");
  return (
    <div style={{ marginTop: 14 }}>
      <div className="section-label" style={{ marginTop: 0 }}>{t("Navigation", "Navegación")}</div>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <button className="btn btn-primary" onClick={() => open(gmaps)}>🧭 {t("Navigate (Google Maps)", "Navegar (Google Maps)")}</button>
        <button className="btn btn-ghost" onClick={() => open(waze)}>{t("Open in Waze", "Abrir en Waze")}</button>
      </div>
      <div className="hint">{t("Opens your maps app with the route to the delivery.", "Abre tu app de mapas con la ruta a la entrega.")}</div>
    </div>
  );
}

// Human label for an activity-log event. Stage kinds reuse the stage labels;
// created/edited get their own wording.
function eventLabel(kind: string, lang: "en" | "es"): string {
  if (kind === "created") return lang === "es" ? "Creada" : "Created";
  if (kind === "edited") return lang === "es" ? "Editada" : "Edited";
  if (kind === "note") return lang === "es" ? "💬 Nota" : "💬 Note";
  const s = stageInfo(kind);
  if (s.key === kind) return stageLabel(kind, lang);
  return kind.charAt(0).toUpperCase() + kind.slice(1);
}

// ---- Small field helpers --------------------------------------------------
function Txt({ label, val, on, type = "text", disabled, placeholder, invalid }: {
  label: string; val: unknown; on: (v: string) => void; type?: string; disabled?: boolean; placeholder?: string; invalid?: boolean;
}) {
  return (
    <div className="field">
      <label>{label}{invalid && <span className="req-star"> *</span>}</label>
      <input className={invalid ? "invalid" : ""} type={type} value={(val as string) ?? ""} disabled={disabled} placeholder={placeholder}
        onChange={(e) => on(e.target.value)} />
    </div>
  );
}

const NEW_ACCOUNT = "__new__";

/** Account — same "pick a saved one, or type a new one" pattern as the
 * Dropoff field. Options are every account name already seen; the parent's
 * `on` callback looks up a saved contact/phone for the picked name and
 * fills those fields too, the same way a saved pickup/dropoff fills its
 * address. */
function AccountCombo({ val, on, options, disabled, placeholder, t }: {
  val: unknown; on: (v: string) => void;
  options: string[]; disabled?: boolean; placeholder?: string;
  t: (en: string, es: string) => string;
}) {
  const current = (val as string) ?? "";
  const known = options.includes(current);
  const [manual, setManual] = useState(!!current && !known);

  return (
    <div className="field">
      <label>{t("Account", "Cuenta")}</label>
      {manual ? (
        <div style={{ display: "flex", gap: 8 }}>
          <input value={current} disabled={disabled} placeholder={placeholder} onChange={(e) => on(e.target.value)} />
          {options.length > 0 && (
            <button className="btn btn-ghost btn-sm" disabled={disabled} onClick={() => { setManual(false); on(""); }}>
              {t("Pick saved", "Elegir guardado")}
            </button>
          )}
        </div>
      ) : (
        <select
          value={known ? current : ""}
          disabled={disabled}
          onChange={(e) => {
            if (e.target.value === NEW_ACCOUNT) { setManual(true); on(""); return; }
            on(e.target.value);
          }}
        >
          <option value="">{placeholder ?? t("Select…", "Seleccione…")}</option>
          {options.map((o) => <option key={o} value={o}>{o}</option>)}
          <option value={NEW_ACCOUNT}>➕ {t("Type a new one…", "Escribir uno nuevo…")}</option>
        </select>
      )}
    </div>
  );
}

/** Delivery Time Windows — a fixed preset list (Early Morning / Morning /
 * Afternoon / All Day) instead of free text. Falls back to showing the raw
 * value as a "Custom" option so existing orders with a non-preset window
 * (e.g. from before this changed) still display correctly. */
function WindowSel({ val, on, disabled, invalid, t }: {
  val: unknown; on: (v: string) => void; disabled?: boolean; invalid?: boolean; t: (en: string, es: string) => string;
}) {
  const current = (val as string) ?? "";
  const isCustom = current && !DELIVERY_WINDOW_PRESETS.some((p) => p.value === current);
  return (
    <div className="field">
      <label>{t("Delivery Time Window", "Ventana de Entrega")}{invalid && <span className="req-star"> *</span>}</label>
      <select className={invalid ? "invalid" : ""} value={current} disabled={disabled} onChange={(e) => on(e.target.value)}>
        <option value="">{t("Select a window…", "Seleccione una ventana…")}</option>
        {DELIVERY_WINDOW_PRESETS.map((p) => <option key={p.key} value={p.value}>{t(p.en, p.es)}</option>)}
        {isCustom && <option value={current}>{t("Custom", "Personalizada")}: {current}</option>}
      </select>
    </div>
  );
}

function Sel({ label, val, opts, on, disabled, placeholder, invalid }: {
  label: string; val: unknown; opts: string[]; on: (v: string) => void; disabled?: boolean; placeholder?: string; invalid?: boolean;
}) {
  const list = useMemo(() => opts ?? [], [opts]);
  return (
    <div className="field">
      <label>{label}{invalid && <span className="req-star"> *</span>}</label>
      <select className={invalid ? "invalid" : ""} value={(val as string) ?? ""} disabled={disabled} onChange={(e) => on(e.target.value)}>
        <option value="">{placeholder ?? "—"}</option>
        {list.map((o) => <option key={o} value={o}>{o}</option>)}
      </select>
    </div>
  );
}

export { fmtMilitary };
