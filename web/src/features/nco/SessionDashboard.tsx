import { Activity, UserCheck, UserPlus, Users } from "lucide-react";
import type { CheckIn } from "@/api";
import { useActiveRoster } from "@/hooks/useNetData";

// The row of counters above the tabs: roster size and how many have checked in, by kind.
export default function SessionDashboard({ checkIns, selectedNet }: { checkIns: CheckIn[]; selectedNet: string }) {
  const { data: roster = [] } = useActiveRoster(selectedNet);

  const standard = checkIns.filter((c) => c.status === "checked_in").length;
  const early = checkIns.filter((c) => c.status === "early").length;
  const guests = checkIns.filter((c) => c.status === "guest").length;
  const total = checkIns.filter((c) => c.status !== "not_heard").length;

  const stats = [
    { label: "Roster Stations", value: roster.length, icon: Users, color: "text-blue-400" },
    { label: "Standard Check-Ins", value: standard, icon: UserCheck, color: "text-green-400" },
    { label: "Early Check-Ins", value: early, icon: Activity, color: "text-purple-400" },
    { label: "Guest Check-Ins", value: guests, icon: UserPlus, color: "text-orange-400" },
    { label: "Total Check-Ins", value: total, icon: UserCheck, color: "text-green-300" },
  ];

  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-3">
      {stats.map((s) => (
        <div key={s.label} className="bg-gray-900 border border-gray-700 rounded-lg p-3 text-center">
          <s.icon className={`w-5 h-5 mx-auto mb-1 ${s.color}`} />
          <div className={`text-2xl font-bold ${s.color}`}>{s.value}</div>
          <div className="text-gray-500 text-xs mt-0.5 leading-tight">{s.label}</div>
        </div>
      ))}
    </div>
  );
}
