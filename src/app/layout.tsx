import './globals.css';
import type { Metadata } from 'next';
export const metadata: Metadata = { title: 'Shohoz Mart | সহজ মার্ট', description: 'Your neighbourhood grocery shop online' };
export default function RootLayout({children}:{children:React.ReactNode}) {
 return <html lang="bn"><body>{children}</body></html>;
}
