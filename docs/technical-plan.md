# VoxSpell 技术规划

> 状态：实施中
>
> 更新时间：2026-07-18
>
> 目标平台：Linux + Fcitx 5
>
> 核心技术：Node.js、TypeScript；C++ 仅用于 Fcitx 5 薄适配层

## 1. 项目目标

VoxSpell 是面向 Linux 桌面的现代 AI 语音输入工具。项目在保留 Fcitx 5 与 Rime 日常键盘输入体验的基础上，增加低延迟实时语音识别、用户语音词典、数字与格式后处理、AI 润色以及多语音服务商切换能力。

首期目标：

- 支持按住说话、松开完成的 PTT 交互。
- 先通过 OpenAI-compatible 音频转写接口跑通录音、整段上传、识别和提交闭环，首批支持 OpenRouter 与智谱 GLM。
- 使用腾讯云实时语音识别 WebSocket API，边说边显示识别结果。
- 普通键盘输入继续使用系统安装的 `fcitx5-rime`，不自行实现或代理 Rime 按键链路。
- 支持用户语音词典、热词映射、数字归一化和确定性文本处理。
- 支持可选的 OpenAI-compatible 流式 AI 润色，并在失败时可靠回退原文。
- 从第一版开始建立供应商适配层，为豆包、千问等实时语音服务预留稳定接口。
- 首版通过系统 `pw-record` 采集 PCM，不自研音频采集程序。
- 运行时不依赖 Python。

非首期目标：

- 不自研拼音、双拼或候选词引擎。
- 不在首期实现稳定分段直接写入目标应用后的回滚与重写。
- 不在首期开发 Electron 控制中心。
- 不在首期实现自有 PipeWire/ALSA 音频引擎。
- 不在首期实现离线 ASR。
- 不在首期覆盖 IBus、macOS 或 Windows。

## 2. 核心架构决策

### 2.1 使用 Fcitx Module，而不是新的 Rime 输入法实现

推荐将 VoxSpell 实现为 Fcitx 5 C++ module addon，但严格限制其职责和代码规模：

- 在 `PreInputMethod` 阶段监听并拦截 PTT 热键。
- 普通键盘事件不处理，继续交给当前输入法，例如官方 `fcitx5-rime`。
- 语音识别过程通过 Fcitx input panel 展示状态和临时文本。
- 只有最终文本通过当前 `InputContext` 提交到应用。

这避免维护独立 librime session、Rime schema 部署和逐按键 IPC，也使用户可以继续使用现有 Rime 配置、词库、同步数据与双拼方案。

C++ 层以约 300 至 600 行核心代码为目标。它是 Fcitx C++ ABI 的适配器，不承载产品业务逻辑。首期不引入 Rust/C++ bridge，也不尝试用非官方绑定覆盖 Fcitx API。

限制：如果 Rime 已有未提交的 composition，首版拒绝启动语音并显示简短提示，避免擅自丢弃或提交用户正在输入的内容。

### 2.2 Fcitx 插件保持轻量

Fcitx 插件只负责：

- PTT 热键和输入上下文生命周期。
- 录音、识别、润色状态的 UI 展示。
- partial/final 文本的 preedit 管理。
- 最终提交、取消和原文回退候选。
- 与 Node daemon 的非阻塞本地通信。

Fcitx 插件不负责：

- 麦克风采集。
- 云端鉴权或 WebSocket 网络请求。
- 用户词典与数字规则执行。
- AI 请求。
- 长耗时任务、阻塞 socket 或子进程管理。

### 2.3 首版复用系统音频工具

MVP 不开发独立 C++ 音频采集程序。Node daemon 直接启动系统 `pw-record`，从 stdout 持续读取原始 PCM：

```text
pw-record --raw --rate 16000 --channels 1 --format s16 -
```

职责边界：

