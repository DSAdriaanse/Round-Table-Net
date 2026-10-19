// The shape of every record the server sends, matching backend/pb_migrations/1760000000_schema.js.
// When you change a field in the schema, change it here too and the compiler lists every screen
// that needs to follow. PocketBase sends "" for an empty text field, 0 for an empty number and
// false for an empty switch, never null, so these types do not use null for stored values.

export interface BaseRecord {
  id: string;
  created_date: string;
  updated_date: string;
}

export type DayOfWeek = "Monday" | "Tuesday" | "Wednesday" | "Thursday" | "Friday" | "Saturday" | "Sunday";

export interface Net extends BaseRecord {
  name: string;
  day_of_week: DayOfWeek;
  time: string;
  frequency: string;
  /** Rich text (HTML) the operator reads aloud to open. May contain [/TOPIC] and [/ANNOUNCEMENTS]. */
  preamble: string;
  closing: string;
}

export interface Station extends BaseRecord {
  callsign: string;
  name: string;
  city: string;
  state: string;
  /** 0 and 0 mean "no coordinates". */
  lat: number;
  lng: number;
  net_id: string;
  permanent_attendance: boolean;
  active: boolean;
  consecutive_absences: number;
  needs_review: boolean;
}

export type SessionStatus = "open" | "pending" | "closed";

export interface NetSession extends BaseRecord {
  net_id: string;
  net_name: string;
  /** YYYY-MM-DD */
  date: string;
  status: SessionStatus;
  nco_callsign: string;
  topic: string;
  notes: string;
  opened_at: string;
  closed_at: string;
  roster_updated: boolean;
  technical_difficulty: boolean;
  checkin_count: number;
}

export type CheckInStatus = "checked_in" | "short_time" | "early" | "not_heard" | "guest";

export interface CheckIn extends BaseRecord {
  session_id: string;
  net_id: string;
  callsign: string;
  station_id: string;
  status: CheckInStatus;
  comment: string;
  name: string;
  location: string;
}

export interface Announcement extends BaseRecord {
  /** Rich text (HTML). */
  text: string;
  order: number;
  active: boolean;
}

export interface Settings extends BaseRecord {
  club_name: string;
  wordpress_url: string;
  wordpress_username: string;
  wordpress_category: string;
  publish_on_close: boolean;
}

/** A live update from the server about one record. */
export interface ChangeEvent<T> {
  type: "create" | "update" | "delete";
  id: string;
  data: T;
}

/** What the public check-in page may know about a net. */
export interface PublicNet {
  id: string;
  name: string;
  day_of_week: DayOfWeek;
  time: string;
  frequency: string;
  is_live: boolean;
}

export interface PublicSession {
  net: Pick<Net, "id" | "name" | "day_of_week" | "time">;
  session: { id: string; date: string; topic: string } | null;
  check_ins: { callsign: string; status: CheckInStatus }[];
}

export type PublicCheckInResult = "checked_in" | "already" | "no_session";
