// The credit line at the bottom of every screen. Hidden when printing so it stays off the net sheet.
export default function CreditLine() {
  return (
    <footer className="text-center text-xs text-gray-500 px-4 py-4 print:hidden">
      Round Table Net &copy; 2026 David Adriaanse
    </footer>
  );
}