- Node 使用 `child_process.spawn()` 传递固定参数，不经过 shell 拼接命令。
- `pw-record` 负责 PipeWire 设备协商、采集、通道转换和重采样。
- stdout 只承载 16kHz、单声道、16-bit signed little-endian PCM。
- stderr 作为独立诊断流读取，不能混入音频。
- Node 必须处理任意大小的 stdout chunk，自行聚合成 ASR 要求的数据包。
- 正常停止先发送 `SIGINT`，等待 stdout 排空和进程退出；超过宽限时间才强制终止。
- 启动时检测 `pw-record` 是否存在，并把缺失依赖转换为稳定的本地错误码。

首期正式支持 PipeWire。`parec` 和 `arecord` 可以在后续作为可选兼容后端，但不在 MVP 同时维护三套设备与停止语义。

### 2.4 高级音频能力使用 Rust 扩展

当系统工具无法满足产品需求时，再增加独立 Rust audio worker。触发条件包括：

- 需要音量表、本地 VAD、AGC、降噪或回声消除。
- 需要可靠的设备热插拔、自动切换和持久麦克风连接。
- 需要精确的 frame、延迟、缓冲深度和丢帧指标。
- `pw-record` 进程启动耗时成为可测量的主要瓶颈。

Rust worker 使用 `pipewire-rs`，继续保持独立进程，并沿用 stdout PCM、stderr 诊断和受控停止协议。这样替换采集实现时，不需要修改 Fcitx addon、ASR Provider 或文本流水线。

不建议用 Rust 重写 Fcitx addon：Fcitx 的完整 addon API 是 C++ 接口，额外的 Rust/C++ bridge 会增加对象生命周期、虚函数回调和混合构建成本，却不能消除最外层 C++ ABI。

### 2.5 Node daemon 承担业务编排

`voxspell-daemon` 负责：

- 会话状态机与超时。
- 通过可替换的 `AudioCaptureBackend` 启动、停止和监控 `pw-record`。
- 聚合、缓存和发送 PCM 数据。
- ASR Provider 生命周期与事件标准化。
- 用户语音词典、数字归一化和文本处理。
- AI 润色与流式结果解析。
- 配置加载、密钥引用、日志和指标。
- 向 Fcitx 插件推送 session 事件。

## 3. 进程与数据流

会话阶段、结果展示、候选选择和提交语义以 [语音输入会话流程](./session-flow.md) 为准。

```text
用户按下 PTT
  -> Fcitx C++ module 发送 session.start
  -> Node daemon 启动 pw-record 和选定的 ASR Provider
  -> pw-record stdout 持续输出 PCM
  -> 实时 Provider 按实时速率消费 PCM，并返回 partial / segment-final
  -> 批量 Provider 在内存中有界缓存本次短语音，不产生虚假的 partial
  -> daemon 将 Provider 事件转成统一事件并推送给 Fcitx

用户松开 PTT
  -> Fcitx module 发送 session.finish
  -> daemon 停止 pw-record 并排空 PCM
  -> 实时 Provider 发送 ASR end 并等待供应商 final
  -> 批量 Provider 将 PCM 封装为 WAV 后上传并等待转写结果
  -> 用户词典和数字后处理
  -> 产生识别结果
  -> 可选 AI 流式润色并产生润色结果
  -> 客户端自动选择或等待用户确认
  -> daemon 通知 Fcitx module 提交选中的文本
```

取消条件：

- 用户按 Escape。
- 输入上下文失焦或被销毁。
- 新会话替代旧会话。
- 录音、网络或处理阶段超时。
- daemon 或 Provider 返回不可恢复错误。

## 4. 本地 IPC 协议

### 4.1 传输

