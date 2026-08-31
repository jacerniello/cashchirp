import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import { Navbar } from "@/components/Navbar";
import { SiteBanner } from "@/components/SiteBanner";
import { Providers } from "@/lib/providers";
import { InvestingChrome } from "@/components/InvestingChrome";

const inter = Inter({
  variable: "--font-sans",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
});

export const metadata: Metadata = {
  title: {
    default: "cashchirp",
    template: "%s | cashchirp",
  },
  description: "Data-driven market-dynamics research over the Sharadar mirror + FRED.",
  // The one logo lives at public/logo.svg and is declared here rather than via the
  // app/icon.png convention file, so the tab icon, the navbar and the chart watermark all
  // read the SAME image — there is no second copy to drift.
  icons: { icon: "/logo.svg", apple: "/logo.svg" },
};

// The single layout: <html>/<body>, the fonts, the navbar, TanStack Query (which every data
// hook needs), and the ⌘K omni-search bar that sits under the nav on every page.
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body className={`${inter.variable} antialiased`}>
        <Navbar />
        <SiteBanner />
        <Providers>
          <InvestingChrome />
          {children}
        </Providers>
      </body>
    </html>
  );
}
