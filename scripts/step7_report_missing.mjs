import fs from "node:fs";
import path from "node:path";

const VENUES_JSON = "public/data/charlotte-deals.json";
const TARGETS = "data/targets_checked.csv";
const OUT = "data/missing_deals_report.csv";

function parseCsv(text) {
  const [headerLine, ...lines] = text.trim().split(/\r?\n/);
  const headers = headerLine.split(",").map((h) => h.trim());
  return lines.map((ln) => {
    const cols = [];
    let cur = "";
    let inQ = false;
    for (let i = 0; i < ln.length; i++) {
      const ch = ln[i];
      if (ch === '"' && ln[i + 1] === '"') { cur += '"'; i++; }
      else if (ch === '"') { inQ = !inQ; }
      else if (ch === "," && !inQ) { cols.push(cur); cur = ""; }
      else { cur += ch; }
    }
    cols.push(cur);
    const obj = {};
    headers.forEach((h, i) => (obj[h] = (cols[i] ?? "").trim()));
    return obj;
  });
}

function esc(v) {
  if (v == null) return "";
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g,'""')}"` : s;
}

function toCsv(rows, headers) {
  return headers.join(",") + "\n" + rows.map(r => headers.map(h => esc(r[h] ?? "")).join(",")).join("\n") + "\n";
}

function main() {
  const venues = JSON.parse(fs.readFileSync(VENUES_JSON, "utf8"));
  const targets = parseCsv(fs.readFileSync(TARGETS, "utf8"));
  const tIndex = new Map(
    targets.map(t => [ (t.venue_name||"").toLowerCase(), t ])
  );

  const rows = [];
  for (const v of venues) {
    const hasDeals = Array.isArray(v.deals) && v.deals.length > 0;
    if (hasDeals) continue;

    const name = v.venue_name || "";
    const t = tIndex.get(name.toLowerCase()) || {};
    rows.push({
      venue_name: name,
      street: v.address?.street || "",
      neighborhood_hint: v.address?.postal_code || "",
      website: v.contact?.website || t.website || "",
      scrape_allowed: (t.scrape_allowed || "").toLowerCase(),
      robots_url: t.robots_url || "",
      google_maps: t.google_maps || "",
      search_query: t.search_query || `${name} ${v.address?.street||""} Charlotte NC specials OR "happy hour" OR menu`,
      note: ""
    });
  }

  const headers = ["venue_name","street","neighborhood_hint","website","scrape_allowed","robots_url","google_maps","search_query","note"];
  fs.writeFileSync(path.resolve(OUT), toCsv(rows, headers));
  console.log(`Wrote ${rows.length} rows → ${OUT}`);
}

main();
