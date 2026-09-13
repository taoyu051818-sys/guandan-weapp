# asset-pipeline-05：素材同步、退役与构建产物

日期：2026-09-12。审阅：root。HEAD：`1d58999dc6e5455b049e1643660bbba3deee1406`。

本批完整审阅 11 个先前 pending 文件，共 999 行。逐文件 SHA-256、行数与完整审查 notes 见 [同名 JSON](asset-pipeline-05.json)。新增确认 finding 0，来源核验边界 1；沿用 BUILD-03-001，不重复计数。

## 完整审阅范围

| 文件（work/guandan-cocos 下） | 行数 |
| --- | ---: |
| scripts/sync-core.mjs | 28 |
| scripts/sync-default-profiles.mjs | 13 |
| scripts/verify-retirement.mjs | 86 |
| scripts/wechat-open-data-package.mjs | 20 |
| scripts/finalize-web-build.mjs | 99 |
| tests/more-feature-retirement-regression.cjs | 62 |
| tests/retirement-boundary-regression.cjs | 42 |
| scripts/import-licensed-audio.mjs | 93 |
| scripts/import-niuma-audio.mjs | 201 |
| scripts/import-niuma-bgm.mjs | 90 |
| scripts/verify-legacy-effect-assets.mjs | 265 |

## 实测与可信边界

- 两个退役回归通过：一个以源码正则检查入口/页面约束，另一个实际实例化 FrontPageController 并注入页域验证赛事委派。不是微信点击或赛事全流程。
- 退役源码检查确认 17 个模块已移除，20 个归档音效字节和哈希匹配；活动回放/好友房观战保留。标记扫描无法证明所有可能别名或重写后的逻辑都已退役，仍需全库可达性审阅。
- 既有 Web 构建 327 文件退役检查通过；微信目录主包文件合计 3,302,334 字节、分包 13,743,105 字节、合计 17,045,439 字节。只是现有目录字节统计，不是微信实际上传包大小或限额合规声明。
- 微信开放域 3 个 JS 文件逐字匹配当前模板，game.json 声明正确；Web 用明确公开发布端点进行 --check --release，通过。第一次净化空环境因缺必需 endpoint 被拒绝属于正确配置门禁；按契约传值后二次通过，不是产品故障。
- 现有构建目录修改时间均为 2026-09-10，不能由上述通过推断它们包含当前全部源代码和五处 dirty。没有调用 Creator、重建、上传或重新写入产物。
- legacy effect 检查 5 allowed / 39 rejected / 0 runtime；扫描 60 个候选文件，通过。未传外部 source-root，输出明确为 source skipped。同扩展精确哈希黑名单、许可文件哈希都不能替代完整上游来源与授权核验。

## 隔离探针

在仓库根执行：

```sh
node docs/audit/2026-09-12/repro/asset-pipeline-05.cjs
```

探针读取当前导入器/同步器源代码并仅在内存转译运行；fs、fetch 和子进程端口全部受控。真实 core-sync-policy 被导入，不用复制规则代替测试对象。所有 `/synthetic-*` 路径只存在于 Map，未创建对应磁盘目录。

验证：

1. open-data 三文件复制、checkOnly 不写、旧文件拒绝、错误声明拒绝及其他配置保留。
2. core-sync 嵌套旧 TS 清理、当前 TS 复制、兼容 barrel 排除、普通 meta UUID 保留及唯一退役 meta 清理。
3. 默认资料用合成名字/字节检查复制和 texture 路径，不读取真实账户。
4. licensed MP3 无效 HTTP 内容不能覆盖选中当前音效；通过最低头/长度校验的响应形成匹配字节数和 SHA-256 的 manifest。不是解码、试听或源授权证明。
5. NiuMa BGM 不同 HEAD 前置拒绝、已修改目标拒绝；匹配 HEAD 时实际读取 working tree 的音频，见下述 concern。

## SOURCE-05-C01：固定 HEAD 不等于选中文件与提交 blob 一致

`import-niuma-bgm.mjs:52` 与 audio 导入器相同模式：先 `git rev-parse HEAD` 对常量，再 readFile 当前工作树。上游文件有未提交改动并不改变 HEAD；如果目标尚不存在，改动字节会被导入并在 manifest 中仍记录固定 sourceRevision。

真实 BGM 脚本在内存端口中复现：匹配 HEAD、许可文本一致、修改过的模拟音频被接受；唯一 Git 调用为 rev-parse HEAD，没有逐文件 blob 或 clean 状态核查。与此同时目标改动和不同 HEAD 均被正确拒绝。

仅作来源验证缺口，不计确认缺陷：尚未检查真实上游 checkout/固定提交的音频与当前已导入资源是否不同，不能据此宣布当前素材受污染。后续来源专项需核 selected blobs 或受控干净 checkout，保留许可证边界说明。

## 操作与其他限制

- sync-core 会先清生成 TS、再拷贝；licensed importer 会剪除非 catalog 的 MP3，并逐个下载覆盖；两者不是整个批次的原子事务。此处只记录工具操作边界，未执行真实破坏性步骤，也不假设本地存在未归档新增素材。
- NiuMa audio 清理仅针对旧 manifest 拥有且哈希未变的文件，当前目标异样会拒绝覆盖。许可文件与固定 HEAD 比对不单独构成商用权利结论。
- MP3 头、静态 format 字段不代表循环接缝/响度/真机播放质量。来源和完整第三方/资源边界仍未完成，不勾选整体完成门槛。
- 只新增本批审计报告与隔离脚本，保留五处原修改；未提交、推送或触达线上。
