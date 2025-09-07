import fs from "node:fs";
import path from "node:path";

const DATA_PATH = "public/data/charlotte-deals.json";

// --- helpers ---
function parseCSV(text) {
  const [headerLine, ...lines] = text.trim().split(/\r?\n/);
  const headers = headerLine.split(",").map((h) => h.trim());
  return lines.map((ln) => {
    const cols = [];
    let cur = "";
    let inQ = false;
    for (let i = 0; i < ln.length; i++) {
      const ch = ln[i];
      if (ch === '"' && ln[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (ch === '"') {
        inQ = !inQ;
      } else if (ch === "," && !inQ) {
        cols.push(cur);
        cur = "";
      } else {
        cur += ch;
      }
    }
    cols.push(cur);
    const obj = {};
    headers.forEach((h, i) => (obj[h] = (cols[i] ?? "").trim()));
    return obj;
  });
}

function toBool(v) {
  if (typeof v !== "string") return null;
  const x = v.trim().toLowerCase();
  if (x === "true") return true;
  if (x === "false") return false;
  return null;
}
function toNum(v) {
  if (v === "" || v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}
function splitSemi(v) {
  return (v || "")
    .split(";")
    .map((x) => x.trim())
    .filter(Boolean);
}

// CSV → Deal
function rowToDeal(r) {
  return {
    title: r.title || "",
    description: r.description || null,
    weekday: r.weekday || null,
    start_time: r.start_time || null,
    end_time: r.end_time || null,
    price: toNum(r.price),
    currency: r.currency || (r.price ? "USD" : null),
    restrictions: splitSemi(r.restrictions),
    start_date: null,
    end_date: null,
    category: splitSemi(r.category),
    confidence: ["high", "medium", "low"].includes((r.confidence || "").toLowerCase())
      ? r.confidence.toLowerCase()
      : "low",
    source_snippet: r.source_snippet || "",
    source_url: r.source_url || "",
    scrape_allowed: toBool(r.scrape_allowed),
  };
}

function matchVenue(venues, name, streetHint) {
  const n = (name || "").toLowerCase();
  const s = (streetHint || "").toLowerCase();
  let candidates = venues.filter((v) => (v.venue_name || "").toLowerCase() === n);
  if (!candidates.length) {
    candidates = venues.filter((v) => (v.venue_name || "").toLowerCase().includes(n));
  }
  if (s) {
    candidates = candidates.filter((v) => (v.address?.street || "").toLowerCase().includes(s));
  }
  return candidates[0] || null;
}

function dedupeDeals(list) {
  const key = (d) =>
    [
      (d.title || "").toLowerCase(),
      d.weekday || "",
      d.start_time || "",
      d.end_time || "",
      d.price ?? "",
      (d.source_url || "").toLowerCase(),
    ].join("|");
  const m = new Map();
  for (const d of list) {
    const k = key(d);
    if (!m.has(k)) m.set(k, d);
  }
  return Array.from(m.values());
}

function main() {
  const csvPath = process.argv[2];
  if (!csvPath) {
    console.error("Usage: node scripts/add-deals-from-csv.mjs deals.csv");
    process.exit(1);
  }

  const csv = fs.readFileSync(path.resolve(csvPath), "utf8");
  const rows = parseCSV(csv);

  const data = JSON.parse(fs.readFileSync(DATA_PATH, "utf8"));
  if (!Array.isArray(data)) throw new Error("Root JSON must be an array of venues");

  let added = 0;
  const noMatch = [];

  for (const r of rows) {
    const venue = matchVenue(data, r.venue_name, r.street_hint);
    if (!venue) {
      noMatch.push({ venue_name: r.venue_name, street_hint: r.street_hint });
      continue;
    }
    venue.deals = Array.isArray(venue.deals) ? venue.deals : [];
    const deal = rowToDeal(r);

    if (!deal.source_url || !deal.source_snippet) {
      console.warn(`Skipping (missing source) → ${r.venue_name} / ${r.title}`);
      continue;
    }

    venue.deals = dedupeDeals([...venue.deals, deal]);
    venue.last_verified_at = new Date().toISOString();
    added++;
  }

  fs.writeFileSync(DATA_PATH, JSON.stringify(data, null, 2));
  console.log(`Added/merged ${added} deals → ${DATA_PATH}`);
  if (noMatch.length) {
    console.log("No match for rows (check venue_name / street_hint):");
    for (const m of noMatch) console.log(` - ${m.venue_name}${m.street_hint ? " [" + m.street_hint + "]" : ""}`);
  }
}

main();
