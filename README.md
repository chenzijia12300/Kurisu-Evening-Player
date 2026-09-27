# 暮色共听 · 牧濑红莉栖

Wallpaper Engine 网页壁纸：夕阳场景、局部人物与云层动画、音乐信息、歌词、频谱和时钟。采用原生 HTML / CSS / JavaScript，无需 npm 或编译。

## 从这里开始

1. 保留整个项目文件夹，把 `index.html` 导入 Wallpaper Engine 的网页壁纸编辑器并应用。不要只导入 PNG。
2. 开启 Wallpaper Engine 的媒体集成，用音乐播放器播放一首歌。歌曲信息取决于播放器向 Windows 媒体会话提供的字段。
3. 若需要播放按钮，或需要补充酷狗缺失的歌曲时间，安装 Python 3.9+，双击 [tools/start-controller.cmd](tools/start-controller.cmd)。
4. 从**这次启动的控制器所在 tools 目录**读取 `.connection-code`，粘贴到 **Wallpaper Engine 主窗口 → 当前壁纸右侧属性 → 本机播放控制连接码（可选）**。连接码通常只配一次。
5. 希望以后自动运行控制器，双击 [tools/install-autostart.cmd](tools/install-autostart.cmd)。安装后在当前用户下次登录 Windows 时后台启动；当前会话需要时可双击 [tools/start-controller-background.cmd](tools/start-controller-background.cmd)。


**创建这些脚本不会自动启用自启。** 必须自己运行安装脚本。Wallpaper Engine 本身的自动启动需在它的设置中另行开启。控制器也不会替你打开酷狗或开始播放音乐。

## 文档导航

- [运行与操作说明](docs/RUNNING.md)：首次使用、连接码、后台运行、安装/取消自启、更新、故障排查、日志与分享。
- [Now Playing 技术说明](NOW-PLAYING.md)：数据来源、模块结构、歌词/封面缓存、请求取消和降级。
- [验证记录](VALIDATION.md)：实际验证过的范围与历史问题，历史记录不代表当前所有播放器都兼容。
- 素材提示词：`PROMPT.txt`、`BLINK-PROMPT.txt`、`CLOUD-PROMPTS.txt`。

## 能力与要求

| 功能 | 数据来源或条件 |
|---|---|
| 歌名、歌手、专辑、封面、播放状态 | Wallpaper Engine 媒体集成 + 支持 Windows SMTC 的播放器 |
| 音乐时间 | 优先有效系统媒体时间；酷狗可通过本机控制器读取主窗口时间控件 |
| 播放/暂停、上一首、下一首 | 控制器发送 Windows 媒体键，播放器必须响应 |
| 音量 | 控制器调整 Windows 系统音量 |
| 当前歌词及中文译文 | 联网匹配 AMLL / LRCLIB；译文必须由歌词源提供 |
| 高清专辑封面 | MusicBrainz / Cover Art Archive 查询成功且图片可加载 |
| 音频频谱 | Wallpaper Engine 音频接口；普通浏览器没有该接口 |
| 发丝、呼吸、眨眼、灯光、倒影、流云、鼠标取景 | 本地 WebGL 动画；无 WebGL 时显示静态底图 |

基础网页壁纸不依赖 Python。控制器只绑定 `127.0.0.1:18743`，无需第三方 Python 包。没有时间数据时不会凭空计时；同曲已取得时间后若酷狗采样中断，宽限7秒后停止推算并保留最近位置与总时长，恢复后重新校准。

当前歌词区域显示原文和可用的译文；不是完整歌词列表，也没有自动机器翻译。已用当前代码真实验证 YOASOBI《夜に駆ける》《アイドル》的中文译文；歌曲版本、标题写法、网络与词库收录都会影响匹配。QQ音乐、网易云音乐的全功能兼容性尚未在本机逐一验证。

## 预览和开发

在项目目录运行：

```powershell
python -m http.server 8768 --bind 127.0.0.1
```

打开 `http://127.0.0.1:8768/preview.html` 可看带示例歌曲的动态预览；`http://127.0.0.1:8768/index.html` 为普通浏览器空闲页面。演示模式不控制真实音乐。实际歌名和频谱需要在 Wallpaper Engine 中验证。

主要目录：

```text
index.html / style.css       界面和响应式布局
wallpaper.js                应用装配、控制器连接、时钟及频谱
media-state.js              基础媒体状态
hair-motion.js              场景局部动画
src/media/                  Wallpaper Engine Provider、状态与联网查询协调
src/services/               歌词、封面、缓存
src/components/NowPlaying/  播放器渲染
src/utils/                  规范化、匹配、网络限流
assets/                     背景、闭眼辅助帧、三张独立云层
project.json                Wallpaper Engine 项目及属性
preview.html                浏览器演示容器
tools/                     本机控制器和可选自启脚本
docs/                      运行文档
```

## 画面与交互边界

支持16:9、21:9、32:9布局，背景会按比例裁切。底图实际为 **1672×941**，可在4K屏幕布局显示，但不是原生4K素材。动画是二维画面的局部变形与混合，不是完整 Live2D 模型。鼠标移动露出的是原图预留边缘，没有生成画面之外的新内容；进度条目前仅展示，不支持拖动跳转。

云层使用三张独立素材向右移动并交替过渡，与城市背景保持柔焦景深。人物呼吸约5.2秒一轮，眨眼、发丝、视线和城市灯光各自变化。动态开关、亮度、组件显示、风力、联网查询、歌词及±5秒歌词偏移均在 Wallpaper Engine 右侧属性调整。

## 隐私与分享

控制器不读取音乐文件、不上传声音、不执行任意命令。联网歌词与封面查询会向相应服务发送歌名、歌手、专辑和可用时长。断网时本地动画及已提供的系统媒体信息仍可用。

**分享或上传前排除 `tools/.connection-code`、`tools/.logs/`、`__pycache__/`。** 连接码是本机控制凭据，不能写进 `project.json` 默认值，也不要发给别人。导入 Wallpaper Engine 会产生独立副本；修改开发目录不会自动更新已导入的壁纸，详见运行文档。
