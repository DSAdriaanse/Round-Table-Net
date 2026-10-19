import { useState } from "react";
import { ChevronRight, Radio } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useNet } from "@/components/NetContext";

// Shown once per visit: confirm which net you are running before any screen loads, so
// nobody logs a session against the wrong net.
export default function NetSelectionGate() {
  const { nets, selectedNet, selectNet, confirmNet } = useNet();
  const [localSel, setLocalSel] = useState(selectedNet || "");

  const chosen = nets.find((n) => n.id === localSel);

  const handleConfirm = () => {
    if (!localSel) return;
    selectNet(localSel);
    confirmNet();
  };

  return (
    <div className="min-h-screen bg-gray-950 text-white flex items-center justify-center p-6">
      <div className="max-w-md w-full">
        <div className="text-center mb-8">
          <Radio className="w-12 h-12 text-green-400 mx-auto mb-4" />
          <h1 className="text-2xl font-bold">Select a Net</h1>
          <p className="text-gray-400 mt-2 text-sm">Confirm which net you are operating tonight before proceeding.</p>
        </div>

        <div className="space-y-2 mb-6">
          {nets.map((n) => (
            <button
              key={n.id}
              onClick={() => setLocalSel(n.id)}
              className={`w-full text-left p-4 rounded-lg border-2 transition-all ${
                localSel === n.id ? "border-green-500 bg-green-900/30" : "border-gray-700 bg-gray-900 hover:border-gray-500"
              }`}
            >
              <div className="flex items-center justify-between">
                <div>
                  <p className="font-bold text-white">{n.name}</p>
                  <p className="text-gray-400 text-xs mt-0.5">
                    {n.day_of_week} · {n.time}
                    {n.frequency ? ` · ${n.frequency}` : ""}
                  </p>
                </div>
                {localSel === n.id && (
                  <div className="w-5 h-5 rounded-full bg-green-500 flex items-center justify-center shrink-0">
                    <ChevronRight className="w-3 h-3 text-gray-900" />
                  </div>
                )}
              </div>
            </button>
          ))}
        </div>

        <Button onClick={handleConfirm} disabled={!localSel} className="w-full bg-green-600 hover:bg-green-700 h-11 text-base">
          Confirm & Continue
        </Button>

        {chosen && (
          <p className="text-center text-gray-500 text-xs mt-4">
            You are about to operate: <span className="text-green-400 font-semibold">{chosen.name}</span>
          </p>
        )}
      </div>
    </div>
  );
}
