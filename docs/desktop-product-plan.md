---
title: 桌面配置程序与 AUR 发布规划
description: VoxSpell 桌面配置程序、daemon、Fcitx 5 扩展及 AUR 单包发布的产品与技术规划。
order: 3
---

# 桌面配置程序与 AUR 发布规划

> 状态：规划已确认，daemon 配置控制面已完成
>
> 更新时间：2026-07-18
>
> 目标平台：Arch Linux + Fcitx 5
>
> 桌面技术：Node.js + TypeScript + node-gtk + GTK 4 + libadwaita
>
> 发布渠道：AUR

## 1. 产品定义

VoxSpell 对用户表现为一个完整的语音输入软件。软件内部由桌面配置程序、后台 daemon 和 Fcitx 5 扩展组成，但统一通过一个 AUR 软件包安装、升级和卸载，用户不需要分别理解或管理这些组件。

三个组件保持独立进程和清晰职责：

```text
VoxSpell Desktop
node-gtk + GTK 4 + libadwaita
    │
    │ Unix Socket / JSON-RPC
    ▼
VoxSpell Daemon
录音、ASR、文本处理、配置管理
    ▲
    │ Unix Socket / JSON-RPC
    │
Fcitx 5 Addon
热键、输入状态、候选结果提交
```

桌面配置程序关闭后，daemon 和 Fcitx 5 扩展继续运行，语音输入能力不受影响。桌面端只在用户需要设置、测试或诊断 VoxSpell 时打开，首期不将托盘常驻作为核心能力。

## 2. 已确认的产品与发行决策

### 2.1 桌面技术

- 使用 node-gtk 调用 GTK 4 和 libadwaita 开发桌面配置程序。
- 桌面端继续使用 Node.js 和 TypeScript，以便直接复用现有 workspace 中的配置类型、校验逻辑和 JSON-RPC 协议。
- 桌面端是配置与诊断界面，不承载录音、ASR、文本处理或输入提交等核心运行逻辑。
- 首期不引入 Electron、WebView、Qt、Tauri 或 GJS 等第二套桌面技术栈。

node-gtk 必须锁定明确版本，并通过其类型生成工具为构建环境中的 GTK 4 与 libadwaita 生成 TypeScript 声明。生成结果属于构建缓存，不作为手工维护的源码提交。

### 2.2 发布范围

- 只考虑通过 AUR 发布到 Arch Linux，暂不设计 Flatpak、AppImage、Deb、RPM、macOS 或 Windows 发布流程。
- GTK、libadwaita、Node.js、Fcitx 5 和 PipeWire 由 pacman 作为系统依赖提供。
- 发布物不携带私有 GTK、Node.js 或 PipeWire runtime。
- 首期只维护一个稳定 AUR 包 `voxspell`，不拆分 `voxspell-daemon`、`voxspell-desktop` 或 `fcitx5-voxspell` 子包。
- AUR 包从源码构建，不优先提供 `voxspell-bin`。

### 2.3 进程边界

- daemon 是持续运行的业务核心。
- Fcitx 5 扩展是输入法框架适配层。
- 桌面端是按需启动的配置客户端。
- GTK 进程退出或崩溃不得中断正在运行的 daemon。
- daemon 重启不得要求重启整个桌面会话。
- Fcitx 扩展和桌面端都通过同一套版本化 JSON-RPC 协议与 daemon 通信。
- daemon Socket 必须允许 Fcitx 扩展与桌面配置程序同时保持连接，并在 daemon 范围内保证同一时间只有一个语音会话。

## 3. 组件职责

### 3.1 VoxSpell Desktop

建议新增 `apps/desktop` workspace，负责：

- 首次启动和启用引导。
- 展示 daemon、Fcitx 5 扩展、PipeWire 和 Provider 状态。
- 管理 ASR Provider 及其模型、端点和凭据引用。
- 管理 PTT 热键、长按阈值和自动选择行为。
- 测试麦克风、Provider 和完整语音输入链路。
- 展示脱敏后的错误、诊断信息和软件版本。
- 启动、停止或重启用户级 daemon 服务。

桌面端应保持薄调用层。表单状态、配置映射、校验错误转换和 RPC 客户端应与 GTK widget 构建分离，使大部分逻辑可以在没有图形环境的测试中验证。

### 3.2 VoxSpell Daemon

daemon 继续承担现有录音、ASR、文本处理和会话协调职责，并扩展为运行时配置的主要所有者：