- Socket：`$XDG_RUNTIME_DIR/voxspell/daemon.sock`。
- 权限：运行目录 `0700`，socket `0600`。
- 连接：Fcitx module 与 daemon 之间保持长连接并自动重连。
- 协议：使用双向 JSON-RPC 2.0；客户端命令使用 request，daemon 异步事件使用 notification。
- 分帧：使用 LSP 风格的 `Content-Length: <bytes>\r\n\r\n<utf8-json>`，不再定义私有二进制消息信封。
- Node 端使用 `vscode-jsonrpc/node` 的 stream reader、writer 和 message connection，不自行实现半包、粘包与请求关联。
- 单条 JSON-RPC 消息首期限制为 1 MiB，超过限制立即关闭对应连接并记录稳定的本地协议错误码。
- 音频只在录音子进程 stdout 中传输，不通过 Fcitx IPC，因此 IPC 不需要二进制消息类型。

### 4.2 请求方法

```text
initialize
session.start
session.finish
session.cancel
session.selectResult
config.reload
daemon.ping
```

连接建立后必须先完成 `initialize`。请求携带客户端信息和支持的 `protocolVersion`，daemon 返回协商后的版本、服务端信息与 capability。初始化前收到其他业务请求时返回 JSON-RPC 错误。

`session.start` 成功后由 daemon 生成并返回 `sessionId`。后续会话请求和服务端通知在 params 中携带该 ID。Unix stream 已保证同一连接上的消息顺序，因此不再维护全局 `sequence`；Provider 的 partial 修订只在 daemon 内部组装，客户端只接收完整文本快照。

### 4.3 服务端通知

```text
daemon.ready
session.phase
session.preview
session.results
session.completed
session.error
```

客户端只整体替换 `session.preview` 和 `session.results` 中的文本，不拼接 ASR 分片或 AI SSE delta。`session.completed` 是唯一提交点；完整事件语义见 [语音输入会话流程](./session-flow.md)。

### 4.4 Schema 与类型规范

- TypeScript 侧统一使用 TypeBox 定义 IPC、配置和用户词典等跨边界结构的 schema。
- TypeBox schema 是唯一事实来源，TypeScript 类型必须通过 `Static<typeof Schema>` 推导，不重复手写同构的 `interface` 或 `type`。
- JSON-RPC request params、result 和 notification params 在边界处使用 TypeBox 做运行时校验。
- 对外对象 schema 默认使用 `additionalProperties: false`；需要扩展字段时必须显式声明。
- 公共标识、错误数据和 capability 提取为可复用 schema，并可导出标准 JSON Schema 供文档、fixture 和未来 C++ 测试使用。
- JSON-RPC 2.0 envelope 由 `vscode-jsonrpc` 负责，不用 TypeBox 重复定义。
- schema 校验失败统一转换为 JSON-RPC `Invalid params`，默认日志不得记录完整用户文本。

### 4.5 错误

JSON-RPC 解析错误、无效请求、方法不存在和参数错误使用标准错误码；初始化前请求使用 `vscode-jsonrpc` 定义的 `ServerNotInitialized`。VoxSpell 业务错误统一使用 `-33000`，避开 `vscode-jsonrpc` 占用的 `-32000` 至 `-32099` 保留范围，并在 `error.data` 中携带稳定的本地错误码、发生阶段、是否可重试和脱敏后的供应商信息。UI 不直接展示供应商原始错误文本。

## 5. 会话状态机

```text
idle
  -> starting (client phase: preparing)
  -> recording
  -> finishing
  -> recognizing
  -> processing
  -> polishing (optional)
  -> choosing (optional)
  -> completed

任意活动状态
  -> cancelling
  -> cancelled

任意活动状态
  -> failed
```

约束：

- 同一 Fcitx input context 同时最多一个活动会话。
- 一个 daemon 首期只允许一个录音会话，避免多个麦克风流竞争。
- `finish()` 可重复调用但只执行一次。
- `cancel()` 必须中断录音子进程、ASR WebSocket 和 AI 请求。
- 过期 Provider 事件通过 `sessionId` 丢弃，不能覆盖新会话 UI。

## 6. ASR Provider 设计

