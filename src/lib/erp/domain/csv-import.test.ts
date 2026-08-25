// Regression lock for the CSV import port (ADR 0010).
//
// Expectations produced by the ORIGINAL implementation. The parser cases are the ones where a naive
// split(",") implementation quietly corrupts data rather than failing: a comma inside quotes, an
// escaped double-quote, a newline inside a quoted field, and CRLF endings — all of which a real
// exported spreadsheet contains.
//
// The mapping cases cover the normalisations that let a re-imported export round-trip: "$1,250.00"
// back to 1250, "08:30-17:30" back to "0830-1730", and a US-format date back to ISO.
import { test, expect } from "vitest";
import { parseCSV, mapRowsToDrafts } from "./csv-import";

const LF = String.fromCharCode(10);
const CR = String.fromCharCode(13);

const EXPECTED: string[] = [
  "csv|simple|[[\"a\",\"b\",\"c\"],[\"1\",\"2\",\"3\"]]",
  "csv|quoted-comma|[[\"a\",\"b\"],[\"x, y\",\"z\"]]",
  "csv|escaped-quote|[[\"a\"],[\"say \\\"hi\\\"\"]]",
  "csv|newline-in-quotes|[[\"a\",\"b\"],[\"line1\\nline2\",\"z\"]]",
  "csv|crlf|[[\"a\",\"b\"],[\"1\",\"2\"]]",
  "csv|trailing-newline|[[\"a\",\"b\"],[\"1\",\"2\"]]",
  "csv|blank-lines|[[\"a\",\"b\"],[\"1\",\"2\"]]",
  "csv|empty-fields|[[\"a\",\"b\",\"c\"]]",
  "csv|empty-string|[]",
  "csv|only-headers|[[\"a\",\"b\",\"c\"]]",
  "csv|ragged|[[\"a\",\"b\",\"c\"],[\"1\",\"2\"]]",
  "csv|quoted-crlf-inside|[[\"a\",\"b\"],[\"x\\r\\ny\",\"z\"]]",
  "map|drafts|[{\"stage\":\"draft\",\"order_type\":\"Customer\",\"store\":\"RDZ McAllen\",\"po2\":\"PO-1\",\"delivery_date\":\"2026-08-25\",\"delivery_fee\":1250,\"est_pallets\":3,\"delivery_address\":\"9 Elm St\",\"delivery_windows\":\"0830-1730\",\"account\":\"Acme\",\"contact\":\"Ana\",\"delivery_phone\":\"956-555-1234\"},{\"stage\":\"draft\",\"order_type\":\"Transfer\",\"store\":\"RDZ Pharr\",\"delivery_date\":\"not-a-date\",\"delivery_fee\":0,\"est_pallets\":-2,\"delivery_address\":\"1 Main\",\"delivery_windows\":\"1300-1600\"}]",
  "map|warnings|[\"Row 3: skipped (no account, address or store).\",\"Row 4: skipped (no account, address or store).\"]",
  "map|mapped|[\"Order Type\",\"Store\",\"PO #\",\"Delivery Date\",\"Delivery Fee\",\"Est. Pallets\",\"Delivery Address\",\"Windows\",\"Account\",\"Contact\",\"Delivery Phone Number\"]",
  "map|ignored|[\"Nonsense Column\"]",
  "map|empty|{\"drafts\":[],\"warnings\":[\"The file has no data rows.\"],\"mappedHeaders\":[],\"ignoredHeaders\":[]}",
  "map|headers-only|{\"drafts\":[],\"warnings\":[\"The file has no data rows.\"],\"mappedHeaders\":[],\"ignoredHeaders\":[]}",
  "map|alias|[{\"stage\":\"draft\",\"store\":\"RDZ Edinburg\",\"est_pallets\":4,\"delivery_windows\":\"0830-1200\",\"delivery_address\":\"5 Oak\"}]"
];

test("csv-import port matches the original exactly", () => {
  const out: string[] = [];
  const j = (v: unknown) => JSON.stringify(v);

  // --- parseCSV: the cases where naive split(",") parsers break -------------
  const csvCases: Array<[string, string]> = [
    ["simple", "a,b,c" + LF + "1,2,3"],
    ["quoted-comma", 'a,b' + LF + '"x, y",z'],
    ["escaped-quote", 'a' + LF + '"say ""hi"""'],
    ["newline-in-quotes", 'a,b' + LF + '"line1' + LF + 'line2",z'],
    ["crlf", "a,b" + CR + LF + "1,2" + CR + LF],
    ["trailing-newline", "a,b" + LF + "1,2" + LF],
    ["blank-lines", "a,b" + LF + LF + "1,2"],
    ["empty-fields", "a,b,c" + LF + ",,"],
    ["empty-string", ""],
    ["only-headers", "a,b,c"],
    ["ragged", "a,b,c" + LF + "1,2"],
    ["quoted-crlf-inside", 'a,b' + LF + '"x' + CR + LF + 'y",z'],
  ];
  for (const [name, text] of csvCases) out.push(`csv|${name}|${j(parseCSV(text))}`);

  // --- mapRowsToDrafts ------------------------------------------------------
  const H = ["Order Type", "Store", "PO #", "Delivery Date", "Delivery Fee", "Est. Pallets",
             "Delivery Address", "Windows", "Account", "Contact", "Delivery Phone Number", "Nonsense Column"];
  const rows = [
    H,
    ["Customer", "RDZ McAllen", "PO-1", "2026-08-25", "$1,250.00", "3", "9 Elm St", "08:30-17:30", "Acme", "Ana", "956-555-1234", "junk"],
    ["Customer", "", "", "8/26/2026", "", "", "", "", "", "", "", ""],           // date in US format, sparse
    ["", "", "", "", "", "", "", "", "", "", "", ""],                              // blank row -> skipped
    ["Transfer", "RDZ Pharr", "", "not-a-date", "abc", "-2", "1 Main", "1300-1600", "", "", "", ""],
  ];
  const res = mapRowsToDrafts(rows);
  out.push(`map|drafts|${j(res.drafts)}`);
  out.push(`map|warnings|${j(res.warnings)}`);
  out.push(`map|mapped|${j(res.mappedHeaders)}`);
  out.push(`map|ignored|${j(res.ignoredHeaders)}`);

  out.push(`map|empty|${j(mapRowsToDrafts([]))}`);
  out.push(`map|headers-only|${j(mapRowsToDrafts([H]))}`);

  // Header aliases must both resolve to the same field.
  out.push(`map|alias|${j(mapRowsToDrafts([
    ["Store (Sold From)", "Est. Pallets (sales)", "Delivery Military Time Windows", "Delivery Address"],
    ["RDZ Edinburg", "4", "0830-1200", "5 Oak"],
  ]).drafts)}`);

  expect(out).toEqual(EXPECTED);
});
