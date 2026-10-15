# AstroBox 个人主页音乐播放器

一个用于 **AstroBox 个人主页**的轻量音乐播放器，通过 iframe 嵌入。界面仅保留歌名、专辑封面、歌词与播放进度条，以透明背景融入个人主页。

当前收录歌曲：**トゲナシトゲアリ — 雑踏、僕らの街 (OP)**。

## ✨ 功能

- **封面交互**：点击封面播放或暂停；播放时封面旋转并略微放大，暂停时停止旋转并平滑缩小，再次播放从当前角度继续。
- **双语歌词**：同步显示日文歌词和中文翻译，高亮当前句并自动滚动，周围歌词以淡化和轻微模糊呈现。
- **歌词跳转**：点击任意歌词跳转到对应时间，保留当前播放或暂停状态。
- **进度控制**：拖动进度条调整播放位置，显示当前时间和总时长。

tips: 封面及日中双语歌词均提取自原始 MP3 的内嵌信息。

## 🚀 使用方法

将播放器文件命名为 `index.html`，放在仓库根目录。可先使用浏览器打开文件，点击封面试听。

页面不会自动播放，需要用户主动点击。系统开启“减少动态效果”时，会关闭封面旋转及相关过渡动画。

### 部署到 GitHub Pages

1. 新建一个公开的 GitHub 仓库，并上传 `index.html`。
2. 进入仓库的 **Settings → Pages**。
3. 在 **Build and deployment** 中，将 **Source** 设为 **Deploy from a branch**。
4. 选择保存页面的分支（通常为 `main`），目录选择 **`/ (root)`**，点击 **Save**。
5. 等待部署完成，使用 Pages 设置页面显示的网站地址。

普通项目仓库的地址通常为：

```text
https://你的用户名.github.io/你的仓库名/
```

### 嵌入 AstroBox 个人主页

在个人主页自定义板块中添加以下代码，将 `src` 替换为实际的 GitHub Pages 地址：

```html
<iframe
  src="https://你的用户名.github.io/你的仓库名/"
  title="雑踏、僕らの街 (OP)"
  width="100%"
  style="border:0;display:block"
  data-astrobox-transparent="true"
  data-astrobox-board-padding="none"
  data-astrobox-board-background="transparent"
  data-astrobox-auto-height="true"
  data-astrobox-theme="true"
></iframe>
```

`src` 应为可直接打开播放器的 **HTTPS 网页地址**，不能使用本地路径或 GitHub 仓库文件页面地址。

## 🔌 AstroBox 接入

依据 [AstroBox 个人主页 iframe API 文档](https://abox.run/docs/usage/custom/personal-homepage-iframe-api)实现，使用协议版本 **1**，需要 **AstroBox 2.1 及以上版本**。

| 接入能力 | 实现方式 |
| --- | --- |
| 初始化通知 | 页面初始化后发送 `ready` |
| 配置接收 | 校验父窗口来源、消息命名空间和协议版本，接收 `config` |
| 主题同步 | 根据 `config.theme` 切换文字与控件配色 |
| 自动高度 | 使用 `ResizeObserver` 监听布局，通过 `requestAnimationFrame` 合并 `resize` 上报 |
| 强制高度更新 | 收到 `config.requestResize` 时，即使高度未变化也重新上报 |

背景始终保持透明。页面不包含外部导航链接，也不使用资源跳转接口。

## 🛠️ 调整样式

可直接编辑 `index.html` 中的 `<style>` 样式块：

| 调整项 | 对应位置 |
| --- | --- |
| 文字与进度条颜色 | `--ink`、`--muted`、`--rail` |
| 封面大小 | `.cover` 的 `max-width` |
| 封面旋转速度 | `.cover img` 的 `animation` 时长 |
| 暂停时封面大小 | `.cover` 的 `transform: scale(.9)` |
| 歌词显示区域高度 | `.lyrics` 的 `height` |
| 移动端布局 | `@media(max-width:620px)` |

歌曲资源已内嵌到 HTML 中；更换歌曲时，需要同步更新音频、封面、歌名、时长与歌词数据。

## 📚 参考文档

- [AstroBox 个人主页 iframe API](https://abox.run/docs/usage/custom/personal-homepage-iframe-api)
- [GitHub Pages 发布源设置](https://docs.github.com/en/pages/getting-started-with-github-pages/configuring-a-publishing-source-for-your-github-pages-site)
