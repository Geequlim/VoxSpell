---
order: 2
---

# 实现细则

本文档用于补充实现阶段的具体写法约束。

## 函数作用域与抽象边界

### 基本原则

- 辅助函数只有一个调用点时，原则上定义在调用它的函数内部
- 只有在存在明确复用价值或稳定边界时，才将函数提升为成员函数、模块级函数或公共工具
- 不要为了“看起来整洁”提前抽象
- 同一条调用链中的局部变换，优先使用局部变量和局部闭包，不要扩散到更大作用域

### 适合内收的情况

- 仅在当前函数中使用一次的格式化、拼装、匹配、fallback 处理
- 只服务于当前流程的一小段分支逻辑
- 抽出来后不会提升复用性，只会增加阅读跳转成本

### 适合提升作用域的情况

- 同一文件内被多个函数复用
- 构成清晰、稳定、可命名的领域能力
- 需要被测试、覆写、多态分发或跨模块复用

```ts
// ❌ 不推荐：单次调用的辅助函数提升到了成员级别
function getResolvedSubject(subject: Subject | null, snapshot: Subject | null) {
	return subject || snapshot;
}

function buildClaims(subject: Subject | null, snapshot: Subject | null) {
	const currentSubject = getResolvedSubject(subject, snapshot);
	return { name: currentSubject?.name };
}

// ✅ 推荐：单次调用的辅助逻辑留在调用点
function buildClaims(subject: Subject | null, snapshot: Subject | null) {
	const currentSubject = subject || snapshot;
	return { name: currentSubject?.name };
}
```

## 参数设计

### 基本原则

- 参数数量尽可能少，并保持语义直接
- 优先使用直白参数，不要为了“未来可能扩展”提前引入 `options`
- 不使用“内涵参数”风格，即通过一个对象承载当前只用到的少量零散字段
- 参数设计应服务当前真实边界，而不是服务假想扩展

### 推荐写法

- 两到四个稳定参数，直接平铺声明
- 调用方已经天然持有这些值时，按值传递，不再额外包一层对象
- 如果对象本身就是一个稳定领域对象，可以直接传对象

### 谨慎使用对象参数

只有在以下情况同时成立时，才考虑对象参数：

- 参数确实较多，且大部分是可选项
- 这些字段天然属于一个完整配置对象
- 调用方以对象传递更清晰，而不是更模糊

```ts
// ❌ 不推荐：为了少量参数引入 options
getSubjectById(options: { userId: string; subjectId: string; type?: SubjectType }) {}

// ✅ 推荐：直接使用少量、清晰的参数
getSubjectById(userId: string, subjectId: string, type?: SubjectType) {}
```

## 边界与补偿

- 存在主数据源和兜底数据源时，先合并为一个局部变量，再继续后续构造
- 不要在对象字面量中重复书写长串 fallback 表达式
- 条件判断、fallback、映射和输出构造应分步完成
- 当一段表达式已经影响可读性时，应拆成命名明确的中间变量
- 校验、规整、纠错只应发生在最靠近数据来源的边界
- 一旦数据已经被 TypeScript、Schema 或协议约束收口，后续控制器、服务层、领域层、配置消费层必须直接信任它，不要重复补偿上游
- 如果某个字段允许为空，就按空值语义处理；如果某个字段不应为空，就通过类型、Schema、协议约束或显式错误处理表达，不要靠下游偷偷改写后继续执行

### 边界划分

- 用户交互输入边界:
  - 前端表单、搜索框、query 输入、剪贴板文本、手工粘贴内容
  - 这里允许 `trim()`、去空格、大小写归一、手机号去分隔符等明确的输入清洗
- 外部非类型化数据边界:
  - 第三方 JSON、JWT claims、`Record<string, unknown>`、原始 header/query/body
  - 这里允许做“类型收窄”，例如 `typeof value === 'string' ? value : undefined`
  - 这里的目标是识别类型，不是把非法值揉成空串继续跑
- 业务内部:
  - 已经过 Schema 校验的请求体、明确类型的配置、DTO、实体字段、模块 options、服务层参数
  - 这里禁止重复做补偿式防御，不要再写 fallback、强转、trim、空值揉平、默认值兜底
- 展示层:
  - 页面标题、占位文案、渲染 fallback
  - 这里允许展示语义上的 fallback，但那是展示逻辑，不是输入规整

### 禁止模式

