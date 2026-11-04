import {NextRequest,NextResponse} from "next/server";
import {z} from "zod";
import {requireAdmin} from "@/providers/auth/session";
import {testDraftModel} from "@/providers/catalog/onboarding";
import {failure,validId} from "../../common";
const schema=z.object({revision:z.number().int().positive(),model:z.string().min(1).max(120)}).strict();
export async function POST(req:NextRequest,{params}:{params:Promise<{id:string}>}){try{const admin=await requireAdmin(),{id}=await params;validId(id);const body=schema.parse(await req.json());return NextResponse.json({result:await testDraftModel(admin.id,id,body.revision,body.model)})}catch(e){return failure(e)}}
