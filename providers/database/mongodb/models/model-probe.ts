import { model, models, Schema, type Model, type Types } from "mongoose";
import type { ProbeCategory } from "@/providers/catalog/model-probe";
export interface ModelProbeRecord {channelId:Types.ObjectId;publicModel:string;upstreamModel:string;fingerprint:string;ok:boolean;category:ProbeCategory|null;status:number;latencyMs:number;testedAt:Date;retryAt:Date|null}
const schema=new Schema<ModelProbeRecord>({channelId:{type:Schema.Types.ObjectId,required:true},publicModel:{type:String,required:true},upstreamModel:{type:String,required:true},fingerprint:{type:String,required:true,select:false},ok:{type:Boolean,required:true},category:{type:String,default:null},status:{type:Number,required:true},latencyMs:{type:Number,required:true},testedAt:{type:Date,required:true},retryAt:{type:Date,default:null}},{strict:"throw",timestamps:true});
schema.index({channelId:1,publicModel:1},{unique:true});
export const ModelProbeModel=(models.ModelProbe as Model<ModelProbeRecord>|undefined)??model<ModelProbeRecord>("ModelProbe",schema);
