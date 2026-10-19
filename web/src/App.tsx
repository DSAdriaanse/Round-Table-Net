import { Toaster } from "@/components/ui/toaster"
import { QueryClientProvider } from '@tanstack/react-query'
import { queryClientInstance } from '@/lib/query-client'
import { BrowserRouter as Router, Route, Routes, Navigate } from 'react-router-dom';
import PageNotFound from '@/lib/PageNotFound';
import { AuthProvider } from '@/features/auth/AuthContext';
import ScrollToTop from '@/components/ScrollToTop';
import Layout from '@/components/Layout';
import ProtectedRoute from '@/features/auth/ProtectedRoute';
import Login from '@/features/auth/Login';
import NetControl from '@/features/nco/NetControl';
import PublicCheckin from '@/features/checkin/PublicCheckin';

// THE MAP OF THE APP: which web address shows which screen, and who may see it.
//   /login, /check-in   open to everyone (the PIN screen, and the public check-in page)
//   everything else     needs the club PIN (ProtectedRoute)
// These guards only hide screens. The real enforcement is on the server.
//
// CUTOVER ALIASES (remove after the old app is switched off): the old app used page names as
// addresses and its public check-in link was shared and printed. These keep those links working.
//   /PublicCheckin?net_id=...   same as /check-in?net_id=...
//   /NCOControl, /Home          same as /net-control
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
