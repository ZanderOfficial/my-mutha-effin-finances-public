import type { Metadata } from "next";
import { Barlow, Big_Shoulders } from "next/font/google";
import { connection } from "next/server";
import { AppHeader } from "@/components/AppHeader";
import "./globals.css";

const barlow = Barlow({
  variable: "--font-barlow",
  subsets: ["latin"],
  weight: ["400", "500", "600"],
});

const bigShoulders = Big_Shoulders({
  variable: "--font-big-shoulders",
  subsets: ["latin"],
  weight: ["700", "900"],
});

export const metadata: Metadata = {
  title: "MMFF",
  description: "My Mutha Effin Finance App: net worth and spending, straight.",
};

export default async function RootLayout({ children }: LayoutProps<"/">) {
  // Every page renders per request: the CSP nonce (src/proxy.ts) only reaches
  // Next's inline scripts at render time, so a page prerendered at build time
  // would have scripts the policy blocks.
  await connection();
  return (
    <html
      lang="en"
      className={`${barlow.variable} ${bigShoulders.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:border-2 focus:border-foreground focus:bg-background focus:px-4 focus:py-3 focus:text-base focus:font-bold"
        >
          Skip to content
        </a>
        <AppHeader />
        {children}
      </body>
    </html>
  );
}
