import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
export function middleware(req:NextRequest){const {pathname}=req.nextUrl;if(pathname.startsWith('/admin')&&!pathname.startsWith('/admin/login')){const cookie=req.cookies.get('admin');if(!cookie||cookie.value!=='1'){const url=req.nextUrl.clone();url.pathname='/admin/login';url.searchParams.set('next',pathname);return NextResponse.redirect(url)}}return NextResponse.next()}
export const config={matcher:['/admin/:path*']}
