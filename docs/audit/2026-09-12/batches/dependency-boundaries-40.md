# 第四十批补充：第三方依赖边界、许可声明与公告核验

基线：`1d58999dc6e5455b049e1643660bbba3deee1406`。核验时间为 2026-09-13（Asia/Shanghai；JSON 保留 UTC 时间）。这是依赖边界补充，三份锁文件已在第34批计入第一方覆盖，本批 `reviewed: []`，不重复增加覆盖分子。

**无新增确认的仓库缺陷，但确认一项上游公告版本命中；全量公告核验仍有缺口。** 原有41项问题（17 P2 / 24 P3）未修复。完整69项名称、版本、锁定 SHA512、许可声明、metadata/notice 路径与 SHA256 见 [JSON](dependency-boundaries-40.json)。

## 依赖清单与生产边界

| 边界 | 锁定包数 | 结论 |
| --- | ---: | --- |
| shared-core | 69 | TypeScript 4.9.5、Vitest 4.1.10及传递工具依赖，均从 devDependencies 进入 |
| Cocos项目 pnpm | 1 | 同一 TypeScript 4.9.5，为开发/类型检查依赖 |
| Node服务器 pnpm | 0 | 无第三方 npm dependencies；依赖 Node内置模块和仓库 shared-core/dist |
| 去重后 | 69 | 70次锁条目；两个 TypeScript 条目完整性值相同 |

本机找到46个不同包、47份自有 package.json；名称/版本全部与锁一致，没有发现额外的自有 pnpm package 根。另23个未安装条目均有 OS/CPU 条件，且来自 optionalDependencies，分别为其他平台的 Rolldown 13项、Lightning CSS 10项。不能把未安装的跨平台包当作本机缺包，也没有从本机已有包装推它们的许可证。

两份本地 `.pnpm/lock.yaml` 与各自源码锁逐字一致。所有69项 SHA512字段格式通过，但这里没有对下载 tarball、签名或解包内容做真实性核验；本机 metadata 哈希仅用于复查本次观察。

对服务器 `.js` 和共享核心已有 `.js` 产物共125文件做只读字面量 import/require 扫描，只看到本地相对引用及8类 `node:` 内置模块，没有第三方裸包名或动态 import 表达式。此扫描不是运行轨迹或形式化依赖闭包证明，也没有执行入口、构建或测试。Cocos的 `cc` 引擎和微信宿主不在这三份 npm 锁里，零生产 npm 依赖不等于零外部运行时风险。

## 许可声明

本地46种包的 package.json 声明为 MIT 38、Apache-2.0 3、MPL-2.0 2、ISC 2、BSD-3-Clause 1。MPL-2.0 两项是 `lightningcss` 和其本机原生包，不能将整个工具链概括为 MIT。记录47份 LICENSE/COPYING/NOTICE/ThirdPartyNotice 文件哈希；TypeScript另有 ThirdPartyNoticeText。`@rolldown/binding-darwin-arm64`、`stackback` 的包根没有匹配该文件名模式的独立许可文件，但 metadata 声明 MIT。

这只是声明/文件留存检查，不是法律批准或发布物通知完整性审查；23个非本机包的许可未核实。本批未证明项目正在向用户分发这些开发工具，不能仅凭许可文件模式缺失认定侵权。媒体、字体和引擎内嵌第三方的权利链也不能由 npm metadata 推出。

## 当前公告：明确命中，明确前提

