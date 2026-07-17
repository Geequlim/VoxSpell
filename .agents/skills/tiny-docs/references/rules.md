---
title: 规则与约束
order: 6
---

# 规则与约束

本文归纳 `tiny-docs` 在路径解析、文档组织、导航关系和资源收集上的核心规则。

## 路径解析

- `workspace` 相对配置文件目录解析
- `assetsDirs` 相对配置文件目录解析
- `pages.template`、`pages.layout` 中的 `./`、`../` 相对配置文件目录解析
- 页面模板中的非相对路径按 `workspace` 解析
- Markdown 文档中的本地链接和资源路径按当前文档所在目录解析
- Markdown 文档中的裸相对路径（例如 `references/getting-started.md`）视同 `./references/getting-started.md`
- `@docs/...` 表示内置模板别名

## 文档组织

文档树通常由目录约定自动生成：

- 目录根的 `README.md`、`readme.md`、`index.md` 优先作为入口页
- `docs/` 目录继续作为子文档树
- front matter 可以调整标题、描述、排序、折叠和隐藏行为

这套目录结构会直接影响文档路由、sidebar 和面包屑。

## 页面与导航的边界

- `pages` 负责页面注册与渲染
- `navigator.buttons` 负责顶部导航
- `sidebar` 负责把页面挂到文档树

不要把三者当作同一件事。

## Markdown 与页面的选择

优先使用 Markdown 的场景：

- 常规文档页
- 规范说明
- 架构设计
- 接口约定

优先使用 `pages` 的场景：

- 首页
- 演示页
- About、Blog 等展示页
- 需要模板数据、特殊布局或脚本的页面

## 资源规则

- Markdown 中的本地资源推荐使用相对路径或以 `/` 开头的项目路径
- 本地资源既支持 `./assets/demo.png`，也支持 `assets/demo.png` 这类裸相对路径
- 页面模板依赖的全站静态文件应放入 `assetsDirs`，并在模板中使用 `/assets/...` 引用
- `/assets/...` 在开发态直接可访问，发布时会复制到产物 `assets/` 并随 `publish.routePrefix` 自动改写
- 页面专属且未放入 `assetsDirs` 的附加文件，应通过页面 `files` 显式声明
- 发布时只会复制被系统识别到的资源
- 外部链接不会被纳入依赖收集

## 排序与显示

Markdown front matter 可用于控制侧边栏行为：

| 参数               | 作用                          | 默认行为                                                                 |
| ------------------ | ----------------------------- | ------------------------------------------------------------------------ |
| `title`            | 作为文档标题使用              | 按标题解析链路回退到 `sidebarTitle` > `title` > 首个 H1 > 文件名或目录名 |
| `sidebarTitle`     | 单独控制 sidebar 中显示的标题 | 未设置时回退到 `title`，再继续走标题解析链路                             |
| `description`      | 文档描述                      | 用于 sidebar 鼠标悬浮提示和 `llms.txt` 目录描述，未设置时不显示          |
| `order`            | 控制文档在同级中的排序        | 未设置时按 `0` 处理，数值越小越靠前                                      |
| `sidebarOrder`     | 单独控制 sidebar 中的排序     | 未设置时回退到 `order`，再按 `0` 处理                                    |
| `sidebarCollapsed` | 控制 sidebar 节点是否默认折叠 | 未设置时默认折叠，设置为 `false` 时默认展开                              |
| `sidebarHide`      | 控制 sidebar 节点是否隐藏     | 只有值为 `true` 时隐藏，其余值都显示                                     |

数值越小越靠前；同级内相同排序值保持当前遍历顺序。
