import type { Metadata, Viewport } from 'next'
import { Archivo } from 'next/font/google'
import { Providers } from '@/components/providers'
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
  themeColor: '#ECEEF1',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={archivo.variable}>
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  )
}
