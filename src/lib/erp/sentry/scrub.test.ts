import { describe, it, expect } from "vitest";
import { scrubData, scrubString, scrubEvent, type ScrubbableEvent } from "./scrub";

describe("scrubString", () => {
  it("redacts currency amounts in free text", () => {
    expect(scrubString("order total $1,100.32 paid")).toBe("order total [$] paid");
    expect(scrubString("cost was $5.50 each")).toBe("cost was [$] each");
    expect(scrubString("no money here")).toBe("no money here");
  });
});

describe("scrubData — key redaction (deep)", () => {
  it("redacts cost / margin / price / unit_price values", () => {
    const out = scrubData({ cost: 5.5, store_cost: 4, margin: 0.3, unit_price: 10.58, list_price: 12, name: "Tile" });
    expect(out.cost).toBe("[redacted]");
    expect(out.store_cost).toBe("[redacted]");
    expect(out.margin).toBe("[redacted]");
    expect(out.unit_price).toBe("[redacted]");
    expect(out.list_price).toBe("[redacted]");
    expect(out.name).toBe("Tile"); // non-sensitive survives
  });
  it("redacts customer name / PO + secrets / tokens / auth", () => {
    const out = scrubData({
      customer_name: "ACME Tile Co",
      customer_po: "15202",
      service_role_key: "sk_live_xyz",
      authorization: "Bearer abc",
      api_key: "k",
      SUPABASE_DB_URL: "postgres://u:p@h/db",
      product: "ok",
    });
    expect(out.customer_name).toBe("[redacted]");
    expect(out.customer_po).toBe("[redacted]");
    expect(out.service_role_key).toBe("[redacted]");
    expect(out.authorization).toBe("[redacted]");
    expect(out.api_key).toBe("[redacted]");
    expect(out.SUPABASE_DB_URL).toBe("[redacted]");
    expect(out.product).toBe("ok");
  });
  it("recurses through nested objects and arrays", () => {
    const out = scrubData({ a: { b: [{ cost: 1 }, { ok: "$9.99" }] } }) as {
      a: { b: Array<Record<string, unknown>> };
    };
    expect(out.a.b[0].cost).toBe("[redacted]");
    expect(out.a.b[1].ok).toBe("[$]"); // money in a string nested deep
  });
});

describe("scrubEvent — the full Sentry payload", () => {
  it("strips cost + customer fields from extra / request body / breadcrumbs and PII identity", () => {
    const event: ScrubbableEvent = {
      message: "failed on total $1,100.32",
      user: { id: 7, /* simulate accidental PII */ ...({ email: "x@y.com", ip_address: "1.2.3.4" } as object) },
      request: {
        cookies: { sb: "secret" },
        headers: { authorization: "Bearer abc", "content-type": "application/json" },
        data: { customer_name: "ACME", customer_po: "15202", unit_price: 10.58, sku: "PLG2030" },
        query_string: "q=carrara&amount=$500.00",
      },
      extra: { cost: 4.25, note: "ok", margin: 0.4 },
      contexts: { order: { total: "$1,100.32", store_cost: 3.1 } },
      exception: { values: [{ value: "boom: customer ACME owes $1,100.32" }] },
      breadcrumbs: [{ message: "POST /api total $99.99", data: { price: 12, label: "x" } }],
    };
    const out = scrubEvent(event);

    // PII identity reduced to an opaque id
    expect(out.user).toEqual({ id: 7 });
    expect(JSON.stringify(out)).not.toContain("x@y.com");
    expect(JSON.stringify(out)).not.toContain("1.2.3.4");

    // request: cookies dropped, auth header + body cost/customer redacted, money in query stripped
    expect(out.request!.cookies).toBeUndefined();
    expect((out.request!.headers as Record<string, string>).authorization).toBe("[redacted]");
    const data = out.request!.data as Record<string, string>;
    expect(data.customer_name).toBe("[redacted]");
    expect(data.customer_po).toBe("[redacted]");
    expect(data.unit_price).toBe("[redacted]");
    expect(data.sku).toBe("PLG2030"); // non-sensitive survives
    expect(out.request!.query_string).toBe("q=carrara&amount=[$]");

    // extra / contexts
    expect(out.extra!.cost).toBe("[redacted]");
    expect(out.extra!.margin).toBe("[redacted]");
    expect(out.extra!.note).toBe("ok");
    expect((out.contexts!.order as Record<string, string>).store_cost).toBe("[redacted]");
    expect((out.contexts!.order as Record<string, string>).total).toBe("[$]");

    // messages: currency stripped from message + exception value + breadcrumb
    expect(out.message).toBe("failed on total [$]");
    expect(out.exception!.values![0].value).toBe("boom: customer ACME owes [$]");
    expect(out.breadcrumbs![0].message).toBe("POST /api total [$]");
    expect((out.breadcrumbs![0].data as Record<string, string>).price).toBe("[redacted]");

    // the hard guarantee: no dollar figure survives anywhere in the serialized payload
    expect(JSON.stringify(out)).not.toMatch(/\$\s?\d/);
    expect(JSON.stringify(out)).not.toContain("10.58");
    expect(JSON.stringify(out)).not.toContain("1,100.32");
  });
});
