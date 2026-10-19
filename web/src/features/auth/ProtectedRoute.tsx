import { Navigate, Outlet, useLocation } from "react-router-dom";
import { useAuth } from "./AuthContext";

// Everything inside this route needs a PIN sign-in. Anyone else is sent to /login and
// comes back to the page they asked for. This only hides screens; the server refuses
// the data to anyone who is not signed in.
export default function ProtectedRoute() {
  const { isAuthenticated } = useAuth();
  const location = useLocation();
  if (!isAuthenticated) return <Navigate to="/login" replace state={{ from: location.pathname + location.search }} />;
  return <Outlet />;
}