- 读取、校验和保存 VoxSpell 配置。
- 管理 Provider 的创建、测试与运行时切换。
- 向桌面端提供状态和诊断信息。
- 在配置缺失或损坏时保持控制 Socket 可用。
- 在应用新配置失败时继续使用上一份有效配置。

daemon 不应因为首次安装时尚无配置、凭据缺失或单个 Provider 无法创建而完全退出。它应进入 `needs-configuration` 或 `degraded` 状态，允许桌面端连接并修复问题。

现有协议已经定义 `config.reload`，但运行时目前注入的是空实现。正式接入桌面端前，必须先完成真实的配置加载与切换语义。

### 3.3 Fcitx 5 Addon

Fcitx 5 扩展继续负责：

- PTT 热键与长按状态机。
- 输入上下文生命周期。
- 录音、识别和润色状态展示。
- 候选结果选择与最终文本提交。
- daemon 断线检测和自动重连。

Fcitx 5 扩展不负责：

- 构建或显示 GTK 配置窗口。
- 直接管理 ASR Provider。
- 保存云服务凭据。
- 执行录音、网络请求或文本处理。
- 直接修改 VoxSpell 主配置文件。

PTT 热键、长按阈值和自动选择行为目前由 Fcitx 配置系统持有。桌面端需要统一展示这些选项时，应通过 Fcitx DBus 配置接口读写，不能直接拼接或覆盖 `~/.config/fcitx5` 下的配置文件。句号裁剪等确定性文本处理选项属于 daemon 主配置，不得放入 Fcitx addon 配置。

## 4. 配置与控制协议

### 4.1 配置路径

生产环境主配置路径固定为：

```text
$XDG_CONFIG_HOME/voxspell/config.yaml
```

没有设置 `XDG_CONFIG_HOME` 时按 XDG 约定回退到：

```text
$HOME/.config/voxspell/config.yaml
```

`VOXSPELL_CONFIG_PATH` 只保留给开发、测试和故障排查，不作为正式安装后的常规配置入口。

### 4.2 配置写入原则

主配置应由 daemon 通过事务式流程更新：

1. 接收并校验候选配置。
2. 验证跨字段约束和凭据引用。
3. 尝试创建并初始化目标 Provider。
4. 将配置写入同目录临时文件并同步落盘。
5. 原子替换正式配置文件。
6. 切换运行时 Provider。
7. 任一步骤失败时保留旧文件和旧运行时配置。

桌面端不应先自行覆盖 YAML 再通知 daemon 重载，否则保存失败、运行时切换失败和并发写入会产生不一致状态。

### 4.3 建议增加的 RPC

```text
daemon.getStatus
daemon.restart
config.get
config.validate
config.update
config.reload
credentials.getStatus
credentials.update
fcitx.getConfig
fcitx.updateConfig
provider.test
audio.test
diagnostics.get
```

协议方法的 params、result、notification 和错误数据继续使用 TypeBox 作为唯一 schema 来源。错误必须提供稳定错误码和结构化字段，桌面端不得依赖 daemon 日志文本判断错误类型。

### 4.4 凭据存储

主 YAML 继续使用现有环境变量名称作为凭据引用，不直接保存 API Key、SecretId 或 SecretKey。例如：

```yaml
apiKeyEnvironment: OPENROUTER_API_KEY
```

daemon 使用应用私有凭据文件：

```text
$XDG_CONFIG_HOME/voxspell/credentials.json
```

凭据文件使用版本化 JSON，键名与主配置引用的环境变量名称一致。目录权限固定为 `0700`，文件权限固定为 `0600`。首期不依赖 Secret Service，确保所有目标 Arch 桌面环境行为一致。

解析 Provider 前，daemon 先以凭据文件构造局部凭据环境，再使用真实 `process.env` 覆盖同名值，最后交给现有 `resolveAsrProvider()`。这样不会改变主配置 schema，也不会修改全局 `process.env`。真实进程环境只作为开发、测试和高级用户自行配置时的兼容能力，不提供 GTK 设置项，也不替用户配置 systemd 环境。

无论凭据来自私有文件还是进程环境，日志、RPC 错误、诊断导出和界面截图都不得包含完整凭据。

## 5. 桌面界面规划

首期使用 libadwaita 的标准设置页布局，包含以下页面。

### 5.1 概览

- VoxSpell 是否已启用。
- daemon 是否运行及其版本。
- Fcitx 5 扩展是否加载。
- 当前 ASR Provider。
- 最近一次脱敏错误。
- 启动、停止和重启 daemon 的操作入口。

