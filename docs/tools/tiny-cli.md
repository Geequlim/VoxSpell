---
title: tiny 快捷指令
order: 6
description: 学会用 tiny 查看、检查和执行 project.tiny 中定义的快捷指令
---

# tiny 快捷指令

app-kit 仓库里的快捷指令统一由 `tiny` 提供。

你可以把它理解成：

- `project.tiny` 定义了仓库里的命令树
- `yarn tiny ...` 负责查找、解析并执行其中一条命令
- VS Code 插件面板和命令行用的是同一套定义

如果你刚开始使用这套框架，先记住下面四条命令就够了：

```bash
yarn tiny --help
yarn tiny list
yarn tiny inspect <selector>
yarn tiny <selector>
```

## 先理解 tiny 提供了什么命令

`tiny` 顶层提供这些子命令：

```bash
yarn tiny --help
```

当前仓库里最常用的是：

- `run`：执行快捷指令
- `list`：列出当前仓库可用的快捷指令
- `inspect`：查看某条快捷指令最终会执行什么
- `hooks`：执行和安装开发事件脚本
- `create`：创建项目

日常开发里，`run`、`list` 和 `inspect` 最常用。

## 先发现命令，再执行命令

如果你不知道仓库里有什么快捷指令，先跑：

```bash
yarn tiny list
```

如果你已经知道自己大概要找哪条命令，但不确定 selector 写法，可以先看列表，再挑出需要的 selector。

例如测试相关常见 selector 是：

- `compile`
- `test`
- `test/storybook`
- `test/e2e`
- `lint`
- `fix-worktree`

## inspect 用来确认最终执行内容

不要靠猜 `tiny` 最终会执行什么，先用 `inspect` 看清楚。

```bash
yarn tiny inspect develop/test
yarn tiny inspect develop/test/storybook
yarn tiny inspect fix-worktree
```

这一步特别适合 agent 和第一次接触仓库的开发者，因为它能直接告诉你：

- 当前 selector 匹配到了哪条命令
- 最终实际执行的命令是什么
- 你接下来应该把参数传给谁

## selector 是什么

`selector` 就是 `project.tiny` 里的命令路径。

例如：

```bash
yarn tiny develop/test
yarn tiny test
yarn tiny test/storybook
yarn tiny test/e2e
```

这里的含义分别是：

- `develop/test`：完整路径
- `test`：短写法
- `test/storybook`：`test` 下面的子命令
- `test/e2e`：`test` 下面的 Playwright E2E 子命令

通常你直接写仓库里已经约定好的短 selector 就够了。

## run 和直接执行 selector 的关系

下面两种写法是等价的：

```bash
yarn tiny run test
yarn tiny test
```

所以日常开发一般直接写：

```bash
yarn tiny test
yarn tiny test/storybook
yarn tiny lint
```

只有在你需要看 `run` 的帮助，或者想强调“这是显式执行 selector”时，才需要把 `run` 写出来。

## 附加参数怎么传

日常使用时，直接把参数写在 selector 后面即可。`tiny run` 只会自己消费 `-p, --project` 和 `-h, --help`，其他不认识的选项都会透传给最终命令。

```bash
yarn tiny compile target=example
yarn tiny test packages/modules/auth/lib
yarn tiny test apps/example --no-storybook
yarn tiny test packages/modules/auth --storybook
yarn tiny test -t "开发首页渲染"
yarn tiny test apps/tiny-docs --build
yarn tiny test/e2e example --build
yarn tiny test/e2e example --headed
yarn tiny test/e2e example --ui
```

普通位置参数也直接写在 selector 后面：

```bash
yarn tiny test/storybook dev example
yarn tiny test/storybook build example
yarn tiny test/storybook test example
yarn tiny test/e2e example apps/example/tests/home.e2e.ts
yarn tiny test/e2e packages/modules/auth/tests/auth-pages.e2e.ts
```

只有最终命令也需要接收 `-p`、`--project`、`-h` 或 `--help` 时，才需要用 `--` 显式分隔：

```bash
yarn tiny run test -- --help
```

## `--project` 是 tiny 自己的参数

如果你不在仓库根目录，或者需要指定另一个 `project.tiny`，可以用：

```bash
yarn tiny list --project .
yarn tiny inspect develop/test --project .
yarn tiny run test --project .
```

