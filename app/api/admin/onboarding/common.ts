import { NextResponse } from "next/server";
import { isValidObjectId } from "mongoose";
import { ZodError } from "zod";
import { AdminRequiredError } from "@/providers/auth/session";
export function failure(e:unknown) {
 if(e instanceof AdminRequiredError)return NextResponse.json({error:"需要管理员权限"},{status:403});
 if(e instanceof ZodError)return NextResponse.json({error:"草稿格式不正确，请检查模型和价格"},{status:400});
 const message=e instanceof Error?e.message:"";
 if(/^(草稿|渠道|模型|尚未|请求|未找到)/.test(message))return NextResponse.json({error:message},{status:409});
 return NextResponse.json({error:"操作失败，请检查配置后重试"},{status:500});
}
export function validId(id:string){if(!isValidObjectId(id))throw new Error("草稿编号不正确")}