### 5.2 语音识别

- Provider 列表和当前 Provider。
- Provider 类型、API 地址、模型和语言相关选项。
- 凭据状态和更新入口。
- Provider 连接测试。
- 麦克风录音与音量测试。

### 5.3 输入行为

- PTT 热键。
- 长按阈值。
- 自动选择推荐结果。
- 识别完成后的选择与提交行为。
- 用户语音词典入口。
- 数字优化、句号裁剪和其他确定性文本处理选项。

### 5.4 AI 润色

- AI 润色开关、服务和模型。
- 系统提示词配置。
- 润色失败时的回退策略说明。

### 5.5 诊断

- Node.js、GTK、libadwaita、Fcitx 5 和 PipeWire 版本。
- daemon Socket 和协议握手状态。
- `pw-record` 可用性。
- 配置文件与凭据存储状态。
- 可复制的脱敏诊断报告。

### 5.6 关于

- VoxSpell 版本。
- 本地协议版本。
- 项目地址与许可证。

## 6. 首次启动与服务生命周期

daemon 作为 systemd user service 安装。AUR 安装阶段不替具体桌面用户自动启用服务，首次打开桌面端时完成显式引导：

1. 检查 `voxspell.service` 状态。
2. 请求用户启用 VoxSpell。
3. 用户确认后启用并启动 user service。
4. 等待 daemon Socket 可连接。
5. 引导创建第一个 Provider 并配置凭据。
6. 执行 Provider 和麦克风测试。
7. 检查 Fcitx 5 扩展是否加载。
8. 必要时提示并协助用户重启 Fcitx 5。

服务建议使用：

- `Restart=on-failure`，仅在异常退出时重启。
- 有界的重启频率，避免无效配置造成快速重启循环。
- journal 作为运行日志出口，默认日志保持脱敏。
- `WantedBy=graphical-session.target`，在桌面会话导入用户环境后启动，并由首次启动流程显式启用。

桌面端关闭时不停止服务。卸载软件时由包管理器移除 unit 文件，但不得删除用户配置、凭据或词典数据。

## 7. AUR 软件包规划

### 7.1 运行依赖

初步运行依赖：

```text
nodejs
gtk4
libadwaita
gobject-introspection-runtime
fcitx5
pipewire-audio
```

`pipewire-audio` 提供 daemon 当前使用的 `pw-record`。node-gtk 的 JS 代码和针对构建环境生成的原生绑定属于 VoxSpell 应用内容，安装在 VoxSpell 私有目录中；GTK 和 Node.js runtime 仍由系统提供。

### 7.2 构建依赖

初步构建依赖：

```text
yarn
cmake
ninja
gcc
pkgconf
gobject-introspection
python
```

最终 `makedepends` 应以干净 Arch 构建环境中的实际构建结果为准，不能仅根据开发机已有软件推断。

### 7.3 安装布局

建议安装布局：

```text
/usr/bin/voxspell
/usr/lib/voxspell/desktop/
/usr/lib/voxspell/daemon/
/usr/lib/voxspell/node_modules/node-gtk/
/usr/lib/fcitx5/voxspell.so
/usr/lib/systemd/user/voxspell.service
/usr/share/fcitx5/addon/voxspell.conf
/usr/share/applications/io.github.geequlim.VoxSpell.desktop
/usr/share/metainfo/io.github.geequlim.VoxSpell.metainfo.xml
/usr/share/icons/hicolor/.../apps/io.github.geequlim.VoxSpell.*
```

`/usr/bin/voxspell` 只负责使用系统 Node.js 启动桌面入口，不在运行时执行依赖安装、构建或目录探测。

### 7.4 Node.js ABI 风险

node-gtk 包含与 Node.js/V8 ABI 关联的原生扩展。AUR 包应在安装时针对构建环境中的系统 Node.js 编译该扩展，并采取以下措施：

- CI 同时覆盖项目最低 Node.js 版本和 Arch 当前 Node.js 版本。
- Node.js 主版本升级后验证 node-gtk，并在必要时提升 AUR `pkgrel` 触发重建。
- 启动器识别原生模块 ABI 不匹配错误，并给出重新构建 VoxSpell 包的明确提示。
- 不默认强制用户将系统 Node.js 替换为 `nodejs-lts-krypton`，避免与 Arch 普通 `nodejs` 包冲突。
- 不发布与单一 Node.js ABI 绑定但又声明宽泛 Node.js 依赖的二进制包。

