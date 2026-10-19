import { Link } from "react-router-dom";

// Shown for any web address the app does not recognise.
export default function PageNotFound() {
  return (
    <div className="min-h-screen flex items-center justify-center p-6 bg-gray-950 text-white">
      <div className="max-w-md w-full text-center space-y-4">
        <h1 className="text-7xl font-light text-gray-600">404</h1>
        <p className="text-gray-400">That page does not exist.</p>
        <Link to="/net-control" className="inline-block text-green-400 hover:text-green-300 underline">
          Back to Net Control
        </Link>
      </div>
    </div>
  );
}
