import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Mise — Clean Recipe Viewer',
  description: 'Paste any recipe URL and get just the ingredients, measurements, and instructions — no ads, no filler.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
