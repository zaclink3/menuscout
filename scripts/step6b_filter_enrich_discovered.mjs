import fs from "node:fs";
import path from "node:path";

const IN = "data/discovered_deals.csv";
const OUT = "data/discovered_deals_reviewed.csv";

const HEADERS = [
  "venue_name",
  "street_hint",
  "title",
  "description",
  "weekday",
  "start_time",
  "end_time",
  "price",
  "currency",
  "restrictions",
  "category",
  "confidence",
  "source_snippet",
  "source_url",
  "scrape_allowed",
];

function parseCsv(text) {
  const [headerLine, ...lines] = text.trim().split(/\r?\n/);
  const headers = headerLine.split(",").map((h) => h.trim());
  return lines
    .map((ln) => {
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
    })
    .filter((r) => Object.values(r).some((v) => v !== ""));
}

function toCsv(rows, headers) {
  const esc = (v) => {
    if (v == null) return "";
    const s = String(v);
    return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  };
  return headers.join(",") + "\n" + rows.map((r) => headers.map((h) => esc(r[h] ?? "")).join(",")).join("\n") + "\n";
}

const KEYWORDS = ["happy hour","taco tuesday","wing wednesday","industry night","special","specials","deal","deals","brunch","daily specials"];
const DROP_PHRASES = ["privacy policy","terms of service","cookie","accessibility","copyright","gift card","newsletter","order online","reservations","buy tickets","catering"];

const WEEKDAY_RE = /\b(Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)s?\b/i;
const PRICE_RE = /\$\s?(\d{1,3}(?:\.\d{1,2})?)/;
const TIME_RE = /\b([01]?\d(?::[0-5]\d)?\s*(?:am|pm)?)\s*(?:-|to|–|until)\s*([01]?\d(?::[0-5]\d)?\s*(?:am|pm)?)\b/i;

function inferTitle(text) {
  const l = text.toLowerCase();
  if (l.includes("taco tuesday")) return "Taco Tuesday";
  if (l.includes("wing wednesday")) return "Wing Wednesday";
  if (l.includes("happy hour")) return "Happy Hour";
  if (l.includes("industry night")) return "Industry Night";
  if (l.includes("brunch")) return "Brunch";
  return "Special";
}
function classifyCategories(text) {
  const t = text.toLowerCase();
  const cat = new Set();
  if (t.includes("taco")) cat.add("tacos");
  if (t.includes("wing")) cat.add("wings");
  if (t.includes("pizza")) cat.add("pizza");
  if (t.includes("burger")) cat.add("burgers");
  if (t.includes("sushi")) cat.add("sushi");
  if (t.includes("brunch")) cat.add("brunch");
  if (t.includes("bbq")) cat.add("bbq");
  if (t.includes("beer") || t.includes("cocktail") || t.includes("wine") || t.includes("happy hour")) {
    cat.add("drinks"); cat.add("happy_hour");
  }
  return Array.from(cat).join(";");
}
function to24(tp) {
  if (!tp) return "";
  const m = tp.trim().match(/^([0-2]?\d)(?::([0-5]\d))?\s*(am|pm)?$/i);
  if (!m) return "";
  let h = parseInt(m[1],10);
  const min = m[2] ? parseInt(m[2],10) : 0;
  const ap = (m[3]||"").toLowerCase();
  if (ap === "pm" && h < 12) h += 12;
  if (ap === "am" && h === 12) h = 0;
  if (!ap && h <= 7) h += 12;
  return `${String(h).padStart(2,"0")}:${String(min).padStart(2,"0")}`;
}
function extractWindow(text, start, end) {
  if (start && end) return { start, end };
  const m = text.match(TIME_RE);
  if (!m) return { start: start || "", end: end || "" };
  return { start: to24(m[1]) || "", end: to24(m[2]) || "" };
}
function improvedConfidence(text, weekday, start, end, price) {
  const t = text.toLowerCase();
  const hasKeyword = KEYWORDS.some((k) => t.includes(k));
  const signals = [weekday, start && end, price].filter(Boolean).length;
  if (hasKeyword && signals >= 2) return "high";
  if (hasKeyword && signals >= 1) return "medium";
  return "low";
}
function looksJunk(text) {
  const l = (text || "").toLowerCase();
  if (l.length < 20) return true;
  if (DROP_PHRASES.some((p) => l.includes(p))) return true;
  const hasKw = KEYWORDS.some((k) => l.includes(k));
  const hasSignal = PRICE_RE.test(l) || TIME_RE.test(l) || WEEKDAY_RE.test(l);
  if (!hasKw && !hasSignal) return true;
  return false;
}

function normalize(r) {
  const snip = (r.source_snippet || "").replace(/\s+/g," ").trim();
  const title = r.title || inferTitle(snip);
  const weekday = r.weekday || ((snip.match(WEEKDAY_RE) || [null, null])[1] || "");
  const { start, end } = extractWindow(snip, r.start_time, r.end_time);
  const price = r.price || (snip.match(PRICE_RE) ? String(Number(snip.match(PRICE_RE)[1]).toFixed(2)) : "");
  const currency = price ? (r.currency || "USD") : "";
  const category = r.category || classifyCategories(snip);
  const confidence = improvedConfidence(snip, weekday, start, end, price);
  return {
    venue_name: r.venue_name,
    street_hint: "",
    title,
    description: "",
    weekday,
    start_time: start,
    end_time: end,
    price,
    currency,
    restrictions: "",
    category,
    confidence,
    source_snippet: snip.slice(0, 240),
    source_url: r.source_url,
    scrape_allowed: "true",
  };
}

function dedupe(rows) {
  const key = (x) => [
    (x.venue_name||"").toLowerCase(),
    (x.title||"").toLowerCase(),
    (x.weekday||"").toLowerCase(),
    x.start_time||"",
    x.end_time||"",
    (x.source_url||"").toLowerCase()
  ].join("|");
  const m = new Map();
  for (const r of rows) {
    const k = key(r);
    if (!m.has(k)) m.set(k, r);
  }
  return Array.from(m.values());
}
function capPerVenue(rows, max = 6) {
  const count = new Map();
  const out = [];
  for (const r of rows) {
    const k = (r.venue_name||"").toLowerCase();
    const n = (count.get(k) || 0) + 1;
    if (n <= max) { out.push(r); count.set(k, n); }
  }
  return out;
}

function main() {
  const raw = fs.readFileSync(path.resolve(IN),"utf8");
  let rows = parseCsv(raw);

  rows = rows.filter((r) => (r.source_url||"").startsWith("http") && (r.source_snippet||"").trim().length > 0);
  rows = rows.filter((r) => !looksJunk(r.source_snippet));

  rows = rows.map(normalize);

  rows = rows.filter((r) => r.confidence === "high" || r.confidence === "medium" || (r.weekday || (r.start_time && r.end_time) || r.price));
  rows = dedupe(rows);
  rows = capPerVenue(rows, 6);

  rows = rows.map((r) => {
    const o = {};
    for (const h of HEADERS) o[h] = r[h] ?? "";
    return o;
  });

  fs.writeFileSync(path.resolve(OUT), toCsv(rows, HEADERS));
  console.log(`Filtered/enriched ${rows.length} rows → ${OUT}`);
}

main();
