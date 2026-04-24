#!/bin/bash

# 针对 2G 内存的 Ubuntu 服务器增加 Swap (虚拟内存)
# 如果不加，npm run build 或者 docker build 时大概率会被 Linux OOM Killer 杀掉进程。

echo "开始检查并创建 Swap 虚拟内存..."

# 检查是否已经有 swap
if swapon --show | grep -q 'file'; then
    echo "Swap 已经存在，无需重复创建。"
    exit 0
fi

echo "创建 2GB 的 Swap 文件..."
sudo fallocate -l 2G /swapfile

echo "设置正确的权限..."
sudo chmod 600 /swapfile

echo "格式化为 Swap 格式..."
sudo mkswap /swapfile

echo "启用 Swap..."
sudo swapon /swapfile

echo "将 Swap 写入 fstab 实现开机自动挂载..."
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab

echo "Swap 创建完成！当前内存状态："
free -h