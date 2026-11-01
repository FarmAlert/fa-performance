import "./admin.css";

export const metadata = { title: "Admin" };

// /admin — the desk side of the build spec (section 2: Performance admin
// and viewers), on this app's own address, signed in with the same staff
// account as the phone app. Access is checked on the server for every
// call (lib/perf/admin-auth.js); this layout is only the frame.
export default function AdminLayout({ children }) {
  return <div className="min-h-screen">{children}</div>;
}
