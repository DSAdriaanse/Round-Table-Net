import { useMemo, useState } from "react";
import { CheckCircle2, ClipboardPaste, Upload } from "lucide-react";
import { createStations } from "@/api";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "@/lib/toast";

type FieldKey = "callsign" | "name" | "city" | "state";
const FIELDS: { key: FieldKey; label: string; aliases: string[] }[] = [
  { key: "callsign", label: "Callsign", aliases: ["call", "callsign", "call sign", "callsigns"] },
  { key: "name", label: "Name", aliases: ["name", "operator", "op", "operator name", "first name", "full name"] },
  { key: "city", label: "City", aliases: ["city", "location", "town", "qth", "locationcity"] },
  { key: "state", label: "State", aliases: ["state", "st", "stateprovince", "province"] },
];
type Mapping = Partial<Record<FieldKey, number>>;

function detectDelimiter(text: string): string {
  const firstLine = text.split(/\r?\n/)[0] || "";
  if (firstLine.includes("\t")) return "\t";
  if (firstLine.includes(",")) return ",";
  return "\t";
}

// Splits one line, handling quoted fields (CSV) and empty columns.
function parseLine(line: string, delim: string): string[] {
  if (delim !== ",") return line.split(delim).map((c) => c.trim());
  const result: string[] = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') { cur += '"'; i++; } else inQuotes = false;
      } else cur += ch;
    } else if (ch === '"') inQuotes = true;
    else if (ch === delim) { result.push(cur.trim()); cur = ""; }
    else cur += ch;
  }
  result.push(cur.trim());
  return result;
}

const normalizeHeader = (h: string) => h.trim().toLowerCase().replace(/[^a-z0-9 ]/g, "").trim();

function autoMapColumns(headers: string[]): Mapping {
  const mapping: Mapping = {};
  const used = new Set<number>();
  for (const field of FIELDS) {
    let best = -1;
    for (let i = 0; i < headers.length; i++) {
      if (used.has(i)) continue;
      const norm = normalizeHeader(headers[i]);
      if (field.aliases.includes(norm)) { best = i; break; }
      if (field.aliases.some((a) => norm.includes(a)) && best === -1) best = i;
    }
    if (best >= 0) { mapping[field.key] = best; used.add(best); }
  }
  return mapping;
}

const NONE = "__none__";

