import { useEffect, useState } from "react";
import { Settings as SettingsIcon } from "lucide-react";
import { getSettings, updateSettings } from "@/api";
import type { Settings as SettingsRecord } from "@/api";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { toast } from "@/lib/toast";

type Form = Pick<SettingsRecord, "club_name" | "wordpress_url" | "wordpress_username" | "wordpress_category" | "publish_on_close">;

// Club name and WordPress details. The WordPress password, the club PIN and the AI key are
// secrets and live in the server's env file, not here (see docs/deployment.md).
export default function Settings() {
  const [record, setRecord] = useState<SettingsRecord | null>(null);
  const [form, setForm] = useState<Form | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    getSettings().then(
      (s) => {
        if (!s) { setError("The settings record is missing. Restart the server so the database setup can run."); return; }
        setRecord(s);
        setForm({ club_name: s.club_name, wordpress_url: s.wordpress_url, wordpress_username: s.wordpress_username, wordpress_category: s.wordpress_category, publish_on_close: s.publish_on_close });
      },
      (e) => setError(`Could not load settings: ${e.message}`),
    );
  }, []);

  const save = async () => {
    if (!record || !form) return;
    setSaving(true);
    try {
      const saved = await updateSettings(record.id, { ...form, wordpress_url: form.wordpress_url.trim(), wordpress_username: form.wordpress_username.trim(), wordpress_category: form.wordpress_category.trim() });
      setRecord(saved);
      toast.success("Settings saved");
    } catch (e) {
      toast.error(`Could not save: ${(e as Error).message}`);
    } finally {
      setSaving(false);
    }
  };

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
      </div>
    </div>
  );
}
