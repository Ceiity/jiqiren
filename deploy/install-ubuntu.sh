#!/usr/bin/env bash
# 奶龙云盘 — Ubuntu 24.04 一键部署脚本
# 用法：在项目根目录执行  sudo bash deploy/install-ubuntu.sh
set -euo pipefail
cd "$(dirname "$0")/.."

if ! command -v docker >/dev/null 2>&1; then
  echo "==> 安装 Docker Engine 与 Compose 插件（官方 apt 源）"
  apt-get update
  apt-get install -y ca-certificates curl
  install -m 0755 -d /etc/apt/keyrings
  curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
  chmod a+r /etc/apt/keyrings/docker.asc
  . /etc/os-release
  echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu ${VERSION_CODENAME} stable" \
    > /etc/apt/sources.list.d/docker.list
  apt-get update
  apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
  systemctl enable --now docker
fi

if [ ! -f .env ]; then
  cp .env.example .env
  echo "==> 已生成 .env（可按需修改端口、数据目录等）"
fi

echo "==> 构建并启动"
docker compose up -d --build

echo "==> 等待服务就绪"
for i in $(seq 1 60); do
  if docker compose ps api | grep -q healthy; then break; fi
  sleep 2
done

PORT=$(grep -E '^HTTP_PORT=' .env | cut -d= -f2); PORT=${PORT:-8080}
TOKEN=$(docker compose logs api 2>/dev/null | grep -o 'SETUP TOKEN: [A-Za-z0-9]*' | tail -1 | awk '{print $3}' || true)
echo
echo "================ 部署完成 ================"
echo "访问地址：http://<服务器IP>:${PORT}"
if [ -n "${TOKEN}" ]; then
  echo "首次访问会进入初始化页面，初始化令牌：${TOKEN}"
else
  echo "初始化令牌：使用 .env 中的 SETUP_TOKEN，或已完成初始化"
fi
echo "=========================================="
