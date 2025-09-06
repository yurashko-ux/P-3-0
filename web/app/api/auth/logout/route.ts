import { NextResponse } from 'next/server'
export async function POST(){const res=NextResponse.redirect(new URL('/admin/login','/'));res.cookies.set('admin','',{path:'/',maxAge:0});return res}
