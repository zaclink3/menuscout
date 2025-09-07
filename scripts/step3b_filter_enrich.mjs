import fs from "node:fs";
import path from "node:path";

// I/O
const IN = "data/scraped_deals.csv";
const OUT = "data/scraped_deals_reviewed.csv";

// Columns we expect
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

// --- CSV helpers ---
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

// --- Text + normalization helpers ---
const KEYWORDS = [
  "happy hour",
  "taco tuesday",
  "wing wednesday",
  "industry night",
  "specials",
  "daily specials",
  "deal",
  "deals",
];

const WEEKDAYS = ["Monday","Tuesday","Wednesday","Thursday","Friday","Saturday","Sunday"];
const WEEKDAY_RE = /\b(Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)s?\b/i;
const PRICE_RE = /\$\s?(\d{1,3}(?:\.\d{1,2})?)/;
const TIME_WINDOW_RE = /\b([01]?\d(?::[0-5]\d)?\s?(?:am|pm)?)\s?(?:-|to|–|—|until)\s?([01]?\d(?::[0-5]\d)?\s?(?:am|pm)?)\b/i;

const DROP_PHRASES = [
  "privacy policy",
  "terms of service",
  "cookie policy",
  "accessibility",
  "copyright",
  "gift card balance",
  "join our newsletter",
  "order online",
  "reservations",
  "buy tickets",
  "catering inquiry",
];

function inferTitle(text) {
  const l = text.toLowerCase();
  if (l.includes("taco tuesday")) return "Taco Tuesday";
  if (l.includes("wing wednesday")) return "Wing Wednesday";
  if (l.includes("happy hour")) return "Happy Hour";
  if (l.includes("industry night")) return "Industry Night";
  if (l.includes("daily specials")) return "Daily Specials";
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
  if (t.includes("beer") || t.includes("draft") || t.includes("cocktail") || t.includes("wine") || t.includes("happy hour"))
    cat.add("drinks");
  if (t.includes("happy hour")) cat.add("happy_hour");
  return Array.from(cat).join(";");
}

function to24h(tp) {
  if (!tp) return null;
  const m = tp.trim().match(/^([0-2]?\d)(?::([0-5]\d))?\s*(am|pm)?$/i);
  if (!m) return null;
  let h = parseInt(m[1], 10);
  const min = m[2] ? parseInt(m[2], 10) : 0;
  const ap = (m[3] || "").toLowerCase();
  if (ap === "pm" && h < 12) h += 12;
  if (ap === "am" && h === 12) h = 0;
  if (!ap && h <= 7) h += 12; // heuristic: bare "5-7" is probably evening (17:00–19:00)
  return `${String(h).padStart(2, "0")}:${String(min).padStart(2, "0")}`;
}

function extractWeekday(text, current) {
  if (current) return current;
  const m = text.match(WEEKDAY_RE);
  return m ? m[1] : "";
}

function extractTimeWindow(text, start, end) {
  if (start && end) return { start, end };
  const m = text.match(TIME_WINDOW_RE);
  if (!m) return { start: start || "", end: end || "" };
  return { start: to24h(m[1]) || "", end: to24h(m[2]) || "" };
}

function extractPrice(text, price) {
  if (price) return price;
  const m = text.match(PRICE_RE);
  return m ? String(Number(m[1]).toFixed(2)) : "";
}

function improvedConfidence(text, weekday, start, end, price) {
  const t = text.toLowerCase();
  const hasKeyword = KEYWORDS.some((k) => t.includes(k));
  const signals = [weekday, start && end, price].filter(Boolean).length;
  if (hasKeyword && signals >= 2) return "high";
  if (hasKeyword && signals >= 1) return "medium";
  return "low";
}

function looksLikeJunk(text) {
  const l = text.toLowerCase();
  if (l.length < 20) return true;
  if (DROP_PHRASES.some((p) => l.includes(p))) return true;
  // throw out big blocks with no deal hints
  const hasKeyword = KEYWORDS.some((k) => l.includes(k));
  const hasSignal = PRICE_RE.test(l) || TIME_WINDOW_RE.test(l) || WEEKDAY_RE.test(l);
  if (!hasKeyword && !hasSignal) return true;
  return false;
}

function normalizeRow(r) {
  const snippet = (r.source_snippet || "").replace(/\s+/g, " ").trim();
  const title = r.title || inferTitle(snippet);
  const weekday = extractWeekday(snippet, r.weekday);
  const { start, end } = extractTimeWindow(snippet, r.start_time, r.end_time);
  const price = extractPrice(snippet, r.price);
  const currency = price ? (r.currency || "USD") : "";
  const category = r.category || classifyCategories(snippet);
  const confidence = improvedConfidence(snippet, weekday, start, end, price);

  return {
    ...r,
    title,
    weekday,
    start_time: start,
    end_time: end,
    price,
    currency,
    category,
    confidence,
    // keep snippet & url as-is for citation
  };
}

function dedupe(rows) {
  const key = (x) =>
    [
      (x.venue_name || "").toLowerCase(),
      (x.title || "").toLowerCase(),
      (x.weekday || "").toLowerCase(),
      x.start_time || "",
      x.end_time || "",
      (x.source_url || "").toLowerCase(),
    ].join("|");
  const m = new Map();
  for (const r of rows) {
    const k = key(r);
    if (!m.has(k)) m.set(k, r);
  }
  return Array.from(m.values());
}

function capPerVenue(rows, maxPerVenue = 5) {
  const count = new Map();
  const out = [];
  for (const r of rows) {
    const k = (r.venue_name || "").toLowerCase();
    const n = (count.get(k) || 0) + 1;
    if (n <= maxPerVenue) {
      out.push(r);
      count.set(k, n);
    }
  }
  return out;
}

function main() {
  const raw = fs.readFileSync(path.resolve(IN), "utf8");
  const rows = parseCsv(raw);

  // Filter to allowed + with URL/snippet
  let cleaned = rows.filter(
    (r) =>
      (r.scrape_allowed || "").toLowerCase() === "true" &&
      (r.source_url || "").startsWith("http") &&
      (r.source_snippet || "").trim().length > 0
  );

  // Drop obvious junk
  cleaned = cleaned.filter((r) => !looksLikeJunk(r.source_snippet || ""));

  // Normalize & enrich
  cleaned = cleaned.map(normalizeRow);

  // Remove rows that are still weak after enrichment
  cleaned = cleaned.filter((r) => {
    const conf = (r.confidence || "low").toLowerCase();
    // Require at least medium **or** has at least one explicit signal
    const hasSignal = !!(r.price || (r.start_time && r.end_time) || r.weekday);
    return conf === "high" || conf === "medium" || hasSignal;
  });

  // Dedupe & cap
  cleaned = dedupe(cleaned);
  cleaned = capPerVenue(cleaned, 5);

  // Keep only known headers, ensure order
  cleaned = cleaned.map((r) => {
    const o = {};
    for (const h of HEADERS) o[h] = r[h] ?? "";
    return o;
  });

  fs.writeFileSync(path.resolve(OUT), toCsv(cleaned, HEADERS));
  console.log(`Filtered/enriched ${cleaned.length} rows → ${OUT}`);
}

main();
