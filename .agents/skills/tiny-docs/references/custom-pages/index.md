---
title: 自定义页面
order: 4
---

# 自定义页面

`tiny-docs` 支持通过 `DocsModule.pages` 注册声明式页面，也支持通过代码注册运行时页面。

如果你还不清楚文档树、sidebar 和顶部导航的边界，建议先看 [文档技能](../../SKILL.md)。

如果你要继续编写模板、使用 helper 或挑选常用样式类，请看 [页面开发](page-development.md)。

## 什么时候用自定义页面

自定义页面适合用于：

- 替换首页
- 添加 demo/about/blog 页面
- 使用模板、数据文件或 Markdown 片段生成页面
- 将展示页挂到某个文档节点下

普通说明型文档仍然优先使用 Markdown。

## 最小示例

```yaml
DocsModule:
  pages:
    - path: ""
      title: 首页
      template: "@docs/pages/index.hbs"
      shell:
        sidebar: false
        breadcrumbs: false
        footerNoMargin: true

    - path: demo
      title: 演示
      template: ./views/demo.hbs
      layout: "@docs/layouts/main.hbs"
      shell:
        sidebar: false
        breadcrumbs: false

    - path: about
      title: About
      template: ./views/about.hbs
      layout: "@docs/layouts/main.hbs"
      shell:
        sidebar: false
```

## 字段说明

| 字段       | 作用          | 说明                              |
| ---------- | ------------- | --------------------------------- |
| `path`     | 页面路由      | `''` 表示首页                     |
| `title`    | 页面标题      | 展示在页面标题和导航位置          |
| `template` | 模板文件      | Handlebars 模板文件               |
| `layout`   | 布局模板      | 可选布局模板                      |
| `data`     | 内联数据      | 直接写在配置里的数据              |
| `dataFile` | 外部数据文件  | 支持 `.json`、`.yaml`、`.yml`     |
| `markdown` | Markdown 内容 | 先渲染为 `contentHtml` 再注入模板 |
| `files`    | 附加静态文件  | 发布时额外复制的静态文件          |

### shell

| 字段                   | 作用                 | 说明                   |
| ---------------------- | -------------------- | ---------------------- |
| `shell.sidebar`        | 是否显示侧边栏       | 默认 `true`            |
| `shell.breadcrumbs`    | 是否显示面包屑       | 默认跟随 `sidebar`     |
| `shell.footer`         | 是否显示底部栏       | 默认 `true`            |
| `shell.footerNoMargin` | 是否移除底部额外留白 | 默认跟随是否显示侧边栏 |

## 模板路径规则

- `@docs/pages/index.hbs`: 内置页面模板
- `@docs/layouts/main.hbs`: 内置布局模板
- `./views/demo.hbs`: 相对配置文件目录解析
- `views/demo.hbs`: 相对 `workspace` 解析

## 模板上下文

模板中可使用下列上下文变量：

| 变量                | 作用              | 说明                             |
| ------------------- | ----------------- | -------------------------------- |
| `page`              | 当前页面对象      | 包含页面路径、标题、模板等信息   |
| `pageTitle`         | 页面标题          | 当前页面展示标题                 |
| `data`              | 页面数据          | 来自 `data` 或 `dataFile` 的内容 |
| `contentHtml`       | Markdown 渲染结果 | `markdown` 配置渲染后的 HTML     |
| `options`           | 全局渲染配置      | 文档模块的渲染选项               |
| `routePrefix`       | 页面路由前缀      | 当前站点使用的路由前缀           |
| `staticRoutePrefix` | 静态资源前缀      | 当前站点使用的静态资源前缀       |
| `spaces`            | 文档空间列表      | 当前可见的 space 数据            |
| `breadcrumbs`       | 面包屑数据        | 当前页面的面包屑信息             |

## pages、sidebar、navigator.buttons 的边界

这三个能力分别负责不同事情：

- `pages`: 注册页面并定义其渲染方式
- `sidebar`: 决定页面是否挂到文档树中
- `navigator.buttons`: 决定页面是否出现在顶部导航

它们不会自动互相补全。

这意味着：

- 页面可访问，只需要配置 `pages`
- 页面要出现在顶部导航，还要配置 `navigator.buttons`
- 页面要出现在某个文档子树中，还要配置 `sidebar`

## 挂到文档侧边栏

页面默认不会进入文档树。若需要挂到某个文档节点下，使用 `sidebar`：

```yaml
DocsModule:
  pages:
    - path: database/playground
      title: SQL Playground
      template: ./views/database-playground.hbs
      layout: "@docs/layouts/main.hbs"
      sidebar:
        parent: database
        title: SQL Playground
        order: 30
```

字段说明：

| 字段             | 作用           | 说明                 |
| ---------------- | -------------- | -------------------- |
| `sidebar.parent` | 目标父节点路径 | 挂载到哪个文档节点下 |
| `sidebar.title`  | 侧边栏显示名称 | 默认使用页面标题     |
| `sidebar.order`  | 排序值         | 数值越小越靠前       |
