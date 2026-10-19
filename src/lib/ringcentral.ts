// ============================================================
// Server-side RingCentral helper (JWT auth). Shared by the SMS (/api/notify)
// and click-to-call (/api/call) routes. Uses plain fetch — no SDK needed.
// ============================================================

const RC_SERVER = process.env.RINGCENTRAL_SERVER || "https://platform.ringcentral.com";

export function ringcentralConfigured(): boolean {
  return !!(process.env.RINGCENTRAL_CLIENT_ID && process.env.RINGCENTRAL_CLIENT_SECRET && process.env.RINGCENTRAL_JWT);
}

/** Exchange the JWT for a short-lived access token (RingCentral "private app" flow). */
export async function ringcentralToken(): Promise<string> {
  const id = process.env.RINGCENTRAL_CLIENT_ID!;
  const secret = process.env.RINGCENTRAL_CLIENT_SECRET!;
  const jwt = process.env.RINGCENTRAL_JWT!;
  const res = await fetch(`${RC_SERVER}/restapi/oauth/token`, {
    method: "POST",
    headers: {
      Authorization: "Basic " + Buffer.from(`${id}:${secret}`).toString("base64"),
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: jwt }).toString(),
  });
  if (!res.ok) throw new Error(`RingCentral auth failed (${res.status})`);
  return (await res.json()).access_token as string;
}

/** Send an SMS from the configured RingCentral number. */
export async function ringcentralSms(to: string, text: string): Promise<void> {
  const token = await ringcentralToken();
  const res = await fetch(`${RC_SERVER}/restapi/v1.0/account/~/extension/~/sms`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: { phoneNumber: process.env.RINGCENTRAL_FROM }, to: [{ phoneNumber: to }], text }),
  });
  if (!res.ok) throw new Error(`RingCentral SMS failed (${res.status}): ${await res.text().catch(() => "")}`);
}

/** Place a RingOut call: rings `from` first, then connects it to `to`.
 * Returns the call id + status so the caller can poll progress. */
export async function ringcentralRingOut(from: string, to: string): Promise<{ id: string; status: string }> {
  const token = await ringcentralToken();
  const res = await fetch(`${RC_SERVER}/restapi/v1.0/account/~/extension/~/ring-out`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: { phoneNumber: from }, to: { phoneNumber: to }, playPrompt: false }),
  });
  if (!res.ok) throw new Error(`RingCentral call failed (${res.status}): ${await res.text().catch(() => "")}`);
  const data = await res.json();
  return { id: String(data?.id ?? ""), status: data?.status?.callStatus ?? "InProgress" };
}

/** Cancel / hang up an in-progress RingOut call. */
export async function ringcentralRingOutCancel(id: string): Promise<void> {
  const token = await ringcentralToken();
  const res = await fetch(`${RC_SERVER}/restapi/v1.0/account/~/extension/~/ring-out/${id}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${token}` },
  });
  // 204 = cancelled; 404/business-error can mean it already ended — treat as done.
  if (!res.ok && res.status !== 404) throw new Error(`RingCentral hang-up failed (${res.status})`);
}

/** Poll the live status of a RingOut call (InProgress / Success / Busy / NoAnswer …). */
export async function ringcentralRingOutStatus(id: string): Promise<{ callStatus: string; callerStatus?: string; calleeStatus?: string }> {
  const token = await ringcentralToken();
  const res = await fetch(`${RC_SERVER}/restapi/v1.0/account/~/extension/~/ring-out/${id}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`RingCentral status failed (${res.status}): ${await res.text().catch(() => "")}`);
  const data = await res.json();
  return { callStatus: data?.status?.callStatus ?? "Unknown", callerStatus: data?.status?.callerStatus, calleeStatus: data?.status?.calleeStatus };
}

/** La agenda personal de la extensión del JWT (hasta 250 contactos: la de «Careers» empieza vacía). Lee, no escribe. */
export async function ringcentralContacts(): Promise<Record<string, unknown>[]> {
  const token = await ringcentralToken();
  const res = await fetch(`${RC_SERVER}/restapi/v1.0/account/~/extension/~/address-book/contact?perPage=250`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`RingCentral contacts failed (${res.status})`);
  return ((await res.json()).records ?? []) as Record<string, unknown>[];
}

/** Crea un contacto en esa misma agenda (D-591: el candidato al llamarlo o textearle). */
export async function ringcentralAddContact(contact: Record<string, string>): Promise<void> {
  const token = await ringcentralToken();
  const res = await fetch(`${RC_SERVER}/restapi/v1.0/account/~/extension/~/address-book/contact`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(contact),
  });
  if (!res.ok) throw new Error(`RingCentral add contact failed (${res.status})`);
}
