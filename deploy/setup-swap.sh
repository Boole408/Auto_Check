#!/usr/bin/env bash
set -euo pipefail

run_root() {
  if [[ "${EUID}" -eq 0 ]]; then
    "$@"
  else
    sudo "$@"
  fi
}

mem_total_kb="$(awk '/MemTotal/ { print $2 }' /proc/meminfo)"
swap_total_kb="$(awk '/SwapTotal/ { print $2 }' /proc/meminfo)"

if [[ -n "${swap_total_kb}" && "${swap_total_kb}" -gt 0 ]]; then
  echo "Swap already exists, skipping."
  exit 0
fi

if [[ -z "${mem_total_kb}" || "${mem_total_kb}" -gt 3145728 ]]; then
  echo "Physical memory is above 3 GB, skipping swap setup."
  exit 0
fi

if [[ -f /swapfile ]]; then
  echo "/swapfile already exists, enabling it."
  run_root chmod 600 /swapfile
  run_root mkswap /swapfile >/dev/null 2>&1 || true
  run_root swapon /swapfile
else
  echo "Creating 2 GB swapfile for low-memory host."
  run_root fallocate -l 2G /swapfile
  run_root chmod 600 /swapfile
  run_root mkswap /swapfile
  run_root swapon /swapfile
fi

if ! grep -Fxq '/swapfile none swap sw 0 0' /etc/fstab; then
  echo '/swapfile none swap sw 0 0' | run_root tee -a /etc/fstab >/dev/null
fi

free -h
