import type { Metadata } from 'next'
import './globals.css'
import { ThemeProvider } from '@/lib/theme'

export const metadata: Metadata = {
  title: 'Mosaic',
  description: 'Industrial AI platform by UGX Systems',
}

// Bug 4.3: blocking inline script that sets data-theme before React hydrates.
// Without it, useState defaults to 'light' on both server and client, then a
// useEffect reads localStorage and switches to 'dark' — producing a hydration
// mismatch (#418) and a flash of light content on every load.
const themeInitScript = `(function(){try{var s=localStorage.getItem('theme');var p=window.matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light';var t=s||p;document.documentElement.setAttribute('data-theme',t);}catch(e){}})();`

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
      </head>
      <body>
        <ThemeProvider>
          {children}
        </ThemeProvider>
      </body>
    </html>
  )
}
