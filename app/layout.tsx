import type { Metadata, Viewport } from 'next';
import { Manrope, JetBrains_Mono } from 'next/font/google';
import './globals.css';

const manrope = Manrope({
  subsets: ['latin', 'cyrillic'],
  weight: ['400', '500', '600', '700'],
  variable: '--font-manrope',
  display: 'swap',
});

const jetbrainsMono = JetBrains_Mono({
  subsets: ['latin', 'cyrillic'],
  weight: ['400', '500', '600'],
  variable: '--font-jetbrains-mono',
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'Ю-Терм. Маркировка',
  description:
    'Мобильное веб-приложение для сборки коробок и учёта кодов маркировки Data Matrix Честный ЗНАК с формированием реестра.',
  icons: {
    icon: '/assets/aistudio/icon_b7e68eaf.png',
    shortcut: '/assets/aistudio/icon_b7e68eaf.png',
    apple: '/assets/aistudio/icon_b7e68eaf.png',
  },
  openGraph: {
    title: 'Ю-Терм. Маркировка',
    description:
      'Мобильное веб-приложение для сборки коробок и учёта кодов маркировки Data Matrix Честный ЗНАК с формированием реестра.',
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Ю-Терм. Маркировка',
    description:
      'Мобильное веб-приложение для сборки коробок и учёта кодов маркировки Data Matrix Честный ЗНАК с формированием реестра.',
  },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="ru" className={`${manrope.variable} ${jetbrainsMono.variable}`}>
      <body
        suppressHydrationWarning
        className="font-sans antialiased bg-[#F6F7F9] text-slate-900"
      >
        {children}
      </body>
    </html>
  );
}
