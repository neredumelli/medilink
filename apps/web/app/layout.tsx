import type { Metadata, Viewport } from 'next';
import { Baloo_2, Baloo_Tammudu_2, Nunito } from 'next/font/google';
import { SessionProvider } from '@/lib/session';
import './globals.css';

const baloo = Baloo_2({ subsets: ['latin', 'devanagari'], weight: ['500', '600', '700', '800'], variable: '--font-baloo' });
const balooTe = Baloo_Tammudu_2({ subsets: ['telugu'], weight: ['500', '700'], variable: '--font-baloo-te' });
const nunito = Nunito({ subsets: ['latin'], weight: ['400', '600', '700', '800'], variable: '--font-nunito' });

export const metadata: Metadata = {
  title: 'MediLink',
  description: 'Order medicines from all your distributors in one place.',
  manifest: '/manifest.webmanifest',
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  themeColor: '#0E9F5E',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${baloo.variable} ${balooTe.variable} ${nunito.variable}`}>
      <body>
        <SessionProvider>{children}</SessionProvider>
      </body>
    </html>
  );
}
