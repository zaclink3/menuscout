"use client";
import React, { useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import { MapPin, Clock, DollarSign, Filter, ExternalLink, Calendar, Download, Upload, Sparkles, Info, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger, DropdownMenuCheckboxItem, DropdownMenuLabel } from "@/components/ui/dropdown-menu";

const CITY = "Charlotte";

const WEEKDAYS = [
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
  "Sunday",
];

const CATEGORY_TAXONOMY = [
  "tacos",
  "wings",
  "pizza",
  "burgers",
  "sushi",
  "happy_hour",
  "drinks",
  "brunch",
  "seafood",
  "bbq",
  "vegan",
  "dessert",
];

function valueScore(deal) {
  const conf = deal?.confidence === "high" ? 1 : deal?.confidence === "medium" ? 0.7 : 0.4;
  const base = typeof deal?.price === "number" && deal.price > 0 ? 1 / deal.price : 0.05;
  return +(base * conf).toFixed(5);
}

function todayWeekday() {
  const d = new Date();
  const i = d.getDay();
  return WEEKDAYS[(i + 6) % 7];
}

function computeNeighborhood(v) {
  const street = (v?.address?.street || "").toLowerCase();
  const postal = v?.address?.postal_code || "";
  if (street.includes("36th")) return "NoDa";
  if (street.includes("south blvd")) return "South End";
  if (postal === "28202") return "Uptown";
  if (postal === "28205") return "Plaza Midwood";
  return "Other";
}

function useNeighborhoods(data) {
  return useMemo(() => {
    const set = new Set();
    data.forEach((v) => set.add(computeNeighborhood(v)));
    return Array.from(set);
  }, [data]);
}

function TopBar({ count, onExport, onImportClick, onRefresh, updating, lastUpdated }) {
  return (
    <div className="sticky top-0 z-30 backdrop-blur supports-[backdrop-filter]:bg-background/70 bg-background/90 border-b">
      <div className="max-w-6xl mx-auto px-4 py-3 flex items-center gap-3">
        <Sparkles className="w-5 h-5" />
        <h1 className="text-xl font-semibold">MenuScout CLT</h1>
        <Badge variant="secondary" className="ml-1">MVP</Badge>
        <div className="ml-2 text-xs text-muted-foreground">{count} venues</div>
        {lastUpdated && <div className="ml-2 text-[10px] text-muted-foreground">Last updated: {lastUpdated}</div>}
        <div className="ml-auto flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={onImportClick}>
            <Upload className="w-4 h-4 mr-2" /> Import JSON
          </Button>
          <Button variant="outline" size="sm" onClick={onRefresh} disabled={updating}>
            <RefreshCw className="w-4 h-4 mr-2" /> {updating ? "Refreshing" : "Refresh"}
          </Button>
          <Button size="sm" onClick={onExport}>
            <Download className="w-4 h-4 mr-2" /> Export JSON
          </Button>
        </div>
      </div>
      <div className="max-w-6xl mx-auto px-4 pb-3 text-xs text-muted-foreground flex items-center gap-2">
        <Info className="w-3.5 h-3.5" />
        <span>
          Data auto-loads from /data/charlotte-deals.json. Update that file in your repo for edits.
        </span>
      </div>
    </div>
  );
}

function FilterBar({ search, setSearch, weekday, setWeekday, category, setCategory, todayOnly, setTodayOnly, neighborhoods, selectedNeighborhoods, setSelectedNeighborhoods }) {
  return (
    <div className="sticky top-[64px] z-20 bg-background border-b">
      <div className="max-w-6xl mx-auto px-4 py-3 flex flex-wrap gap-2 items-center">
        <Filter className="w-4 h-4" />
        <Input
          placeholder="Search venues, deals, notes..."
          className="w-64"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <Select value={weekday} onValueChange={(v) => setWeekday(v)}>
          <SelectTrigger className="w-[160px]"><SelectValue placeholder="Weekday" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="Any">Any day</SelectItem>
            {WEEKDAYS.map((d) => (
              <SelectItem key={d} value={d}>{d}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={category} onValueChange={(v) => setCategory(v)}>
          <SelectTrigger className="w-[180px]"><SelectValue placeholder="Category" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="Any">Any category</SelectItem>
            {CATEGORY_TAXONOMY.map((c) => (
              <SelectItem key={c} value={c}>{c}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="sm">Neighborhoods</Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent className="w-56">
            <DropdownMenuLabel>Select neighborhoods</DropdownMenuLabel>
            {neighborhoods.map((n) => (
              <DropdownMenuCheckboxItem
                key={n}
                checked={selectedNeighborhoods.includes(n)}
                onCheckedChange={(checked) => {
                  if (checked) {
                    setSelectedNeighborhoods((prev) => (prev.includes(n) ? prev : [...prev, n]));
                  } else {
                    setSelectedNeighborhoods((prev) => prev.filter((x) => x !== n));
                  }
                }}
              >
                {n}
              </DropdownMenuCheckboxItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
        <div className="ml-auto flex items-center gap-2">
          <Badge variant={todayOnly ? "default" : "outline"} className="cursor-pointer" onClick={() => setTodayOnly(!todayOnly)}>
            <Calendar className="w-3.5 h-3.5 mr-1" /> Today only
          </Badge>
        </div>
      </div>
    </div>
  );
}

function DealChip({ d }) {
  return (
    <div className="flex items-center gap-2 text-sm">
      <Badge variant="secondary">{d.title}</Badge>
      {d.weekday && (
        <span className="inline-flex items-center gap-1 text-muted-foreground">
          <Calendar className="w-3.5 h-3.5" /> {d.weekday}
        </span>
      )}
      {(d.start_time || d.end_time) && (
        <span className="inline-flex items-center gap-1 text-muted-foreground">
          <Clock className="w-3.5 h-3.5" />
          {d.start_time || "?"}-{d.end_time || "?"}
        </span>
      )}
      {typeof d.price === "number" && (
        <span className="inline-flex items-center gap-1 text-muted-foreground">
          <DollarSign className="w-3.5 h-3.5" /> {d.price.toFixed(2)} {d.currency || "USD"}
        </span>
      )}
      <Badge variant={d.confidence === "high" ? "default" : d.confidence === "medium" ? "secondary" : "outline"}>
        {d.confidence}
      </Badge>
    </div>
  );
}

function VenueCard({ v }) {
  const top = useMemo(() => {
    if (!v.deals?.length) return null;
    return [...v.deals].sort((a, b) => valueScore(b) - valueScore(a))[0];
  }, [v.deals]);

  return (
    <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}>
      <Card className="hover:shadow-lg transition-shadow">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <span>{v.venue_name}</span>
            {v.categories?.slice(0, 3).map((c) => (
              <Badge key={c} variant="outline" className="capitalize">{c}</Badge>
            ))}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {v.address?.street && (
            <div className="text-sm text-muted-foreground flex items-center gap-2">
              <MapPin className="w-4 h-4" />
              <span>
                {v.address.street}, {v.address.city}, {v.address.region} {v.address.postal_code}
              </span>
            </div>
          )}

          {v.deals?.length ? (
            <div className="space-y-2">
              {v.deals.map((d, i) => (
                <div key={`${v.venue_name}-${i}`} className="p-2 rounded-lg border">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <DealChip d={d} />
                    {d.source_url && (
                      <a href={d.source_url} target="_blank" rel="noreferrer" className="text-xs inline-flex items-center gap-1 text-primary hover:underline">
                        Source <ExternalLink className="w-3.5 h-3.5" />
                      </a>
                    )}
                  </div>
                  {d.description && (
                    <p className="mt-1 text-sm">{d.description}</p>
                  )}
                  {!!d.restrictions?.length && (
                    <p className="mt-1 text-xs text-muted-foreground">Restrictions: {d.restrictions.join(", ")}</p>
                  )}
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">No deals listed.</p>
          )}

          {top && (
            <div className="text-xs text-muted-foreground">Top value score: {valueScore(top)}</div>
          )}
        </CardContent>
      </Card>
    </motion.div>
  );
}

function ImportDialog({ open, onOpenChange, onImportJson }) {
  const [text, setText] = useState("");
  const [error, setError] = useState("");

  function handleImport() {
    setError("");
    try {
      const parsed = JSON.parse(text);
      if (!Array.isArray(parsed)) throw new Error("Root JSON must be an array of venues");
      onImportJson(parsed);
      onOpenChange(false);
      setText("");
    } catch (e) {
      setError(e.message);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Import venues JSON</DialogTitle>
        </DialogHeader>
        <div className="space-y-2">
          <p className="text-sm text-muted-foreground">Paste an array matching the MenuScout schema. Existing data will be replaced.</p>
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            className="w-full h-64 p-3 border rounded-md font-mono text-sm"
            placeholder={'[ { "venue_name": "...", ... } ]'}
          />
          {error && <p className="text-xs text-red-500">{error}</p>}
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button onClick={handleImport}>Import</Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function Highlights({ venues }) {
  const ranked = useMemo(() => {
    const rows = [];
    venues.forEach((v) => {
      (v.deals || []).forEach((d) => {
        rows.push({ v, d, score: valueScore(d), neighborhood: computeNeighborhood(v) });
      });
    });
    return rows.sort((a, b) => b.score - a.score).slice(0, 5);
  }, [venues]);

  return (
    <div className="grid md:grid-cols-2 gap-3">
      {ranked.map(({ v, d, score }, idx) => (
        <Card key={`${v.venue_name}-highlight-${idx}`}>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Sparkles className="w-4 h-4" /> {d.title}
              <Badge variant="outline" className="ml-auto">{score}</Badge>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            <div className="text-sm">{v.venue_name}</div>
            <div className="text-xs text-muted-foreground">
              {d.weekday} {d.start_time ? `${d.start_time}` : ""}{d.end_time ? `-${d.end_time}` : ""}
            </div>
            <div className="text-xs text-muted-foreground">
              {typeof d.price === "number" ? `$${d.price.toFixed(2)}` : "Price varies"} - {d.category?.join(", ")}
            </div>
            {d.source_url && (
              <a className="text-xs inline-flex items-center gap-1 text-primary hover:underline" href={d.source_url} target="_blank" rel="noreferrer">
                Source <ExternalLink className="w-3.5 h-3.5" />
              </a>
            )}
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

export default function MenuScoutApp() {
  const [venues, setVenues] = useState([]);
  const [search, setSearch] = useState("");
  const [weekday, setWeekday] = useState("Any");
  const [category, setCategory] = useState("Any");
  const [todayOnly, setTodayOnly] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [updating, setUpdating] = useState(false);
  const [loadError, setLoadError] = useState("");

  const neighborhoods = useNeighborhoods(venues);
  const [selectedNeighborhoods, setSelectedNeighborhoods] = useState([]);

  const today = todayWeekday();

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    return venues.filter((v) => {
      const hay = [
        v.venue_name || "",
        ...(v.categories || []),
        ...(v.notes || []),
        ...((v.deals || []).flatMap((d) => [d.title, d.description, d.source_snippet]).filter(Boolean)),
      ]
        .join(" \n ")
        .toLowerCase();
      if (term && !hay.includes(term)) return false;
      const hood = computeNeighborhood(v);
      if (selectedNeighborhoods.length && !selectedNeighborhoods.includes(hood)) return false;
      if (todayOnly) {
        if (!v.deals?.some((d) => d.weekday === today)) return false;
      } else if (weekday !== "Any") {
        if (!v.deals?.some((d) => d.weekday === weekday)) return false;
      }
      if (category !== "Any") {
        if (!v.deals?.some((d) => (d.category || []).includes(category))) return false;
      }
      return true;
    });
  }, [venues, search, weekday, category, todayOnly, selectedNeighborhoods, today]);

  const lastUpdated = useMemo(() => {
    const dates = venues.map((v) => v.last_verified_at).filter(Boolean);
    if (!dates.length) return "";
    try {
      const d = new Date(Math.max(...dates.map((d) => new Date(d).getTime())));
      return d.toLocaleString();
    } catch {
      return "";
    }
  }, [venues]);

  async function fetchVenues() {
    try {
      setUpdating(true);
      setLoadError("");
      const res = await fetch(`/data/charlotte-deals.json`, { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      if (Array.isArray(data)) {
        setVenues(data);
      }
    } catch (e) {
      setLoadError(String(e.message || e));
    } finally {
      setUpdating(false);
    }
  }

  useEffect(() => {
    fetchVenues();
    const id = setInterval(fetchVenues, 15 * 60 * 1000);
    return () => clearInterval(id);
  }, []);

  function exportJson() {
    const blob = new Blob([JSON.stringify(venues, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `menuscout_${CITY.toLowerCase()}_${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  function handleImportJson(arr) {
    setVenues(arr);
  }

  return (
    <div className="min-h-screen bg-background text-foreground">
      <TopBar count={filtered.length} onExport={exportJson} onImportClick={() => setImportOpen(true)} onRefresh={fetchVenues} updating={updating} lastUpdated={lastUpdated} />
      <ImportDialog open={importOpen} onOpenChange={setImportOpen} onImportJson={handleImportJson} />
      <FilterBar
        search={search}
        setSearch={setSearch}
        weekday={weekday}
        setWeekday={(v) => { setTodayOnly(false); setWeekday(v); }}
        category={category}
        setCategory={setCategory}
        todayOnly={todayOnly}
        setTodayOnly={(v) => { setWeekday("Any"); setTodayOnly(v); }}
        neighborhoods={neighborhoods}
        selectedNeighborhoods={selectedNeighborhoods}
        setSelectedNeighborhoods={setSelectedNeighborhoods}
      />
      <main className="max-w-6xl mx-auto px-4 py-6">
        {loadError && <div className="mb-4 text-xs text-red-500">Failed to auto-load data: {loadError}. Using current dataset.</div>}
        <Tabs defaultValue="list" className="w-full">
          <TabsList className="grid grid-cols-2 w-full md:w-auto">
            <TabsTrigger value="list">All Venues ({filtered.length})</TabsTrigger>
            <TabsTrigger value="highlights">Highlights</TabsTrigger>
          </TabsList>
          <TabsContent value="list" className="mt-4">
            {filtered.length ? (
              <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
                {filtered.map((v) => (
                  <VenueCard key={v.venue_name} v={v} />
                ))}
              </div>
            ) : (
              <div className="text-sm text-muted-foreground">No results. Try broadening your filters.</div>
            )}
          </TabsContent>
          <TabsContent value="highlights" className="mt-4">
            <Highlights venues={filtered} />
          </TabsContent>
        </Tabs>
        <section className="mt-10 space-y-3">
          <h2 className="text-lg font-semibold">Schema Notes</h2>
          <ul className="text-sm list-disc pl-5 space-y-1 text-muted-foreground">
            <li>Every deal should include source_url and source_snippet. Do not guess.</li>
            <li>Normalize weekday and time to 24h format. Use null if unknown and adjust confidence.</li>
            <li>Respect robots and terms. If disallowed, set scrape_allowed to false and add a note.</li>
            <li>Mark anything older than N months as stale and set confidence low unless reverified.</li>
          </ul>
        </section>
      </main>
    </div>
  );
}
