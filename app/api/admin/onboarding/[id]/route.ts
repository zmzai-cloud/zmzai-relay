import {NextRequest,NextResponse} from "next/server";
import {requireAdmin} from "@/providers/auth/session";
import {getDraft,updateDraft} from "@/providers/catalog/onboarding";
import {validateUpstreamUrl} from "@/providers/network/safe-upstream-fetch";
import {failure,validId} from "../common";
export async function GET(_req:NextRequest,{params}:{params:Promise<{id:string}>}){try{const admin=await requireAdmin(),{id}=await params;validId(id);return NextResponse.json({draft:await getDraft(admin.id,id)})}catch(e){return failure(e)}}
export async function PATCH(req:NextRequest,{params}:{params:Promise<{id:string}>}){try{const admin=await requireAdmin(),{id}=await params;validId(id);const body=await req.json();if(!Number.isInteger(body?.revision)||!body?.input)throw new Error("请求格式不正确");if(body.input.channel?.kind==="new")await validateUpstreamUrl(body.input.channel.baseUrl);return NextResponse.json({draft:await updateDraft(admin.id,id,body.revision,body.input)})}catch(e){return failure(e)}}
