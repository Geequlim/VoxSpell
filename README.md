# 言出法随（VoxSpell）

言出法随是一款面向 Linux 桌面与 Fcitx 5 的现代 AI 语音输入工具。它通过按住说话、松开完成的交互，将语音识别、用户词典、确定性文本处理和可选的 AI 润色整合进日常输入流程，同时保留用户原有的 Rime 等键盘输入体验。

> [!IMPORTANT]
> 本项目是源码公开项目，不是 OSI 定义下的开源项目。代码仅按 [PolyForm Noncommercial License 1.0.0](./LICENSE) 授权用于非商业目的，不授予任何商业使用许可。

## 主要能力

- 集成 Fcitx 5 的按住说话（PTT）语音输入体验
- 支持 OpenAI-compatible 与实时语音识别服务
- 支持用户语音词典、热词映射和确定性文本处理
- 支持可选的 AI 文本润色与失败回退
- 提供基于 GTK 4 与 libadwaita 的桌面配置程序
- 通过本地 daemon 统一管理录音、识别、配置和文本处理

## 项目信息

- 中文名称：言出法随
- 英文名称：VoxSpell
- 作者：Geequlim
- 目标平台：Arch Linux、Fcitx 5
- 主要技术：TypeScript、Node.js、GTK 4、libadwaita、C++
- 软件许可：PolyForm Noncommercial License 1.0.0

## 项目结构

```text
apps/desktop              GTK 桌面配置程序
apps/daemon               录音、识别与文本处理服务
native/fcitx5-addon       Fcitx 5 扩展
packages/                 协议、配置和服务适配包
docs/                     产品与技术文档
```

桌面配置程序与 Fcitx 5 扩展通过 Unix Socket 和 JSON-RPC 连接本地 daemon。关闭桌面配置程序不会中断 daemon 或语音输入能力。

## 开发环境

- Node.js 24 或更高版本
- Yarn 4（通过 Corepack 管理）
- Linux、Fcitx 5、PipeWire
- GTK 4、libadwaita 及其开发工具

安装依赖：

```bash
corepack yarn install
```

常用命令：

```bash
corepack yarn tiny build
corepack yarn tiny test
corepack yarn tiny dev
```

项目快捷命令定义在 `project.tiny` 中。运行 `corepack yarn tiny list` 可以查看所有可用命令。

## 许可与商业使用

本项目源代码依据 [PolyForm Noncommercial License 1.0.0](./LICENSE) 提供。该许可允许符合其条款的非商业使用、修改和分发，但不允许预期具有商业应用的使用行为。

任何人或组织获得本项目代码时，均应同时保留许可文本及 [NOTICE](./NOTICE) 中的必要版权声明。法律另有规定的权利不受本说明限制；许可范围与具体条件以英文 `LICENSE` 原文为准。

Copyright 2026 Geequlim.
