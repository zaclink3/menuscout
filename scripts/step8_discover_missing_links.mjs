import fs from "node:fs";
import path from "node:path";
import fetch from "node-fetch";
import * as cheerio from "cheerio";
import { XMLParser } from "fast-xml-parser";

const IN = "data/missing_deals_report.csv";
const OUT = "data/discovered_links_missing.csv";
const LOG = "data/discovered_links_missing.log";

const KEYWORDS = [
  "menu","menus","food","drink","drinks","beverage","special","specials","deal","deals",
  "happy-hour","happyhour","happy","hour","events","event","calendar","promotions","promo",
  "tuesday","wednesday","thursday","monday","friday","saturday","sunday","brunch"
];

const MAX_PER_SITE = 25;

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
    .filter(r => Object.values(r).some(v => v !== ""));
}

function writeCsvHeader() {
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, "venue_name,base_url,url\n");
  fs.writeFileSync(LOG, "");
}
function appendRow(vname, base, url) {
  const esc = (s) => /[",\n]/.test(s) ? `"${s.replace(/"/g,'""')}"` : s;
  fs.appendFileSync(OUT, `${esc(vname)},${esc(base)},${esc(url)}\n`);
}
function logLine(s) { fs.appendFileSync(LOG, s + "\n"); }

function sameOrigin(u, base) {
  try { return new URL(u, base).origin === new URL(base).origin; }
  catch { return false; }
}
function normUrl(u, base) {
  try { return new URL(u, base).toString().replace(/#.*$/,""); }
  catch { return ""; }
}
function looksUseful(u) {
  const lu = u.toLowerCase();
  return KEYWORDS.some(k => lu.includes(k));
}

async function fetchText(url) {
  try {
    const res = await fetch(url, {
      redirect: "follow",
      headers: {
        "user-agent":"Mozilla/5.0 (compatible; MenuScoutLinkFinder/0.1)",
        "accept":"text/html,application/xhtml+xml,application/xml"
      },
      timeout: 15000
    });
    if (!res.ok) return "";
    return await res.text();
  } catch { return ""; }
}

function fromSitemap(xmlText, base) {
  if (!xmlText) return [];
  try {
    const parser = new XMLParser({ ignoreAttributes: false });
    const j = parser.parse(xmlText);
    const urls = new Set();
    const pushLoc = (loc) => {
      if (!loc) return;
      const u = normUrl(loc, base);
      if (u && sameOrigin(u, base) && looksUseful(u)) urls.add(u);
    };
    if (j.urlset && Array.isArray(j.urlset.url)) {
      for (const entry of j.urlset.url) pushLoc(entry.loc);
    } else if (j.sitemapindex && Array.isArray(j.sitemapindex.sitemap)) {
      for (const sm of j.sitemapindex.sitemap) pushLoc(sm.loc);
    }
    return Array.from(urls);
  } catch { return []; }
}

function fromHomepage(html, base) {
  if (!html) return [];
  const $ = cheerio.load(html);
  const set = new Set();
  $("a[href]").each((_, el) => {
    const href = $(el).attr("href") || "";
    const u = normUrl(href, base);
    if (!u) return;
    if (!sameOrigin(u, base)) return;
    if (!looksUseful(u)) return;
    set.add(u);
  });
  return Array.from(set);
}

async function discoverFor(venue_name, base_url, scrape_allowed) {
  const out = new Set();
  if ((scrape_allowed || "").toLowerCase() !== "true") return [];

  const homepage = await fetchText(base_url);
  fromHomepage(homepage, base_url).forEach(u => out.add(u));

  const smUrl = (() => {
    try { const b = new URL(base_url); return `${b.protocol}//${b.host}/sitemap.xml`; }
    catch { return ""; }
  })();
  if (smUrl) {
    const sm = await fetchText(smUrl);
    fromSitemap(sm, base_url).forEach(u => out.add(u));
  }

  ["/menu","/menus","/food","/drinks","/specials","/deals","/happy-hour","/happyhour","/events","/calendar"]
    .map(p => normUrl(p, base_url))
    .filter(u => u && sameOrigin(u, base_url))
    .forEach(u => out.add(u));

  return Array.from(out).slice(0, MAX_PER_SITE).map(u => ({ venue_name, base_url, url: u }));
}

async function main() {
  const missing = parseCsv(fs.readFileSync(IN,"utf8"))
    .filter(r => r.website && (r.scrape_allowed || "").toLowerCase() === "true");

  writeCsvHeader();

  let total = 0;
  for (const r of missing) {
    const found = await discoverFor(r.venue_name, r.website, r.scrape_allowed);
    if (found.length) {
      found.forEach(x => appendRow(x.venue_name, x.base_url, x.url));
      logLine(`FOUND ${found.length} → ${r.venue_name}`);
      total += found.length;
    } else {
      logLine(`NONE → ${r.venue_name}`);
    }
  }
  console.log(`Discovered ${total} links (missing venues) → ${OUT}`);
  console.log(`Log: ${LOG}`);
}

main();
