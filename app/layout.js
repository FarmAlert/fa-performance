import { Manrope } from "next/font/google";
import "./perf.css";

// Farm Alert Performance — standalone app (own deployment, own address),
// sharing the Performance System's Supabase data with VetXpress. The staff
// phone app is at "/", the admin at "/admin". Design tokens and Manrope
// type follow the build spec's designs (app/perf.css).
const manrope = Manrope({ subsets: ["latin"], weight: ["400", "500", "600", "700", "800"], display: "swap" });

export const metadata = {
  title: { default: "Farm Alert Performance", template: "%s · Farm Alert Performance" },
  description: "Your day, daily report, rating and ideas, in one place.",
  manifest: "/manifest.webmanifest",
  robots: { index: false, follow: false },
  appleWebApp: { capable: true, title: "FA Performance", statusBarStyle: "black-translucent" },
  icons: { icon: "/icons/icon-192.png", apple: "/icons/icon-192.png" },
};

export const viewport = {
  themeColor: "#0D3B4F",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body className={manrope.className} style={{ margin: 0 }}>
        {children}
      </body>
    </html>
  );
}
