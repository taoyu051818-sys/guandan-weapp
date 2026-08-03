# 安卓 (Android) APP 打包指南

由于当前的云端 Linux 环境没有安装庞大的 Android SDK 和 Gradle 编译环境，我无法直接为您生成最终的 `.apk` 安装包。

不过，我已经利用现代跨平台框架 **Capacitor** 将您的项目转换为了标准的 Android 原生工程，并为您准备好了包含所有代码和前端资源的压缩包：`guandan-master-1.0.0-android-source.zip`。

您只需要在本地电脑上执行以下简单步骤，即可生成安卓安装包：

### 准备工作
1. 下载并安装 [Android Studio](https://developer.android.com/studio)（谷歌官方的安卓开发工具）。
2. 将我为您生成的 `guandan-master-1.0.0-android-source.zip` 下载到您的电脑并解压。

### 编译步骤
1. 打开 **Android Studio**，点击主界面的 **"Open"**。
2. 选中您刚刚解压出来的 `android` 文件夹（注意是 `android` 这一层目录，里面包含 `build.gradle` 等文件），然后点击 OK 打开项目。
3. Android Studio 会自动开始同步项目、下载对应的 Gradle 版本和依赖（首次打开可能需要几分钟，请保持网络畅通）。
4. 同步完成后，点击顶部菜单栏的 **Build** -> **Build Bundle(s) / APK(s)** -> **Build APK(s)**。
5. 编译完成后，右下角会弹出一个提示气泡，点击其中的 **"locate"**（定位），即可在文件夹中找到最终生成的 `.apk` 文件。
6. 您可以直接将该 `.apk` 文件发送到您的安卓手机上进行安装和游玩！

如果您想直接将手机连接到电脑上进行真机调试，也可以在 Android Studio 中连接手机并点击顶部绿色的“运行 (Run)”按钮。

如果在打包过程中遇到任何环境或配置报错，欢迎随时向我提问！
