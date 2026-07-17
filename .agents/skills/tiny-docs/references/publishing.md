---
title: 发布与部署
order: 5
---

# 发布与部署

`tiny-docs` 支持将文档站静态化后部署到任意静态托管环境。

## 本地发布

```bash
yarn tiny-docs publish dist/docs
```

如果需要指定配置文件：

```bash
yarn tiny-docs publish dist/docs -c configs.yaml
```

## 发布流程

执行 `publish` 时会自动完成：

1. 切换到发布环境
2. 重写 `routePrefix` 与 `staticRoutePrefix`
3. 复制文档静态资源
4. 复制 Markdown 依赖资源
5. 生成 Markdown 页面
6. 生成 `DocsModule.pages` 注册页面
7. 生成运行时代码注册的页面
8. 如果启用了 `publish.llm.enabled`，生成 `llms.txt` 与 `llms/` Markdown 镜像
9. 如果启用了 `search`，生成 Pagefind 搜索索引

## 典型配置

```yaml
DocsModule:
  publish:
    routePrefix: /
    llm:
      enabled: true
```

如果文档站部署在子路径，例如项目站点：

```yaml
DocsModule:
  publish:
    routePrefix: /my-project
    llm:
      enabled: true
```

## 公开路径映射

发布时会沿用 `spaces[].dirs[].linkPrefix` 声明的公开路径映射。它不只是开发态 sidebar 的链接前缀，而是文档站页面、正文链接、搜索索引、LLM Markdown 镜像和文档依赖静态资源共同使用的 canonical 路径。

例如：

```yaml
DocsModule:
  publish:
    routePrefix: /LayaAir-Docs
  spaces:
    - title: Agent
      dirs:
        - path: .agents/skills
          title: skills
          linkPrefix: agents/skills
```

发布后会输出到公开路径：

- HTML 页面：`/LayaAir-Docs/agents/skills/...`
- LLM 镜像：`llms/agents/skills/...`
- 静态资源：`static/agents/skills/...`

当源码目录包含 `.agents` 这类点号开头目录时，推荐配置 `linkPrefix`，避免静态托管平台对隐藏路径支持不一致，也避免搜索结果或 LLM 链接暴露坏路径。

## LLM Markdown 镜像

启用 `publish.llm.enabled` 后，发布目录会额外生成一套面向 Agent / LLM 的 Markdown 入口：

- 发布根目录输出 `llms.txt`
- 默认将 Markdown 文档镜像到 `llms/` 目录
- 文档间链接会按公开路径重写到 `llms/` 下对应的 `.md` 文件
- 本地静态资源链接会按公开路径重写到发布目录中的 `static/` 资源

例如发布到 `dist/docs/tiny-docs` 时，默认会得到：

- `dist/docs/tiny-docs/llms.txt`
- `dist/docs/tiny-docs/llms/README.md`
- `dist/docs/tiny-docs/llms/packages/foundation/modules/docs/README.md`

这套产物不会替代原有 HTML 页面，只是附加一套机器可读入口。

## 部署前检查

- 确认 `workspace` 指向正确的项目根目录
- 确认 `assetsDirs` 覆盖了模板和页面依赖的静态资源
- 确认顶部导航中的页面在发布时都能生成
- 确认页面模板依赖的额外文件已通过 `files` 或资源目录纳入发布范围
- 如果启用了搜索，确认发布产物中包含 `pagefind` 索引目录
