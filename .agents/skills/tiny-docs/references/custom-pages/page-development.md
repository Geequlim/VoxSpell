---
title: 页面开发
order: 1
---

# 页面开发

本文面向需要编写 `DocsModule.pages` 模板、代码注册页面模板，或者为自定义页面补充样式的场景。

如果你还在了解页面配置本身，先读 [自定义页面](./index.md)。

## 适用场景

这份文档适合下面这些情况：

- 你需要写 `@docs/pages/*.hbs` 或项目内的页面模板
- 你需要在模板里使用 Handlebars helper
- 你需要了解模板可用的上下文变量
- 你需要给自定义页面挑选合适的 CSS 类

## 模板组织建议

- 页面结构尽量贴近实际展示层，不要在模板里拼太多业务逻辑
- 有复用价值的片段可以通过 `{{import ...}}` 拆出去
- 页面内容可以用 `docs-markdown` 承载正文，用 `docs-article` 承载完整内容页
- 如果页面本质上是文档，优先保持与系统文档一致的排版节奏

### 文件路径

模板文件可以是：

- `@docs/...`：模块内置模板别名
- `./views/...`：相对当前配置文件目录
- `views/...`：相对 `workspace`

### 静态资源路径

自定义页面模板可以直接使用 `/assets/...` 引用 `assetsDirs` 中的全站静态资源。

```hbs
<link rel="stylesheet" href="/assets/pages/home.css">
<img src="/assets/pages/hero.png" alt="Hero">
<script src="/assets/pages/home.js"></script>
```

这条规则同时适用于开发态和发布态：

- 开发态会把 `assetsDirs` 注册到 `/assets`
- 发布时会把 `assetsDirs` 中的文件复制到产物 `assets/`
- 如果站点发布在子路径下，页面中的 `/assets/...` 会自动改写成带 `publish.routePrefix` 的路径

因此，写自定义页面时不要因为担心发布路径而回避 `/assets/...`。只有页面专属、未放入 `assetsDirs` 的附加文件，才需要通过 `pages.files` 或代码注册页面的 `files` 显式声明。

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

## Handlebars Helper

### `typeof(value)`

返回值的类型字符串，适合做轻量分支判断。

常见返回值：

- `string`
- `number`
- `boolean`
- `object`
- `array`
- `null`
- `undefined`

### `now(format?)`

返回当前时间。

- 不传 `format` 时，返回 `Date` 对象
- 传 `format` 时，按 `fecha` 的格式化规则输出字符串

示例：

```hbs
{{now}}
{{now "YYYY-MM-DD"}}
```

### `json(value, options)`

把值序列化为 JSON 文本，适合调试模板数据或输出嵌入式配置。

支持的 `hash` 参数：

| 参数     | 作用                 | 说明                                |
| -------- | -------------------- | ----------------------------------- |
| `pretty` | 是否格式化输出       | 默认 `true`                         |
| `space`  | 缩进空格数           | 默认跟随 `pretty`，开启时为 `2`     |
| `safe`   | 是否安全处理循环引用 | 设为 `1`、`true` 或 `safe=1` 时启用 |

示例：

```hbs
<pre>{{json data}}</pre>
<pre>{{json data pretty=0}}</pre>
```

### `routeLink(prefix, value)`

拼接站点路由前缀和页面路径。

- `prefix` 是站点路由前缀
- `value` 是目标路径

示例：

```hbs
<a href="{{routeLink routePrefix "demo"}}">演示页</a>
```

### `import(target, ...)`

导入并渲染其他模板，适合拆分页面片段。

- `target` 可以写 `@docs/...` 或项目内路径
- 传入的 `hash` 会作为模板局部参数
- 当前上下文会以 `super` 的形式传给被导入模板

示例：

```hbs
{{{ import "@docs/pages/partials/hero" title="首页" subtitle="文档站" }}}
```

## 常用 CSS 类

### 页面骨架

| 类名                      | 作用             | 适合场景               |
| ------------------------- | ---------------- | ---------------------- |
| `.docs-layout`            | 页面最外层布局   | 所有文档页和自定义页   |
| `.docs-layout-no-sidebar` | 无侧边栏布局     | 首页、纯展示页         |
| `.docs-main`              | 主内容区域       | 普通文档页             |
| `.docs-main-custom`       | 自定义页面主区域 | 需要自定义顶部间距时   |
| `.docs-container`         | 内容居中容器     | 标准宽度页面           |
| `.docs-custom-head`       | 自定义页头部区域 | 自定义页标题、面包屑   |
| `.docs-custom-page`       | 自定义页面主体   | 代码注册页面或特殊布局 |

### 内容排版

| 类名                      | 作用              | 适合场景                     |
| ------------------------- | ----------------- | ---------------------------- |
| `.docs-article`           | 文档卡片容器      | 需要边框、圆角、阴影的正文页 |
| `.docs-markdown`          | Markdown 排版容器 | 需要复用系统 Markdown 样式   |
| `.docs-show-line-numbers` | 显示代码行号      | 代码块需要展示行号时         |
| `.docs-breadcrumb`        | 面包屑导航        | 详情页、子页面               |
| `.docs-placeholder`       | 空状态提示        | 未找到内容、加载占位         |

### 导航与搜索

| 类名                   | 作用         | 适合场景           |
| ---------------------- | ------------ | ------------------ |
| `.docs-navbar`         | 顶部导航容器 | 使用系统顶部导航时 |
| `.docs-navbar-button`  | 顶部按钮     | 自定义导航按钮     |
| `.docs-navbar-link`    | 顶部链接     | 顶部导航链接       |
| `.docs-search-trigger` | 搜索触发器   | 需要默认搜索入口时 |
| `.docs-search-modal`   | 搜索弹窗     | 搜索面板样式定制   |

### 首页样式

如果你在做首页，可以参考 `.docs-home-*` 系列类名：

- `.docs-home-container`
- `.docs-home-hero`
- `.docs-home-hero-actions`
- `.docs-home-feature-grid`
- `.docs-home-feature-card`

这组类更适合 Hero 区、特性卡片和首屏视觉布局。

## 开发示例

下面是一个常见的自定义展示页模板片段：

```hbs
<div class="docs-container">
	<article class="docs-article">
		<nav class="docs-breadcrumb">
			<a href="{{routeLink routePrefix "getting-started"}}">文档</a>
			<span>/</span>
			<span>{{pageTitle}}</span>
		</nav>

		<h1>{{pageTitle}}</h1>

		<p>当前时间：{{now "YYYY-MM-DD HH:mm"}}</p>

		<pre>{{json data}}</pre>

		<div class="docs-markdown">
			{{{contentHtml}}}
		</div>
	</article>
</div>
```

## 选择建议

- 正常文档内容优先继续用 Markdown
- 需要模板数据、特殊布局、动态内容时再用自定义页面
- 如果只是做一个可配置展示页，优先使用 `DocsModule.pages`
- 如果页面需要运行时数据或附加文件，再考虑代码注册
