import type { Metadata, Viewport } from 'next';
import { THEME_BOOT_SCRIPT } from '@/lib/themeCore';
import './globals.css';

export const metadata: Metadata = {
  title: 'AI Agency OS',
  description: 'Empresa virtual 3D operada por funcionários de inteligência artificial.',
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#eef2f7' },
    { media: '(prefers-color-scheme: dark)', color: '#05080f' },
  ],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    // data-theme é definido pelo script abaixo antes da pintura (sem flash).
    <html lang="pt-BR" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOT_SCRIPT }} />
      </head>
      <body className="app-backdrop font-sans">{children}</body>
    </html>
  );
}
