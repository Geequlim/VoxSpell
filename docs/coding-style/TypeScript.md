---
title: TypeScript
order: 0
---

# TypeScript 编码规范

## 命名约定

- **文件和目录**：kebab-case（`user-service.ts`、`api/`）
- **类、接口、枚举、类型**：PascalCase（`UserService`、`User`）
- **变量和函数**：camelCase（`userName`、`getUserById`）
- **常量**：UPPER_SNAKE_CASE（`MAX_RETRY_COUNT`）
- **私有属性**：美元符前缀（`$privateField`）
- **函数命名**：动词或动词+名词（`start()`、`startLevel(level: number)`）
- **变量命名**：使用有意义的名称（`clickCallback`、`tempValue`）

## 格式化规范

- **缩进**：使用 Tab 缩进，禁止使用空格缩进
- **换行符**：使用 LF（Unix 风格）
- **分号**：始终使用分号结尾
- **引号**：使用单引号（`'string'`），必要时允许模板字符串
- **空格规范**：
  - 括号内不使用空格：`if (x < 10) { }`
  - 逗号、冒号、分号后要有一个空格：`function f(x: number, y: string): void { }`
  - 对象花括号使用空格：`{ key: value }`
  - 数组方括号不使用空格：`[1, 2, 3]`
  - 模板字符串 curly 内不使用空格：`` `Hello ${name}` ``
  - 函数调用不使用空格：`console.log('hello')`
- **代码块**：开始的 `{` 总是和其所属的语句在同一行
- **变量声明**：每个变量声明语句只声明一个变量（`const x = 1; const y = 2;`）
- **import 语句**：如果一次导入多个成员，不论成员数量多少或行多长，都必须保持单行，不得换行拆分

```ts
// ✅ 推荐
import { A, B, C, D, E, F } from './types';

// ❌ 不推荐
import {
	A,
	B,
	C,
	D,
	E,
	F,
} from './types';
```

## 类型系统

### 类型定义

- **对象类型**：优先使用 `interface` 定义
- **联合类型和复杂类型**：使用 `type` 定义
- **避免使用 `any`**：使用具体类型或 `unknown` 代替
- **可推断的类型**：不需要显式声明
- **不要把 `| null`、`| undefined` 当作默认写法到处显式展开**
- **字段或参数只是可缺省时，优先使用可选属性和可选参数**
- **只有在协议语义或外部接口明确要求时，才显式区分 `null` 与 `undefined`**
- **类型定义位置**：在文件顶部

### 可选类型写法

- 属性可缺省时使用 `foo?: T`
- 参数可不传时使用 `foo?: T`
- 返回值如果语义上允许“空结果”，统一使用 `Nullable<T>`
- 不要把“可不传”写成 `foo: T | undefined`
- 参数如果只是可选，不要顺手写成 `foo?: T | null`
- 不要把常规缺省字段写成 `foo: T | null | undefined`
- 不要在返回值位置手写 `T | null | undefined`

```ts
// ❌ 不推荐
type UserContext = {
	accountId: string | null | undefined;
};

// ✅ 推荐
type UserContext = {
	accountId?: string;
};

// ❌ 不推荐
function buildCallbackUrl(url: string, state: string | undefined) {}

// ✅ 推荐
function buildCallbackUrl(url: string, state?: string) {}

// ❌ 不推荐
function updateProfile(handle?: string | null) {}

// ✅ 推荐
function updateProfile(handle?: string) {}

// ❌ 不推荐
function getCurrentAccount(): Account | null | undefined {}

// ✅ 推荐
function getCurrentAccount(): Nullable<Account> {}
```

### 类型导入

- **类型导入分离**：使用 `import type` 导入类型，分离到单独的 import 语句

### 定义来源

- **禁止转发式导出**：不要通过 `export { Foo } from './foo'`、`export type { Foo } from './foo'` 之类的方式做“空壳转发”
- **禁止定义二次包装**：如果一个文件只剩下转发出口或别名出口，就删除它，调用方直接从定义文件 import
- **明确来源优先**：代码里出现的类型、常量、函数、Schema，应该能直接追溯到它的定义文件，不要再绕一层中转文件

```ts
// ❌ 不推荐：定义来源被转发层遮住了
export { OIDCSubjectSchema };
export type { OIDCSubject };

// ✅ 推荐：调用方直接从定义文件 import
import { OIDCSubjectSchema } from '@modules/auth/oidc/subject';
import type { OIDCSubject } from '@modules/auth/oidc/subject';
```

```ts
// 值导入
import { getUser } from './api';

// 类型导入（单独的 import 语句）
import type { User } from './types';
```

## 代码质量

### 禁止事项

- **禁止默认导出**：使用命名导出（`export const x = 1;`）
- **禁止使用 `@ts-ignore`**：优先修复类型问题
- **禁止在 `src/` 目录使用 `.js` 文件**
- **禁止使用 `namespace`**：使用 ES Module
- **禁止使用 `for..in`**：使用 `for...of`、`forEach`
- **成员函数不使用箭头函数**：影响多态调用
- **不使用 `var`**：使用 `const` 或 `let`
- **不使用 `+` 拼接字符串**：使用模板字符串

### 最佳实践

- **使用箭头函数代替匿名函数表达式**
- **箭头函数参数**：只有需要时才把参数括起来（`x => x + x`）
- **使用 `forEach`、`map` 和 `filter` 代替循环**
- **为类、成员、函数、接口、枚举使用 JSDoc 注释**
- **不在文件头添加签名**

### 一般假设

- 假设外部不需要修改的成员，添加 `readonly` 修饰
- 假设外部不需要访问的成员，添加 `private` 或 `protected` 修饰
- 假设不会变的对象，声明为 `Readonly<T>`

## 编码风格

1. 函数参数表和返回值声明尽量保持在一行内

   ```ts
   async getUserById(id: string, includeDeleted?: boolean): Promise<User>
   ```

2. 只有一个表达式的条件语句可以省略大括号，表达式与条件语写在同一行

   ```ts
   if (!isValid) return;
   if (!isValid) throw new Error("Invalid");
   ```

3. 取值优先使用可选链，不写冗长的显式判空表达式

   ```ts
   // ❌ 不推荐
   const email = account ? account.email : undefined;

   // ✅ 推荐
   const email = account?.email;
   ```

4. 三目运算只用于短小、线性的条件选择；如果逻辑复杂到需要换行，改写成 `if` / `else`

   ```ts
   // ❌ 不推荐
   const label = account?.email
   	? account.email
   	: account?.identifier
   		? account.identifier
   		: 'unknown';

   // ✅ 推荐
   let label = 'unknown';
   if (account?.email) {
   	label = account.email;
   } else if (account?.identifier) {
   	label = account.identifier;
   }
   ```
