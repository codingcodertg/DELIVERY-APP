import { describe, it, expect } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { pdfToLayoutText } from "@/lib/erp/server/pdf";
import { parseDocument, type ParsedPo, type ParsedAck } from "@/lib/erp/domain/po-parse";

// End-to-end PDF→text→parse proof against the two REAL PLG documents. Point PLG_PO_PDF / PLG_ACK_PDF
// at the files to run it (e.g. the originals in ~/Downloads); it auto-skips when they're absent, so
// CI (which has no PDFs) stays green. This guards the unpdf layout reconstruction + the parser
// together, reproducing the documented price/qty/total discrepancy inputs.
const PO = process.env.PLG_PO_PDF;
const ACK = process.env.PLG_ACK_PDF;
const ready = !!PO && !!ACK && existsSync(PO) && existsSync(ACK);

describe.skipIf(!ready)("PDF ingestion (real PLG documents)", () => {
  it("extracts + parses PO 12428 (per-box)", async () => {
    const doc = parseDocument(await pdfToLayoutText(readFileSync(PO!))) as ParsedPo;
    expect(doc?.kind).toBe("po");
    expect(doc.header.po_number).toBe("12428");
    expect(doc.header.total).toBe(10083.09);
    expect(doc.lines).toHaveLength(2);
    expect(doc.lines.map((l) => l.vendor_item_no)).toEqual(["ATRANEW19CI", "PMONNUE19CI"]);
    expect(doc.lines.map((l) => l.qty)).toEqual([540, 528]);
    expect(doc.lines.every((l) => l.uom === "BOX" && l.unit_rate === 9.4411)).toBe(true);
  });

  it("extracts + parses acknowledgment 1004963324 (per-PI2, wrapped descriptions)", async () => {
    const doc = parseDocument(await pdfToLayoutText(readFileSync(ACK!))) as ParsedAck;
    expect(doc?.kind).toBe("ack");
    expect(doc.header.ack_document_no).toBe("1004963324");
    expect(doc.header.po_number).toBe("12428"); // links to its PO
    expect(doc.header.incoterm).toBe("ZD3 DDP Brownsville TX");
    expect(doc.header.total).toBe(12096.95);
    expect(doc.lines).toHaveLength(2);
    expect(doc.lines.map((l) => l.item_no)).toEqual(["ATRANEW19CI", "PMONNUE19CI"]);
    expect(doc.lines.map((l) => l.unit_price)).toEqual([0.49, 0.6]);
    expect(doc.lines.map((l) => l.boxes)).toEqual([576, 576]);
    expect(doc.lines[0].description).toContain("GRAY 1A"); // wrapped continuation merged
  });

  it("the parsed pair reproduces the documented total gap (~$2,013.86)", async () => {
    const po = parseDocument(await pdfToLayoutText(readFileSync(PO!))) as ParsedPo;
    const ack = parseDocument(await pdfToLayoutText(readFileSync(ACK!))) as ParsedAck;
    expect((ack.header.total as number) - (po.header.total as number)).toBeCloseTo(2013.86, 2);
  });
});