Daemon 使用同一套增量音频会话接口容纳两类 Provider：

- 实时 Provider 边接收 PCM 边发送到供应商，可以产生 partial 和 segment-final。
- 批量 Provider 接收录音期间的 PCM，但只在 `finish()` 后上传完整 WAV，只产生 completed。

`partialResults` capability 明确表示 Provider 是否产生实时中间结果。业务层不得根据 Provider ID 推断工作模式。

```ts
export interface RealtimeAsrProvider {
  readonly id: string;
  readonly capabilities: AsrCapabilities;
  createSession(options: AsrSessionOptions): Promise<RealtimeAsrSession>;
}

export interface RealtimeAsrSession {
  start(signal?: AbortSignal): Promise<void>;
  writeAudio(frame: Uint8Array): Promise<void>;
  finish(): Promise<void>;
  cancel(reason?: string): Promise<void>;
  events(): AsyncIterable<AsrEvent>;
}
```

统一事件：

```ts
type AsrEvent =
  | { type: "ready" }
  | { type: "partial"; segmentId: string; revision: number; text: string }
  | { type: "segment-final"; segmentId: string; text: string }
  | { type: "completed"; text: string }
  | { type: "error"; code: string; retryable: boolean; providerCode?: string };
```

Provider 内部负责：

- 鉴权和连接参数。
- 供应商协议编解码。
- partial 覆盖、segment 累积和 final 拼装。
- ping、超时、关闭握手和错误分类。
- 供应商限制与 capability 声明。

业务层不得依赖腾讯云的 `slice_type`、千问事件名或豆包二进制协议字段。

### 6.1 OpenAI-compatible 批量转写

首个真实 ASR 实现使用官方 OpenAI Node SDK 作为兼容协议客户端，不自行实现 multipart 请求：

- Provider 配置使用 `baseUrl`，SDK 负责追加 `/audio/transcriptions`。
- 首批配置 OpenRouter 与智谱 GLM，通过 `OPENROUTER_API_KEY` 和 `GLM_API_KEY` 环境变量读取密钥。
- `pw-record` 的 16 kHz、单声道、16-bit PCM 在内存中封装为 WAV，再使用 SDK 的 `toFile()` 上传。
- 首版按短时 PTT 语音设计，音频不落盘；会话必须有明确的时长或字节上限，不能无限增长。
- SDK 自动重试关闭，避免响应丢失时重复上传和重复计费；错误只映射为稳定的脱敏 Provider 错误。
- SDK 日志关闭，不允许请求体、响应体、Authorization 或用户语音内容进入默认日志。
- `cancel()` 使用 `AbortSignal` 中止正在进行的请求并释放缓存。

批量 Provider 的 `capabilities.partialResults` 为 `false`。录音期间 UI 只展示录音状态，不能伪造实时识别文本。

## 7. 腾讯云首期实现

默认参数建议：

```text
engine_model_type = 16k_zh_en
voice_format      = 1        # PCM
needvad           = 1
filter_punc       = 0
filter_modal      = 0
filter_empty_result = 1
word_info         = 0
```

音频发送：

- `pw-record` stdout chunk 没有固定业务边界，daemon 必须视为连续字节流。
- daemon 聚合成 200ms、6400 字节的数据包。
- 发送节奏保持接近 1:1 实时率，不允许一次性突发发送缓存。
- WebSocket 未 ready 时保存 1 至 2 秒有界首帧缓存；超出上限则失败，不无限占用内存。
- 发送结束消息后等待 `final=1`，不能立即关闭连接。

结果映射：

```text
slice_type=0 -> partial（可为空）
slice_type=1 -> partial（同 segment revision +1）
slice_type=2 -> segment-final
final=1      -> completed
code!=0      -> error
```

腾讯云签名使用 Node 内置 `crypto` 完成 HMAC-SHA1 和 Base64。日志不得记录 SecretKey、完整签名 URL、Authorization、API Key 或完整音频内容。

