import { useState } from "react";
import { Link, NavLink, Outlet } from "react-router-dom";
import CreditLine from "@/components/CreditLine";
import GroupLogo from "@/components/GroupLogo";
import { BookOpen, Cog, ChevronDown, Globe, History, LayoutDashboard, List, LogOut, Megaphone, Menu, Printer, Radio, Settings, X, type LucideIcon } from "lucide-react";
import { NetProvider, useNet } from "@/components/NetContext";
import NetSelectionGate from "@/components/NetSelectionGate";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useAuth } from "@/features/auth/AuthContext";

// The sidebar around every signed-in screen (a slide-out menu on a phone).
// To add a screen to the menu, add it to navGroups and give it a route in App.tsx.
interface NavItem { label: string; to: string; icon: LucideIcon; highlight?: boolean }
const navGroups: { label: string | null; items: NavItem[] }[] = [
  { label: null, items: [{ label: "Net Control", to: "/net-control", icon: Radio, highlight: true }] },
  {
    label: "Net Management",
    items: [
      { label: "Net Dashboard", to: "/dashboard", icon: LayoutDashboard },
      { label: "Roster Manager", to: "/roster", icon: List },
      { label: "Manage Nets", to: "/nets", icon: Settings },
    ],
  },
  { label: "Reporting", items: [{ label: "Session History", to: "/history", icon: History }] },
  {
    label: "Other Tools",
    items: [
      { label: "Public Check-In", to: "/check-in", icon: Globe },
      { label: "Announcements", to: "/announcements", icon: Megaphone },
      { label: "Print Net Sheet", to: "/print-sheet", icon: Printer },
    ],
  },
  { label: "Help", items: [{ label: "NCO Guide", to: "/guide", icon: BookOpen }, { label: "Settings", to: "/settings", icon: Cog }] },
];

