# 第十二批：账户资料、默认头像、头像数据与商户服务

基线 HEAD：`1d58999dc6e5455b049e1643660bbba3deee1406`。root 完整审阅11文件 / 829行，无新增已确认问题。
完整文件哈希、逐项结论见 [JSON](account-profiles-12.json)。

## 覆盖

统一前缀 `work/guandan-windows-source/`：

| 文件 | 行数 | 重点 |
| --- | ---: | --- |
| server/platform/account-service.js | 239 | 账号分配/索引、登录优先级、一次初始积分、资料原子保存 |
| server/platform/account-service.test.mjs | 50 | 同身份、Unicode昵称、保存后登录不覆盖 |
| server/platform/profile-avatar.js | 59 | patch约束、头像代理、流量上限和缓存 |
| server/platform/profile-avatar.test.mjs | 20 | URL/昵称校验与内存Response |
| server/platform/profile-upload.js | 37 | data URI/base64、头部尺寸、内容SHA地址 |
| server/platform/default-profile-upload.test.mjs | 62 | 默认资料、上传/替换、本地HTTP保存与取图 |
| server/default-profiles.js | 19 | 静态捆绑目录、随机/稳定选择、文件读取 |
| server/player-nicknames.js | 27 | 四席名字去重、重连稳定、头像映射 |
| scripts/import-default-profiles.mjs | 41 | 一次性导入、部分失败/恢复、限流和资源写入 |
| server/platform/merchant-service.js | 201 | 申请、门店/角色、赠分幂等与日额度 |
| server/platform/merchant-service.test.mjs | 74 | pending/active、幂等/归属、记录和账本 |

HTTP、facade及客户端调用是辅助追踪，没有因引用或搜索而计入完整审阅。真实捆绑目录被测试使用也不自动标为目录/素材/许可证边界完成。

## 验证与边界

```sh
node work/guandan-windows-source/server/platform/account-service.test.mjs
node work/guandan-windows-source/server/platform/profile-avatar.test.mjs
node work/guandan-windows-source/server/platform/default-profile-upload.test.mjs
node work/guandan-windows-source/server/platform/merchant-service.test.mjs
node docs/audit/2026-09-12/repro/account-profiles-12.mjs
```

全部退出0。[补充探针](../repro/account-profiles-12.mjs) 使用真实业务模块、内存存储和合成用户：

- 新建账号落盘失败不留下用户/初始账目；账户提交后签票端口失败，再登录不会重复创建或重复赠分。
- 40次同身份并发仍为1人；额外80身份强制相同八位候选号，经过128次碰撞后确定性回退，最终81人、81唯一账号和81条初始记录。
- 修改昵称与上传图片的持久失败不会半写；登录旧资料不覆盖已保存资料；失败草稿不落库。相同图片两人上传后，只有最后一个使用者替换完才不再能从账号集合取回旧内容。
- 4种Unicode边界按code point保留24字，25字拒绝。返回公开资料无avatarImageData。
- 500个合成房间，旧名字纠正、四席去重、已存名字恢复稳定；默认名称是显示资料，机器人身份仍由其他metadata字段管理。
- 头像缓存验证599999ms命中、600000ms失效，20条容量逐出，失败可重试。替换的是隔离进程全局fetch和Date.now，finally恢复；没有真实远程请求。
- 5组代理返回/尺寸案例；512KiB接受、超过1字节拒绝；25组PNG头部宽高组合检查1..256范围。**头部fixture不等于有效可渲染PNG，也没有验证CRC、像素解码或实网8秒超时。**
- 商户fixture由测试手动置active；真实服务赠分持久失败完全回滚，20次同key只发一次，另外6个并发请求竞争剩余额度时只允许4个成功，合计5000分和5条账本。

既有上传HTTP测试仅在127.0.0.1动态端口，authenticate为合成token端口、账号为memory，finally关服务。未调用微信、QQ或线上账户。

## 本批没有冒充完成的部分

- 一次性昵称/头像导入器会curl上游且写正式资源目录，所以只完整审阅代码，**没有运行**；游戏启动模块不会调用该导入器。导入是否满50、资源来源/授权、素材去重与包体对应继续归属专门边界检查。
- 图片上传使用64KiB/256像素头部边界，代理使用512KiB/签名边界；不是全文件格式验证或内容审核承诺。
- 商户接口在平台HTTP仍注册。目标搜索未找到活动Cocos商户页面，但这不足以判断对外API已退役；不自动删除。
- 商户console的grantedPoints只汇总返回的最近50条grant；日额边界用进程本地午夜；已有商户owner身份优先于employee身份。这些规则与统计、部署时区、多商户需求的对应仍需边界核验，**未凭假定将其升级为当前线上缺陷**。

本批只新增审计材料，原有修改保留，没有改产品、写真实资料、批准商户、发真实积分或部署。