- 不要把“类型系统和 Schema 已经收口”的值再次做补偿式规整
- 不要为了“保险”把空值统一揉成空串
- 不要用 `String(...)` 掩盖上游契约不清
- 不要在每一层重复做同一轮防御
- 不要把 `typeof x === 'string' ? x : undefined` 滥用到本来就已经是 `string | undefined` 的字段上

### 判断顺序

- 先问这个值现在是不是 `unknown` 或原始外部输入
- 再问这里是不是用户交互输入边界
- 如果都不是，就直接使用当前值，不要再做补偿式规整
- 如果这里需要对非法值做处理，应优先报错、拒绝、或显式返回空，而不是偷偷改写成空串继续执行

```ts
// ❌ 不推荐：在对象字面量中重复写 fallback
const ret = {
	name: subject?.name || snapshot?.name,
	email: subject?.email || snapshot?.email,
	picture: subject?.picture || snapshot?.picture,
};

// ✅ 推荐：先合并，再构造输出
const currentSubject = subject || snapshot;

const ret = {
	name: currentSubject?.name,
	email: currentSubject?.email,
	picture: currentSubject?.picture,
};

// ❌ 不推荐：边界已经收口，下游还在重复补偿
const issuer = String(this.configs.provider?.issuer || '').trim();
const subjectId = String(req.accessToken?.subjectId || '').trim();
const keyword = String(input || '').trim();
const clientName = typeof ctx.oidc.client?.clientName === 'string' ? ctx.oidc.client.clientName : undefined;

// ✅ 推荐：业务内部直接使用已约束的值
const issuer = this.configs.provider.issuer;
const subjectId = req.accessToken?.subjectId;
const clientName = ctx.oidc.client?.clientName;

// ✅ 推荐：只在输入边界做明确规整
const keyword = event.currentTarget.value.trim();
```

## 调用点与输出

- 先确定当前使用的数据源
- 再基于该数据源构造返回值
- 命名应反映语义，例如 `currentSubject`、`resolvedGrant`、`effectiveScope`
- 调用点尽量薄；如果某个接口天然可以处理空值或缺省值，就不要在调用点额外铺一层三目或 `Promise.resolve(null)` 去喂参数
- 调用点如果只是事件绑定、组件回调传递或局部参数适配，应让模板直接反映真实调用关系，不要制造额外的“空壳中转层”
- 输出结构尽量贴近真实消费需求；如果最终只需要一个值，就直接返回这个值，不要为了“结构统一”再包一层只有单字段的对象

```ts
// ❌ 不推荐：调用点为了喂参数再铺一层条件分支
const token = account?.issuer
	? subjectTokenService.getBySubject(account?.issuer, account.identifier)
	: Promise.resolve(null);

// ✅ 推荐：让接口自己处理空值
const token = subjectTokenService.getBySubject(account?.issuer, account?.identifier);

// ❌ 不推荐：只为了包对象而包对象
const ret = {
	subject: account ? { subjectId: account.identifier } : null,
};

// ✅ 推荐：直接返回最终需要的值
const ret = {
	subject: account?.identifier,
};
```

## 空值与可选参数

- 默认只用 `undefined` 表达“缺省 / 没有提供 / 当前无值”
- `null` 不是默认空值；只有在协议或业务明确要求表达“显式清空”时才允许使用
- 参数如果只是可选，使用 `foo?: T`，不要写 `foo?: T | null`
- 属性如果只是可缺省，使用 `foo?: T`，不要写 `foo: T | null | undefined`
- 输出层优先直接返回真实值或可选值，不要习惯性补 `|| null`
- 空值判定、缺省收口、默认值选择，优先放在被调用函数内部处理，不要在调用点先写三目运算喂参数
- Patch / Update 场景中，`undefined` 表示“不修改”；只有明确需要“清空字段”时，才允许引入 `null`

```ts
// ❌ 不推荐：把缺省值习惯性压成 null
const ret = {
	user: user?.toDto() || null,
};

// ❌ 不推荐：参数只是可选，却额外展开成 nullable
function updateProfile(handle?: string | null) {}

// ✅ 推荐：参数可选就直接用可选参数
function updateProfile(handle?: string) {}

// ✅ 推荐：直接返回可选值
const ret = {
	user: user?.toDto(),
};
```

## 例外说明

- 当提升作用域能显著减少重复、提升命名边界或满足多态需求时，可以不内收
- 当外部接口、第三方库或框架约定要求对象参数时，可以使用对象参数
- 当中间变量会降低而不是提升理解效率时，可以保留简短表达式

例外必须有明确收益，不能仅以个人习惯作为理由。