### 7.1 热词

用户词典中的标准词可映射到腾讯云 `hotword_list`：

- 按显式优先级和最近使用频率排序。
- 遵守单词长度、权重和最多 128 个热词限制。
- 超限词仍参与本地替换，只是不发送到云端。
- 本地词典始终是结果正确性的最终来源，云端热词只是识别增强。

### 7.2 数字转换

`convert_num_mode` 必须可配置。完成本地数字规则基线修复前可以使用腾讯云智能转换；本地规则稳定后，建议关闭云端转换并统一由本地处理，以降低不同 Provider 的输出差异。

## 8. 用户语音词典

Rime 原生用户词库与 VoxSpell 语音词典必须分离。Rime 数据继续由 Rime 管理，VoxSpell 只管理 ASR 热词和识别后替换规则。

建议格式：

```yaml
version: 1
entries:
  - term: VoxSpell
    aliases:
      - 沃克斯 spell
      - voice spell
    protect: true
    boost: 10
    enabled: true
```

要求：

- 支持旧项目 `replace` / `protect` 格式的一次性迁移。
- 最长别名优先，英文别名大小写不敏感。
- 检测冲突并保留确定性优先级。
- 配置错误时继续使用最后一次有效词典。
- 文件修改后热加载，但必须先完成 schema 校验和编译。
- 词典编译结果应包含替换索引、保护词集合和 Provider 热词列表。

## 9. 文本处理流水线

```text
ASR final
  -> Unicode 与空白基础清理
  -> 用户词典别名归一
  -> 数字、日期、时间、百分比和编号归一化
  -> 保存识别结果 transcript
  -> 可选 AI 润色
  -> 再次应用词典与数字规则
  -> 输出校验
  -> 保存润色结果 polished
  -> 客户端选择提交结果
```

确定性处理必须满足：

- 相同输入和配置产生相同输出。
- 重复执行尽量保持幂等。
- 词典替换先于数字转换，以便保护技术词和固定表达。
- 不依赖具体 ASR Provider 的私有结果格式。
- 所有规则由 table-driven golden tests 覆盖。

AI 后再次执行词典与数字规则，防止模型改坏术语或重新写回中文数字。

## 10. AI 润色

```ts
export interface TextPolisher {
  readonly id: string;
  polish(request: PolishRequest, signal?: AbortSignal): AsyncIterable<PolishEvent>;
}
```

首期实现 OpenAI-compatible Chat Completions SSE：

- 优先使用支持自定义 `baseURL`、取消和流式事件的成熟 SDK，不自行实现 HTTP 请求与 SSE parser。
- 默认关闭 thinking/reasoning 输出。
- 支持自定义 endpoint、model、headers、prompt 和超时。
- `AbortController` 贯穿网络与业务层。
- 以最近一次有效 delta 计算 idle timeout。
- 不设置过小的固定输出 token 上限。

输出校验：

- 结果不能为空。
- 长度变化超过配置阈值时回退。
- 必须保留受保护的标准词。
- 不能输出 thinking 标签、Markdown 说明或多余前缀。
- 任意错误都保留识别结果 `transcript`。

daemon 始终向客户端提供识别结果和润色结果。自动模式仅展示流式润色结果并在完成后选择推荐项；手动模式将润色结果作为默认第一候选，将识别结果作为第二候选。AI 失败时推荐项回退为识别结果。具体行为见 [语音输入会话流程](./session-flow.md)。

## 11. 推荐仓库结构

