---
name: tiny-docs
order: 3
description: tiny-docs 文档应用技能包，说明文档站的概念模型、配置规则、页面机制、发布方式和 Markdown 能力。
---

# tiny-docs

## 简介

`tiny-docs` 是一个文档应用工具，用来把项目中的 Markdown、页面模板和静态资源组织成完整的文档站。

它的重点不是“单篇 Markdown 渲染”，而是提供一套稳定的文档站组织模型：

- 从 `workspace` 中收集文档
- 通过 `spaces` 将不同目录组织成多个文档分组
- 根据文档树自动生成文档侧边栏、面包屑和目录
- 通过“自定义页面配置”（`DocsModule.pages`）注册首页、演示页、关于页等非 Markdown 页面
- 通过“顶部导航按钮配置”（`navigator.buttons`）单独控制顶部导航
- 通过内置搜索快速定位文档内容
- 将文档站静态化发布到任意静态托管环境

`tiny-docs` 还扩展了一部分 Markdown 语法和内容块能力，例如图表、标签页、提示块以及其他文档增强写法。不要只依赖普通 Markdown 经验，遇到这类语法时请直接查看 [Markdown 完整示例](references/markdown.md)。

## 核心概念

文档里会出现一些配置键名，它们对应的中文概念如下：

- `workspace`：文档扫描根目录，文档目录、资源目录和大多数相对路径都以它或配置文件目录为基准解析
- `spaces`：文档分组配置，用来声明扫描哪些目录，并把它们归到哪个文档分组下
- `spaces[].dirs[].linkPrefix`：扫描入口的公开路径映射，用来把源码目录映射成文档站公开 URL、LLM 镜像和静态资源使用的 canonical 路径
- `DocsModule.pages`：自定义页面配置，用来注册首页、演示页、关于页等非 Markdown 页面
- `navigator.buttons`：顶部导航按钮配置，只决定顶部导航显示什么
- `sidebar`：文档侧边栏挂载配置，用来决定页面是否进入文档树
- `registerCustomDocPage()`：代码注册的文档页挂载方式，用来把运行时页面放进文档树
- `search.enabled`：文档搜索开关，决定是否启用搜索入口和索引
- `assetsDirs`：静态资源目录配置，用来声明页面依赖的资源目录
- `files`：页面附加文件配置，用来显式声明页面发布时要一起复制的文件

`基础使用` 只适用于把 `@tinyaxis/tiny-docs` 当作独立文档应用来启动、初始化和发布的场景。如果你是在 `app-kit` 里做 `DocsModule` 集成，这部分内容只作为背景参考，优先看模块文档里的配置和页面说明。

### 文档入口与子文档

文档树的形成规则如下：

- 目录根的 `README.md`、`readme.md` 或 `index.md` 作为入口页
- 同目录下的 `docs/` 继续作为子文档树被收集
- 没有根文档时，系统会直接以目录内容组织入口

这套树结构会直接影响文档侧边栏、面包屑、文档路由和发布时的页面生成。

如果扫描入口使用了 `linkPrefix`，文档树的源码路径和公开路径会分离。比如 `path: .agents/skills`、`linkPrefix: agents/skills` 会让开发态链接生成到 `/dev/agents/skills/...`，发布态链接生成到发布前缀下的 `/agents/skills/...`，同时 LLM Markdown 镜像和静态资源也会使用 `agents/skills/...` 这条公开路径。

### 文档侧边栏

文档侧边栏主要来自文档树，而不是独立配置一份完整导航数据：

- Markdown 文档的目录结构决定主要文档侧边栏
- 文档 front matter 可以控制标题、描述、排序、折叠与隐藏
- 自定义页面配置也可以通过 `sidebar` 配置挂到某个文档节点下
- 代码注册的文档页可以通过 `registerCustomDocPage()` 进入文档树

### 自定义页面配置

自定义页面配置适合首页、演示页、关于页、博客页，以及依赖模板数据的展示页面。

它和 Markdown 文档的边界是：

- 常规说明文档优先用 Markdown
- 需要模板、数据、特殊布局的页面优先用自定义页面配置

### 顶部导航按钮配置

