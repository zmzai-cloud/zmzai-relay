import {NextRequest,NextResponse} from "next/server";
import {requireAdmin} from "@/providers/auth/session";
import {saveDraft,listDrafts,draftSchema} from "@/providers/catalog/onboarding";
import {validateUpstreamUrl} from "@/providers/network/safe-upstream-fetch";
import {failure} from "./common";
export async function GET(){try{const admin=await requireAdmin();return NextResponse.json({drafts:await listDrafts(admin.id)})}catch(e){return failure(e)}}
export async function POST(req:NextRequest){try{const admin=await requireAdmin();const input=draftSchema.parse(await req.json());if(input.channel.kind==="new")await validateUpstreamUrl(input.channel.baseUrl);return NextResponse.json({draft:await saveDraft(admin.id,input)},{status:201})}catch(e){return failure(e)}}
