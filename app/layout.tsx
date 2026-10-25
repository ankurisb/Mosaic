import type { Metadata, Viewport } from 'next'
import './globals.css'
import { ThemeProvider } from '@/lib/theme'

export const metadata: Metadata = {
  title: 'Mosaic',
  description: 'Industrial AI platform by UGX Systems',
  manifest: '/manifest.webmanifest',
  appleWebApp: { capable: true, title: 'Mosaic', statusBarStyle: 'black-translucent' },
  icons: {
    icon: [{ url: '/icons/favicon-32.png', sizes: '32x32', type: 'image/png' }, { url: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' }],
    apple: [{ url: '/icons/apple-touch-icon.png', sizes: '180x180' }],
  },
}

// width=device-width is critical — without it the app renders desktop-zoomed on
// phones. viewport-fit=cover lets us pad for notches/home indicators via the
// safe-area env() vars. themeColor tints the mobile browser/status bar per mode.
export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#f5f5f5' },
    { media: '(prefers-color-scheme: dark)', color: '#0a0a0a' },
  ],
}

// Register the service worker (installability + offline shell). Kept out of the
// theme script so a SW failure can never block first paint.
const swRegister = `(function(){if('serviceWorker'in navigator){window.addEventListener('load',function(){navigator.serviceWorker.register('/sw.js').catch(function(){});});}})();`

// Bug 4.3: blocking inline script that sets data-theme before React hydrates.
// Without it, useState defaults to 'light' on both server and client, then a
// useEffect reads localStorage and switches to 'dark' — producing a hydration
// mismatch (#418) and a flash of light content on every load.
const themeInitScript = `(function(){try{var s=localStorage.getItem('theme');var p=window.matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light';var t=s||p;document.documentElement.setAttribute('data-theme',t);var pal=localStorage.getItem('palette');if(pal&&pal!=='mosaic'){document.documentElement.setAttribute('data-palette',pal);}}catch(e){}})();`

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
        <script dangerouslySetInnerHTML={{ __html: swRegister }} />
      </head>
      <body>
        <ThemeProvider>
          {children}
        </ThemeProvider>
      </body>
    </html>
  )
}
