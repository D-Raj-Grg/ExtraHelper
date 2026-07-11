import type { Metadata } from "next";
import { Figtree } from "next/font/google";
import { cookies } from "next/headers";
import "./globals.css";
import { cn } from "@/lib/utils";
import { TooltipProvider } from "@/components/ui/tooltip";
import {
  SCALE_COOKIE,
  SCALE_PX,
  THEME_COOKIE,
  clampScale,
} from "@/lib/preferences-constants";

const figtree = Figtree({ subsets: ["latin"], variable: "--font-sans" });

export const metadata: Metadata = {
  title: "ExtraHelper",
  description: "Restaurant management platform",
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  // Paint the user's saved theme + text size before hydration (no flash).
  const store = await cookies();
  const isDark = store.get(THEME_COOKIE)?.value === "dark";
  const scale = clampScale(Number(store.get(SCALE_COOKIE)?.value ?? NaN));

  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={cn(
        "h-full",
        "antialiased",
        "font-sans",
        figtree.variable,
        isDark && "dark",
      )}
      style={{ fontSize: `${SCALE_PX[scale]}px` }}
    >
      <TooltipProvider><body className="min-h-full flex flex-col">{children}</body></TooltipProvider>
    </html>
  );
}
