// Announcements read aloud in the opening (the [/ANNOUNCEMENTS] part of the script).
import { table } from "./records";
import type { Announcement } from "./types";

const announcements = table<Announcement>("announcements");

/** All announcements in reading order. */
export const listAnnouncements = async () => (await announcements.list({ sort: "order" })).sort((a, b) => (a.order || 0) - (b.order || 0));
export const createAnnouncement = (data: Partial<Announcement>) => announcements.create(data);
export const updateAnnouncement = (id: string, data: Partial<Announcement>) => announcements.update(id, data);
export const deleteAnnouncement = (id: string) => announcements.remove(id);
