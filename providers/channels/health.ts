import type { Types } from "mongoose";

import { CHANNEL_COOLDOWN_MS, CHANNEL_COOLDOWN_THRESHOLD, ChannelModel } from "@/providers/database/mongodb/models/channel";

/** 渠道健康计数：成功即清零并解除冷却；连续失败达阈值进入冷却 5 分钟。
 *  请求路由与渠道手动测试共用：真实推理成功才能确认渠道恢复。 */
export async function markChannelSuccess(channelId: Types.ObjectId | string): Promise<void> {
  await ChannelModel.updateOne({ _id: channelId, consecutiveFailures: { $ne: 0 } }, { $set: { consecutiveFailures: 0, cooldownUntil: null } });
}

export async function markChannelFailure(channelId: Types.ObjectId | string): Promise<void> {
  const updated = await ChannelModel.findOneAndUpdate(
    { _id: channelId, $or: [{ cooldownUntil: null }, { cooldownUntil: { $lte: new Date() } }] },
    { $inc: { consecutiveFailures: 1 } },
    { new: true },
  ).select("consecutiveFailures").lean();
  if (updated && updated.consecutiveFailures >= CHANNEL_COOLDOWN_THRESHOLD) {
    await ChannelModel.updateOne({ _id: channelId }, { $set: { cooldownUntil: new Date(Date.now() + CHANNEL_COOLDOWN_MS), consecutiveFailures: 0 } });
  }
}
