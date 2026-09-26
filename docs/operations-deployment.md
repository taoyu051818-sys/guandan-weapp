# 运营后台部署手册

目标地址：[https://api.yutechhn.cn/admin/](https://api.yutechhn.cn/admin/)。本手册仅准备发布步骤；本轮没有连接服务器、修改生产配置、创建生产管理员或部署。账号归属、私密密码输入、TOTP 绑定和生产发布仍待用户与授权运维完成。

## 1. 已核对的仓库部署约定

以下来自仓库模板与历史部署文档，不代表本轮重新核验了线上状态：

| 项目 | 约定 |
| --- | --- |
| 平台服务 | `guandan-platform.service`，运行用户/组 `guandan` |
| 启动目录 | `/srv/guandan/current/work/guandan-windows-source` |
| 启动命令 | `/opt/node-v24.19.0/bin/node server/platform-server.js` |
| 内部平台地址 | `127.0.0.1:33103`，不得对公网开放 |
| 已有环境文件 | `/srv/guandan/shared/production.env`、`/srv/guandan/shared/wechat.env`，root 所有、0600 |
| 平台状态 | `/srv/guandan/shared/data/platform.json`，单进程 JSON writer |
| Nginx 片段 | `/etc/nginx/snippets/guandan.conf`；所属 HTTPS 站点历史路径 `/etc/nginx/sites-available/yanqing-api` |
| 已有玩家路由 | `/guandan/api/v1/` → 平台；`/guandan/weapp` → 牌局服 |

依据：`work/guandan-cocos/ops/guangzhou/{guandan-platform.service,guandan.nginx.conf,initialize-production-env.mjs,activate-server-variants.sh}` 与 `work/guandan-cocos/docs/guangzhou-wechat-deployment.md`。正式操作前只读核对实际 unit、监听端口、站点 include、当前 release 与维护窗口；不打印环境文件内容。

## 2. 发布包必须包含同级管理端

平台进程自己提供管理端静态文件；不增加第二个平台进程，不将管理端部署到游戏 `web/` 目录，不使用跨域静态站点。

```text
/srv/guandan/releases/<审核后的 release-id>/
  shared-core/dist/
  shared-core/package.json
  work/guandan-windows-source/server/
  work/guandan-windows-source/package.json
  work/guandan-admin/index.html
  work/guandan-admin/styles.css
  work/guandan-admin/src/{app,api,model,dom,dialog,login,announcements,feedback,features,audit}.js
```

管理端无需构建或第三方 CDN。仅上面 12 个运行时文件进入发布包与静态服务白名单；`README.md`、`package.json`、测试、脚本、环境文件、凭据和 enrollment 文件不进入管理端发布目录。

本地打包器 `scripts/package-server-release.mjs` 与激活器共享 `ops/guangzhou/release-paths.mjs` 白名单。激活器在解压前拒绝路径穿越、重复路径、缺失管理端资产、符号链接、硬链接和特殊文件；打包器还拒绝任意文件名下可解析为 JSON 的凭据/enrollment 结构（根 `admins` 数组、`totpSecret` 或 `otpauth` URI）。这不代替秘密治理：凭据必须一直位于仓库与制品之外，不能依赖扫描兜底。独立安装激活器时，必须同时安装同版本的 `release-paths.mjs` 到激活器旁边；不可只更新旧 `.sh` 文件。

在仓库根目录，先完成检查，审核并提交源码。打包器会拒绝脏工作区；不要为了打包擅自提交或丢弃现有改动。

```sh
node scripts/release-manifest.test.mjs
bash -n work/guandan-cocos/ops/guangzhou/activate-server-variants.sh
npm --prefix work/guandan-admin run verify
npm --prefix work/guandan-windows-source run check:server
npm --prefix work/guandan-windows-source run test:platform
pnpm --dir shared-core build

read -r -p '已审核的 release-id（例如 YYYYMMDD-operations-v1）: ' ops_release_id
ops_bundle_dir=$(mktemp -d /tmp/guandan-operations-bundle.XXXXXX)
node scripts/package-server-release.mjs "$ops_release_id" "$ops_bundle_dir"
```

命令输出包路径、SHA-256、源码 commit 和文件数量。默认保留上一 release 的游戏 Web；只有本次明确批准同时更新游戏 Web、并完成其正式配置验收时才加 `--with-web`。打包器不会生成或包含真实凭据。发布前保留既有 release manifest、测试与构建证据；打包 hash 不等同于真机验收或生产容量证明。

后续获得生产执行授权后，按既有发布渠道传输已核 hash 的归档至 `/tmp/guandan-release-<release-id>.tgz`，将审核后的激活器和 `release-paths.mjs` 配套安装至 `/srv/guandan/ops/`，再按既有入口执行：

```sh
read -r -p '已核对的归档 SHA-256: ' ops_release_sha
sudo bash /srv/guandan/ops/activate-server-variants.sh "$ops_release_id" "$ops_release_sha"
```

这一步会停止/启动 `guandan-game` 与 `guandan-platform`、备份数据并切换 current。默认遇到连接或活动牌局时只暂存不激活；未经明确授权不得加 `--allow-active`。首次上线宜保持全部 `ADMIN_*` 未配置，先部署为后台关闭状态，再完成个人绑定与启用。

## 3. 私密管理员初始化：由本人完成

没有默认账号、默认密码或通用 TOTP 秘钥。管理员独立于微信/玩家 Bearer 登录。用户名须为 3–64 个字母、数字、下划线、点或连字符，首字符为字母/数字；角色只允许 `admin`、`operator`、`support`。

新代码已位于 current 后，授权运维可在未录屏、未启用命令输入审计记录密码的可信交互终端执行以下初始化。此处命令尚未运行；用户本人输入密码，不发给聊天、文档或工单。

```sh
sudo install -d -o guandan -g guandan -m 0700 /srv/guandan/shared/admin
read -r -p '管理员本人选定的用户名: ' ops_admin_username
sudo -u guandan /opt/node-v24.19.0/bin/node \
  /srv/guandan/current/work/guandan-windows-source/server/platform/admin-provision.mjs \
  --file /srv/guandan/shared/admin/admins.json \
  --enrollment-file /srv/guandan/shared/admin/enrollment-owner.json \
  --username "$ops_admin_username" \
  --role admin
```

CLI 要求交互 TTY，隐藏输入并二次确认 6–256 字符密码，不强制大小写、数字或符号组合；密码不经命令参数或环境变量传递。它生成随机盐 scrypt 哈希与独立随机 TOTP 秘钥，只写入新建的 0600 文件，不打印秘钥；已有目标文件会拒绝覆盖。登录限流与动态验证码要求保持不变。

本机验收例外：`scripts/operations-preview.mjs` 显式设置 `ADMIN_ALLOW_PASSWORD_ONLY_LOCALHOST=true`，只在非生产 loopback 模式允许免 TOTP。此配置不能进入生产 env，不能用于外网或局域网绑定；配置加载会拒绝这些组合。登录页通过服务端 `login-options` 显示对应表单，不是仅隐藏验证码校验。正式部署仍按本节绑定认证器。

由该管理员通过受控私密通道取得 enrollment 文件，使用可信本地验证器导入其中的 `otpauth` URI，或手工绑定秘钥：SHA-1、6 位数字、30 秒周期。不要上传到在线二维码生成网站，不把 URI/秘钥放进浏览器源码、日志、截图、聊天或 Git。确认设备可生成验证码后，按组织私密材料处置规范移除额外 enrollment 副本；服务端 `admins.json` 必须保留。文件删除不构成物理安全擦除承诺。

服务运行时需要以 `guandan` 读取凭据：`admins.json` 必须是私有普通文件（POSIX 无组/其他人权限）、非符号链接、位于管理端静态目录之外，且不得与平台 JSON 同路径。可只读检查，不输出文件内容：

```sh
sudo stat /srv/guandan/shared/admin/admins.json
sudo -u guandan test -r /srv/guandan/shared/admin/admins.json
timedatectl status
```

追加账号目前不是在线功能：为新个人生成独立私有文件，由授权运维离线合并 `schemaVersion: 1` 的 `admins` 数组，核验唯一 `id`、唯一用户名与角色（最多 100 条），不覆盖其他个人记录。变更密码/TOTP、角色或 `disabled` 后均须重启平台。禁用离职账号使用 `disabled: true` 后重启；保留其 ID 供历史审计识别，不给新个人复用。没有通用恢复码；设备丢失由授权运维离线重新绑定，禁止关闭 TOTP 作为绕过。

## 4. 生产环境配置与关闭语义

用 `sudoedit /srv/guandan/shared/production.env` 仅追加或更新下列非秘钥配置，保留既有四个独立 HMAC 密钥、微信环境文件和其他业务参数：

```dotenv
ADMIN_CREDENTIALS_FILE=/srv/guandan/shared/admin/admins.json
ADMIN_ORIGIN=https://api.yutechhn.cn
ADMIN_SESSION_TTL_MS=28800000
```

`ADMIN_ORIGIN` 是精确 Origin，不带 `/admin/` 或尾斜杠。生产不要设置 `ADMIN_ALLOW_INSECURE_LOCALHOST`；它只允许显式非生产回环 HTTP 调试，生产配置会拒绝。有效会话时长为 300000–43200000 毫秒，默认 8 小时。

既有关键生产值继续保持：`NODE_ENV=production`、`PLATFORM_HOST=127.0.0.1`、`PLATFORM_PORT=33103`、`PLATFORM_ENABLE_DEV_LOGIN=false`、`PLATFORM_STORE_MODE=json-single-instance`、`PLATFORM_JSON_FILE=/srv/guandan/shared/data/platform.json`、`PLATFORM_CORS_ORIGIN=https://api.yutechhn.cn`。不得重跑初始化来替换既有密钥，也不把这里的增量片段当成完整生产环境文件。

全部 `ADMIN_*` 未配置时，`/admin/` 和 `/api/v1/admin/*` 返回 404；玩家消息、反馈和功能状态仍正常工作。仅漏填凭据、但留下其他管理配置不属于正常关闭，会 fail-fast 拒绝平台启动。关闭后台应移除 `ADMIN_CREDENTIALS_FILE`、`ADMIN_ORIGIN`、`ADMIN_SESSION_TTL_MS`、`ADMIN_ALLOW_INSECURE_LOCALHOST` 四项，再在批准的维护窗口重启。

## 5. 同一个 HTTPS 主机的反向代理

在 `api.yutechhn.cn` 现有 HTTPS server 的掼蛋 include 中增加以下精确路径，保留原有路由。不代理整个根 `/api/v1/`：该主机历史上还有其他业务的 `/api/v1/health`。

```nginx
location = /admin {
    return 308 /admin/;
}

location ^~ /admin/ {
    proxy_pass http://127.0.0.1:33103;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-Proto https;
    proxy_cache off;
    proxy_read_timeout 30s;
}

location ^~ /api/v1/admin/ {
    proxy_pass http://127.0.0.1:33103;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto https;
    proxy_set_header Origin $http_origin;
    proxy_set_header X-CSRF-Token $http_x_csrf_token;
    proxy_set_header Cookie $http_cookie;
    proxy_cache off;
    proxy_read_timeout 30s;
    proxy_send_timeout 30s;
}
```

`proxy_pass` 不带 URI 后缀，完整保留 `/admin/...` 与 `/api/v1/admin/...`。管理端固定请求根 `/api/v1/admin/`，不能只新增静态路由或只在 `/guandan/api/v1/admin/` 配置代理。保留上游 `Set-Cookie`、CSP、`Cache-Control: no-store` 与 MIME，不移除 HttpOnly/SameSite/Secure，不开启跨域管理 API，不记录请求正文/Cookie/CSRF header。

生产 Cookie 为 `__Host-guandan_admin`，`HttpOnly; SameSite=Strict; Secure; Path=/`；写操作还校验精确 Origin、内存 CSRF token 和服务端角色。可在代理层对两个管理前缀统一增加批准的管理网络/IP 访问策略，但不能用代理限制替代应用鉴权。

应用不信任 `X-Forwarded-For` 作为限流身份：登录按实际 socket IP 与用户名各限 10 次/15 分钟，最多 4 个同时密码计算。经同一个 Nginx 回环转发时，管理员共享 socket-IP 配额；不要在生产循环失败登录压测。扩大团队/代理拓扑前需另行评审限流策略，不擅自改为信任任意请求头。

待配置审查和执行授权后，先 `sudo nginx -t`，成功才 reload；使用维护窗口重启 `guandan-platform` 读取管理配置。不要重启整台主机。这里不声称任何操作已执行。

## 6. 会话、备份与容量

- 会话只在平台进程内存中，最多每人 5 个、总计 10000 个；注销即撤销。平台重启会撤销所有管理会话，旧 Cookie 不可恢复。
- TOTP 已消费步骤仅以哈希账号键和计数写入同一平台 JSON 的 `adminSecurity`，并通过事务防并发重放；不要清除这部分来“修复登录”。同一验证码不能重复登录，应等待下一步验证码。
- 公告/反馈/功能/已读/审计使用同一 `operations` 状态和单一平台 writer。不要另启 `node server/platform-server.js` 指向线上 JSON，也不能用 PM2 cluster、第二个 systemd 实例或独立“管理服务”并发写同一文件。
- 激活器在停服后备份整个 `/srv/guandan/shared/data`。凭据目录与 root 环境文件在发布包之外，需另行采用加密、限权、可恢复的备份；不放进普通构建制品或故障日志。
- 审计采用追加记录；反馈只保存身份/版本/状态/回复数量变化和新回复，不重复完整会话。审计上限为 100000 条且紧凑 UTF-8 JSON 载荷不超过 32 MiB（实际格式化文件及其他状态另占空间）。字节上限返回 503 `OPERATIONS_AUDIT_CAPACITY`，条数上限返回 503 `OPERATIONS_CAPACITY`，业务修改和审计一起回滚。现有审计没有在线删除/轮转 API，需另行设计审核过的归档方案；不要手改计数或清空历史绕过限制。
- 容量告警与离线归档工具现见 `docs/PROJECT_MANAGEMENT_20260926.md`：只生成带哈希的私有归档和候选快照，不直接操作线上 writer。仍须监控磁盘、备份可读性、服务重启和 429/503；单机 JSON 不能据此宣称具备正式多实例容量。

## 7. 最终验收命令（仅在获准发布后执行）

以下不提交运营业务记录、不创建玩家，TLS 校验保持开启：

```sh
sudo systemctl is-active guandan-platform guandan-game
sudo journalctl -u guandan-platform --since '10 minutes ago' --no-pager
curl --fail --silent --show-error https://api.yutechhn.cn/guandan/api/v1/health
curl --silent --show-error --dump-header - --output /dev/null https://api.yutechhn.cn/admin/
curl --silent --show-error --dump-header - https://api.yutechhn.cn/api/v1/admin/session
curl --silent --show-error --dump-header - --output /dev/null https://api.yutechhn.cn/admin/src/app.js
curl --silent --show-error --dump-header - --output /dev/null https://api.yutechhn.cn/admin/README.md
curl --silent --show-error --dump-header - --output /dev/null https://api.yutechhn.cn/admin/.env
curl --path-as-is --silent --show-error --dump-header - --output /dev/null 'https://api.yutechhn.cn/admin/%2e%2e/shared/admin/admins.json'
curl --silent --show-error --dump-header - \
  -H 'Origin: https://untrusted.example' -H 'Content-Type: application/json' \
  --data '{}' https://api.yutechhn.cn/api/v1/admin/session
/opt/node-v24.19.0/bin/node /srv/guandan/ops/verify-deployment.mjs
```

启用后预期：健康 200；管理 HTML 和 `src/app.js` 为 200 且 MIME 正确、带严格 CSP/no-store/nosniff；匿名 session 为 JSON 401；未知/私有静态路径不返回内容（通常 404，代理也可提前 400/403）；不可信 Origin 登录为 403。未启用阶段管理入口/session 应为 404，不应误判为需要生成默认账号。原有传输验证脚本不代替管理后台验收。

由本人在上述 HTTPS 页面输入密码与验证码，检查 Secure/HttpOnly/SameSite Cookie、刷新恢复会话、本人角色可读页面、注销后 session 401；不要把登录正文、Cookie 或 CSRF token 放入 curl 命令历史。随后按批准的测试范围验证公告草稿/发布、反馈回复、开关和审计；写入会影响真实运营数据，不能把自动生产写入当作无害 smoke。真实用户验收与未完成项目单独记录。

## 8. 回退

1. 仅后台需要紧急关闭时，移除全部四项管理环境设置并在维护窗口重启平台；这会撤销全部管理会话，但保留玩家数据、运营记录与 TOTP 重放状态。可同时撤下新增的两个管理路由；不删除原有 `/guandan/` 路由或覆盖整个站点。
2. 代码需要回退时，先核对发布备份的 `previous-release.txt` 与当前数据兼容性，在批准的停服窗口使用既有 current 切换流程回到已验证的上一 release；保留故障 release 与当前数据作诊断。激活器自身的失败回退保留业务数据，不回灌旧快照。
3. 不自动恢复旧 `platform.json`：它包含钱包、牌局相关状态、运营修改和 TOTP 计数，恢复可能丢失新业务数据。数据回退必须另获授权，先备份故障时现状并完成兼容/恢复评审；密钥与凭据也不得从不明旧副本覆盖。
4. 回退后重新运行非写入 smoke，确认原游戏路由、平台鉴权和状态完整。操作记录必须写明实际动作和结果；本手册的完成不等于已发布、已绑定账号或已通过生产验收。
