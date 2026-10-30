// The ONLY door between the screens and the server. Pages import from "@/api"
// and never from "pocketbase" directly.
//   nets.ts          the recurring nets and their scripts
//   stations.ts      the roster
//   sessions.ts      sessions, close, roster update, WordPress report
//   checkIns.ts      check-ins
//   announcements.ts announcements for the opening
//   settings.ts      app settings
//   public.ts        the no-sign-in routes for the public check-in page
//   chat.ts          team chat through Slack (status and test message)
//   auth.ts          PIN sign-in and sign-out
//   pb               the raw PocketBase client (rarely needed)
// To add something: put a named function in the matching file and export it here.
export { pb } from "./pb";
export type * from "./types";
export type { RouteError } from "./records";
export * from "./nets";
export * from "./stations";
export * from "./sessions";
export * from "./checkIns";
export * from "./announcements";
export * from "./settings";
export * from "./public";
export * from "./chat";
export { auth } from "./auth";
export * from "./geocode";
