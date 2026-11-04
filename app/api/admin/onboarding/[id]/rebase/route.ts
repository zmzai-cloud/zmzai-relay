import {NextRequest,NextResponse} from "next/server";
import {z} from "zod";
import {requireAdmin} from "@/providers/auth/session";
import {inspectDraftChanges,rebaseDraft} from "@/providers/catalog/onboarding";
import {failure,validId} from "../../common";
const revision=z.coerce.number().int().positive();
const input=z.object({revision:z.number().int().positive(),token:z.string().min(1),acknowledge:z.literal(true)}).strict();
export async function GET(req:NextRequest,{params}:{params:Promise<{id:string}>}){try{const admin=await requireAdmin(),{id}=await params;validId(id);return NextResponse.json({review:await inspectDraftChanges(admin.id,id,revision.parse(new URL(req.url).searchParams.get("revision")))})}catch(e){return failure(e)}}
export async function POST(req:NextRequest,{params}:{params:Promise<{id:string}>}){try{const admin=await requireAdmin(),{id}=await params;validId(id);const body=input.parse(await req.json());return NextResponse.json({draft:await rebaseDraft(admin.id,id,body.revision,body.token)})}catch(e){return failure(e)}}