## 8. 测试与验收

### 8.1 桌面端测试

- 配置表单与领域配置之间的映射单元测试。
- RPC 成功、业务错误、断线和超时测试。
- daemon 未运行、配置损坏和 Provider 不可用的界面状态测试。
- GTK 应用启动、单实例激活和主要页面构建 smoke test。
- 不依赖视觉截图判断配置是否正确保存。

### 8.2 集成测试

- 桌面端通过真实 Unix Socket 读取 daemon 状态。
- `config.update` 成功后配置文件和运行时 Provider 同时更新。
- 非法配置不会覆盖上一份有效配置。
- 桌面端退出后 daemon 与 Fcitx 5 扩展继续工作。
- daemon 重启后 Fcitx 5 扩展和桌面端能够自动重连。
- Fcitx 设置通过 DBus 更新后真实生效。

### 8.3 AUR 验收

- 在干净 Arch 环境中完成 `makepkg`。
- 安装包后不存在未声明的运行依赖。
- 桌面文件、图标、metainfo、systemd user unit 和 Fcitx 5 扩展安装到正确路径。
- 首次启动可以启用 daemon 并完成初始配置。
- 升级不会覆盖用户配置。
- 卸载不会删除用户数据，也不会遗留系统级文件。
- Node.js 主版本变化时能够检测并处理 node-gtk ABI 兼容问题。

## 9. 分阶段实施顺序

### 阶段一：配置控制面

- 确定正式配置路径。
- 让 daemon 在未配置和配置错误状态下继续提供控制 Socket。
- 实现配置读取、校验、原子保存和真实运行时切换。
- 完成状态、配置和诊断 RPC。
- 使用应用私有文件完成凭据存储，并保留进程环境覆盖能力。
- 允许 Fcitx 扩展和配置客户端同时连接 daemon。
- 由 daemon 通过 Fcitx Controller1 DBus 接口读写 VoxSpell addon 配置。

完成标准：无 GTK 界面时，可以通过协议完成首次配置、更新配置和错误恢复。

### 阶段二：最小桌面端

- 创建 `apps/desktop`。
- 接入 node-gtk、GTK 4、libadwaita 和类型生成。
- 实现单实例应用、概览页和 daemon RPC 客户端。
- 实现 ASR Provider 配置与测试。

完成标准：用户可以从空配置状态启动 daemon、创建 Provider、保存配置并完成连接测试。

### 阶段三：系统集成

- 增加 systemd user service。
- 完成首次启动引导。
- 在桌面端接入 daemon 已提供的 Fcitx 配置 RPC。
- 完成麦克风测试和诊断页。
- 处理 daemon 与 Fcitx 5 的重启、重连和升级状态。

完成标准：用户不需要手工编辑文件或运行命令即可完成安装后的必要配置。

### 阶段四：AUR 发布

- 创建稳定版本构建产物。
- 编写并验证 `PKGBUILD`。
- 在干净 Arch 环境执行构建、安装、升级和卸载测试。
- 建立 Node.js 主版本升级时的 node-gtk 重建流程。

完成标准：AUR 软件包能够独立完成整个产品的安装，并通过本节的 AUR 验收清单。

## 10. 待确认事项

开始对应实现前仍需逐项确认：

- 正式的 freedesktop application ID；本文暂用 `io.github.geequlim.VoxSpell`。
- 首期是否同时实现输入行为中的用户语音词典入口与 AI 润色设置页。
- 首个 AUR 版本支持 Arch 当前 Node.js，还是额外声明一个经过验证的版本范围。

配置切换已确定为不取消活动会话，新会话使用切换后的 Provider；Fcitx 配置由 daemon 内部的薄 DBus 适配层通过 `org.fcitx.Fcitx.Controller1` 管理。其余事项未确认前不得通过隐式默认值将其固化为公开配置或发行行为。

## 11. 相关文档

- [VoxSpell 技术规划](./technical-plan.md)
- [语音输入会话流程](./session-flow.md)
- [编码规范](./coding-style/index.md)
- [node-gtk 项目](https://github.com/romgrk/node-gtk)
- [Arch Linux Fcitx 5 软件包](https://archlinux.org/packages/extra/x86_64/fcitx5/)
- [Arch Linux Node.js LTS Krypton 软件包](https://archlinux.org/packages/extra/x86_64/nodejs-lts-krypton/)
