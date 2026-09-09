import "./globals.css";
import type { Metadata } from "next";
import AutoUpdater from "@/components/AutoUpdater";

export const metadata: Metadata = {
  title: "Faktur Tracker",
  description: "Tracking No Faktur, No DO, No SO, dan status print",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="id">
      <body>
        <AutoUpdater />
        {children}
      </body>
    </html>
  );
}
