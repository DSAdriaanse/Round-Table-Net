import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Settings as SettingsIcon } from "lucide-react";
import { getSettings, logoUrl, removeLogo, updateSettings, uploadLogo } from "@/api";
import type { Settings as SettingsRecord } from "@/api";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { LOGO_TYPES, MAX_LOGO_PX, logoProblem } from "@/lib/logo";
import { tileLayerFor } from "@/lib/tileConfig";
import { toast } from "@/lib/toast";

type Form = Pick<SettingsRecord, "club_name" | "wordpress_url" | "wordpress_username" | "wordpress_category" | "publish_on_close" | "map_tile_url" | "map_attribution" | "map_api_key">;

// Club name and WordPress details. The WordPress password, the club PIN and the AI key are
// secrets and live in the server's env file, not here (see docs/deployment.md).
export default function Settings() {
  const queryClient = useQueryClient();
  const [record, setRecord] = useState<SettingsRecord | null>(null);
  const [form, setForm] = useState<Form | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [logoBusy, setLogoBusy] = useState(false);
  const [logoError, setLogoError] = useState("");
  const fileInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    getSettings().then(
      (s) => {
        if (!s) { setError("The settings record is missing. Restart the server so the database setup can run."); return; }
        setRecord(s);
        setForm({ club_name: s.club_name, wordpress_url: s.wordpress_url, wordpress_username: s.wordpress_username, wordpress_category: s.wordpress_category, publish_on_close: s.publish_on_close, map_tile_url: s.map_tile_url || "", map_attribution: s.map_attribution || "", map_api_key: s.map_api_key || "" });
      },
      (e) => setError(`Could not load settings: ${e.message}`),
    );
  }, []);

  // The picture's pixel size is read in the browser, because the server cannot read it.
  const imageSize = (file: File) => new Promise<{ width: number; height: number }>((resolve) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => { resolve({ width: img.naturalWidth, height: img.naturalHeight }); URL.revokeObjectURL(url); };
    img.onerror = () => { resolve({ width: 0, height: 0 }); URL.revokeObjectURL(url); };
    img.src = url;
  });

  const saved = (next: SettingsRecord) => {
    setRecord(next);
    queryClient.setQueryData(["settings"], next); // the sidebar picks it up at once
  };

  const pickLogo = async (file: File | undefined) => {
    if (!file || !record) return;
    setLogoError("");
    const { width, height } = await imageSize(file);
    const problem = logoProblem(file, width, height);
    if (problem) { setLogoError(problem); return; }
    setLogoBusy(true);
    try {
      saved(await uploadLogo(record.id, file));
      toast.success("Logo saved");
    } catch (e) {
      setLogoError(`Could not upload: ${(e as Error).message}`);
    } finally {
      setLogoBusy(false);
      if (fileInput.current) fileInput.current.value = "";
    }
  };

  const dropLogo = async () => {
    if (!record) return;
    setLogoBusy(true);
    setLogoError("");
    try {
      saved(await removeLogo(record.id));
      toast.success("Logo removed");
    } catch (e) {
      setLogoError(`Could not remove: ${(e as Error).message}`);
    } finally {
      setLogoBusy(false);
    }
  };

  const save = async () => {
    if (!record || !form) return;
    setSaving(true);
    try {
      const saved = await updateSettings(record.id, { ...form, wordpress_url: form.wordpress_url.trim(), wordpress_username: form.wordpress_username.trim(), wordpress_category: form.wordpress_category.trim(), map_tile_url: form.map_tile_url.trim(), map_attribution: form.map_attribution.trim(), map_api_key: form.map_api_key.trim() });
      setRecord(saved);
      queryClient.setQueryData(["settings"], saved); // the map picks up the new tiles at once
      toast.success("Settings saved");
    } catch (e) {
      toast.error(`Could not save: ${(e as Error).message}`);
    } finally {
      setSaving(false);
    }
  };

  const tilesProblem = form ? tileLayerFor(form).problem : "";

  return (
    <div className="min-h-screen bg-gray-950 text-white p-4 sm:p-6">
      <div className="max-w-2xl mx-auto">
        <div className="flex items-center gap-3 mb-6">
          <SettingsIcon className="w-6 h-6 text-gray-400" />
          <h1 className="text-2xl font-bold">Settings</h1>
        </div>
        {error && <p role="alert" className="text-red-400 text-sm mb-4">{error}</p>}
        {form && (
          <Card className="bg-gray-900 border-gray-700">
            <CardHeader><CardTitle className="text-white text-lg">Club and WordPress</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              <div><Label htmlFor="s-club">Club name</Label><Input id="s-club" value={form.club_name} onChange={(e) => setForm({ ...form, club_name: e.target.value })} className="bg-gray-800 border-gray-600 text-white mt-1" /></div>
              <div><Label htmlFor="s-wp-url">WordPress site address</Label><Input id="s-wp-url" type="url" value={form.wordpress_url} onChange={(e) => setForm({ ...form, wordpress_url: e.target.value })} placeholder="https://www.example.org" className="bg-gray-800 border-gray-600 text-white mt-1" /></div>
              <div><Label htmlFor="s-wp-user">WordPress username</Label><Input id="s-wp-user" value={form.wordpress_username} onChange={(e) => setForm({ ...form, wordpress_username: e.target.value })} className="bg-gray-800 border-gray-600 text-white mt-1" /></div>
              <div><Label htmlFor="s-wp-cat">WordPress category (slug)</Label><Input id="s-wp-cat" value={form.wordpress_category} onChange={(e) => setForm({ ...form, wordpress_category: e.target.value })} className="bg-gray-800 border-gray-600 text-white mt-1" /></div>
              <div className="flex items-start gap-3 pt-1">
                <Switch id="s-pub" checked={form.publish_on_close} onCheckedChange={(v) => setForm({ ...form, publish_on_close: v })} className="mt-0.5" />
                <Label htmlFor="s-pub" className="cursor-pointer">Post the report to WordPress when a session is closed<span className="block text-xs text-gray-500 font-normal mt-0.5">Needs the site address and username above, and the WordPress application password in the server's env file.</span></Label>
              </div>
              <Button onClick={save} disabled={saving} className="bg-green-600 hover:bg-green-700">{saving ? "Saving..." : "Save settings"}</Button>
            </CardContent>
          </Card>
        )}
        {record && (
          <Card className="bg-gray-900 border-gray-700 mt-6">
            <CardHeader><CardTitle className="text-white text-lg">Group logo</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              <p className="text-sm text-gray-400">Shown at the top of the menu. PNG, JPG or WebP, up to {MAX_LOGO_PX} x {MAX_LOGO_PX} pixels and 1 MB. A PNG with a transparent background works. It is scaled to the width of the menu (a small logo is enlarged, so a sharp {MAX_LOGO_PX}-pixel one looks best).</p>
              {record.logo && (
                <div className="w-52 rounded-lg bg-gray-900 border border-gray-800 px-3 py-3" aria-label="Logo preview">
                  <img src={logoUrl(record)} alt="Current logo" className="w-full max-h-32 object-contain" />
                </div>
              )}
              <div className="flex flex-wrap gap-3">
                <input ref={fileInput} id="s-logo" type="file" accept={LOGO_TYPES.join(",")} className="sr-only" aria-label="Choose logo file" onChange={(e) => pickLogo(e.target.files?.[0])} />
                <Button onClick={() => fileInput.current?.click()} disabled={logoBusy} className="bg-green-600 hover:bg-green-700">{logoBusy ? "Working..." : record.logo ? "Replace logo" : "Upload logo"}</Button>
                {record.logo && <Button onClick={dropLogo} disabled={logoBusy} variant="outline" className="border-gray-600 text-gray-300 bg-transparent hover:bg-gray-800">Remove logo</Button>}
              </div>
              {logoError && <p role="alert" className="text-sm text-red-400">{logoError}</p>}
            </CardContent>
          </Card>
        )}
        {form && (
          <Card className="bg-gray-900 border-gray-700 mt-6">
            <CardHeader><CardTitle className="text-white text-lg">Map</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              <p className="text-sm text-gray-400">Map tile providers now want an API key. CARTO's is free for non-profits: request one at <span className="text-green-400">carto.com/basemaps/apikey</span>, then use the tile address below with that key. Without a key the map still loads but carries an "API KEY REQUIRED" watermark. Any other provider works the same way: paste its tile address with <code className="text-green-400">{"{key}"}</code> where the key goes.</p>
              <p className="text-sm text-gray-400">CARTO dark: <code className="text-green-400 break-all">https://basemaps.cartocdn.com/rastertiles/dark_all/{"{z}/{x}/{y}"}.png?key={"{key}"}</code> with the credit <span className="text-gray-300">© OpenStreetMap contributors, © CARTO</span>. Check the provider's current docs for the exact address.</p>
              <div><Label htmlFor="s-tile-url">Tile address</Label><Input id="s-tile-url" value={form.map_tile_url} onChange={(e) => setForm({ ...form, map_tile_url: e.target.value })} placeholder="https://.../{z}/{x}/{y}.png?key={key}" className="bg-gray-800 border-gray-600 text-white mt-1 font-mono text-sm" /></div>
              <div><Label htmlFor="s-tile-key">API key</Label><Input id="s-tile-key" value={form.map_api_key} onChange={(e) => setForm({ ...form, map_api_key: e.target.value })} autoComplete="off" className="bg-gray-800 border-gray-600 text-white mt-1 font-mono text-sm" />
                <span className="block text-xs text-gray-500 mt-1">Anyone who opens the map can see this key in their browser, so restrict it to this site's address in the provider's dashboard.</span></div>
              <div><Label htmlFor="s-tile-credit">Credit line</Label><Input id="s-tile-credit" value={form.map_attribution} onChange={(e) => setForm({ ...form, map_attribution: e.target.value })} placeholder="© OpenStreetMap contributors, © CARTO" className="bg-gray-800 border-gray-600 text-white mt-1" />
                <span className="block text-xs text-gray-500 mt-1">The credit the provider asks you to show on the map.</span></div>
              {tilesProblem && <p role="alert" className="text-sm text-yellow-400">{tilesProblem} The map is using CARTO's tiles without a key until this is fixed, which shows a watermark.</p>}
              <Button onClick={save} disabled={saving} className="bg-green-600 hover:bg-green-700">{saving ? "Saving..." : "Save settings"}</Button>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