## hooks 开发事件脚本

`project.tiny` 可以通过顶层 `hooks` 配置开发事件脚本。hooks 条目的字段和普通快捷指令一致，但不支持 `actions` 嵌套。

```yaml
hooks:
  pre-commit:
    - name: lint-staged
      command: npx lint-staged

  postinstall:
    - name: setup-git-hooks
      command: tiny hooks install
```

Hook 任务可以通过 `condition` 声明执行条件。`condition` 会作为 Node.js 表达式执行，返回 truthy 时才继续执行当前任务：

```yaml
hooks:
  pre-push:
    - name: ci-only
      condition: "'CI' in process.env"
      command: yarn tiny test
```

如果整个 hook 事件都需要条件判断，可以使用对象写法，把任务放到 `tasks` 中：

```yaml
hooks:
  postinstall:
    condition: "!('CI' in process.env)"
    tasks:
      - name: setup-git-hooks
        command: tiny hooks install
      - name: prepare-assets
        command: yarn tiny assets prepare
```

配置 `condition` 后，tiny 会先判断 hook 事件条件，再判断任务条件，然后才处理 `files` 和执行 `command`。条件返回 falsy 时，对应 hook 事件或任务会跳过并计入 skipped；条件表达式语法错误或执行抛错时，hook 会失败。`condition` 等同于执行项目配置中的本地代码，只应在可信项目中使用。

Hook 任务可以通过 `files` 只把常见 Git 文件集合传给命令，并用 glob 再次过滤：

```yaml
hooks:
  pre-commit:
    - name: lint-ts
      command: yarn oxlint --fix
      files:
        source: staged
        include:
          - "apps/**/*.{ts,tsx,mts,cts}"
          - "packages/**/*.{ts,tsx,mts,cts}"
        exclude:
          - "**/*.d.ts"
        restage: true
```

`files.source` 支持：

- `staged`：使用已暂存的新增、复制、修改、重命名文件
- `changed`：使用工作区中未暂存的修改文件和未跟踪文件

`include` 和 `exclude` 只会过滤 Git 已返回的文件，不会扫描整个仓库。匹配结果为空时，该任务会跳过。`restage: true` 只允许配合 `source: staged` 使用；任务命令成功后，tiny 会显式执行 `git add -- <matched files>`，把命令修正过的文件重新暂存。

如果只需要选择文件集合，也可以使用简写：

```yaml
files: staged
```

常用命令：

```bash
yarn tiny hooks list
yarn tiny hooks inspect pre-commit
yarn tiny hooks run pre-commit
yarn tiny hooks run commit-msg -- .git/COMMIT_EDITMSG
yarn tiny hooks run postinstall --if-present
```

安装 Git hook 包装脚本：

```bash
yarn tiny hooks install
```

`hooks install` 只会为 Git hook 事件生成 `.githooks/<event>` 脚本，并设置 `git config core.hooksPath .githooks`。生成的脚本会切回项目根目录，并执行 `yarn tiny hooks run <event> --if-present -- "$@"`。`postinstall` 这类 npm lifecycle 不会自动注册，需要在 `package.json` 中显式调用：

```json
{
	"scripts": {
		"postinstall": "tiny hooks run postinstall --if-present"
	}
}
```

## 建议的使用顺序

刚接触一个仓库时，最稳妥的顺序是：

1. 先跑 `yarn tiny --help`
2. 再跑 `yarn tiny list`
3. 找到目标 selector 后，用 `yarn tiny inspect <selector>` 确认最终执行内容
4. 最后再执行 `yarn tiny <selector> [args]`

这样可以避免两个最常见的问题：

- selector 写错，但自己没意识到
- 参数属于 tiny 还是最终命令不清楚，导致执行结果不符合预期

## 在 app-kit 里最常用的命令

框架开发时，最常见的是这几类：

```bash
# 编译某个应用 target
yarn tiny compile target=example

# 统一测试入口
yarn tiny test

# Storybook 专用入口
yarn tiny test/storybook test example

# Playwright E2E 专用入口
yarn tiny test/e2e example

# 整理当前工作区改动
yarn tiny fix-worktree

# 查看某条命令最终会执行什么
yarn tiny inspect develop/test
```
