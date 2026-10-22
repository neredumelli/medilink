import type { Metadata, Viewport } from 'next';
// Fonts are bundled with the app (open-source Fontsource packages): no Google download at build time or for users.
import '@fontsource/baloo-2/600.css';
import '@fontsource/baloo-2/700.css';
import '@fontsource/baloo-2/800.css';
import '@fontsource/baloo-tammudu-2/500.css';
import '@fontsource/baloo-tammudu-2/700.css';
import '@fontsource/nunito/400.css';
import '@fontsource/nunito/600.css';
import '@fontsource/nunito/700.css';
import '@fontsource/nunito/800.css';
import { SessionProvider } from '@/lib/session';
import './globals.css';

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
    <html lang="en">
      <body>
        <SessionProvider>{children}</SessionProvider>
      </body>
    </html>
  );
}
