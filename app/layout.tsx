import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "OUSD(C) AI & Data Solutions | DoD Budget Analytics",
  description:
     "AI, Machine Learning, and Data Analytics solutions for DoD budget analysis at the Office of the Under Secretary of Defense for Comptroller (OUSD(C)).",
  keywords: [
     "DoD budget",
     "AI",
     "machine learning",
     "data analytics",
     "OUSD(C)",
     "defense budget",
     "cost estimation",
     "fiscal policy",
   ],
  openGraph: {
    title: "OUSD(C) AI & Data Solutions",
    description:
       "AI, ML, and data analytics for DoD budget analysis at OUSD(C).",
    type: "website",
   },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
     <html lang="en" className="scroll-smooth">
       <body className="font-sans antialiased">
         {children}
       </body>
     </html>
   );
}
