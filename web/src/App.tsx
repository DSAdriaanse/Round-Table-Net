import { Toaster } from "@/components/ui/toaster"
import { QueryClientProvider } from '@tanstack/react-query'
import { queryClientInstance } from '@/lib/query-client'
import { BrowserRouter as Router, Route, Routes, Navigate, useLocation } from 'react-router-dom';
import PageNotFound from '@/lib/PageNotFound';
import { AuthProvider } from '@/features/auth/AuthContext';
import ScrollToTop from '@/components/ScrollToTop';
import Layout from '@/components/Layout';
import ProtectedRoute from '@/features/auth/ProtectedRoute';
import Login from '@/features/auth/Login';
import NetControl from '@/features/nco/NetControl';
import PublicCheckin from '@/features/checkin/PublicCheckin';
import NetDashboard from '@/features/dashboard/NetDashboard';
import RosterManager from '@/features/roster/RosterManager';
import NetsManager from '@/features/nets/NetsManager';
import PrintNetSheet from '@/features/nets/PrintNetSheet';
import SessionHistory from '@/features/history/SessionHistory';
import SessionReport from '@/features/history/SessionReport';
import AnnouncementsManager from '@/features/announcements/AnnouncementsManager';
import Instructions from '@/features/guide/Instructions';
import Settings from '@/features/settings/Settings';

// THE MAP OF THE APP: which web address shows which screen, and who may see it.
//   /login, /check-in   open to everyone (the PIN screen, and the public check-in page)
//   everything else     needs the club PIN (ProtectedRoute)
// These guards only hide screens. The real enforcement is on the server.
//
// CUTOVER ALIASES (remove after the old app is switched off): the old app used page names as
// addresses and its public check-in link was shared and printed. These keep those links working.
//   /PublicCheckin?net_id=...   same as /check-in?net_id=...
//   /NCOControl, /Home          same as /net-control
//   /NetDashboard /RosterManager /NetsManager /SessionHistory /SessionReport?session_id=...
//   /AnnouncementsManager /PrintNetSheet /Instructions   same as the new addresses below
const LEGACY: Record<string, string> = {
  "/NetDashboard": "/dashboard", "/RosterManager": "/roster", "/NetsManager": "/nets",
  "/SessionHistory": "/history", "/SessionReport": "/session-report",
  "/AnnouncementsManager": "/announcements", "/PrintNetSheet": "/print-sheet", "/Instructions": "/guide",
};
// Sends an old address to its new one, keeping ?session_id=... and the like.
function LegacyRedirect() {
  const { pathname, search } = useLocation();
  return <Navigate to={(LEGACY[pathname] || "/net-control") + search} replace />;
}
const AuthenticatedApp = () => (
  <Routes>
    <Route path="/login" element={<Login />} />
    <Route path="/check-in" element={<PublicCheckin />} />
    <Route path="/PublicCheckin" element={<PublicCheckin />} />
    <Route element={<ProtectedRoute />}>
      <Route element={<Layout />}>
        <Route path="/" element={<Navigate to="/net-control" replace />} />
        <Route path="/Home" element={<Navigate to="/net-control" replace />} />
        <Route path="/NCOControl" element={<Navigate to="/net-control" replace />} />
        <Route path="/net-control" element={<NetControl />} />
        <Route path="/dashboard" element={<NetDashboard />} />
        <Route path="/roster" element={<RosterManager />} />
        <Route path="/nets" element={<NetsManager />} />
        <Route path="/history" element={<SessionHistory />} />
        <Route path="/session-report" element={<SessionReport />} />
        <Route path="/announcements" element={<AnnouncementsManager />} />
        <Route path="/print-sheet" element={<PrintNetSheet />} />
        <Route path="/guide" element={<Instructions />} />
        <Route path="/settings" element={<Settings />} />
        {Object.keys(LEGACY).map((path) => <Route key={path} path={path} element={<LegacyRedirect />} />)}
      </Route>
    </Route>
    <Route path="*" element={<PageNotFound />} />
  </Routes>
);

// App = the outer wrappers every screen sits inside: sign-in state, the data cache,
// the router, and the pop-up message area (Toaster).
function App() {
  return (
    <AuthProvider>
      <QueryClientProvider client={queryClientInstance}>
        <Router>
          <ScrollToTop />
          <AuthenticatedApp />
        </Router>
        <Toaster />
      </QueryClientProvider>
    </AuthProvider>
  )
}

export default App
