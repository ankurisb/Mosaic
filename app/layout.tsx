import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'Claude App v1.0.0',
  description: 'AI assistant powered by Claude · ugx.ai',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  )
}
