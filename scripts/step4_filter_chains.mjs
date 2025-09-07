import fs from "node:fs";
import path from "node:path";

const INPUT = "public/data/charlotte-deals.json";
const OUTPUT = "public/data/charlotte-deals.clean.json";
const REMOVED_OUT = "public/data/charlotte-deals.removed_chains.json";

// Maintainable list of chain names and domains (lowercase).
// You can edit/expand this over time.
const CHAIN_NAMES = [
  "mcdonald", "burger king", "wendy", "taco bell", "kfc", "pizza hut",
  "domino", "papa john", "little caesars", "subway", "chipotle",
  "panera", "starbucks", "dunkin", "five guys", "shake shack",
  "arbys", "arbys", "dairy queen", "jimmy john", "jersey mike",
  "firehouse subs", "wingstop", "zaxby", "bojangles", "cook out",
  "qdooba", "qdoba", "moe's southwest grill", "panda express",
  "red robin", "buffalo wild wings", "hooters", "ihop", "denny",
  "waffle house", "checkers", "rally's", "raising cane", "culver",
  "whataburger", "hardee", "carl's jr", "schlotzsky", "potbelly",
  "pieology", "mod pizza", "blaze pizza", "tropical smoothie",
  "smoothie king", "jeremiah's italian ice", "cold stone", "auntie anne",
  "great clips", // occasional weird OSM noise
];

const CHAIN_DOMAINS = [
  "mcdonalds.com","burgerking.com","wendys.com","tacobell.com","kfc.com","pizzahut.com",
  "dominos.com","papajohns.com","littlecaesars.com","subway.com","chipotle.com",
  "panerabread.com","starbucks.com","dunkindonuts.com","fiveguys.com","shakeshack.com",
  "arbys.com","dairyqueen.com","jimmyjohns.com","jerseymikes.com","firehousesubs.com",
  "wingstop.com","zaxbys.com","bojangles.com","cookout.com","qdoba.com","moes.com",
  "pandaexpress.com","redrobin.com","buffalowildwings.com","hooters.com","ihop.com",
  "dennys.com","wafflehouse.com","checkers.com","rallys.com","raisingcanes.com",
  "culvers.com","whataburger.com","hardees.com","carlsjr.com","schlotzskys.com",
  "potbelly.com","pieology.com","modpizza.com","blazepizza.com","tropicalsmoothiecafe.com",
  "smoothieking.com","jeremiahsice.com","coldstonecreamery.com","auntieannes.com"
];

function norm(s) {
  return (s || "")
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function isChainByName(name) {
  const n = norm(name);
  return CHAIN_NAMES.some((c) => n.includes(c));
}

function hostFromUrl(u) {
  try {
    const { host } = new URL(u);
    return host.toLowerCase();
  } catch {
    return "";
  }
}

function baseDomain(host) {
  if (!host) return "";
  const parts = host.split(".").filter(Boolean);
  if (parts.length <= 2) return host;
  return parts.slice(-2).join(".");
}

function isChainByDomain(website) {
  const h = baseDomain(hostFromUrl(website));
  if (!h) return false;
  return CHAIN_DOMAINS.some((d) => h.endsWith(d));
}

function loadJson(p) {
  const text = fs.readFileSync(path.resolve(p), "utf8");
  return JSON.parse(text);
}

function saveJson(p, data) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(path.resolve(p), JSON.stringify(data, null, 2));
}

function main() {
  const data = loadJson(INPUT);
  if (!Array.isArray(data)) throw new Error("Root JSON must be an array");

  const removed = [];
  const kept = [];

  for (const v of data) {
    const name = v?.venue_name || "";
    const web = v?.contact?.website || "";

    const isChain =
      isChainByName(name) ||
      isChainByDomain(web);

    // Optional heuristic: treat obvious fast-food only if you want to be stricter
    // const looksFastFood = (v.categories || []).some((c) => ["burgers"].includes(String(c).toLowerCase()));
    // const drop = isChain || looksFastFood;

    if (isChain) {
      removed.push(v);
    } else {
      kept.push(v);
    }
  }

  saveJson(OUTPUT, kept);
  saveJson(REMOVED_OUT, removed);

  console.log(`Kept: ${kept.length}`);
  console.log(`Removed (chains): ${removed.length}`);
  console.log(`Wrote cleaned → ${OUTPUT}`);
  console.log(`Backup of removed → ${REMOVED_OUT}`);

  const sample = removed.slice(0, 10).map((v) => v.venue_name);
  if (sample.length) {
    console.log("Sample removed:", sample.join(" | "));
  }
}

main();
