import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { auth } from "@/api";

// Whether someone is signed in, kept in step with the stored sign-in (it can also end
// by itself after 12 hours, or in another tab). Screens use useAuth(); they never read
// the token themselves.
interface AuthValue {
  isAuthenticated: boolean;
  signOut: () => void;
}

const AuthCtx = createContext<AuthValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [isAuthenticated, setAuthenticated] = useState(() => auth.isAuthenticated());

  useEffect(() => auth.onChange(() => setAuthenticated(auth.isAuthenticated())), []);

  return <AuthCtx.Provider value={{ isAuthenticated, signOut: auth.signOut }}>{children}</AuthCtx.Provider>;
}

export function useAuth(): AuthValue {
  const value = useContext(AuthCtx);
  if (!value) throw new Error("useAuth must be used inside <AuthProvider>");
  return value;
}