function SidebarContent({ collapsed, onNavigate }: { collapsed: boolean; onNavigate?: () => void }) {
  const { nets, selectedNet, selectNet } = useNet();
  const { signOut } = useAuth();

  return (
    <>
      {/* Net selector */}
      {!collapsed && nets.length > 0 && (
        <div className="px-3 py-3 border-b border-gray-800">
          <p className="text-gray-600 text-xs uppercase tracking-wide mb-1.5">Active Net</p>
          <Select value={selectedNet} onValueChange={selectNet}>
            <SelectTrigger className="w-full bg-gray-800 border-gray-700 text-white text-sm h-8" aria-label="Active net">
              <SelectValue placeholder="Select net..." />
            </SelectTrigger>
            <SelectContent className="bg-gray-800 border-gray-700">
              {nets.map((n) => (
                <SelectItem key={n.id} value={n.id} className="text-white text-sm">{n.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}
      {collapsed && nets.length > 0 && (
        <div className="px-1.5 py-2 border-b border-gray-800">
          <div className="w-full h-8 bg-gray-800 border border-gray-700 rounded flex items-center justify-center" title={nets.find((n) => n.id === selectedNet)?.name}>
            <ChevronDown className="w-3.5 h-3.5 text-gray-400" />
          </div>
        </div>
      )}

      <nav className="flex-1 py-3 px-1.5 space-y-4 overflow-y-auto">
        {navGroups.map((group, gi) => (
          <div key={gi}>
            {group.label && !collapsed && <p className="text-gray-600 text-xs uppercase tracking-widest px-2.5 mb-1">{group.label}</p>}
            <div className="space-y-0.5">
              {group.items.map(({ label, to, icon: Icon, highlight }) => (
                <NavLink key={to} to={to} onClick={onNavigate} title={collapsed ? label : undefined}>
                  {({ isActive }) => (
                    <div
                      className={`flex items-center gap-3 px-2.5 py-2 rounded-lg text-sm transition-colors cursor-pointer ${
                        highlight
                          ? isActive ? "bg-red-700 text-white font-bold" : "bg-red-700/80 text-white font-bold hover:bg-red-600"
                          : isActive ? "bg-green-700/30 text-green-400 font-medium" : "text-gray-400 hover:bg-gray-800 hover:text-white"
                      }`}
                    >
                      <Icon className="w-4 h-4 shrink-0" />
                      {!collapsed && <span className="truncate">{label}</span>}
                    </div>
                  )}
                </NavLink>
              ))}
            </div>
          </div>
        ))}
      </nav>

      <div className={`px-3 py-3 border-t border-gray-800 flex items-center ${collapsed ? "justify-between" : "justify-end"}`}>
        <button onClick={signOut} title="Sign out" aria-label="Sign out" className="text-gray-500 hover:text-white p-1 rounded">
          <LogOut className="w-4 h-4" />
        </button>
      </div>
    </>
  );
}

function LayoutInner() {
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const { nets, netConfirmed } = useNet();

  if (nets.length > 0 && !netConfirmed) return <NetSelectionGate />;

  // The shell is exactly one screen tall: the sidebar stays put and only the main area
  // scrolls, so the footer sits at the bottom edge instead of pushing the page past 100%.
  return (
    <div className="flex h-[100dvh] overflow-hidden bg-gray-950 text-white print:h-auto print:overflow-visible">
      {/* Phone: top bar with a menu button, and a slide-out menu */}
      <div className="md:hidden fixed top-0 inset-x-0 z-30 h-12 bg-gray-900 border-b border-gray-800 flex items-center gap-3 px-3">
        <button onClick={() => setMobileOpen(true)} aria-label="Open menu" className="text-gray-300 p-1"><Menu className="w-5 h-5" /></button>
        <Link to="/net-control" className="flex items-center gap-2 font-bold text-sm"><Radio className="w-4 h-4 text-green-400" />Round Table Net</Link>
      </div>
      {mobileOpen && (
        <div className="md:hidden fixed inset-0 z-40 flex">
          <aside className="w-64 bg-gray-900 border-r border-gray-800 flex flex-col">
            <GroupLogo />
            <div className="flex items-center justify-between px-3 py-3 border-b border-gray-800">
              <span className="font-bold text-sm">Round Table Net</span>
              <button onClick={() => setMobileOpen(false)} aria-label="Close menu" className="text-gray-400 p-1"><X className="w-4 h-4" /></button>
            </div>
            <SidebarContent collapsed={false} onNavigate={() => setMobileOpen(false)} />
          </aside>
          <div className="flex-1 bg-black/60" onClick={() => setMobileOpen(false)} />
        </div>
      )}

      {/* Wide screen: fixed sidebar */}
      <aside className={`hidden md:flex ${collapsed ? "w-14" : "w-52"} flex-shrink-0 bg-gray-900 border-r border-gray-800 flex-col transition-all duration-200`}>
        <GroupLogo collapsed={collapsed} />
        <div className="flex items-center gap-3 px-3 py-4 border-b border-gray-800">
          <button onClick={() => setCollapsed(!collapsed)} aria-label={collapsed ? "Expand menu" : "Collapse menu"} className="text-gray-400 hover:text-white p-1 rounded">
            {collapsed ? <Menu className="w-5 h-5" /> : <X className="w-4 h-4" />}
          </button>
          {!collapsed && (
            <div className="flex items-center gap-2 overflow-hidden">
              <Radio className="w-5 h-5 text-green-400 shrink-0" />
              <span className="font-bold text-sm text-white truncate">Round Table Net</span>
            </div>
          )}
        </div>
        <SidebarContent collapsed={collapsed} />
      </aside>

      <main className="relative print:static flex-1 min-w-0 overflow-y-auto flex flex-col pt-12 md:pt-0 print:overflow-visible">
        <Outlet />
        <CreditLine />
      </main>
    </div>
  );
}

export default function Layout() {
  return (
    <NetProvider>
      <LayoutInner />
    </NetProvider>
  );
}
