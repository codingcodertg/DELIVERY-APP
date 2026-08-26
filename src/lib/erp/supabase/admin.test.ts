import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { adminKey } from "./admin";

/**
 * The regression these cover: this project's legacy `service_role` JWT was disabled, so every
 * service-role call started returning 401. Nothing said so — the PO page just stopped showing its
 * documents and dropped PDFs stopped being archived. The resolver now prefers the modern key and
 * refuses loudly when there is none, instead of handing `undefined` to the client.
 */
describe("adminKey", () => {
  const saved = { ...process.env };

  beforeEach(() => {
    delete process.env.SUPABASE_SECRET_KEY;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  });
  afterEach(() => {
    process.env = { ...saved };
    vi.restoreAllMocks();
  });

  it("prefers the modern secret key when both are set", () => {
    process.env.SUPABASE_SECRET_KEY = "sb_secret_modern";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "eyJlegacy";
    expect(adminKey()).toBe("sb_secret_modern");
  });

  it("falls back to the legacy name so an un-updated environment still runs", () => {
    process.env.SUPABASE_SERVICE_ROLE_KEY = "sb_secret_via_old_name";
    expect(adminKey()).toBe("sb_secret_via_old_name");
  });

  it("warns once when the fallback value is a legacy JWT, which is disabled on this project", async () => {
    // A fresh module, so the once-only flag is not carried in from another test in this file.
    vi.resetModules();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    process.env.SUPABASE_SERVICE_ROLE_KEY = "eyJhbGciOiJIUzI1NiJ9.x.y";

    const fresh = await import("./admin");
    expect(fresh.adminKey()).toBe("eyJhbGciOiJIUzI1NiJ9.x.y");
    fresh.adminKey();

    // Once, not per call: a warning on every upload is a warning nobody reads.
    expect(warn).toHaveBeenCalledOnce();
    expect(String(warn.mock.calls[0]?.[0])).toContain("SUPABASE_SECRET_KEY");
  });

  it("throws a named error rather than passing undefined to createClient", () => {
    expect(() => adminKey()).toThrow(/SUPABASE_SECRET_KEY/);
  });

  it("treats a blank value as absent", () => {
    process.env.SUPABASE_SECRET_KEY = "   ";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "sb_secret_real";
    expect(adminKey()).toBe("sb_secret_real");
  });
});
