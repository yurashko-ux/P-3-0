import { NextResponse } from 'next/server';import { setAuthCookie } from '../../../../lib/auth'
export async function POST(req:Request){const {pass}=await req.json().catch(()=>({}));if(!process.env.ADMIN_PASS||pass!==process.env.ADMIN_PASS)return NextResponse.json({ok:false,error:'wrong pass'},{status:401});const res=NextResponse.json({ok:true});setAuthCookie(res);return res}
