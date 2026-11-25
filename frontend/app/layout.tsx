import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import Link from "next/link";

import { TooltipProvider } from "@/components/ui/tooltip";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "OpenRoles",
  description: "Companies hiring now, for the sales team",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        <TooltipProvider delay={300}>
          <div className="border-b">
            <div className="mx-auto flex h-12 w-full max-w-6xl items-center px-4">
              <Link href="/" className="text-sm font-semibold tracking-tight">
                OpenRoles
              </Link>
            </div>
          </div>
          {children}
        </TooltipProvider>
      </body>
    </html>
  );
}
