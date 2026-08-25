import { describe, it, expect } from "vitest";
import {
  num,
  isNumericToken,
  isMpnToken,
  isUnitWord,
  parseUsDate,
  parseEuDate,
  parsePoLine,
  parseAckLine,
  parseDocument,
  type ParsedPo,
  type ParsedAck,
} from "@/lib/erp/domain/po-parse";

// Fixtures mirror the two REAL RTG documents — PO 12428 (Rodriguez → PLG) and its Acknowledgment
// 1004963324 (PLG/Lamosa → Rodriguez) — as `pdftotext -layout` renders them (label:value header
// rows, space-separated line tables). Values are the documented ones (per-box on the PO, per-PI2 on
// the proforma), so these double as the discrepancy-matcher fixtures.
const PO_TEXT = `
                                                       Purchase Order

Rodriguez Home Center LLC                  Date        P.O. No.
3913 N Expressway                          6/5/2026    12428
Brownsville, TX 78520

     Vendor
     PLG CERAMICS, INC.

     Ship To
     Rodriguez Home Center LLC
     3913 N. Expressway
     Brownsville TX

                                                       Buyer
                                                       GS

   Vendor #      Description                            QTY    U/M    Rate      Amount
   ATRANEW19CI   8X36 TRAPLANK FD US GRAY 1A            540    BOX    9.4411    5,098.19
   PMONNUE19CI   20X90 MADERA MONTALVO FD GRIS 1A NEW   528    BOX    9.4411    4,984.90

                                                       Total    $10,083.09
`;

const ACK_TEXT = `
                       ACKNOWLEDGMENT OF ORDER
                           PLG CERAMICS

United States Ceramic Tile INC. dba PLG Ceramics
5904 WEST DR., STE. 14
LAREDO US TX 78041
Tel: (214)647-0250 Fax:

CUSTOMER:        10100172 RODRIGUEZ HOME CENTER     PAGE:            1 of 1
SHIP TO:         10100172 RODRIGUEZ HOME CENTER     DOCUMENT NO.:    1004963324
ORDER TYPE:      ZEUS Export terrestrial O          DOCUMENT DATE:   10.06.2026
PURCHASE ORDER:  12428                              VALID FROM - TO: 00.00.0000 - 00.00.0000
CURRENCY:        USD United States Dollar           INCOTERM:        ZD3 DDP Brownsville TX
                                                    PAYMENTCOND:     D107 105 DAYS INVOICE DATE
                                                    SALESPERSON:     JUAN ARTURO ALTAMIRANO
                                                    SPECIFIER:

LINE  ITEM         CUSTOMER ITEM  DESCRIPTION       UM   QUANTITY    PRICE   AMOUNT    BOXES   WEIGHT       WEIGHT (lbs)  PALLET F.  PALLETS
10    ATRANEW19CI                 8X36 TRAPLANK FD US  PI2  11,098.12   0.49    5,438.08  576.00  20,681.632   45,595.231   64.44 M2   16.0
                                  GRAY 1A
20    PMONNUE19CI                 20X90 MADERA MONTALVO  PI2  11,098.12   0.60    6,658.87  576.00  19,442.321   42,863.016   85.92 M2   12.0
                                  FD GRIS 1A
                                  TOTAL                       22,196.24          12,096.95  1,152.00 40,123.953   88,458.247              28.0

                                          MERCHANDISE VALUE   12,096.95
                                          HANDLING            0.00
                                          HANDLING - BONUS    0.00
                                          FLETE               0.00
                                          SUB-TOTAL           12,096.95
                                          IVA          0 %    0.00
                                          TOTAL               12,096.95

SHIP TO ADDRESS
3913 N EXPRESS WAY 83
78520
BROWNSVILLE
Texas                                     SPECIAL INSTRUCTIONS:
`;

