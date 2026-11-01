# 奶龙云盘

以 **FlClash 设计语言**打造的现代化 Web 外链网盘：文件存储、文件管理、外链分享。前后端分离，Docker 一键部署。

- 前端：React 18 + TypeScript + Vite + Framer Motion + Lucide + TanStack Query / Virtual
- 后端：Node.js 22 + Fastify 5 + TypeScript + SQLite（better-sqlite3，带版本化迁移）
- 存储：本地磁盘（默认）/ S3 兼容对象存储（AWS S3、MinIO、R2、SeaweedFS…）
- 部署：Docker + Docker Compose + Nginx，支持 IP:端口、域名、HTTPS 反向代理

---

## 目录

- [快速开始（Docker）](#快速开始docker)
- [Ubuntu 24.04 部署](#ubuntu-2404-部署)
- [HTTPS 部署](#https-部署)
- [升级、备份与数据目录](#升级备份与数据目录)
- [环境变量](#环境变量)
- [本地开发](#本地开发)
- [功能清单](#功能清单)
- [FlClash 设计研究与实现](#flclash-设计研究与实现)
- [架构](#架构)
- [安全设计](#安全设计)
- [测试](#测试)
- [许可证说明](#许可证说明)

---

## 快速开始（Docker）

```bash
git clone <本仓库> nailong-pan && cd nailong-pan
cp .env.example .env            # 可选：修改端口、数据目录
docker compose up -d --build
docker compose logs api | grep "SETUP TOKEN"   # 取得一次性初始化令牌
```

浏览器打开 `http://服务器IP:8080`，首次访问进入「初始化」页面，填写初始化令牌并创建管理员账号。

- 代码中**没有任何默认密码**。初始化令牌在没有管理员时于启动日志中随机生成（或使用 `.env` 中的 `SETUP_TOKEN`），创建管理员后立即失效。
- 也可以在命令行创建/重置管理员：
  ```bash
  docker compose exec api node dist/cli/create-admin.js admin   # 交互式输入密码
  ```

## Ubuntu 24.04 部署

```bash
sudo bash deploy/install-ubuntu.sh
```

脚本会：安装 Docker Engine 与 Compose 插件（官方 apt 源）→ 生成 `.env` → 构建并启动 → 打印访问地址与初始化令牌。

手动部署等价于：安装 Docker → `cp .env.example .env` → `docker compose up -d --build`。

## HTTPS 部署

容器内置的 Nginx 监听 80 端口（映射为宿主机 `HTTP_PORT`）。推荐在宿主机前置一层负责证书的反向代理：

1. `.env` 中设置：
   ```ini
   BIND_ADDR=127.0.0.1   # 只允许本机反代访问
   HTTP_PORT=8080
   TRUST_PROXY=2         # 外层反代 + 内置 nginx 两跳
   ```
2. 选择一种：
   - **Caddy**（自动申请证书）：参考 [`deploy/Caddyfile.example`](deploy/Caddyfile.example)
   - **Nginx + certbot**：参考 [`deploy/nginx-https.conf.example`](deploy/nginx-https.conf.example)
3. 在「设置 → 系统设置 → 网站域名」填写 `https://pan.example.com`，分享链接会使用该域名生成。

HTTPS 下 Cookie 自动带 `Secure`（`COOKIE_SECURE=auto`）。反代需关闭请求/响应缓冲（示例已配置），以保证大文件流式上传下载、断点续传。

## 升级、备份与数据目录

所有持久化数据都在 `DATA_PATH`（默认 `./data`）：

| 路径 | 内容 |
| --- | --- |
| `data/db/nailong.sqlite` | 数据库（WAL 模式） |
| `data/storage/` | 文件内容（按内容哈希去重的对象） |
| `data/cache/thumbs/` | 缩略图缓存（可删除，会自动重建） |
| `data/tmp/uploads/` | 未完成的分片上传（断点续传用） |
| `data/avatars/` | 用户头像 |
| `data/logs/app.log` | 应用日志（同时输出到 `docker compose logs`） |

- **升级**：`git pull && docker compose up -d --build`。启动时自动执行尚未应用的数据库迁移（`server/migrations/*.sql`，记录在 `schema_migrations` 表），不会清空数据。
- **备份**：`docker compose stop api` 后打包 `data/` 目录；或在线备份数据库 `sqlite3 data/db/nailong.sqlite ".backup backup.sqlite"` 并同步 `data/storage/`。
- 重启 / 重建容器不会丢失文件。

## 环境变量

完整说明见 [`.env.example`](.env.example)。

| 变量 | 默认 | 说明 |
| --- | --- | --- |
| `HTTP_PORT` | `8080` | 对外端口 |
| `BIND_ADDR` | `0.0.0.0` | 监听地址，前置反代时设为 `127.0.0.1` |
| `DATA_PATH` | `./data` | 宿主机数据目录 |
| `SETUP_TOKEN` | 随机 | 首次初始化令牌 |
| `TRUST_PROXY` | `1` | 信任的代理层数 |
| `COOKIE_SECURE` | `auto` | Cookie Secure 标记 |
| `SESSION_DAYS` | `30` | 登录保持天数 |
| `STORAGE_DRIVER` | `local` | `local` / `s3` |
| `MAX_CHUNK_MB` | `64` | 单个上传分片上限 |
| `S3_*` | | S3 端点、区域、桶、密钥、path-style |
| `LOG_LEVEL` | `info` | 日志级别 |

站点名称、图标、域名、开放注册、默认配额、单文件大小上限、回收站保留天数、分享最长有效期在 **设置 → 系统设置** 中修改，保存后立即生效。存储驱动与路径需修改环境变量并重启（页面中有明确提示）。

## 本地开发

需要 Node.js ≥ 20（推荐 22）和 ffmpeg（视频封面，可选）。

```bash
# 后端：http://localhost:8080
cd server && npm install
SETUP_TOKEN=dev-token npm run dev

# 前端：http://localhost:5173（/api 代理到 8080）
cd web && npm install && npm run dev
```

生产构建：`cd server && npm run build && npm start`；`cd web && npm run build`（产物在 `web/dist`）。

## 功能清单

**界面与体验**
- FlClash 风格：窗口化侧边栏（可展开/收起，选中项滑动的填充底与主题色指示条）、填充层级代替边框、超大圆角卡片、iOS 字号体系
- 浅色 / 深色 / 跟随系统；8 种 FlClash 预设主题色 + 自定义取色；鲜明 / 着色 / 柔和 / 单色 4 种配色风格；主题切换圆形扩散动画（View Transitions）；选择持久保存到账号
- 动画：页面淡入、卡片依次进入、弹窗弹簧动画、菜单缩放展开、分段控件与导航指示滑动、上传进度、拖拽遮罩、删除/选中动画、Toast；支持「完整 / 减弱 / 关闭」与系统 `prefers-reduced-motion`
- 移动端：大标题栏、悬浮底部 Dock（FlClash 移动端导航）、底部弹出菜单（可下拉关闭）、长按多选、悬浮上传按钮、图片双指缩放与滑动切换
- 骨架屏、空状态插画、统一 Toast、错误边界

**文件管理**
- 网格 / 列表视图，虚拟滚动 + 分页加载（10 万级文件不卡顿），图片懒加载、缩略图服务端缓存
- 单选、Ctrl/⌘ 多选、Shift 范围选择、全选、右键菜单、键盘（Del / F2 / Enter / Esc / Ctrl+A）
- 新建文件夹、重命名、移动、复制、删除（回收站，可撤销）、批量操作、拖拽到文件夹/面包屑移动
- 全盘搜索（SQLite FTS5 trigram 索引）、按名称/大小/时间/类型排序、按分类筛选（图片/视频/音频/文档）
- 预览：图片（缩放、旋转、平移、切换）、视频、音频播放器、PDF（pdf.js 渲染到 canvas）、TXT/JSON/MD 等文本（Markdown 经 DOMPurify 净化）
- 文件详情（路径、SHA-256、分享次数）

**上传下载**
- 单文件、多文件、文件夹上传、窗口任意位置拖拽上传（含文件夹）
- 分片上传、断点续传（刷新页面后重新选择同一文件即可从断点继续）、暂停 / 继续 / 取消 / 自动重试（指数退避）
- 上传面板：文件名、大小、速度、百分比、剩余时间、状态，可折叠
- 下载：HTTP Range 断点续传、ETag / If-Range、RFC 5987 中文文件名、多文件/文件夹流式 ZIP 打包，全程流式不占内存
- 内容寻址去重存储：相同文件只存一份，复制文件瞬间完成

**外链分享**
- 文件或文件夹分享，链接形如 `/s/AbC123xyZ9`（10 位 CSPRNG 随机标识，约 59 bit 熵）
- 有效期（永久 / 1 小时 / 1 天 / 7 天 / 30 天 / 自定义）、访问密码（随机生成）、允许下载、允许预览、下载次数上限、访问次数上限、备注
- 分享访问页：无需登录、FlClash 风格，展示文件信息、分享者头像昵称、有效期、预览、下载；文件夹可逐级浏览、单文件下载或打包下载
- 精致的密码页（错误抖动反馈、解锁动画），密码在服务端校验，下载接口独立校验授权
- 分享管理：状态筛选、搜索、复制链接（动画反馈）、编辑、禁用/启用、删除、批量操作、访问统计（14 天柱状图 + 最近访问记录）

**用户与管理**
- 登录 / 退出 / 修改密码（其他设备自动下线）/ 头像 / 昵称 / 存储空间
- 管理后台：运行状态（磁盘、上传/下载中任务、内存、负载）、用户管理（创建、删除、禁用、角色、配额、重置密码）、全站文件管理、全站分享管理、操作日志
- 公开注册默认关闭，可在系统设置中开启

## FlClash 设计研究与实现

开发前克隆并阅读了 [chen08209/FlClash](https://github.com/chen08209/FlClash) 的真实源码（Flutter），重点是 `lib/ui/`（`color.dart`、`surface.dart`、`shape.dart`、`sidebar.dart`、`typography.dart`、`motion.dart`、`page_transition.dart`、`dialog.dart`、`popup.dart`、`navigation_dock.dart`）、`.agents/surfaces.md` 设计规范文档，以及 `snapshots/preview*.png`。提炼出的规范与本项目的对应实现：

| FlClash 规范 | 本项目实现 |
| --- | --- |
| **用填充分层，不用边框**：四级表面 page → card → block → inset；浅色 94/98/94/90，深色 6/15/21/27（HCT 色调）；深色只会变亮 | `web/src/theme/scheme.ts` 用 HCT 色彩空间按相同色调生成 `--page --card --block --inset`，全站组件只用填充区分层级 |
| **表面接近中性灰**（色度 ≤ 3，浅色纸面 ≤ 1.5），`tinted` 风格才带主题色调 | 同样的色度上限与 4 种 `ColorStyle`（鲜明/着色/柔和/单色） |
| **主题色即种子色**（像 Apple 强调色），浅色色调限制 35–60，深色 +3 并限制 50–75；默认 `#007AFF`，8 个预设色 | 完全相同的规则与预设色 |
| **侧边栏是窗口装饰**：`surfaceContainerHighest`/`surfaceContainerLow`，与内容区相接处一条分隔线；收起 48、展开 220；条目高 40、圆角 10；选中 = `onSurface 8%` 填充 + 3×16 主题色指示条；悬停 4% | `layout/Sidebar.tsx` + `styles/layout.css`，选中填充与指示条用共享布局动画平滑滑动 |
| **颜色只表示状态**：选中用对勾徽标而不是整块着色；成功/警告/错误用固定色板的小标签；破坏性操作用 iOS systemRed | `SelectionBadge`/`CheckCircle`、`chip-success/warning/error`、`--destructive` |
| **分段控件选中段为实心主题色**（仪表盘「Rule/Global/Direct」） | `ui/controls.tsx` `Segmented`，选中底色在段间弹簧滑动 |
| **圆角**：xs 4 / sm 8 / md 16 / lg 20 / xl 24 / xxl 28 / alert 34，药丸按钮 | `--r-*` token；卡片 24、文件卡片 20、缩略图 12、输入框 12、弹窗 34 |
| **字体**：iOS Dynamic Type（pageTitle 24/600、headline 17/600、subheadline 15、footnote 13、caption 12） | `.t-*` 字号类 |
| **悬浮物**（弹窗、菜单、Dock、Toast）在深色下比卡片更亮一级并带阴影；列表卡片不加阴影 | `--float` / `--float-block` 与 `--shadow-float` |
| **动效**：弹窗弹簧（约 275ms、轻微回弹）、菜单弹簧展开、标签页淡入 220ms、侧栏展开 250ms 标准缓动 | `ui/motion.ts` 中同参数的 Framer Motion 弹簧与缓动 |
| **移动端**：大标题 + 悬浮 Dock，Dock 选中项为高一级的中性底板 + 主题色图标文字 | `layout/Dock.tsx` |
| 仪表盘：状态卡片中的「花瓣形」大按钮与有机形状背景、上传/下载流量折线卡片 | 首页存储卡片的花瓣上传按钮与背景 blob、「近 7 天上传 / 分享访问」折线卡片 |

**为什么没有用 Material UI**：MUI 的默认外观是标准 Google Material（色调容器填充、描边输入框、Material 2/3 阴影），而 FlClash 恰恰重写了这些——用中性填充层级替代 tonal container、按钮为药丸形、选择态用对勾而非填充、iOS 字号。用 MUI 需要覆盖几乎每个组件的样式，反而更重。因此本项目实现了一套轻量组件（按钮、卡片、分段控件、开关、菜单、弹窗/底部弹层、Toast、骨架屏、进度环等）+ CSS 变量 token，视觉还原度更高、体积更小。Tailwind 同理未引入。

## 架构

```
┌──────────────┐  HTTPS  ┌───────────────────────────── docker compose ─────────────────────────────┐
│ 浏览器 / 手机 │ ──────▶ │ web: nginx ─ 静态 SPA（web/dist）                                          │
└──────────────┘         │        └─ /api/* 反向代理（无缓冲，流式） ─▶ api: Fastify (Node 22)       │
                         │                                            ├─ SQLite (WAL, 迁移)            │
                         │                                            ├─ StorageDriver: local | s3     │
                         │                                            └─ sharp / ffmpeg 缩略图缓存      │
                         └───────────────────────────────────────────────────────────────────────────┘
```

```
server/
  migrations/001_init.sql     # users, sessions, folders, files, blobs, files_fts, upload_sessions,
                              # shares, share_grants, share_access_logs, download_tickets,
                              # system_settings, operation_logs
  src/
    app.ts  index.ts  config.ts
    db/          # 连接与迁移执行器
    lib/         # 错误、ID、密码哈希、文件类型、Range 流式发送
    storage/     # driver 接口 + local + s3
    services/    # fs（文件夹/文件/回收站）、uploads、shares、thumbs、zip、users、settings、oplog
    routes/      # auth、files、shares（含公开访问）、admin
    cli/create-admin.ts
  test/e2e.mjs   # 端到端测试
web/
  src/
    theme/       # FlClash 风格配色生成 + ThemeProvider（含圆形扩散切换）
    styles/      # tokens / base / components / layout / files / pages
    ui/          # 组件库：Dialog、Menu、Toast、controls、Empty、Sparkline…
    layout/      # AppShell、Sidebar、Dock、Page
    features/    # FileBrowser、上传引擎与面板、预览、分享弹窗、文件夹选择器…
    pages/       # 首页、文件、分类、分享、回收站、存储、设置、管理后台、登录/初始化、外链页
  nginx/default.conf
deploy/          # Ubuntu 安装脚本、Caddy / Nginx HTTPS 示例
```

**关键设计**
- **文件夹层级**：物化路径 `path = '/祖先id/…/自身id/'`，子树查询、移动、打包、分享越权校验都是一次前缀匹配。
- **存储**：`files` 引用 `blobs`（SHA-256 + 大小去重，引用计数），存储 key 由服务端生成，与用户提供的文件名完全无关——从根本上杜绝路径遍历与文件覆盖。
- **上传协议**（类 tus）：`POST /api/uploads` 创建会话 → `PUT /api/uploads/:id?offset=N` 按偏移流式追加（偏移不一致返回 409 与服务端已接收字节数）→ `POST /complete` 校验大小、计算哈希、去重入库。会话按「文件名+大小+修改时间+目标路径」指纹复用，实现跨页面刷新的断点续传；过期会话与临时文件定时清理。
- **下载**：单文件直接由浏览器原生下载（Cookie 认证），多文件通过一次性票据 URL 流式生成 ZIP（store 模式，常量内存）。
- **性能**：列表分页 + 前端虚拟滚动；所有查询走复合索引；搜索用 FTS5 trigram；缩略图并发限流与磁盘缓存；实测 1 GB 文件上传/下载时 Node 进程 RSS 峰值约 165 MB。

## 安全设计

| 风险 | 防护 |
| --- | --- |
| 路径遍历 / 任意文件覆盖 | 存储 key 服务端生成并校验字符集；文件名经规范化与校验（禁止 `/ \ . ..` 和控制字符）；文件夹上传的相对路径逐段校验 |
| 未授权访问 / 越权 | 所有文件接口校验所有者；分享内文件与子文件夹必须位于分享根的物化路径之下；管理员也无法直接读取他人文件内容 |
| 分享链接枚举 | 10 位 CSPRNG 标识（无偏拒绝采样）；公开接口限流；不使用自增 ID |
| 分享密码 | Argon2id 哈希；解锁后签发服务端授权凭证（仅存 SHA-256），改密码立即使旧凭证失效；解锁接口单独限流 |
| 分享失效 | 每次请求（含 Range 续传、缩略图、ZIP）都重新校验状态、有效期、次数与目标文件是否存在 |
| XSS | 只把白名单内的图片/音视频/PDF 内联返回；文本类一律 `text/plain`；HTML/SVG 等绝不以原类型内联；`X-Content-Type-Options: nosniff` + `CSP: sandbox`；Markdown 经 DOMPurify；PDF 用 pdf.js 渲染到 canvas |
| CSRF | SameSite=Lax 会话 Cookie + 双重提交 CSRF Token（`X-CSRF-Token`）+ Origin 校验 |
| 账号密码 | Argon2id；未知用户名也执行一次哈希以抹平时间差；登录限流；会话 Token 只存 SHA-256 |
| 恶意请求 / 内存耗尽 | 全局与接口级限流；分片大小上限且流式计数截断；JSON body 1 MB 上限；图片解码像素上限；ffmpeg 超时与输出上限；全链路流式 |
| 初始化 | 无默认密码；一次性初始化令牌仅在无管理员时有效 |

## 测试

```bash
cd server
SETUP_TOKEN=<令牌> node test/e2e.mjs http://localhost:8080
```

端到端测试覆盖：初始化与登录、CSRF/Origin、名称校验、断点续传（偏移冲突恢复）、Range 与完整性、XSS 内容类型、中文文件名、文件夹上传与路径遍历、搜索、移动/复制/回收站、分享密码与子树隔离、改密失效、禁用即时生效、预览/下载权限、次数上限、ZIP、配额与跨用户隔离。该测试已分别在本地磁盘驱动、S3 驱动（SeaweedFS）以及 Docker Compose（经 Nginx）三种环境下全部通过。

## 许可证说明

FlClash 以 **GPL-3.0** 发布。本项目仅参考其公开的设计语言与设计规范文档（配色规则、表面层级、圆角、字号、动效参数、布局），**没有复制其任何源代码**；所有界面均使用 React/CSS 独立实现。
