import type { Metadata } from 'next';
import { Libre_Bodoni, Schibsted_Grotesk } from 'next/font/google';
import { Providers } from '@/lib/providers';
import './globals.css';

const ui = Schibsted_Grotesk({ subsets: ['latin'], variable: '--font-ui' });
const engrave = Libre_Bodoni({ subsets: ['latin'], weight: '700', variable: '--font-engrave' });

export const metadata: Metadata = { title: 'Lockstep', description: 'Project management where the whole team reads the same state.' };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${ui.variable} ${engrave.variable}`}>
      <body className="font-sans antialiased"><Providers>{children}</Providers></body>
    </html>
  );
}