describe("token classifiers", () => {
  it("num() tolerates $, commas, %", () => {
    expect(num("$10,083.09")).toBe(10083.09);
    expect(num("11,098.12")).toBe(11098.12);
    expect(num("0 %")).toBe(0);
    expect(num("")).toBeNull();
    expect(num("abc")).toBeNull();
  });
  it("isNumericToken rejects sizes/grades but accepts decorated numbers", () => {
    expect(isNumericToken("5,098.19")).toBe(true);
    expect(isNumericToken("576.00")).toBe(true);
    expect(isNumericToken("8X36")).toBe(false);
    expect(isNumericToken("1A")).toBe(false);
  });
  it("isMpnToken matches PLG MPNs, rejects words/units/sizes", () => {
    expect(isMpnToken("ATRANEW19CI")).toBe(true);
    expect(isMpnToken("PMONNUE19CI")).toBe(true);
    expect(isMpnToken("BOX")).toBe(false);
    expect(isMpnToken("MADERA")).toBe(false);
    expect(isMpnToken("8X36")).toBe(false);
    expect(isMpnToken("1A")).toBe(false);
    expect(isMpnToken("ZD3")).toBe(false); // too short
  });
  it("isUnitWord knows BOX and PI2", () => {
    expect(isUnitWord("BOX")).toBe(true);
    expect(isUnitWord("pi2")).toBe(true);
    expect(isUnitWord("MADERA")).toBe(false);
  });
  it("date parsers: US M/D/Y and European D.M.Y", () => {
    expect(parseUsDate("6/5/2026")).toBe("2026-06-05");
    expect(parseEuDate("10.06.2026")).toBe("2026-06-10"); // 10 June, not Oct 6
  });
});

describe("parsePoLine (per-box)", () => {
  it("parses an MPN-first row", () => {
    const l = parsePoLine("ATRANEW19CI   8X36 TRAPLANK FD US GRAY 1A   540   BOX   9.4411   5,098.19");
    expect(l).toMatchObject({
      vendor_item_no: "ATRANEW19CI",
      qty: 540,
      uom: "BOX",
      unit_rate: 9.4411,
      amount: 5098.19,
    });
    expect(l?.description).toContain("TRAPLANK");
  });
  it("is robust to PDF copy-paste reordering (description after amount)", () => {
    const l = parsePoLine("ATRANEW19CI 540 BOX 9.4411 5,098.19 8X36 TRAPLANK FD US GRAY 1A");
    expect(l).toMatchObject({ vendor_item_no: "ATRANEW19CI", qty: 540, uom: "BOX", unit_rate: 9.4411, amount: 5098.19 });
  });
  it("returns null for header / non-item rows", () => {
    expect(parsePoLine("   Vendor #   Description   QTY   U/M   Rate   Amount")).toBeNull();
    expect(parsePoLine("Total    $10,083.09")).toBeNull();
  });
});

describe("parseAckLine (per-PI2)", () => {
  it("maps the 8 trailing numeric columns positionally, skipping the M2 unit label", () => {
    const l = parseAckLine(
      "10    ATRANEW19CI    8X36 TRAPLANK FD US GRAY 1A    PI2   11,098.12   0.49   5,438.08   576.00   20,681.632   45,595.231   64.44 M2   16.0"
    );
    expect(l).toMatchObject({
      line_no: 10,
      item_no: "ATRANEW19CI",
      uom: "PI2",
      quantity: 11098.12,
      unit_price: 0.49,
      amount: 5438.08,
      boxes: 576,
      weight_kg: 20681.632,
      weight_lbs: 45595.231,
      pallet_factor_m2: 64.44,
      pallets: 16,
    });
  });
});