顶部导航只由顶部导航按钮配置控制，不会从自定义页面配置或文档树自动推导。

这意味着：

- 页面注册成功，不代表会自动出现在顶部导航
- 文档存在于文档侧边栏中，也不代表一定要出现在顶部导航
- 顶部导航、文档树、页面注册是三套相互配合但职责不同的机制

### 文档搜索

文档站默认会提供搜索入口。它基于 Pagefind 工作，开发态和发布态都可用，但前提是 `search.enabled` 为 `true`。

常见行为如下：

- 顶部导航会显示搜索按钮和快捷键提示
- `Ctrl K` 可直接打开搜索
- 发布时会生成搜索索引文件
- 没有可用索引时，搜索入口会保持不可用状态，直到索引准备完成

### 资源与发布

Markdown 中引用的本地资源会被系统识别并收集，页面模板依赖的资源则需要放入 `assetsDirs` 或通过页面 `files` 显式声明。发布时，只有被识别到的页面和资源会进入静态产物。

自定义页面模板可以放心使用 `/assets/...` 引用 `assetsDirs` 中的全站静态资源。开发态会把这些目录注册到 `/assets`，发布时会复制到产物的 `assets/` 目录，并根据 `publish.routePrefix` 自动改写页面里的 `/assets/...` 引用。不要为了担心发布路径而把这类资源硬改成相对路径。

## 最小阅读路径

1. 先读 [基础使用](references/getting-started.md)
2. 需要理解配置字段时读 [配置说明](references/configuration.md)
3. 需要处理首页、演示页、导航关系时读 [自定义页面](references/custom-pages/)
4. 需要编写模板、helper 和常用样式时读 [页面开发](references/custom-pages/page-development.md)
5. 需要理解路径、资源、排序、行为边界时读 [规则与约束](references/rules.md)
6. 需要理解搜索入口和索引生成时读 [发布与部署](references/publishing.md)
7. 需要完整 Markdown 示例时读 [Markdown 完整示例](references/markdown.md)

## 任务索引

- 安装并初始化独立文档应用: [基础使用](references/getting-started.md)
- 理解配置规则和字段语义: [配置说明](references/configuration.md)
- 了解文档搜索的配置和行为: [配置说明](references/configuration.md)
- 替换首页、增加自定义页面: [自定义页面配置](references/custom-pages/)
  - 把自定义页面挂到文档树中: [自定义页面配置](references/custom-pages/)
  - 编写自定义页面模板、helper 和常用样式: [页面开发](references/custom-pages/page-development.md)
- 理解文档收集、space、文档侧边栏、导航规则: [规则与约束](references/rules.md)
- 编写 Markdown 并查看增强语法示例: [Markdown 完整示例](references/markdown.md)
- 生成静态站点并部署: [发布与部署](references/publishing.md)

## 技能规则

- 先建立文档树与导航模型，再调整页面和模板
- 顶部导航始终由 `navigator.buttons` 控制，不要把它和自定义页面配置混为一谈
- 页面能用配置描述时，优先使用 `DocsModule.pages` 这套自定义页面配置
- 遇到 Markdown 语法问题时，直接查看 [Markdown 完整示例](references/markdown.md)

## 使用图表

- 思维导图一律用 `mindmap`
- Mermaid 只用于极短、单路径、少节点的关系表达，且尽量竖向排版
- `draw.io` 用于需要精确阅读的规格图：架构图、流程图、时序图、服务关系图、带明确方向和节点名称的依赖图
- `Excalidraw` 用于只需大致理解的草图：概念草图、版式草稿、低保真示意、讨论稿、标注重点的视觉草图
- 切页是展示规范，不是额外拆页面；当同一主题需要同时方便人类和 agent 理解时，就用 `:::tabs` 把它拆成“图形 + 结构说明”两页
- 切页时第一页放人类更容易读的图，第二页放给 agent 看的线框图、结构摘要、节点关系表或步骤列表

````md
:::tabs 图表名称

== 图形
![架构图](./architecture.drawio){drawio}

== 结构说明
```text
模块 A -> 模块 B -> 模块 C
```text

:::
````

`:::tabs` 的基本写法是先写标题，再用 `==` 分别定义每个页签内容。
