import { useState } from "react";
import { Navigate, useLocation, useNavigate } from "react-router-dom";
import { Lock, Radio } from "lucide-react";
import { auth } from "@/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useAuth } from "./AuthContext";

// The club PIN screen. The PIN is checked on the server (not in this page), so
// reading this code reveals nothing.
export default function Login() {
  const { isAuthenticated } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const from = (location.state as { from?: string } | null)?.from || "/net-control";

  const [pin, setPin] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  if (isAuthenticated) return <Navigate to={from} replace />;

  const submit = async () => {
    if (!pin.trim() || busy) return;
    setBusy(true);
    setError("");
    try {
      await auth.signInWithPin(pin.trim());
      navigate(from, { replace: true });
    } catch (e) {
      const status = (e as { status?: number }).status;
      setError(
        status === 401 ? "Incorrect PIN. Please try again."
          : status === 429 ? "Too many attempts. Wait a minute and try again."
          : status === 503 ? "Sign-in is not set up on this server yet."
          : "Could not sign in. Check your connection and try again.",
      );
      setPin("");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-950 flex items-center justify-center p-4">
      <div className="bg-gray-900 border border-gray-700 rounded-xl p-8 w-full max-w-sm text-center">
        <div className="flex justify-center mb-4">
          <div className="bg-green-500/20 rounded-full p-3">
            <Radio className="w-8 h-8 text-green-400" />
          </div>
        </div>
        <h1 className="text-white text-xl font-bold mb-1">Net Control Access</h1>
        <p className="text-gray-400 text-sm mb-6">Enter the club PIN to continue</p>
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          <Input
            type="password"
            inputMode="numeric"
            autoComplete="current-password"
            value={pin}
            onChange={(e) => setPin(e.target.value)}
            placeholder="Club PIN"
            aria-label="Club PIN"
            className="bg-gray-800 border-gray-600 text-white text-center text-xl tracking-widest"
            autoFocus
          />
          {error && <p role="alert" className="text-red-400 text-sm">{error}</p>}
          <Button type="submit" disabled={busy || !pin.trim()} className="w-full bg-green-600 hover:bg-green-700">
            <Lock className="w-4 h-4 mr-2" />
            {busy ? "Checking..." : "Unlock"}
          </Button>
        </form>
        <a href="/check-in" className="block text-gray-500 hover:text-gray-300 text-xs mt-6 underline">
          Just checking in to a net? Use the public check-in page
        </a>
      </div>
    </div>
  );
}