describe("parseDocument — full PLG PO", () => {
  const doc = parseDocument(PO_TEXT) as ParsedPo;
  it("detects the PO format", () => {
    expect(doc).not.toBeNull();
    expect(doc.kind).toBe("po");
  });
  it("reads the header", () => {
    expect(doc.header.po_number).toBe("12428");
    expect(doc.header.po_date).toBe("2026-06-05");
    expect(doc.header.buyer_user).toBe("GS");
    expect(doc.header.vendor_name).toMatch(/PLG CERAMICS/);
    expect(doc.header.total).toBe(10083.09);
  });
  it("reads exactly the two line items, amounts summing to the total", () => {
    expect(doc.lines).toHaveLength(2);
    expect(doc.lines.map((l) => l.vendor_item_no)).toEqual(["ATRANEW19CI", "PMONNUE19CI"]);
    expect(doc.lines.map((l) => l.line_no)).toEqual([1, 2]);
    const sum = doc.lines.reduce((s, l) => s + (l.amount ?? 0), 0);
    expect(sum).toBeCloseTo(10083.09, 2);
    expect(doc.warnings).toHaveLength(0);
  });
});

describe("parseDocument — full PLG acknowledgment", () => {
  const doc = parseDocument(ACK_TEXT) as ParsedAck;
  it("detects the ack format", () => {
    expect(doc).not.toBeNull();
    expect(doc.kind).toBe("ack");
  });
  it("reads the header (incl. incoterm, payment terms, totals)", () => {
    expect(doc.header.ack_document_no).toBe("1004963324");
    expect(doc.header.po_number).toBe("12428");
    expect(doc.header.ack_date).toBe("2026-06-10");
    expect(doc.header.customer_no).toBe("10100172");
    expect(doc.header.currency).toBe("USD");
    expect(doc.header.incoterm).toBe("ZD3 DDP Brownsville TX");
    expect(doc.header.payment_terms).toMatch(/D107/);
    expect(doc.header.salesperson).toBe("JUAN ARTURO ALTAMIRANO");
    expect(doc.header.order_type).toMatch(/ZEUS Export terrestrial/);
    expect(doc.header.merchandise_value).toBe(12096.95);
    expect(doc.header.iva_pct).toBe(0);
    expect(doc.header.total).toBe(12096.95);
  });
  it("reads exactly the two line items with per-PI2 prices and box counts", () => {
    expect(doc.lines).toHaveLength(2);
    expect(doc.lines.map((l) => l.item_no)).toEqual(["ATRANEW19CI", "PMONNUE19CI"]);
    expect(doc.lines.map((l) => l.unit_price)).toEqual([0.49, 0.6]);
    expect(doc.lines.map((l) => l.boxes)).toEqual([576, 576]);
    expect(doc.lines.map((l) => l.line_no)).toEqual([10, 20]);
  });
  it("merges wrapped description continuation lines into their item (not a new line)", () => {
    // The fixture wraps each description across two text lines, as `pdftotext -layout` does.
    expect(doc.lines).toHaveLength(2); // "GRAY 1A" / "FD GRIS 1A" did not become phantom lines
    expect(doc.lines[0].description).toBe("8X36 TRAPLANK FD US GRAY 1A");
    expect(doc.lines[1].description).toBe("20X90 MADERA MONTALVO FD GRIS 1A");
  });
});

describe("the parsed pair reproduces the documented discrepancies", () => {
  // Sanity check on the parsed numbers (the authoritative matcher is the DB RPC po_recon_rows).
  const po = parseDocument(PO_TEXT) as ParsedPo;
  const ack = parseDocument(ACK_TEXT) as ParsedAck;
  const SF_PER_BOX = 19.26; // products.sf_per_box for both fixture SKUs

  it("MONTALVO is overcharged per-PI2, TRAPLANK is not", () => {
    const poImplied = (mpn: string) => (po.lines.find((l) => l.vendor_item_no === mpn)!.unit_rate as number) / SF_PER_BOX;
    const ackPrice = (mpn: string) => ack.lines.find((l) => l.item_no === mpn)!.unit_price as number;
    expect(poImplied("ATRANEW19CI")).toBeCloseTo(0.49, 2); // ≈ ack 0.49 → no gap
    expect(ackPrice("PMONNUE19CI") / poImplied("PMONNUE19CI") - 1).toBeGreaterThan(0.2); // >20% overcharge
  });
  it("the order total gap is ~$2,013.86", () => {
    expect((ack.header.total as number) - (po.header.total as number)).toBeCloseTo(2013.86, 2);
  });
});
