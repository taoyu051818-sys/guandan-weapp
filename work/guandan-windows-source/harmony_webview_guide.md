# 鸿蒙 (HarmonyOS NEXT) APP 打包指南

由于编译原生的鸿蒙安装包 (`.hap` 或 `.app`) 强依赖于华为官方的 **DevEco Studio** 编译器以及华为开发者账号的签名证书，我们无法在当前的云端 Linux 环境中直接为您生成最终的安装包。

但我已经为您编译好了用于鸿蒙 WebView 调用的全套前端静态资源压缩包 `dist-harmony-h5.zip`。您只需要在本地的 DevEco Studio 中按照以下简单几步即可生成鸿蒙 APP：

### 第一步：创建项目
1. 打开 DevEco Studio，创建一个新的 **Empty Ability** 项目。
2. 语言选择 **ArkTS**，模型选择 **Stage**。

### 第二步：导入资源
1. 解压我为您生成的 `dist-harmony-h5.zip`。
2. 将解压出的 `dist` 文件夹下的所有内容（包括 `index.html` 和 `assets` 目录），复制到鸿蒙项目的 `entry/src/main/resources/rawfile` 目录下。

### 第三步：配置 Web 权限
在 `entry/src/main/module.json5` 中，添加网络权限（如果未来有联网需求）：
```json
"requestPermissions": [
  {
    "name": "ohos.permission.INTERNET"
  }
]
```

### 第四步：编写 WebView 代码
打开 `entry/src/main/ets/pages/Index.ets`，将内容替换为以下代码：

```typescript
import web_webview from '@ohos.web.webview';

@Entry
@Component
struct Index {
  controller: web_webview.WebviewController = new web_webview.WebviewController();

  build() {
    Row() {
      Column() {
        Web({
          src: $rawfile('index.html'),
          controller: this.controller
        })
        .width('100%')
        .height('100%')
        .domStorageAccess(true)
        .fileAccess(true)
        .mixedMode(MixedMode.All)
        .javaScriptAccess(true)
      }
      .width('100%')
    }
    .height('100%')
  }
}
```

### 第五步：编译打包
点击菜单栏的 `Build` -> `Build Hap(s)/APP(s)` -> `Build Hap(s)`，即可生成可以安装在鸿蒙设备上的 APP 安装包了！
