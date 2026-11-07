import {afterEach,describe,expect,it,vi} from "vitest";
const state=vi.hoisted(()=>({renew:vi.fn()}));
vi.mock("@/providers/database/mongodb/models/model-health",()=>({ModelHealthModel:{updateOne:state.renew}}));
import {startRecoveryHeartbeat} from "@/providers/channels/model-health";

describe("recovery heartbeat",()=>{
 afterEach(()=>{vi.useRealTimers();state.renew.mockReset()});
 it("renews active long requests and stops on completion",async()=>{
  vi.useFakeTimers();state.renew.mockResolvedValue({matchedCount:1});
  const heartbeat=startRecoveryHeartbeat({channelId:"channel",publicModel:"model",fingerprint:"fingerprint"},{token:"owner",expiresAt:new Date()},9000);
  await vi.advanceTimersByTimeAsync(30000);
  expect(state.renew).toHaveBeenCalledTimes(10);expect(heartbeat.signal.aborted).toBe(false);
  heartbeat.stop();await vi.advanceTimersByTimeAsync(9000);expect(state.renew).toHaveBeenCalledTimes(10);
 });
 it("aborts the upstream when the lease is lost",async()=>{
  vi.useFakeTimers();state.renew.mockResolvedValue({matchedCount:0});
  const heartbeat=startRecoveryHeartbeat({channelId:"channel",publicModel:"model",fingerprint:"fingerprint"},{token:"owner",expiresAt:new Date()},9000);
  await vi.advanceTimersByTimeAsync(3000);expect(heartbeat.signal.aborted).toBe(true);heartbeat.stop();
 });
});