**GHSA-82fw-gwwq-j7x9 / CVE-2026-84373（Moderate）确实覆盖锁定的 `vitest@4.1.10` 和 `@vitest/mocker@4.1.10`。** 公告稳定版受影响区间为 `>=2.1.0 <4.1.11`，修复版4.1.11。风险为开发服务的重定向 mock 读取越界文件；上游区分可达的 standalone mocker/interceptor 插件 WebSocket 路径与有 token 的 browser RPC。这里仅登记维护/安全关注，不伪装成“无公告”。[上游公告](https://github.com/vitest-dev/vitest/security/advisories/GHSA-82fw-gwwq-j7x9)

仓库已核入口为 `vitest run`，锁中没有 `@vitest/browser`；对共享核心测试/manifest/CI作定向搜索，未见 browser/API外露或 standalone `mockerPlugin` / `interceptorPlugin` 配置。因所需路径没有在当前工作流得到证明，本批没有将此关注另计为可利用的仓库缺陷；不能把这一判断外推为用户以后手工开放开发服务器也安全。没有启动服务、模拟攻击、读取真实敏感文件或升级依赖。

其他定向比对：

- Vite8.2.1不在 GHSA-fx2h-pf6j-xcff 的8.x受影响区间（截至8.0.15），其修复版是8.0.16；这只是该条公告的排除。[Vite公告](https://github.com/vitejs/vite/security/advisories/GHSA-fx2h-pf6j-xcff)
- 两条 Browser Mode公告针对未被这三份锁纳入的 `@vitest/browser`，分别修于4.1.10与4.1.8；没有把同仓库所有子包等同于已安装包。[权限门禁公告](https://github.com/vitest-dev/vitest/security/advisories/GHSA-p63j-vcc4-9vmv)、[CDP公告](https://github.com/vitest-dev/vitest/security/advisories/GHSA-g8mr-85jm-7xhm)
- [Rolldown](https://github.com/rolldown/rolldown/security/advisories)、[Lightning CSS](https://github.com/parcel-bundler/lightningcss/security/advisories)、[Cocos Engine](https://github.com/cocos/cocos-engine/security/advisories) 的维护者公告页未显示已发布条目；页面为空不是“无漏洞”证明。Vite/Vitest的旧公告档案未逐条完成全量比对。

## Node 与 Cocos 不应混入 npm 清单

服务器 manifest为 Node `>=22`；两份 systemd配置指定 `/opt/node-v24.19.0/bin/node`；CI选择 Node22，本审计进程本机版本为26.7.0。四者不是同一条部署证据。官方目前将22/24列为 LTS；July安全发布的24线修复版为24.18.1，配置中的24.19.0数值上较后，但未查验线上二进制/构建来源。后续24.21.0还更新了 OpenSSL/Undici；不能仅凭“不是最新”新增缺陷，也不能仅凭配置路径判定线上已打补丁。[生命周期](https://nodejs.org/en/about/previous-releases)、[July安全公告](https://nodejs.org/en/blog/vulnerability/july-2026-security-releases)、[24.19.0](https://nodejs.org/en/blog/release/v24.19.0)、[24.21.0](https://nodejs.org/en/blog/release/v24.21.0)

项目声明 Creator3.8.8，官方存在对应版本；v3.8.8 runtime engine的顶层许可证是 MIT。该声明不涵盖编辑器本体、所有 engine外部组件或最终包的许可证集合；编辑器支持自定义引擎路径，因此 package.json版本字段不证明真实构建引擎的内容/哈希。[官方下载条目](https://www.cocos.com/creator-download)、[v3.8.8引擎许可证](https://github.com/cocos/cocos-engine/blob/v3.8.8/LICENSE.md)、[引擎路径配置](https://docs.cocos.com/creator/3.8/manual/en/editor/preferences/)

## 网络与覆盖限制

尝试按官方规范直接向 `https://registry.npmjs.org/-/npm/v1/security/advisories/bulk` 请求已人工确认公开的69个名称/版本。进程通过 `env -i` 启动，没有调用 npm/pnpm、读取 npmrc、继承凭据、提交私有包/仓库树、取 tarball 或产生缓存。连接在87秒观察点仍为 SYN_SENT，未获得可保存响应；只终止了本审计进程，没有重试。[npm Bulk接口规范](https://docs.npmjs.com/cli/v11/commands/npm-audit/)

作为独立的只读核验尝试，GitHub reviewed/malware 两种公开名称/版本批量查询均被浏览工具以 non-retryable URL安全错误拒绝，未重试或绕过。因此不能报告全69项“0 CVE/0恶意包”，也不能报告69项 registry完整性一致；JSON明确记录 `resultCount: null`。随后能读取的维护者公告页形成上述定向证据，不替代全量查询。[GitHub查询参数规范](https://docs.github.com/en/rest/security-advisories/global-advisories?apiVersion=2022-11-28)

初版探针的 socket timeout未覆盖建连阶段，已在审计脚本加20秒绝对期限，并在首个公告失败后跳过元数据请求；这是探针改正，不是产品缺陷。修订后的在线分支未再次请求。没有得到初次在线输出，不能断言该中止过程中实际完成了多少HTTP请求；不把未捕获结果写成成功。

## 重复离线核验

```sh
env -i PATH=/opt/homebrew/bin:/usr/bin:/bin /opt/homebrew/bin/node docs/audit/2026-09-12/repro/dependency-boundaries-40.mjs
```

[探针](../repro/dependency-boundaries-40.mjs)只读并向 stdout输出；本机离线复跑通过。保留的 `--online` 为固定官方 registry、固定公开 allowlist、无重试的可选后续入口，本轮未重跑。仅以 apply_patch 写本批审计文件，未改业务、锁文件、依赖或中央审计台账。
