import {NextRequest,NextResponse} from "next/server";
import {z} from "zod";
import {requireAdmin} from "@/providers/auth/session";
import {publishDraft} from "@/providers/catalog/onboarding";
import {failure,validId} from "../../common";
const schema=z.object({revision:z.number().int().positive(),acceptUntested:z.boolean()}).strict();
export async function POST(req:NextRequest,{params}:{params:Promise<{id:string}>}){try{const admin=await requireAdmin(),{id}=await params;validId(id);const body=schema.parse(await req.json());return NextResponse.json(await publishDraft(admin.id,id,body.revision,body.acceptUntested))}catch(e){return failure(e)}}
