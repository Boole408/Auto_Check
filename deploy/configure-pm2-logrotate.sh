#!/usr/bin/env bash
set -euo pipefail

pm2 install pm2-logrotate
pm2 set pm2-logrotate:retain 1
pm2 set pm2-logrotate:max_size 10M
pm2 set pm2-logrotate:compress false
pm2 set pm2-logrotate:workerInterval 30
pm2 set pm2-logrotate:rotateInterval '0 0 * * *'
pm2 set pm2-logrotate:dateFormat YYYY-MM-DD_HH-mm-ss

pm2 conf pm2-logrotate
