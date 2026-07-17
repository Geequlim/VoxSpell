---
title: 基础使用
order: 1
---

# 基础使用

本文说明如何把 `@tinyaxis/tiny-docs` 作为独立文档应用使用。

在继续操作前，如果你还不清楚 `workspace`、`spaces`、sidebar、`pages`、`navigator.buttons` 分别负责什么，建议先看 [文档技能](../SKILL.md)。

## 配置文件参数

`tiny-docs` 的命令主要围绕配置文件工作。最常用的参数如下：

| 参数                  | 作用         | 说明                                        |
| --------------------- | ------------ | ------------------------------------------- |
| `-c, --config <file>` | 指定配置文件 | 默认通常使用当前工作目录中的 `configs.yaml` |
| `--force`             | 覆盖已有配置 | 仅用于 `tiny-docs init`                     |
| `publish <dist>`      | 指定发布目录 | 例如 `dist/docs`                            |

如果你是第一次使用，建议先理解配置文件的结构，再执行初始化。

## 推荐目录

建议为文档站准备独立目录，例如 `docs-site/`：

```text
my-app/
|- .agents/
|  `- skills/
|- docs/
|- packages/
`- docs-site/
```

`tiny-docs init` 会把技能安装到当前文档应用所在目录下的 `.agents/skills/tiny-docs`。

## 安装

进入文档应用目录并安装：

```bash
cd docs-site
yarn add -D @tinyaxis/tiny-docs
```

安装后可以直接使用：

```bash
yarn tiny-docs --help
yarn tiny-docs init
yarn tiny-docs serve
yarn tiny-docs publish dist/docs
```

## 初始化

首次使用时执行：

```bash
yarn tiny-docs init
```

该命令会：

1. 生成 `configs.yaml`
2. 默认把 `routePrefix` 和 `publish.routePrefix` 设为 `/`
3. 在交互终端中默认询问是否安装 `tiny-docs` 技能目录
4. 在非交互环境中默认安装 `tiny-docs` 技能目录
5. 安装完成或检测到已存在后，默认询问是否安装第三方图表技能

如果你想跳过技能安装，可以使用：

```bash
yarn tiny-docs init --skip-skills
yarn tiny-docs init --skip-third-party-skills
```

如果已经存在配置并希望覆盖：

```bash
yarn tiny-docs init --force
```

## 启动预览

```bash
yarn tiny-docs serve
```

常见写法：

```bash
yarn tiny-docs serve -c configs.yaml
yarn tiny-docs publish dist/docs
```

## 下一步

- 修改站点标题、文档空间、导航或路由前缀，继续看 [配置说明](configuration.md)
- 替换首页或增加展示页，继续看 [自定义页面](custom-pages/)
- 理解路径、资源和侧边栏规则，继续看 [规则与约束](rules.md)
