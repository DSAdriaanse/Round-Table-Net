import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { listNets } from "@/api";
import type { Net } from "@/api";

// Which net the operator is working on. Remembered in this browser (localStorage) so a
// reload keeps it; "confirmed" is per tab (sessionStorage) so each visit starts by
// asking which net you are running tonight (see NetSelectionGate).
interface NetContextValue {
  nets: Net[];
  selectedNet: string;
  selectNet: (id: string) => void;
  netConfirmed: boolean;
  confirmNet: () => void;
}

const NetContext = createContext<NetContextValue | null>(null);

// Browser storage can be blocked or full; the app must work without it.
const read = (store: Storage, key: string) => { try { return store.getItem(key) || ""; } catch { return ""; } };
const write = (store: Storage, key: string, value: string) => { try { store.setItem(key, value); } catch { /* ignore */ } };

export function NetProvider({ children }: { children: ReactNode }) {
  const [nets, setNets] = useState<Net[]>([]);
  const [selectedNet, setSelectedNet] = useState(() => read(localStorage, "selectedNetId"));
  const [netConfirmed, setNetConfirmed] = useState(() => read(sessionStorage, "netConfirmed") === "true");

  useEffect(() => {
    listNets().then((n) => {
      setNets(n);
      // Forget a remembered net that no longer exists; default to the first one.
      setSelectedNet((current) => (n.some((x) => x.id === current) ? current : n[0]?.id || ""));
    });
  }, []);

  const selectNet = (id: string) => {
    setSelectedNet(id);
    write(localStorage, "selectedNetId", id);
  };

  const confirmNet = () => {
    setNetConfirmed(true);
    write(sessionStorage, "netConfirmed", "true");
  };

  return <NetContext.Provider value={{ nets, selectedNet, selectNet, netConfirmed, confirmNet }}>{children}</NetContext.Provider>;
}

export function useNet(): NetContextValue {
  const value = useContext(NetContext);
  if (!value) throw new Error("useNet must be used inside <NetProvider>");
  return value;
}
