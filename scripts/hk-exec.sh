#!/bin/bash
set -e
scp -i ~/.ssh/id_rsa prod-dashboard-check.js root@149.88.84.189:/tmp/prod-dashboard-check.js
ssh -i ~/.ssh/id_rsa root@149.88.84.189 "mongosh --quiet mongodb://127.0.0.1:27017/muzhi_production /tmp/prod-dashboard-check.js"
echo "exit=$?"
