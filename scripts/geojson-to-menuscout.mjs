import fs from "node:fs";
import path from "node:path";

const CITY = "Charlotte";
const REGION = "NC";

function mapCategories(tags) {
  const a = (tags.amenity || "").toLowerCase();
  const c = (tags.craft || "").toLowerCase();
  const cats = new Set();
  if (/restaurant|fast_food/.test(a)) cats.add("burgers");
  if (/cafe/.test(a)) cats.add("dessert");
  if (/bar|pub/.test(a)) cats.add("drinks");
  if (/brewery/.test(c)) cats.add("drinks");
  if (cats.size === 0) cats.add("drinks");
  return Array.from(cats);
}

function featureToVenue(feat) {
  const t = feat.properties || {};
  const coords =
    feat.geometry?.type === "Point"
      ? feat.geometry.coordinates
      : feat.properties?.center // Overpass Turbo “out center” puts lat/lon in tags sometimes
      ? [feat.properties.center.lon, feat.properties.center.lat]
      : null;

  const housenumber = t["addr:housenumber"] || "";
  const street = t["addr:street"] || "";
  const streetLine = [housenumber, street].filter(Boolean).join(" ").trim();

  return {
    venue_name: t.name || "(Unnamed)",
    categories: mapCategories(t),
    address: {
      street: streetLine,
      city: CITY,
      region: REGION,
      postal_code: t["addr:postcode"] || "",
      lat: coords ? Number(coords[1]) : null,
      lng: coords ? Number(coords[0]) : null,
    },
    contact: {
      phone: t.phone || "",
      website: t.website || "",
      instagram: "",
      facebook: "",
      google_maps: "",
    },
    hours: [],
    deals: [],
    menu_items: [],
    notes: ["needs_follow_up: verify socials and add deals"],
    last_verified_at: new Date().toISOString(),
  };
}

function mergeByNameStreet(existing, incoming) {
  const key = (v) =>
    [String(v.venue_name || "").toLowerCase(), String(v.address?.street || "").toLowerCase(), v.address?.postal_code || ""].join("|");
  const map = new Map(existing.map((v) => [key(v), v]));
  for (const v of incoming) {
    const k = key(v);
    if (!map.has(k)) map.set(k, v);
  }
  return Array.from(map.values());
}

const inputPath = process.argv[2];
if (!inputPath) {
  console.error("Usage: node scripts/geojson-to-menuscout.mjs <charlotte_venues.geojson>");
  process.exit(1);
}

const geo = JSON.parse(fs.readFileSync(path.resolve(inputPath), "utf8"));
const feats = Array.isArray(geo.features) ? geo.features : [];
const converted = feats.map(featureToVenue);

const outPath = path.resolve("public/data/charlotte-deals.json");
let current = [];
if (fs.existsSync(outPath)) {
  try {
    current = JSON.parse(fs.readFileSync(outPath, "utf8"));
  } catch {}
}

const merged = mergeByNameStreet(current, converted);

// preserve any existing deals/contacts for exact name+street matches
const final = merged.map((v) => {
  const match = current.find(
    (c) =>
      String(c.venue_name || "").toLowerCase() === String(v.venue_name || "").toLowerCase() &&
      String(c.address?.street || "").toLowerCase() === String(v.address?.street || "").toLowerCase()
  );
  if (!match) return v;
  return {
    ...v,
    categories: match.categories?.length ? match.categories : v.categories,
    contact: { ...v.contact, ...match.contact },
    deals: Array.isArray(match.deals) ? match.deals : [],
    menu_items: Array.isArray(match.menu_items) ? match.menu_items : [],
    notes: Array.from(new Set([...(v.notes || []), ...((match.notes || []))])),
    last_verified_at: match.last_verified_at || v.last_verified_at,
  };
});

fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, JSON.stringify(final, null, 2));
console.log(`Wrote ${final.length} venues → ${outPath}`);
