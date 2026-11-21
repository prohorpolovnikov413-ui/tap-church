import type { Metadata } from "next";
import { Bricolage_Grotesque, Figtree } from "next/font/google";
import "./globals.css";

const display = Bricolage_Grotesque({
  subsets: ["latin", "latin-ext"],
  variable: "--font-bricolage",
});

const body = Figtree({
  subsets: ["latin", "latin-ext"],
  variable: "--font-figtree",
});

export const metadata: Metadata = {
  title: "Доброта — добрые дела и рейтинг",
  description:
    "Отмечай добрые дела, получай баллы и поднимайся в таблице добрых дел.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ru">
      <body className={`${display.variable} ${body.variable} antialiased`}>
        {children}
      </body>
    </html>
  );
}
