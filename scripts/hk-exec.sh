#!/bin/bash
set -e
ssh -i ~/.ssh/id_rsa root@149.88.84.189 "mongosh --quiet mongodb://127.0.0.1:27017/muzhi_production --eval 'const u = db.usages.find({model:\"gpt-5.6-terra\"}).sort({\$natural:-1}).limit(1).toArray()[0]; print(JSON.stringify({status:u.status, charged:u.chargedMicros, cost:u.costMicros, profit:u.grossProfitMicros, inPrice:u.inputPricePer1kMicros, outPrice:u.outputPricePer1kMicros, inCost:u.inputCostPer1kTokensMicros, outCost:u.outputCostPer1kTokensMicros, prompt:u.promptTokens, completion:u.completionTokens}, null, 1)); const ch = db.channels.find({}, {name:1, consecutiveFailures:1, cooldownUntil:1}).toArray(); print(JSON.stringify(ch))'"
echo "exit=$?"
