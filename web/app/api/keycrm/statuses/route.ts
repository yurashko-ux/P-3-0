import { NextResponse } from 'next/server';import { listStatuses } from '../../../../../lib/keycrm'
export async function GET(){try{const data=await listStatuses();return NextResponse.json({ok:true,items:data})}catch(e:any){return NextResponse.json({ok:false,error:e.message},{status:500})}}
