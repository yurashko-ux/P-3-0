import { NextResponse } from 'next/server';export function setAuthCookie(res:NextResponse){res.cookies.set('admin','1',{httpOnly:true,sameSite:'lax',path:'/'})}
