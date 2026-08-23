import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "DoD AI & Data Solutions | Budget Analytics",
  description:
     "AI, Machine Learning, and Data Analytics solutions for Department of Defense budget analysis.",
  keywords: [
     "DoD budget",
     "AI",
     "machine learning",
     "data analytics",
     "DoD",
     "defense budget",
     "cost estimation",
     "fiscal policy",
   ],
  openGraph: {
    title: "DoD AI & Data Solutions",
    description:
       "AI, ML, and data analytics for Department of Defense budget analysis.",
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
