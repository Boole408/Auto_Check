#!/usr/bin/env bash
set -euo pipefail

run_root() {
    if [[ "${EUID}" -eq 0 ]]; then
        "$@"
    else
        sudo "$@"
    fi
}

# 针对 2G 内存的 Ubuntu 服务器增加 Swap (虚拟内存)
# 如果不加，npm run build 或者 docker build 时大概率会被 Linux OOM Killer 杀掉进程。

echo "开始检查并创建 Swap 虚拟内存..."

# 检查是否已经有 swap
if swapon --show | grep -q 'file'; then
    echo "Swap 已经存在，无需重复创建。"
    exit 0
fi

echo "创建 2GB 的 Swap 文件..."
run_root fallocate -l 2G /swapfile

echo "设置正确的权限..."
run_root chmod 600 /swapfile

echo "格式化为 Swap 格式..."
run_root mkswap /swapfile

echo "启用 Swap..."
run_root swapon /swapfile

echo "将 Swap 写入 fstab 实现开机自动挂载..."
if ! grep -Fxq '/swapfile none swap sw 0 0' /etc/fstab; then
    echo '/swapfile none swap sw 0 0' | run_root tee -a /etc/fstab >/dev/null
fi

echo "Swap 创建完成！当前内存状态："
free -h
