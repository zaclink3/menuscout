import fs from "node:fs";
import path from "node:path";
import fetch from "node-fetch";
import * as cheerio from "cheerio";

const IN = "data/discovered_links.csv";
const OUT = "data/discovered_deals.csv";
const LOG = "data/discovered_deals.log";

const HEADERS = [
  "venue_name",
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
];

// --- helpers ---
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

function writeCsvHeader() {
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, HEADERS.join(",") + "\n");
  fs.writeFileSync(LOG, "");
}
function appendCsv(rows) {
  const esc = (v) => {
    if (v == null) return "";
    const s = String(v);
    return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  };
  fs.appendFileSync(
    OUT,
    rows.map((r) => HEADERS.map((h) => esc(r[h] ?? "")).join(",")).join("\n") + "\n"
  );
}
function logLine(s) { fs.appendFileSync(LOG, s + "\n"); }

const KEYWORDS = [
  "happy hour","taco tuesday","wing wednesday","industry night",
  "special","specials","deal","deals","brunch","daily specials"
];
const WEEKDAY_RE = /\b(Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)s?\b/i;
const PRICE_RE = /\$\s?(\d{1,3}(?:\.\d{1,2})?)/;
const TIME_RE = /\b([01]?\d(?::[0-5]\d)?\s?(am|pm)?)\s?(?:-|to|–|until)\s?([01]?\d(?::[0-5]\d)?\s?(am|pm)?)\b/i;

function to24h(tp) {
  if (!tp) return "";
  const m = tp.trim().match(/^([0-2]?\d)(?::([0-5]\d))?\s*(am|pm)?$/i);
  if (!m) return "";
  let h = parseInt(m[1], 10);
  const min = m[2] ? parseInt(m[2], 10) : 0;
  const ap = (m[3] || "").toLowerCase();
  if (ap === "pm" && h < 12) h += 12;
  if (ap === "am" && h === 12) h = 0;
  if (!ap && h <= 7) h += 12;
  return `${String(h).padStart(2, "0")}:${String(min).padStart(2, "0")}`;
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
  if (t.includes("beer")||t.includes("cocktail")||t.includes("wine")||t.includes("happy hour")) {
    cat.add("drinks");
    cat.add("happy_hour");
  }
  return Array.from(cat).join(";");
}

function inferTitle(text) {
  const l = text.toLowerCase();
  if (l.includes("taco tuesday")) return "Taco Tuesday";
  if (l.includes("wing wednesday")) return "Wing Wednesday";
  if (l.includes("happy hour")) return "Happy Hour";
  if (l.includes("industry night")) return "Industry Night";
  if (l.includes("brunch")) return "Brunch";
  return "Special";
}

function buildRow(venue, text, url) {
  const weekday = (text.match(WEEKDAY_RE) || [null, null])[1] || "";
  const priceMatch = text.match(PRICE_RE);
  const tm = text.match(TIME_RE);
  const start = tm ? to24h(tm[1]) : "";
  const end = tm ? to24h(tm[3]) : "";
  const cat = classifyCategories(text);
  const conf = (priceMatch && weekday && start && end) ? "high" : (priceMatch || weekday || start ? "medium" : "low");

  return {
    venue_name: venue,
    title: inferTitle(text),
    description: "",
    weekday,
    start_time: start,
    end_time: end,
    price: priceMatch ? priceMatch[1] : "",
    currency: priceMatch ? "USD" : "",
    restrictions: "",
    category: cat,
    confidence: conf,
    source_snippet: text.slice(0, 200),
    source_url: url,
  };
}

function extractDeals(html, venue, url) {
  const $ = cheerio.load(html);
  const blocks = [];
  $("h1,h2,h3,h4,h5,h6,p,li,div,section").each((_, el) => {
    const t = $(el).text().replace(/\s+/g," ").trim();
    if (!t) return;
    const l = t.toLowerCase();
    if (KEYWORDS.some(k => l.includes(k))) {
      blocks.push(t);
    }
  });
  return blocks.map((b) => buildRow(venue, b, url));
}

async function fetchHtml(u) {
  try {
    const res = await fetch(u, {
      redirect:"follow",
      headers: { "user-agent":"Mozilla/5.0 MenuScoutBot/0.1" },
      timeout:15000
    });
    if (!res.ok) return "";
    const ct = (res.headers.get("content-type")||"").toLowerCase();
    if (!ct.includes("text/html")) return "";
    return await res.text();
  } catch { return ""; }
}

async function processRow(r) {
  const venue = r.venue_name;
  const url = r.url;
  const html = await fetchHtml(url);
  if (!html) {
    logLine(`NONE → ${venue} (${url})`);
    return [];
  }
  const rows = extractDeals(html, venue, url);
  if (rows.length) {
    logLine(`FOUND ${rows.length} → ${venue} (${url})`);
  } else {
    logLine(`NONE → ${venue} (${url})`);
  }
  return rows;
}

async function main() {
  const txt = fs.readFileSync(IN,"utf8");
  const links = parseCsv(txt);
  writeCsvHeader();

  let total = 0;
  for (const l of links) {
    const rows = await processRow(l);
    if (rows.length) {
      appendCsv(rows);
      total += rows.length;
    }
  }
  console.log(`Done. Found ${total} candidate deals → ${OUT}`);
  console.log(`Log: ${LOG}`);
}

main();
