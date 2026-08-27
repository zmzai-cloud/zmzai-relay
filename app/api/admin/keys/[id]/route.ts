import { type NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { AdminRequiredError, requireAdmin } from "@/providers/auth/session";
import { connectMongo } from "@/providers/database/mongodb/connection";
import { ApiKeyModel } from "@/providers/database/mongodb/models/apikey";

export const dynamic = "force-dynamic";

function err(code: string, status: number, message: string) {
  return NextResponse.json({ error: message, code }, { status });
}

const editSchema = z
  .object({
    name: z.string().min(1).max(80).optional(),
    quotaTotalTokens: z.coerce.number().int().min(0).optional(),
    rateLimitPerMinute: z.coerce.number().int().min(1).optional(),
    allowedModels: z.array(z.string().min(1).max(120).trim()).optional(),
    status: z.enum(["active", "revoked"]).optional(),
  })
  .refine((value) => Object.keys(value).length > 0, { message: "没有要修改的字段" });

/** 编辑 key 配置（名称/额度/限流/允许模型/状态）。 */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    await requireAdmin();
  } catch (e) {
    if (e instanceof AdminRequiredError) return err("ADMIN_REQUIRED", 403, "需要管理员权限");
    throw e;
  }
  const body = await req.json().catch(() => null);
  const parsed = editSchema.safeParse(body);
  if (!parsed.success) {
    return err("INVALID_BODY", 400, "Key 配置格式不正确");
  }
  const { id } = await params;
  await connectMongo();
  const updated = await ApiKeyModel.findByIdAndUpdate(id, { $set: parsed.data }, { new: true, runValidators: true }).lean();
  if (!updated) {
    return err("NOT_FOUND", 404, "key 不存在");
  }
  return NextResponse.json({ key: { _id: String(updated._id), prefix: updated.prefix, name: updated.name, status: updated.status, quotaTotalTokens: updated.quotaTotalTokens, rateLimitPerMinute: updated.rateLimitPerMinute, allowedModels: updated.allowedModels } });
}

/** 吊销 key。 */
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    await requireAdmin();
  } catch (e) {
    if (e instanceof AdminRequiredError) return err("ADMIN_REQUIRED", 403, "需要管理员权限");
    throw e;
  }
  const { id } = await params;
  await connectMongo();
  const r = await ApiKeyModel.updateOne({ _id: id }, { $set: { status: "revoked" } });
  if (r.matchedCount === 0) {
    return err("NOT_FOUND", 404, "key 不存在");
  }
  return NextResponse.json({ ok: true });
}
