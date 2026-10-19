# AstroBox 个人主页音乐播放器

一个AstroBox的个人主页播放器～

## 开始使用

1. 将自己的 MP3 放到 `assets/audio/track.mp3`
2. 将项目内容部署到静态网站，或通过本地 HTTP 服务打开
3. 点击专辑封面播放或暂停

tips: 歌词和专辑封面都依赖于音频的内嵌信息，因此如果你的音频文件没有内嵌信息的话，虽然可以正常播放但是专辑封面和歌词都会变成棍母

如果音频文件需要使用其他文件名，请修改 `index.html`：

```html
<audio id="audio" preload="auto" data-src="assets/audio/my-track.mp3"></audio>
```

## 歌词与翻译

带时间戳的内嵌 LRC／SPL 歌词会按播放进度高亮，点击歌词可跳转到目标进度

歌词翻译按照 [SPL 标准](https://moriafly.com/standards/spl.html)识别：

- 相同时间戳的第一条文本作为原文，后续文本作为翻译。
- 紧跟时间戳歌词的无时间戳文本，作为该句翻译。
- 支持同一句的多行翻译。
- 纯时间戳行作为结束标记，不显示为歌词。

```text
[00:01.00]Original line
[00:01.00]Translation line
[00:04.00]Next original
Next translation
[00:07.00]
```

支持重复起始时间戳、显式／隐式结束和 `[offset:...]`。时间戳支持 1–3 位分钟、1–2 位秒以及 1–6 位小数。行内逐字时间戳会从显示文本中移除，当前只做按行高亮。

另外兼容以窄空格 `U+2009` 分隔原文与译文的内嵌时间戳歌词，会先转成同时间戳的多行文本，再交给 SPL 解析。此兼容按格式处理，不依赖歌名或歌词语言；普通空格不会拆分，翻译按钮仍只在识别到译文时显示。

如果文件使用其他行内分隔符，可以显式配置：

```html
<audio
  id="audio"
  preload="auto"
  data-src="assets/audio/track.mp3"
  data-lyric-separator=" | "
></audio>
```

这会把同一时间戳文本中的 ` | ` 两侧转成原文与翻译；不设置时使用窄空格兼容。若文件中的窄空格仅作排版，可设置 `data-lyric-separator=""` 关闭兼容，保留原文。转换只在内存中进行，不改写音频。

界面文字默认中文；这与歌曲语言无关。原文语言读取文件标签，无法确定的译文语言标记为 `und`。

## 交互

- 点击专辑封面播放／暂停
- 点击歌词立即跳转
- 系统开启“减少动态效果”时，关闭旋转和过渡动画

音频先完整载入，再使用同一份原始字节创建 Blob 播放源和读取标签。跳转仅修改播放进度，不重新加载音频，也不依赖服务器的远程分段请求。初次等待时间与 MP3 大小、网络速度有关。

## 目录

| 路径 | 用途 |
| --- | --- |
| `index.html` | 页面与音频路径配置 |
| `assets/audio/` | 放置自己的 MP3，包内仅保留使用说明 |
| `assets/images/cover-placeholder.svg` | 无封面或无法显示时的通用占位图 |
| `assets/css/player.css` | 布局、动画和主题 |
| `assets/js/player.js` | 播放、歌词、翻译及信息回退 |
| `assets/js/audio-file.js` | 完整加载音频并校验响应 |
| `assets/js/id3.js` | 通用标签与封面解析 |
| `assets/js/spl.js` | 时间戳、翻译和普通歌词解析 |
| `assets/js/lyric-anchor.js` | 统一布局固定点计算 |
| `assets/js/translation-layout.js` | 译文高度和透明度更新 |
| `assets/js/spring-motion.js` | 视口阻尼弹簧、连续定位与手势取消 |
| `assets/js/astrobox.js` | iframe 消息和高度同步 |
| `tests/fixtures.js` | 自动生成测试数据，不引用用户歌曲 |
| `tests/` | 标签、歌词和交互检查 |

## 本地运行与部署

通过 HTTP 加载项目，不能直接双击 HTML 用 `file://` 预览：

```sh
python -m http.server 8000
```

打开 <http://localhost:8000/>。项目无需构建、运行时框架或外部 CDN。

使用 GitHub Pages 时，将项目内容放到仓库根目录，保留 `.nojekyll`，在 **Settings → Pages** 选择发布分支及根目录。上传文件前先放入自己的 MP3。更新时保留自己的 `assets/audio/track.mp3`，不要把代码包外层文件夹再嵌套进仓库。

## AstroBox 接入

将 `src` 换成自己的部署地址：

```html
<iframe
  src="https://example.com/astrobox-profile-player/"
  title="个人主页音乐播放器"
  width="100%"
  style="border:0;display:block"
  data-astrobox-transparent="true"
  data-astrobox-board-padding="none"
  data-astrobox-board-background="transparent"
  data-astrobox-auto-height="true"
  data-astrobox-theme="true"
></iframe>
```

页面采用协议版本 1，发送 `ready`，校验父窗口的 `config`，按需报告 `resize`，背景保持透明。

## 检查

安装 Node.js 20 或更新版本后运行，无需安装 npm 依赖：

```sh
npm test
```

测试数据在内存中生成。即使音频目录为空、换了歌或文件没有标签，测试也不依赖具体歌名、封面、歌词、时长或曲目文件。检查包含多版本 ID3、无标签、缺少封面、普通文本歌词、多种语言、图片格式、播放与进度交互及翻译布局。当前通过脚本和模拟 DOM 检查；浏览器及 AstroBox 真机体验仍需实测。

## 参考

- [SaltPlayerSource](https://github.com/Moriafly/SaltPlayerSource) 主要用于发布和反馈，不包含播放器歌词动画源码。本项目参考作者独立开源组件 [LyricViewX](https://github.com/Moriafly/LyricViewX) 中播放位置与视口位置分离、手势暂停跟随、阻尼回归的思路，以原生 JavaScript 独立实现；没有引入 Android 代码，也不声称与当前版本椒盐音乐完全一致。
- [AstroBox 个人主页 iframe API](https://abox.run/docs/usage/custom/personal-homepage-iframe-api)
- [SPL 标准](https://moriafly.com/standards/spl.html)
- [ID3v2.2](https://id3.org/id3v2-00)、[ID3v2.3](https://id3.org/id3v2.3.0)、[ID3v2.4](https://id3.org/id3v2.4.0-structure)、[ID3v1](https://id3.org/ID3v1)
- [MDN 图片格式指南](https://developer.mozilla.org/en-US/docs/Web/Media/Guides/Formats/Image_types)
