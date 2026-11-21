# 酒店预订系统运行说明

Go 服务运行于 Linux，使用 PostgreSQL 持久化。React + Fluent 界面由浏览器和 Tauri 共用。顾客可公开注册，管理员通过初始化命令创建，工作人员由管理员分配登录账户与所属酒店。

## 本机启动

准备 Go 1.26、PostgreSQL、Node.js 和 npm。为服务建立独立数据库和有建表权限的数据库账户。通过运行环境提供以下变量。

| 变量 | 值 |
|---|---|
| `HOTEL_DATABASE_URL` | 连接串，例如 `postgres://hotel@127.0.0.1:5432/hotel?sslmode=disable`。示例使用本机连接，实际认证资料由运行环境提供。 |
| `HOTEL_OPERATION_SECRET` | 至少 32 字节的随机密钥，可用 `openssl rand -hex 32` 生成。同一数据库的所有服务进程及重启后使用同一值。 |
| `HOTEL_ADMIN_USER`、`HOTEL_ADMIN_PASSWORD` | 首次初始化时使用的账户名和密码。初始化完成后可从运行环境移除。 |

在仓库根目录运行：

```bash
npm ci
npm run build
mkdir -p .local
go -C server build -o ../.local/hotel-booking .
.local/hotel-booking -init-admin
.local/hotel-booking -static dist -seed
```

浏览器地址为 <http://127.0.0.1:8080/>。默认开发地址限本机回环。可选的 `-seed` 为新建的三家示例酒店添加房型和从当天起 90 天的日历。它不创建账户，重复执行也不会覆盖现有客房或日历。

界面开发时保持 Go 服务运行，另开终端执行 `npm run dev -- --host 127.0.0.1`。Vite 将 `/api` 转发给本机 8080 端口，`HOTEL_DEV_API` 可指定其他开发服务地址。要回看实验二的演示，使用 `npm run dev:prototype`。

## 客户端及服务部署

- 桌面开发使用 `npm run tauri -- dev`。Windows 11 需要 MSVC 与 WebView2，macOS 使用 Xcode 工具链。Linux 开发检查需要 GTK 3 与 WebKitGTK 4.1。
- 分发构建设置 `VITE_API_BASE_URL` 为 Go 服务的 HTTPS 源地址，执行 `npm run tauri -- build`。服务端以 `HOTEL_ALLOWED_ORIGINS` 允许实际客户端 WebView 源，多个值用逗号分隔，例如 `tauri://localhost,https://tauri.localhost`。
- iPadOS 与 Android 在对应设备开发环境中使用 Tauri 的 `ios init` 和 `android init` 生成项目，再执行对应的 `build` 命令。iPadOS 需要 macOS 和 Xcode。四个平台共用同一入口和权限逻辑。
- 对外直接提供 HTTPS 时，设置 `HOTEL_TLS_CERT` 与 `HOTEL_TLS_KEY` 并指定监听地址。通过同机 HTTPS 反向代理时，Go 可保留在回环地址。

[Tauri 平台前置条件](https://v2.tauri.app/start/prerequisites/) · [Tauri 配置](https://v2.tauri.app/develop/configuration-files/)

## 事务与恢复

订单业务在服务端执行。会话校验后，写入先处理同一操作者的操作标识，再获取对应酒店行锁。服务在锁内重新检查期限、报价和连续住宿日可用量。订单状态、价格版本、当前占用、幂等结果和审计一起提交。全店异常在同一事务登记影响范围与停售。统计界面与 CSV 使用同一次读取返回的间夜数据。

当前实现中，日历批量编辑、异常影响范围和单次统计的上限均为 90 个住宿日。服务每 30 秒扫描到期订单和联系方式，涉及订单或库存的入口也会在事务内检查截止时间。登录会话有效期为 12 小时。

在有独立存储的部署环境安排每日 `pg_dump --format=custom`。恢复时先通过 `pg_restore --exit-on-error` 写入新的数据库，随后指向新连接串执行 `.local/hotel-booking -check`。该命令处理到期订单和联系方式，并检查订单、逐晚占用、版本和创建审计的关联。通过后再切换服务使用的连接串。

## 复测

```bash
npm run check
GOTOOLCHAIN=local go -C server vet ./...
HOTEL_TEST_DATABASE_URL="$HOTEL_DATABASE_URL" go -C server test -race -count=1 -v ./...
```

Go 集成测试会在目标数据库中新建并清理独立的测试 schema。使用专用测试数据库。浏览器真实流程需要在该数据库完成示例初始化，再设置 `HOTEL_TEST_BASE_URL`、`HOTEL_TEST_ADMIN`、`HOTEL_TEST_ADMIN_PASSWORD` 后执行 `npm run test:live`。原型回归在 `npm run dev:prototype` 启动后执行 `npm run test:ui`。首次运行浏览器测试可用 `npm run browser:install` 下载本地 Chromium。
