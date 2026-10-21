import type { Metadata, Viewport } from 'next'
import { Archivo } from 'next/font/google'
import { Providers } from '@/components/providers'
import { THEME_SCRIPT } from '@/lib/theme'
import './globals.css'

const archivo = Archivo({
  subsets: ['latin', 'latin-ext'],
  axes: ['wdth'],
  variable: '--font-archivo',
  display: 'swap',
})

export const metadata: Metadata = {
  title: { default: 'Cutroom', template: '%s · Cutroom' },
  description: 'Script, voice-over and images in. Scheduled YouTube video out.',
  icons: { icon: '/icon.svg' },
}

export const viewport: Viewport = {
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#ECEEF1' },
    { media: '(prefers-color-scheme: dark)', color: '#0E1116' },
  ],
  viewportFit: 'cover',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    // data-theme is set by THEME_SCRIPT before React loads, so the server can't know it.
    <html lang="en" className={archivo.variable} suppressHydrationWarning>
      <head>
        {/* biome-ignore lint/security/noDangerouslySetInnerHtml: a fixed script that sets the theme before paint */}
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      </head>
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  )
}
