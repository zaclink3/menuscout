import fs from "node:fs";
import path from "node:path";

const INPUT_JSON = "public/data/charlotte-deals.json";
const OUT_DIR = "data";
const OUT_CSV = path.join(OUT_DIR, "targets.csv");

function csvEscape(v) {
  if (v === null || v === undefined) return "";
  const s = String(v);
  return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

function domainFromUrl(u) {
  try {
    const { protocol, host } = new URL(u);
    if (!/^https?:$/.test(protocol)) return "";
    return host;
  } catch {
    return "";
  }
}

function robotsFromWebsite(u) {
  try {
    const url = new URL(u);
    if (!/^https?:$/.test(url.protocol)) return "";
    return `${url.protocol}//${url.host}/robots.txt`;
  } catch {
    return "";
  }
}

function mapRow(v) {
  const name = v.venue_name || "";
  const street = v.address?.street || "";
  const city = v.address?.city || "Charlotte";
  const region = v.address?.region || "NC";
  const postal = v.address?.postal_code || "";

  const website = v.contact?.website || "";
  const instagram = v.contact?.instagram || "";
  const facebook = v.contact?.facebook || "";
  const gmaps = v.contact?.google_maps || `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${name} ${street} ${city} ${region}`)}`;

  const searchQuery = `${name} ${street} ${city} ${region} (specials OR "happy hour" OR menu OR tacos OR wings)`;
  const robots = website ? robotsFromWebsite(website) : "";

  return {
    venue_name: name,
    street,
    city,
    region,
    postal_code: postal,
    website,
    instagram,
    facebook,
    google_maps: gmaps,
    search_query: searchQuery,
    robots_url: robots,
    scrape_allowed: "", // fill in Step 2
    notes: "",
  };
}

function writeCsv(rows) {
  const headers = [
    "venue_name",
    "street",
    "city",
    "region",
    "postal_code",
    "website",
    "instagram",
    "facebook",
    "google_maps",
    "search_query",
    "robots_url",
    "scrape_allowed",
    "notes",
  ];
  const body = rows
    .map((r) =>
      headers
        .map((h) => csvEscape(r[h] ?? ""))
        .join(",")
    )
    .join("\n");
  const csv = headers.join(",") + "\n" + body + "\n";
  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(OUT_CSV, csv);
}

function main() {
  const raw = fs.readFileSync(INPUT_JSON, "utf8");
  const data = JSON.parse(raw);
  if (!Array.isArray(data)) throw new Error("Root JSON must be an array");
  // optional: sort by name for consistency
  data.sort((a, b) => String(a.venue_name || "").localeCompare(String(b.venue_name || "")));
  const rows = data.map(mapRow);
  writeCsv(rows);
  console.log(`Wrote ${rows.length} rows → ${OUT_CSV}`);
  console.log("Open this file in Excel/Sheets to verify/fill website/instagram/facebook for any blanks.");
}

main();
