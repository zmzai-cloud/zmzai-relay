#!/bin/bash
set -e
scp -i ~/.ssh/id_rsa prod-topup.js root@149.88.84.189:/tmp/prod-topup.js
ssh -i ~/.ssh/id_rsa root@149.88.84.189 "mongosh --quiet mongodb://127.0.0.1:27017/muzhi_production /tmp/prod-topup.js"
echo "exit=$?"
