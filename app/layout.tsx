import type { Metadata } from "next";
import "./globals.css";

const SITE = process.env.NEXT_PUBLIC_SITE_URL || "https://datamatter.vercel.app";

export const metadata: Metadata = {
  metadataBase: new URL(SITE),
  title: {
    default: "datamatter · Department of War budget analytics",
    template: "%s",
  },
  description:
    "Budget formulation, execution, and audit analytics over the USASpending account and award warehouse and a curated DoD financial-management knowledge bank. Every figure names its source and vintage.",
  keywords: [
    "budget execution", "Statement of Budgetary Resources", "USASpending",
    "Department of War", "DoD budget", "obligations", "outlays",
    "financial management", "audit readiness", "FPDS",
  ],
  openGraph: {
    type: "website",
    siteName: "datamatter",
    title: "datamatter · Department of War budget analytics",
    description:
      "From appropriated authority to obligation to outlay, with every figure carrying its source and vintage.",
  },
  robots: { index: true, follow: true },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="scroll-smooth">
      <body className="font-sans antialiased" data-palette="#3987e5,#d95926,#199e70,#c98500,#d55181">
        {children}
      </body>
    </html>
  );
}