```text
VoxSpell/
├── apps/
│   └── daemon/                    # Node daemon 入口和业务编排
├── packages/
│   ├── protocol/                  # JSON-RPC 方法、TypeBox schema、版本和 capability
│   ├── asr-core/                  # Provider 接口、事件和 transcript assembler
│   ├── asr-openai-compatible/     # OpenRouter、GLM 等批量音频转写
│   ├── asr-tencent/               # 腾讯云实现
│   ├── audio-capture/              # pw-record 进程适配和统一采集接口
│   ├── text-pipeline/              # 词典、数字处理和输出校验
│   ├── ai-polisher/                # AI 接口及 OpenAI-compatible 实现
│   ├── config/                     # 配置 schema、迁移和密钥引用
│   └── observability/              # 日志、指标和脱敏
├── native/
│   └── fcitx5-addon/               # 唯一的 C++ 模块
├── tests/
│   ├── fixtures/                   # Provider 脱敏事件和文本 golden cases
│   ├── contract/                   # Provider contract tests
│   └── e2e/
├── packaging/
│   ├── systemd/
│   ├── arch/
│   └── debian/
├── docs/
├── project.tiny                   # 统一开发快捷指令
└── yarn.lock
```

不引入 Nx 或 Turborepo。首期使用 Yarn 4 workspaces、Tiny、Rspack、CMake 和 CTest 即可；`package.json` 不承担开发快捷指令编排。

## 12. 配置与密钥

建议路径：

```text
$XDG_CONFIG_HOME/voxspell/config.yaml
$XDG_CONFIG_HOME/voxspell/credentials.json
$XDG_CONFIG_HOME/voxspell/dictionary.yaml
$XDG_STATE_HOME/voxspell/logs/
$XDG_RUNTIME_DIR/voxspell/daemon.sock
```

原则：

- 普通设置可由 YAML 管理，并使用 TypeBox schema 校验和推导 TypeScript 类型。
- 密钥由 daemon 的 `0600` 应用私有凭据文件管理，键名沿用主配置引用的环境变量名称。
- daemon 解析时允许真实进程环境覆盖同名凭据，供开发、测试和高级用户自行配置，但不提供 systemd 环境配置界面。
- 配置日志只能打印密钥来源和是否存在，不能打印密钥值。
- 配置热加载失败时继续使用上一份有效配置。

## 13. 错误恢复

- ASR 建连失败：停止录音并明确提示网络或鉴权问题。
- ASR 中途断开：首期不静默重连并拼接结果，避免重复和漏字；保留已获得的稳定文本作为可选回退。
- daemon 不在线：Fcitx module 快速提示，不阻塞按键链路，并以退避策略重连。
- `pw-record` 异常退出：终止对应云会话，保留脱敏 stderr 摘要并清理 UI。
- AI 失败：将推荐结果回退为识别结果，不让本次语音输入丢失。
- Fcitx input context 消失：立即取消会话，禁止向新的应用窗口提交旧结果。

是否支持保存整段 PCM 后自动重放重试，应在后续通过隐私、费用和重复识别风险评估后决定，首期默认不保存音频文件。

## 14. 可观测性

每个会话使用随机 `sessionId`，记录：

- `pw-record` 启动和首个 PCM chunk 耗时。
- ASR WebSocket 建连耗时。
- first audio 到 first partial 延迟。
- PTT 松开到 ASR final 延迟。
- 文本后处理耗时。
- AI 首 token、完成和 idle timeout 延迟。
- 音频字节数、stdout chunk 数、ASR 包数和最大缓冲深度。
- Provider、结果原因和脱敏错误码。

默认不记录完整音频、完整签名 URL、密钥或用户最终文本。Debug 文本日志必须显式开启，并在文档中说明隐私影响。

## 15. 测试策略

### 15.1 TypeScript

