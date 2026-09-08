# 商业 UI 资源审查清单

> 审查日期：2026-08-31
>
> 来源目录：`/Users/mac/Downloads/掼蛋（非开发项目，仅供参考）`
>
> 目标：只让“来源可追溯、许可明确、视觉达到当前陵水海蓝/香槟金基线”的素材进入正式运行包。

## 结论

本轮没有把新的 UI 图片直接复制进 `assets/`：MIT 旧客户端资源可以合法复用，但大部分仍带明显的旧棋牌风；视觉质量最高的商业 UI 合图没有随附许可证或生成记录。当前只记录候选、九宫格参数、拒绝项和授权阻塞，避免把“能找到”误当成“能上线”。

唯一已经复用的同源图片是金币图标：源文件与当前 `assets/game-assets/ui/lobby/coin.png` 的 SHA-256 完全一致，不重复导入。

## 来源与授权证据

| 项目 | 记录 |
| --- | --- |
| MIT 源仓库 | `https://github.com/niuma-wj/client-cocos.git` |
| 固定 revision | `f9d037feaef5a80867fd97c8dd39b9a7486fbeca` |
| 本地许可证 | `/Users/mac/Downloads/掼蛋（非开发项目，仅供参考）/client-cocos/LICENSE` |
| 完整图片清单 | `/Users/mac/Downloads/掼蛋（非开发项目，仅供参考）/organized/image-assets/manifest.csv` |
| 分类说明 | `/Users/mac/Downloads/掼蛋（非开发项目，仅供参考）/organized/image-assets/README.md` |
| 项目内许可证副本 | `third_party/licenses/NiuMa-client-cocos-MIT.txt` |

`manifest.csv` 已覆盖 641 张分类图片，并记录原路径、尺寸、SHA-256 和 Cocos UUID。正式采用其中任一图片时，仍要追加“源路径 -> 运行时路径”的导入清单，不能只保留文件名。

## 第一梯队：授权明确，可作重绘或局部复用基线

这些素材的法律来源清楚，结构也有复用价值；但除已经接入的金币外，本轮都不直接进入运行包。后续应先去除烘焙文字、改成海蓝/香槟金，并在 1280×720 牌桌和窄屏安全区上完成视觉验收。

| 类别 | 源文件 | 可吸收内容 | 原九宫格参数 | 当前处理 |
| --- | --- | --- | --- | --- |
| 通用按钮 | `01-shared/guandan-common/button_bg.png`、`button_bg_red.png`、`button_close.png` | 圆角轮廓、按压层次、关闭语义 | 以原 `.meta` 为参考 | 只作结构参考；重新绘制无字底图 |
| 弹窗 | `01-shared/guandan-common/dialog_bg.png`、`dialog_bg1.png`、`dialog_title_bg.png` | 面板层级和标题区比例 | `dialog_bg` 四边 52px；`dialog_bg1` 四边 28px | 旧米黄色装饰偏重，不直接使用 |
| 聊天气泡 | `01-shared/guandan-common/bubble.png` | 座位气泡尾部、可拉伸区域 | 上下 26px、左 30px、右 26px | 可按当前白色半透明体系重绘 |
| 玩家信息 | `08-gameplay/room-desk/head_frame.png`、`HeadMask.png`、`text_bg.png` | 头像遮罩和昵称/余牌底板尺寸关系 | `head_frame` 上 22、下 32、左右 22；`text_bg` 四边 12px | 原蓝绿框与当前 HUD 不一致，不直接使用 |
| 结算 | `08-gameplay/room-results/frame.png`、`light.png` | 背光与结算层次 | 不适用 | 光片边缘过硬，只作动效参考 |
| 好友房键盘 | `03-lobby/guandan-hall/JoinRoom__Frame.png` 及同目录 `JoinRoom__Btn*.png`、`JoinRoom__NumberBottom.png`、`JoinRoom__Title*.png` | 数字键正常/按下两态和完整交互状态 | 以原 `.meta` 为参考 | 第二批重绘候选，不复制旧 prefab |
| 金币 | `01-shared/common-ui/gold.png` | 货币图标 | 不适用 | 已以相同哈希存在于 `assets/game-assets/ui/lobby/coin.png` |

