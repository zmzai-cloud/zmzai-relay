import {model,models,Schema,type Model,type Types} from "mongoose";
import type {UpstreamErrorCategory} from "@/providers/channels/upstream-errors";
export interface ModelHealthRecord {
  channelId:Types.ObjectId;publicModel:string;fingerprint:string;consecutiveFailures:number;
  category:UpstreamErrorCategory|null;leaseUntil:Date|null;lastFailureCategory:UpstreamErrorCategory|null;cooldownUntil:Date|null;lastFailureAt:Date|null;lastSuccessAt:Date|null;
}
const schema=new Schema<ModelHealthRecord>({
  channelId:{type:Schema.Types.ObjectId,required:true},publicModel:{type:String,required:true},
  fingerprint:{type:String,required:true,select:false},consecutiveFailures:{type:Number,default:0},
  category:{type:String,default:null},leaseUntil:{type:Date,default:null},lastFailureCategory:{type:String,default:null},cooldownUntil:{type:Date,default:null},lastFailureAt:{type:Date,default:null},lastSuccessAt:{type:Date,default:null},
},{timestamps:true,strict:"throw"});
schema.index({channelId:1,publicModel:1},{unique:true});
export const ModelHealthModel=(models.ModelHealth as Model<ModelHealthRecord>|undefined)??model<ModelHealthRecord>("ModelHealth",schema);