- JSON-RPC method、TypeBox params/result/notification schema 和协议版本兼容性测试。
- initialize 前置约束、无效 params、标准错误映射、消息大小上限和 Unix Socket 断线测试。
- 使用 `vscode-jsonrpc` stream reader/writer 验证 Content-Length 分帧下的端到端请求、响应和通知。
- 用户词典编译、冲突、热加载和旧格式迁移测试。
- 数字归一化 golden tests。
- 文本流水线幂等与保护词测试。
- Provider contract tests。
- 使用本地 fake HTTP server 验证 OpenAI SDK 生成的转写路径、multipart、鉴权、取消和错误映射。
- 使用固定 WAV fixture 验证批量 Provider 的 PCM 聚合、WAV 封装和 completed 事件，默认测试不得访问公网。
- 腾讯云签名固定向量测试。
- 使用 fake child process 验证 `pw-record` 启动、任意 chunk 边界、停止、stderr 和异常退出。
- 使用本地 fake WebSocket server 验证节奏、backpressure、end/final、超时和错误。
- AI SSE 分片、空 chunk、取消、thinking 清理和失败回退测试。

### 15.2 C++

- PTT 按下、松开、短按、取消和失焦状态机测试。
- JSON-RPC Content-Length framing、半包、粘包、无效响应、断线和过期 session 测试。

### 15.3 端到端

- 使用 Fcitx test frontend 验证热键、preedit 和 commit。
- 使用 PipeWire 虚拟输入源验证 `pw-record` PCM 格式与停止流程。
- Rime 正在组合时不会破坏 composition。
- X11 与 Wayland 下分别验证提交。
- Electron、Qt、GTK、终端应用至少各覆盖一个代表客户端。
- 腾讯云真实账号测试放在显式 opt-in 的集成测试中，默认测试不得产生云费用。

## 16. 性能验收目标

以下为工程目标，不是对公网服务的绝对承诺：

- Fcitx 事件处理不执行网络或阻塞 I/O。
- 本地 PTT 到 `pw-record` 首个 PCM chunk 目标小于 150ms。
- 正常使用时 Node 音频缓冲保持有界，录音子进程不得因消费过慢长期阻塞。
- 良好网络下 first partial 的 P95 目标小于 1.2s。
- 不启用 AI 时，PTT 松开到 final 的 P95 目标小于 800ms。
- daemon 常驻空闲内存目标小于 100MB。
- Fcitx 插件或 daemon 重启后不需要重启桌面会话。

## 17. 实施阶段

### 阶段 0：冻结行为规范

- 整理旧项目用户词典和数字处理用例。
- 将当前失败用例分为实现缺陷与错误期望。
- 形成语言无关的输入/输出 fixture。
- 明确新项目许可证和可复用代码边界。

完成标准：文本 golden cases 全部有明确预期，不存在“以当前输出为准”的模糊规则。

### 阶段 1：基础骨架

- 初始化 Yarn 4 workspace、Tiny、Rspack 与 CMake。
- 先建立基于 JSON-RPC 2.0 和 TypeBox 的 protocol，以及 daemon 会话状态机和 `AudioCaptureBackend`。
- 实现 `pw-record` 后端及 fake capture 测试后端。
- 使用 TypeScript fake client、fake capture 和 fake provider 跑通无 C++ 的完整会话闭环。
- 协议与 daemon 闭环稳定后再创建 Fcitx module，跑通 PTT 到 preedit/commit。
- 建立 CI、格式化、静态检查和测试命令。

完成标准：无云账号时可通过 fake provider 完成端到端输入。

### 阶段 2：OpenAI-compatible 批量转写

- 使用 TypeBox 实现配置 schema、YAML 加载、active Provider 选择和环境变量密钥解析。
- 使用 OpenAI Node SDK 实现 OpenRouter、智谱 GLM 共用的批量音频转写 Provider。
- 将裸 PCM 封装为 WAV，完成取消、超时、错误分类和隐私约束。
- 提供两类显式真实冒烟测试：麦克风录制后请求，以及从 fixtures 选取一组音频逐条请求并汇总。
- 默认测试使用本地 fake HTTP server，不访问公网、不读取真实密钥、不产生云费用。

完成标准：OpenRouter 或 GLM 至少一个真实服务可以完成整段语音转写；两类冒烟测试均只能显式执行，且不会泄露密钥和请求正文。

