// Nets: the recurring meetings (name, day, time, script).
import { table } from "./records";
import type { Net } from "./types";

const nets = table<Net>("nets");

export const getNet = (id: string) => nets.get(id);
export const listNets = () => nets.list({ sort: "-created_date" });
export const createNet = (data: Partial<Net>) => nets.create(data);
export const updateNet = (id: string, data: Partial<Net>) => nets.update(id, data);
export const deleteNet = (id: string) => nets.remove(id);
