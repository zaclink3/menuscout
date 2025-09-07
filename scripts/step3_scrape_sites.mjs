import fs from "node:fs";
import path from "node:path";
import fetch from "node-fetch";
import * as cheerio from "cheerio";

const IN = "data/targets_checked.csv";
const OUT = "data/scraped_deals.csv";
const LOG = "data/scraped_deals.log";

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

function csvEscape(v) {
  if (v === null || v === undefined) return "";
  const s = String(v);
  return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}
function toCsvRow(obj) {
  return HEADERS.map((h) => csvEscape(obj[h] ?? "")).join(",");
}
function writeCsvHeader() {
  if (!fs.existsSync(path.dirname(OUT))) fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, HEADERS.join(",") + "\n");
  fs.writeFileSync(LOG, "");
}
function appendCsv(rows) {
  fs.appendFileSync(OUT, rows.map(toCsvRow).join("\n") + "\n");
}
function logLine(s) {
  fs.appendFileSync(LOG, s + "\n");
}

function parseCsv(text) {
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

// simple heuristics
const KEYWORDS = [
  "happy hour",
  "taco tuesday",
  "wing wednesday",
  "industry night",
  "specials",
  "deal",
  "daily specials",
  "tuesday",
  "wednesday",
  "thursday",
  "monday",
  "friday",
  "saturday",
  "sunday",
  "am–",
  "pm–",
  "–pm",
  "–am",
];
const TIME_RE = /\b([01]?\d|2[0-3]):?[0-5]?\d?\s?(am|pm)?\s?(?:-|to|–)\s?([01]?\d|2[0-3]):?[0-5]?\d?\s?(am|pm)?\b/i;
const PRICE_RE = /\$\s?(\d{1,3}(?:\.\d{1,2})?)/;
const WEEKDAY_RE = /\b(Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)s?\b/i;

function findCandidateBlocks($) {
  const blocks = [];
  $("h1,h2,h3,h4,h5,h6,p,li,div,section").each((_, el) => {
    const text = $(el).text().replace(/\s+/g, " ").trim();
    if (!text) return;
    const lower = text.toLowerCase();
    if (KEYWORDS.some((k) => lower.includes(k))) {
      blocks.push(text);
    }
  });
  // dedupe-ish, keep unique long lines
  const seen = new Set();
  return blocks
    .filter((t) => {
      const k = t.toLowerCase();
      if (seen.has(k)) return false;
      seen.add(k);
      return t.length >= 20;
    })
    .slice(0, 200);
}

function normalizeTime(text) {
  const m = text.match(TIME_RE);
  if (!m) return { start: null, end: null };
  const a = m[1] + (m[2] ? m[2].toLowerCase() : "");
  const b = m[3] + (m[4] ? m[4].toLowerCase() : "");
  function to24(s) {
    if (!s) return null;
    const mm = s.match(/^([0-2]?\d):?([0-5]\d)?(am|pm)?$/i);
    if (!mm) return null;
    let h = parseInt(mm[1], 10);
    let min = mm[2] ? parseInt(mm[2], 10) : 0;
    const ap = (mm[3] || "").toLowerCase();
    if (ap === "pm" && h < 12) h += 12;
    if (ap === "am" && h === 12) h = 0;
    return `${String(h).padStart(2, "0")}:${String(min).padStart(2, "0")}`;
    }
  return { start: to24(a), end: to24(b) };
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
  if (t.includes("beer") || t.includes("draft") || t.includes("cocktail") || t.includes("wine") || t.includes("happy hour")) {
    cat.add("drinks");
    cat.add("happy_hour");
  }
  return Array.from(cat);
}

function inferTitle(text) {
  const l = text.toLowerCase();
  if (l.includes("taco tuesday")) return "Taco Tuesday";
  if (l.includes("wing wednesday")) return "Wing Wednesday";
  if (l.includes("happy hour")) return "Happy Hour";
  if (l.includes("industry night")) return "Industry Night";
  if (l.includes("daily specials")) return "Daily Specials";
  return "Special";
}

async function fetchHtml(url) {
  try {
    const res = await fetch(url, {
      redirect: "follow",
      headers: {
        "user-agent":
          "Mozilla/5.0 (compatible; MenuScoutBot/0.1; +https://example.com/bot) legal: respectful, honors robots.txt",
        accept: "text/html,application/xhtml+xml",
      },
      timeout: 15000,
    });
    if (!res.ok) return "";
    const ct = (res.headers.get("content-type") || "").toLowerCase();
    if (!ct.includes("text/html")) return "";
    return await res.text();
  } catch {
    return "";
  }
}

function buildCandidateUrls(website) {
  const urls = new Set();
  try {
    const u = new URL(website);
    urls.add(u.toString());
    ["/specials", "/deals", "/happy-hour", "/happyhour", "/menu", "/menus"].forEach((p) => {
      urls.add(new URL(p, u).toString());
    });
  } catch {}
  return Array.from(urls);
}

function toRow(venue, text, url) {
  const weekday = (text.match(WEEKDAY_RE) || [null, null])[1];
  const priceMatch = text.match(PRICE_RE);
  const { start, end } = normalizeTime(text);
  const cat = classifyCategories(text);
  const hasStrongSignals = /happy hour|taco|wing|daily|special/i.test(text);
  const conf = hasStrongSignals && (priceMatch || start || weekday) ? "medium" : "low";
  return {
    venue_name: venue.venue_name,
    street_hint: venue.street,
    title: inferTitle(text),
    description: "",
    weekday: weekday || "",
    start_time: start,
    end_time: end,
    price: priceMatch ? priceMatch[1] : "",
    currency: priceMatch ? "USD" : "",
    restrictions: "",
    category: cat.join(";"),
    confidence: conf,
    source_snippet: text.slice(0, 240),
    source_url: url,
    scrape_allowed: "true",
  };
}

async function processRow(row) {
  const website = row.website?.trim();
  if (!website || row.scrape_allowed !== "true") return [];
  const urls = buildCandidateUrls(website);
  const out = [];
  for (const u of urls) {
    const html = await fetchHtml(u);
    if (!html) {
      logLine(`SKIP (no html): ${row.venue_name} -> ${u}`);
      continue;
    }
    const $ = cheerio.load(html);
    const blocks = findCandidateBlocks($);
    for (const b of blocks) {
      // filter obvious non-deal boilerplate
      if (/copyright|privacy|cookies|accessibility/i.test(b)) continue;
      // must contain at least one signal
      if (!KEYWORDS.some((k) => b.toLowerCase().includes(k))) continue;
      out.push(toRow(row, b, u));
      if (out.length >= 5) break; // keep it light per site
    }
    if (out.length >= 5) break;
  }
  return out;
}

async function main() {
  // read targets
  const txt = fs.readFileSync(IN, "utf8");
  const targets = parseCsv(txt);

  writeCsvHeader();

  let total = 0;
  for (const t of targets) {
    const rows = await processRow(t);
    total += rows.length;
    if (rows.length) {
      appendCsv(rows);
      logLine(`FOUND ${rows.length}: ${t.venue_name}`);
    } else {
      logLine(`NONE: ${t.venue_name}`);
    }
  }
  console.log(`Done. Wrote ${total} candidate deals → ${OUT}`);
  console.log(`Log: ${LOG}`);
}

main();