### 阶段 3：Fcitx 批量语音输入闭环

- 将批量 Provider 注入 daemon 运行时。
- 跑通 PTT 按下录音、松开上传、识别完成后单次提交。
- 在没有 partial 的情况下提供明确的录音中和识别中状态。

完成标准：无需腾讯云账号即可使用 OpenRouter 或 GLM 完成一次真实 Fcitx 语音输入。

### 阶段 4：腾讯云实时 ASR

- 实现签名、WebSocket、音频节奏和结果拼装。
- 实现取消、超时、错误分类和指标。
- 完成 fake server 与 opt-in 真实云测试。

完成标准：partial 实时显示，松开后只提交一次 final，断网和鉴权失败不影响普通 Rime 输入。

### 阶段 5：确定性文本处理

- 移植并修正用户词典。
- 移植数字、日期、时间、百分比和编号规则。
- 实现腾讯云热词映射和旧词典迁移。

完成标准：所有冻结 golden cases 在 TypeScript 中通过，重复执行保持预期幂等。

### 阶段 6：AI 润色

- 实现 TextPolisher 和 OpenAI-compatible provider。
- 实现完整结果快照、取消、输出校验和识别结果回退。
- 实现 `session.selectResult`，让客户端决定自动选择还是等待用户确认。
- 完成 Fcitx 候选交互。

完成标准：AI 成功时同时提供润色结果与识别结果，默认推荐润色结果；自动与手动模式通过同一选择请求完成唯一一次提交，任意失败时识别结果仍可提交。

### 阶段 7：发布与多 Provider

- 完成 systemd user service 和 Arch/Debian 打包。
- 加入配置迁移、日志诊断和安装检查工具。
- 先用 contract tests 验证豆包、千问，再分别实现 Provider。

完成标准：供应商切换不修改 daemon 会话编排和 Fcitx 插件代码。

## 18. 首期完成定义

首个可发布版本必须同时满足：

- 普通 Rime 输入不经过 VoxSpell daemon。
- OpenAI-compatible 批量 Provider 可以完成录音、上传和单次 final 提交。
- 腾讯云实时 partial 可见，final 只提交一次。
- PTT、Escape、失焦和 daemon 断线均有确定行为。
- 用户词典、数字处理和 AI 回退具有自动化测试。
- 默认不落盘保存音频和用户文本。
- 密钥、签名和用户内容不会出现在默认日志中。
- X11 与 Wayland 的目标应用兼容性测试通过。
- 安装、升级、卸载不会覆盖用户现有 Rime 配置。

## 19. 待确认事项

以下事项不阻塞阶段 0 和阶段 1，但应在腾讯云接入前确认：

- PTT 默认按键以及短按时是否透传原按键。
- AI 润色默认开启还是默认关闭。
- 腾讯云默认使用 `16k_zh_en` 大模型引擎的成本是否可接受。
- 首批支持的发行版、最低 Fcitx/PipeWire 版本以及 `pw-record` 包名。
- 项目最终许可证。
- 是否需要首版提供命令行配置工具，还是仅使用 YAML 与 Fcitx 配置面板。

## 20. 参考资料

- Fcitx 5 基本概念：https://fcitx-im.org/wiki/Basic_concept
- Fcitx 5 输入法插件开发：https://fcitx-im.org/wiki/Develop_an_simple_input_method
- 腾讯云实时语音识别 WebSocket：https://cloud.tencent.com/document/api/1093/48982
- 千问实时语音识别交互流程：https://help.aliyun.com/zh/model-studio/qwen-asr-realtime-interaction-process
- 豆包大模型流式语音识别：https://www.volcengine.com/docs/6561/1354871
- PipeWire：https://pipewire.pages.freedesktop.org/pipewire/
- pipewire-rs（未来高级音频 worker）：https://pipewire.pages.freedesktop.org/pipewire-rs/pipewire/index.html