// Paste rows copied from a spreadsheet; columns are detected by their header names.
// Callsigns already on the roster are skipped.
export default function BulkImportDialog({ open, onOpenChange, netId, existingCallsigns, onImported }: {
  open: boolean; onOpenChange: (open: boolean) => void; netId: string; existingCallsigns: Set<string>; onImported: () => void;
}) {
  const [rawText, setRawText] = useState("");
  const [mapping, setMapping] = useState<Mapping>({});
  const [hasHeader, setHasHeader] = useState(true);
  const [importing, setImporting] = useState(false);
  const [result, setResult] = useState<{ created: number; skipped: number; failed: number } | null>(null);

  const parsed = useMemo(() => {
    if (!rawText.trim()) return { headers: [] as string[], rows: [] as string[][] };
    const delim = detectDelimiter(rawText);
    const lines = rawText.trim().split(/\r?\n/).filter((l) => l.trim());
    if (lines.length === 0) return { headers: [], rows: [] };
    const split = (line: string) => parseLine(line, delim);

    let headers: string[];
    let dataLines: string[];
    if (hasHeader) { headers = split(lines[0]); dataLines = lines.slice(1); }
    else { headers = ["Column 1", "Column 2", "Column 3", "Column 4"].slice(0, split(lines[0]).length); dataLines = lines; }

    // Pad short rows so a blank column never shifts data out of line.
    const maxCols = Math.max(headers.length, ...dataLines.map((l) => split(l).length));
    while (headers.length < maxCols) headers.push("");
    const rows = dataLines.map((line) => { const cells = split(line); while (cells.length < maxCols) cells.push(""); return cells; });
    return { headers, rows };
  }, [rawText, hasHeader]);

  // The operator's own choices win; otherwise the columns are guessed from the headers.
  const effective = useMemo<Mapping>(() => {
    const valid: Mapping = {};
    for (const f of FIELDS) { const v = mapping[f.key]; if (v !== undefined && v < parsed.headers.length) valid[f.key] = v; }
    return Object.keys(valid).length > 0 ? valid : autoMapColumns(parsed.headers);
  }, [parsed.headers, mapping]);

  const mappedRows = useMemo(() => parsed.rows.map((row) => {
    const cell = (k: FieldKey) => (effective[k] !== undefined ? row[effective[k]!] : "") || "";
    return { callsign: cell("callsign").trim().toUpperCase(), name: cell("name"), city: cell("city"), state: cell("state").toUpperCase().slice(0, 2) };
  }), [parsed.rows, effective]);

  const validRows = mappedRows.filter((r) => r.callsign);
  const isDup = (cs: string) => existingCallsigns.has(cs);
  // A callsign repeated inside the pasted text counts once.
  const seen = new Set<string>();
  const fresh = validRows.filter((r) => { if (isDup(r.callsign) || seen.has(r.callsign)) return false; seen.add(r.callsign); return true; });
  const dupCount = validRows.length - fresh.length;

  const doImport = async () => {
    if (fresh.length === 0) return;
    setImporting(true);
    try {
      const { created, failed } = await createStations(fresh.map((r) => ({
        callsign: r.callsign, name: r.name || r.callsign, city: r.city, state: r.state,
        net_id: netId, active: true, consecutive_absences: 0,
      })));
      setResult({ created, skipped: dupCount, failed });
      onImported();
    } catch (err) {
      toast.error(`Import failed: ${(err as Error).message}`);
    } finally {
      setImporting(false);
    }
  };

  const reset = () => { setRawText(""); setMapping({}); setResult(null); };
  const close = () => { reset(); onOpenChange(false); };

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) reset(); onOpenChange(o); }}>
      <DialogContent className="bg-gray-900 border-gray-700 text-white max-w-3xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><ClipboardPaste className="w-5 h-5 text-green-400" />Bulk Import from a Spreadsheet</DialogTitle>
        </DialogHeader>

        {result ? (
          <div className="py-6 text-center space-y-3">
            <CheckCircle2 className="w-12 h-12 text-green-400 mx-auto" />
            <p className="text-lg font-medium">Import complete</p>
            <p className="text-gray-400">{result.created} station(s) added, {result.skipped} duplicate(s) skipped{result.failed ? `, ${result.failed} failed` : ""}.</p>
            <Button onClick={close} className="bg-green-600 hover:bg-green-700">Done</Button>
          </div>
        ) : (
          <div className="space-y-4">
            <p className="text-sm text-gray-400">Copy cells from a spreadsheet and paste below. The first row should be column headers. Columns can be in any order and are detected automatically.</p>
            <div>
              <Label htmlFor="bulk-text" className="text-gray-300">Paste data here</Label>
              <textarea id="bulk-text" value={rawText} onChange={(e) => { setRawText(e.target.value); setMapping({}); }}
                placeholder={"Callsign\tName\tCity\tState\nW1AW\tBob Smith\tHartford\tCT\nK2ABC\tJane Doe\tAlbany\tNY"}
                className="w-full h-32 mt-1 bg-gray-800 border border-gray-600 text-white text-sm font-mono p-3 rounded-md resize-y" />
            </div>
            <div className="flex items-center gap-2">
              <input type="checkbox" id="hasHeader" checked={hasHeader} onChange={(e) => { setHasHeader(e.target.checked); setMapping({}); }} className="accent-green-600" />
              <Label htmlFor="hasHeader" className="text-sm text-gray-300 cursor-pointer">First row is column headers</Label>
            </div>

            {parsed.headers.length > 0 && (
              <>
                <div className="border-t border-gray-700 pt-4">
                  <p className="text-sm font-medium text-gray-300 mb-3">Column Mapping</p>
                  <div className="grid sm:grid-cols-2 gap-3">
                    {FIELDS.map((field) => (
                      <div key={field.key}>
                        <Label className="text-xs text-gray-400">{field.label}</Label>
                        <Select value={effective[field.key] !== undefined ? String(effective[field.key]) : NONE}
                          onValueChange={(v) => setMapping({ ...effective, [field.key]: v === NONE ? undefined : Number(v) })}>
                          <SelectTrigger className="bg-gray-800 border-gray-600 text-white mt-1 h-8 text-sm" aria-label={`${field.label} column`}><SelectValue /></SelectTrigger>
                          <SelectContent className="bg-gray-800 border-gray-700">
                            <SelectItem value={NONE} className="text-white text-sm">— None —</SelectItem>
                            {parsed.headers.map((h, i) => <SelectItem key={i} value={String(i)} className="text-white text-sm">{`${i + 1}. ${h || "(empty)"}`}</SelectItem>)}
                          </SelectContent>
                        </Select>
                      </div>
                    ))}
                  </div>
                </div>

                {validRows.length > 0 && (
                  <div className="border-t border-gray-700 pt-4">
                    <div className="flex items-center justify-between mb-2">
                      <p className="text-sm font-medium text-gray-300">Preview ({validRows.length} rows)</p>
                      <p className="text-xs text-green-400">{fresh.length} new · <span className="text-yellow-400">{dupCount} duplicate</span></p>
                    </div>
                    <div className="max-h-48 overflow-y-auto border border-gray-700 rounded-md">
                      <table className="w-full text-xs">
                        <thead className="bg-gray-800/60 sticky top-0">
                          <tr>{["Callsign", "Name", "City", "State"].map((h) => <th key={h} className="text-left text-gray-400 px-3 py-1.5 font-medium">{h}</th>)}</tr>
                        </thead>
                        <tbody>
                          {validRows.slice(0, 100).map((r, i) => (
                            <tr key={i} className={`border-t border-gray-800 ${isDup(r.callsign) ? "opacity-40" : ""}`}>
                              <td className="px-3 py-1.5 font-mono text-green-400">{r.callsign}{isDup(r.callsign) && " ⚠"}</td>
                              <td className="px-3 py-1.5 text-white">{r.name}</td>
                              <td className="px-3 py-1.5 text-gray-400">{r.city}</td>
                              <td className="px-3 py-1.5 text-gray-400">{r.state}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}
              </>
            )}

            <DialogFooter>
              <Button variant="ghost" onClick={() => onOpenChange(false)} className="text-gray-400">Cancel</Button>
              <Button onClick={doImport} disabled={importing || fresh.length === 0} className="bg-green-600 hover:bg-green-700">
                <Upload className="w-4 h-4 mr-2" />{importing ? "Importing..." : `Import ${fresh.length} Station${fresh.length !== 1 ? "s" : ""}`}
              </Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