## 第二梯队：功能语义值得吸收，图片本身不采用

| 类别 | 来源 | 决策 |
| --- | --- | --- |
| 出牌/提示/不要/贡还按钮 | `08-gameplay/room-desk/chupai_btn_*.png`、`button_present_tribute.png`、`button_refund_tribute.png` | 保留功能与按钮状态；重做无字底图，文案统一用 Cocos `Label` |
| 托管/准备/队伍/名次 | `08-gameplay/auto-play/`、`08-gameplay/room-seats/`、`flag_ready.png` | 只吸收状态语义，改成现代小徽章 |
| 商城框架 | `04-account-store/shop/shop1.png`、`btn_buy.png` | 只参考商品卡与购买按钮结构；不采用蓝紫旧面板和钻石商品 |
| 设置控件 | `01-shared/common-ui/slider_*.png`、`tab*.png` | 只参考滑块/页签状态；统一改为深海蓝和香槟金 |

旧 `Room.prefab`、`Hall.prefab`、`DlgShop.prefab`、`DlgPersonalCenter.prefab` 不复制。它们绑定旧 UUID、旧脚本和旧状态结构，只能用来核对页面层级与交互覆盖范围。

## 视觉最好，但授权阻塞

### `AI抠图_360智图.png`

- 位置：`/Users/mac/Downloads/掼蛋（非开发项目，仅供参考）/AI抠图_360智图.png`
- 尺寸：1437×1095，RGBA。
- 内容：金色/米色按钮、空白玩法卡、金币钻石条、底栏、功能图标和一张大厅背景。
- 优点：是本目录里最接近当前 3D 商业棋牌质感的一组。
- 技术处理：需要裁切、去除烘焙文字、重建九宫格、补 normal/pressed/disabled 状态，不能把整张图当图集直接上线。
- 阻塞：没有许可证、原始生成记录或可商用证明；文件名只表明经过“360 智图”抠图，关联的原文件名指向第三方站点。用户确认拥有原图及衍生图商业使用权前，不进入正式包。

### `人物.png`

- 位置：`/Users/mac/Downloads/掼蛋（非开发项目，仅供参考）/人物.png`
- 尺寸：1415×1112，RGBA。
- 内容：迎宾女性角色多个姿势和头像表情。
- 决策：授权同样不清楚，而且和现有小鸡主 IP 不统一；最多作为客服/新手引导的设计参考。

## 明确拒绝

| 资源 | 原因 |
| --- | --- |
| `https___huoya...png.png` | 商业 UI 合图的黑底重复版 |
| 根目录 `image.png` | 棋盘格已烘焙，不是真透明；现有 `chicken-timer-frame.png` 更干净 |
| `03-lobby/platform-hall/bg.jpg` | 旧大厅与陵水海滨主题冲突 |
| `08-gameplay/room-background/bg.png`、`room-desk/desk.png` | 旧桌面与当前 2.5D 牌桌冲突 |
| `slide_ad__*` | 其他游戏广告内容 |
| `shop/diamond*.png` | 商品方向错误，且不符合当前日用品示例商城 |
| `body_*`、`hair_*`、`head_*` | 旧人物拼装风格，与当前 IP 不一致 |
| `06-social/emoji/`、`06-social/meme/` | 视觉陈旧，单项来源也不够清楚 |
| `09-effects/room-effects/` | 与当前统一粒子/Renderer 体系冲突，不恢复旧几何特效 |
| `room-desk/sign_pass.png` | 违反“不出只显示文字、不套纸牌或木牌框”的已定交互 |

## 下一步启用条件

1. 用户提供 `AI抠图_360智图.png` 和 `人物.png` 的商业使用权说明或原始生成记录。
2. 美术从有授权的合图中裁出无字组件，补齐 normal、pressed、disabled 三态。
3. 任何新增运行时图片都补充来源、revision、SHA-256、目标路径和九宫格参数。
4. 在大厅、匹配、商城、牌桌、结算五个页面逐一验证安全区、缩放、文字长度和点击热区。
5. 通过视觉验收后再写进 `THIRD_PARTY.md` 并进入正式构建；未通过的候选继续留在包外。
