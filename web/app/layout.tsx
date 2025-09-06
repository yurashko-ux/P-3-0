import './globals.css'
import Link from 'next/link'
export const metadata={title:'P-3-0 Admin',description:'Campaigns admin'}
export default function RootLayout({children}:{children:React.ReactNode}){
  return (<html lang='uk'><body><nav className='sticky top-0 z-10 bg-white border-b border-gray-200'><div className='mx-auto max-w-5xl px-4 py-3 flex items-center gap-6'><a href='/' className='font-semibold'>P‑3‑0</a><div className='text-sm flex gap-4'><Link href='/admin'>Dashboard</Link><Link href='/admin/campaigns'>Campaigns</Link><Link href='/admin/logs'>Logs</Link><Link href='/admin/settings'>Settings</Link></div></div></nav><main className='mx-auto max-w-5xl px-4 py-6'>{children}</main></body></html>)
}
