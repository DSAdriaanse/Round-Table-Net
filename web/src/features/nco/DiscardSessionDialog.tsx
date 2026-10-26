import { useEffect, useRef, useState } from "react";
import { Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { CANCEL_PHRASE, canDiscard, cancelPlan } from "@/lib/cancelSession";

// The only way to throw a session away. Not undoable: the session and its check-ins are deleted
// and nothing reaches the history or WordPress. A session with check-ins makes the operator
// type CANCEL; the safe route (close it properly) is offered right next to it.
export default function DiscardSessionDialog({ open, onOpenChange, checkInCount, onDiscard, onCloseProperly }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  checkInCount: number;
  /** Resolves true when the session was deleted; false leaves the dialog open. */
  onDiscard: () => Promise<boolean>;
  onCloseProperly: () => void;
}) {
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  // Set when the operator picks "Close it properly", so focus goes there instead of back to the link.
  const closeProperly = useRef(false);
  const plan = cancelPlan(checkInCount);

  // Start clean every time the dialog opens.
  useEffect(() => {
    if (open) { setTyped(""); setBusy(false); }
  }, [open]);

  const discard = async () => {
    setBusy(true);
    try {
      if (await onDiscard()) onOpenChange(false);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!busy) onOpenChange(o); }}>
      <DialogContent
        className="bg-gray-900 border-gray-700 text-white"
        onCloseAutoFocus={(e) => {
          if (closeProperly.current) { e.preventDefault(); closeProperly.current = false; onCloseProperly(); }
        }}
      >
        <DialogHeader>
          <DialogTitle className="text-red-400">Discard this session?</DialogTitle>
          <DialogDescription className="text-gray-300">
            For testing and training only. If this was a real net, close it instead so it is recorded.
          </DialogDescription>
        </DialogHeader>

        <p className={`text-sm font-semibold ${plan.needsTyping ? "text-red-300" : "text-gray-300"}`}>{plan.warning}</p>

        {plan.needsTyping && (
          <div>
            <label htmlFor="discard-confirm" className="text-sm text-gray-400">
              Type <span className="font-mono font-bold text-white">{CANCEL_PHRASE}</span> to confirm
            </label>
            <Input
              id="discard-confirm"
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && canDiscard(plan, typed, busy)) discard(); }}
              autoComplete="off"
              className="bg-gray-950 border-gray-700 text-white mt-1 font-mono"
            />
          </div>
        )}

        <DialogFooter className="gap-2 sm:gap-2">
          <Button
            onClick={() => { closeProperly.current = true; onOpenChange(false); }}
            disabled={busy}
            className="bg-green-600 hover:bg-green-700 text-white"
          >
            Close it properly instead
          </Button>
          <Button
            onClick={discard}
            disabled={!canDiscard(plan, typed, busy)}
            variant="ghost"
            className="text-red-400 hover:text-red-300 hover:bg-red-900/30 disabled:opacity-40"
          >
            <Trash2 className="w-4 h-4 mr-2" />{busy ? "Discarding..." : "Discard session"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
