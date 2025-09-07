import fs from "node:fs";
import path from "node:path";
import fetch from "node-fetch"; // make sure node-fetch is installed

const IN_CSV = "data/targets.csv";
const OUT_CSV = "data/targets_checked.csv";

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

function toCsv(rows, headers) {
  const escape = (v) => {
    if (v == null) return "";
    const s = String(v);
    return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  };
  return (
    headers.join(",") +
    "\n" +
    rows.map((r) => headers.map((h) => escape(r[h] ?? "")).join(",")).join("\n")
  );
}

async function checkRobots(url) {
  try {
    const res = await fetch(url, { timeout: 5000 });
    if (!res.ok) return "";
    const txt = await res.text();
    const lines = txt.split(/\r?\n/).map((l) => l.trim().toLowerCase());
    if (lines.some((l) => l.startsWith("user-agent: *"))) {
      // look for global disallows
      if (lines.some((l) => l.startsWith("disallow: /"))) return "false";
      return "true";
    }
    return "";
  } catch {
    return "";
  }
}

async function main() {
  const input = fs.readFileSync(IN_CSV, "utf8");
  const rows = parseCsv(input);
  for (const row of rows) {
    if (row.robots_url && !row.scrape_allowed) {
      row.scrape_allowed = await checkRobots(row.robots_url);
      console.log(`${row.venue_name}: robots=${row.robots_url} → ${row.scrape_allowed}`);
    }
  }
  const headers = Object.keys(rows[0]);
  fs.writeFileSync(OUT_CSV, toCsv(rows, headers));
  console.log(`Wrote updated file → ${OUT_CSV}`);
}

main();
