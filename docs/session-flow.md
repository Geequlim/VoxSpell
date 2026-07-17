# 语音输入会话流程

本文定义 daemon 与输入法客户端之间的会话行为。协议保持 `v1`；客户端只负责展示和选择，文本拼装、纠错与处理全部由 daemon 完成。

## 1. 完整流程

```text
准备 ASR 与麦克风
  -> 录音
  -> 实时识别与纠错
  -> 确定性处理（词典、数字、格式）
  -> 识别结果
  -> 可选 AI 流式润色
  -> 润色结果
  -> 客户端选择结果
  -> daemon 确认选择并通知客户端提交
```

daemon 通过 `session.phase` 明确通知以下客户端可见阶段：

```text
preparing -> recording -> recognizing -> processing -> polishing -> choosing
```

`preparing` 表示 daemon 正在连接 ASR 并初始化麦克风，此时客户端不能提示用户讲话。`recording` 仅在 ASR 与麦克风均已就绪后发送，是客户端提示“请开始讲话”的唯一依据。`polishing` 和 `choosing` 仅在启用 AI 润色时出现；结束录音和资源清理等内部状态不暴露给客户端。

`preparing` 可能在 `session.start` 请求仍处于 pending 时到达；通知携带的 `sessionId` 与随后成功响应中的 ID 相同。客户端必须正常处理请求完成前到达的会话通知，并且只能在收到 `recording` 后播放开始讲话提示。若准备失败，daemon 发送 `session.error`，同时 `session.start` 返回错误。

## 2. 文本数据

实时 ASR 阶段使用 `session.preview` 推送当前完整文本。ASR 的分段、修订和乱序合并由 daemon 处理，客户端收到通知后整体替换，不拼接增量内容。收到 partial 和 segment-final 时会话阶段仍保持 `recording`；只有客户端调用 `session.finish`、录音停止并开始等待最终识别结果后，daemon 才发送 `recognizing`。

确定性处理完成后，daemon 产生不可变的 `transcript`。它是经过词典、数字和格式处理的识别结果，不是供应商返回的原始文本。

AI 润色期间使用 `session.results` 推送完整结果快照：

```ts
{
	sessionId,
	transcript: {
		text,
		status: "final"
	},
	polished: {
		text,
		status: "streaming" | "final"
	},
	recommendedChoiceId: "polished"
}
```

daemon 在内部累积 AI 流式输出，每次发送完整的 `polished.text`。客户端只替换对应内容，不拼接 SSE delta。润色失败或结果校验失败时，`polished` 不可选，推荐结果回退为 `transcript`。

## 3. 客户端展示策略

是否自动提交由客户端配置决定，daemon 始终提供识别结果和润色结果。

### 自动选择

- 润色过程中只展示正在生成的润色结果，不展示识别结果。
- 润色完成后，客户端立即选择 `recommendedChoiceId`。
- 默认推荐 `polished`；润色不可用时推荐 `transcript`。

### 手动选择

- 润色结果是输入法第一候选和默认选中项，流式生成时持续整体替换。
- 识别结果固定保留为第二候选，允许用户绕过 AI 润色。
- 润色结果完成前不可选择；用户可以提前选择识别结果，结束润色并提交识别结果。
- 润色完成后进入 `choosing`，等待用户确认当前候选。

展示布局属于客户端职责；候选顺序和选择语义必须保持一致。

## 4. 提交协议

客户端通过统一请求选择结果：

```ts
session.selectResult {
	sessionId,
	choiceId: "transcript" | "polished"
}
```

daemon 校验结果已经可选，停止仍在运行的后续处理，然后发送：

```ts
session.completed {
	sessionId,
	selectedChoiceId,
	text
}
```

`session.completed` 是客户端唯一允许提交文本到目标应用的事件。自动与手动模式使用同一条提交路径，daemon 不读取也不保存客户端的选择模式配置。

## 5. 通知集合

```text
daemon.ready       daemon 已可用
session.phase      更新会话阶段
session.preview    整体替换实时识别文本
session.results    整体替换识别与润色结果
session.completed  提交唯一一次最终文本
session.error      清理会话并展示错误
```

录音、ASR 或确定性处理失败属于会话错误。AI 润色失败属于可恢复降级，不丢失已经生成的识别结果。
