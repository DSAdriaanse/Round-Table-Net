// Sign-in and sign-out. Net control operators type the club PIN; the server checks it
// (POST /api/rt/auth/pin) and returns a normal PocketBase sign-in that lasts 12 hours.
import { pb } from "./pb";
import { post } from "./records";

export const auth = {
  /** True while a stored sign-in exists and has not expired. */
  isAuthenticated: () => pb.authStore.isValid,

  /** Exchange the PIN for a sign-in. Rejects with "Incorrect PIN." when it is wrong. */
  async signInWithPin(pin: string): Promise<void> {
    const res = await post<{ token: string; record: Record<string, unknown> }>("/api/rt/auth/pin", { pin });
    pb.authStore.save(res.token, res.record as never);
  },

  signOut() {
    pb.authStore.clear();
  },

  /** Calls back whenever someone signs in or out (also when the token is cleared elsewhere). */
  onChange: (cb: () => void) => pb.authStore.onChange(cb),
};
