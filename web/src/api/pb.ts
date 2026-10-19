// The one PocketBase client for the whole app. The browser keeps the sign-in token
// for you in localStorage, so a page reload does not sign people out.
// In dev, Vite proxies /api to PocketBase. In production, Nginx serves both from one origin.
import PocketBase from "pocketbase";

export const pb = new PocketBase(import.meta.env.VITE_PB_URL || window.location.origin);
// Several requests (roster, check-ins) fire at once; do not cancel the earlier ones.
pb.autoCancellation(false);
