# Jarvis — 架构说明

> 版本基线:v2.1.393 · 更新日期:2026-06-13
>
> 这份文档面向**第一次接触Jarvis代码库**的工程师/合作方。读完之后,应该能在 30 分钟内:
> 1. 讲清楚Jarvis是什么、不是什么
> 2. 画出主循环的关键数据流
> 3. 知道改一个常见需求应该看哪些文件

---

## 1. 一句话定位

**Jarvis是一个"持续运行"的本地 AI Agent 框架**——它不是一个聊天程序,而是一个**常驻在用户桌面上、有主循环心跳、能记住、能行动、能观察自己**的本地数字生命体。

它跟传统聊天 Agent 的根本区别:**不是"用户说一句、Agent 答一句"**,而是:

- 有用户消息时优先处理用户
- 空闲时按节奏继续整理记忆、检查任务、刷新上下文
- 把运行状态实时推到 Brain UI,用户随时看得见它在干嘛

---

## 2. 设计哲学:ACI(预判注入)

Jarvis的核心创新不是某个具体能力,而是**把"信息采集"从推理时提前到消息到达时**——这叫 **ACI:Anticipatory Context Injection**。

传统 Agent 循环:

```
用户输入 → LLM 思考(我需要啥?)→ 调工具 A → 等结果 → LLM 思考(还要啥?)→ 调工具 B → ...
```

Jarvis的循环:

```
消息到达 ─┬─ 语义检索相关记忆 ────┐
          ├─ 模式匹配触发工具链预执行 ─┤
          └─ 读预热缓存(天气/新闻/日历) ─┘
                  ↓
            拼装 system prompt(1.5s 超时)
                  ↓
                LLM 开口
```

**关键约束**:只有"只读 + 幂等 + 低副作用 + 结果有时效"的工具才能进预判范围;写消息、发文件、调外部 API 绝不预判。预判错了最坏情况是多查一次,不会造成功能错误。

这个设计跟 2026 年学界的 **PASTE / B-PASTE / Speculative Actions** 在同一条赛道上,但Jarvis走**应用层**——不绑推理引擎,任何 OpenAI 兼容 API 都能用,定位差异化清晰。

---

## 3. 系统全景图

```
┌─────────────────────────────────────────────────────────────┐
│                    Electron 桌面壳                           │
│  ┌────────────┐  ┌────────────┐  ┌─────────────────────┐    │
│  │ main 进程  │  │ 预加载桥   │  │ 9 个 HTML 入口页     │    │
│  │(窗口/托盘)  │  │(contextIso)│  │(brain-ui/dashboard/ │    │
│  │            │  │            │  │ activation/turn-trace)│   │
│  └────────────┘  └────────────┘  └─────────────────────┘    │
│         │              ▲                   ▲                 │
│         ▼              │                   │                 │
│  ┌──────────────────────────────────────────────────────┐   │
│  │            本地后端(:3721 HTTP + WS + SSE)          │   │
│  │  src/api.js(路由)、src/events.js(事件总线)、         │   │
│  │  src/control.js(启停控制)                            │   │
│  └──────────────────────────────────────────────────────┘   │
└──────────────────────────┬──────────────────────────────────┘
                           │
                           ▼
┌──────────────────────────────────────────────────────────────┐
│              主循环 runTurn  src/index.js (L854-1584)         │
│                                                              │
│  ┌──────────┐    ┌──────────┐    ┌──────────┐    ┌────────┐ │
│  │ queue.js │ →  │ injector │ →  │ llm.js   │ →  │ tool   │ │
│  │ 优先级队  │    │  ACI 注入 │    │ 流式调用 │    │ 执行器 │ │
│  │ 抢占调度  │    │ 1.5s 超时 │    │ 工具解析 │    │ 沙箱   │ │
│  └──────────┘    └──────────┘    └──────────┘    └────────┘ │
│       ▲                                                    │
│       │                                                    │
│  ┌──────────┐    ┌──────────┐    ┌──────────┐              │
│  │ ticker.js│    │ runtime/ │    │ prefetch/│              │
│  │ 空闲心跳  │    │ 协议兜底 │    │ 预热缓存  │              │
│  └──────────┘    └──────────┘    └──────────┘              │
└──────────────┬───────────────────────────────────────────────┘
               │
       ┌───────┴────────┐
       ▼                ▼
┌─────────────┐   ┌──────────────────────────────────────────┐
│  持久化层    │   │             工具能力域                    │
│ src/db.js   │   │  src/capabilities/(12 个 schema 域 +     │
│ SQLite+FTS5 │   │   沙箱 + 工具市场)                       │
│ 1848 行 LoC │   │  通信/文件/Shell/网页/搜索/媒体/          │
│ 跑在 Electron│   │  记忆管理/UI 卡片/任务/提醒/本地委托     │
│ 主进程,不在  │   └──────────────────────────────────────────┘
│ 渲染进程    │                │
└─────────────┘                ▼
               ┌──────────────────────────────────────────┐
               │             集成域                        │
               │  src/social/(Discord/微信 wechat-ilink)    │
               │  src/voice/(云 ASR + TTS 多 provider)     │
               │  src/providers/(7+ LLM provider 配置)     │
               └──────────────────────────────────────────┘
                               │
                               ▼
               ┌──────────────────────────────────────────┐
               │             记忆域                        │
               │  src/memory/(22 个文件)                   │
               │   识别 / 注入 / 线程 / 焦点 / 召回         │
               │  src/context/(7 个文件)                   │
               │   运行时上下文 / 规则 / 关键词 / 片段       │
               │  src/embedding.js(bge-small-zh 向量化)    │
               └──────────────────────────────────────────┘
```

---

## 4. 主循环核心机制

### 4.1 消息调度(抢占式优先级队列)

`src/queue.js` + `src/index.js` 实现了**带抢占的优先级队列**:

- **USER 类消息**最高优先级,可**中断正在跑的 TICK 后台任务**(`shouldPreemptFor` + `AbortController`)
- **TICK 类消息**(空闲心跳)低优先级,但永不让位到"忘了跑"
- **TASK 类消息**(长任务续跑)中等优先级
- **EXPIRED 标记**自动丢弃已过期的提醒/续跑

### 4.2 焦点栈管理

不只是当前对话——Jarvis维护**多焦点帧**(`src/memory/threads.js`、`focus-frame.js`):

- 用户切换话题时,旧焦点入栈
- 新焦点激活,异步压缩旧焦点(给 LLM 总结 → 落库)
- 焦点恢复时从持久化里取回
- 焦点栈本身也持久化,应用重启不丢

### 4.3 协议兜底(协议韧性)

`src/runtime/tool-protocol.js` 实现了"协议级容错"——当 LLM 忘了调 `send_message` 工具就出文本回复时,系统**自动把回复内容兜底发出去**。这避免了"模型自言自语但用户没收到"的死局。

### 4.4 工具注入策略

不像某些 Agent 一次性塞 50+ 工具定义,Jarvis**每轮动态选工具**:

- 看当前消息类型(用户/TICK/任务续跑)
- 看最近行动日志(避免重复失败调用)
- 看 UI 信号(用户当前在看什么面板)
- 看 Provider 能力(某些模型不支持并行工具调用)

**结果**:token 浪费少、模型决策准、长上下文不爆。

---

## 5. 数据持久化

所有长期状态都在本地 SQLite(`src/db.js`,2605 行,跑在 Electron 主进程):

| 表族 | 用途 |
|---|---|
| conversations / participants / profile | 对话、用户画像 |
| memories + relations + FTS5 + visibility | 记忆节点、关系、全文检索、可见性 |
| actions + tool_results + turn_traces | 行动日志、工具结果、回合轨迹 |
| reminders + prefetch_tasks + prefetch_cache | 提醒、预取任务、预取缓存 |
| media + music + video | 媒体历史、音乐库、视频 |
| focus_frames + promises | 焦点栈、承诺状态 |
| social_credentials + local_config | 微信桥凭证、本地配置 |

**为什么主进程跑 SQLite 不在渲染进程**:Electron 安全最佳实践,渲染进程不能直接持有 native binding(`better-sqlite3` 需要 rebuild)。

---

## 6. 外部接口

### 6.1 桌面端(Electron)

- 单实例运行(锁文件)
- 托盘 + 自动更新状态指示
- 焦点横幅(`focus-banner.html`)— 用户切回应用时弹"刚才在干嘛"
- 日志落盘

### 6.2 本地 HTTP 服务(默认 :3721)

**普通端点**(本机即可):

| 方法 | 路径 | 说明 |
|---|---|---|
| POST | `/message` | 发一条用户消息到主循环 |
| GET | `/events` | SSE 事件流(状态/UI 卡片/语音) |
| GET | `/status` | 运行状态 |
| GET | `/quota` | 配额与限流 |
| GET/POST | `/settings/*` | 模型、温度、语音、TTS 等配置 |

**敏感端点**(默认仅本机,可通过 `API_TOKEN` 远程访问):

- `/activate`(首次激活)
- `/admin/{stop,start,restart,reset-memories,reset-files}`
- `/memories/:id` 的 PATCH/DELETE

**外部集成**:

- `POST /social/wechat-clawbot/qr` — 微信桥接二维码状态
- `POST /tts/stream` — 流式 TTS
- `GET /settings/voice` / `POST /settings/voice` — 语音识别配置

### 6.3 WebSocket

`/ws` 端点用于 Brain UI 双向通信——比 SSE 灵活,支持客户端主动操作(批准/拒绝卡片、切换面板)。

---

## 7. 工具能力地图

`src/capabilities/` 下 12 个 schema 域,每个域独立 `schema.json` + `tools/*.js` + `sandbox/*`:

| 域 | 典型工具 | 备注 |
|---|---|---|
| communication | `send_message`, `send_image`, `send_video` | 含微信桥 |
| filesystem | `read_file`, `write_file`, `list_dir`, `delete` | 沙箱内执行 |
| shell | `run_command`, `manage_long_running` | watchdog 保护 |
| web | `web_search`, `web_scrape`, `browser_read` | 多 provider fallback |
| media_gen | `tts`, `image_gen`, `video_gen` | matrix MCP 桥接 |
| memory | `search`, `recall`, `write`, `merge`, `demote` | 噪声驱逐策略 |
| reminders | `add`, `cancel`, `list` | 解析自然语言时间 |
| acui | `show_card`, `update_card`, `close_card` | 天气/自检/唤醒/图片 |
| tasks | `add`, `update`, `list` | 跨会话任务追踪 |
| local_agent | `delegate_subtask` | 委托本地子 Agent |
| review | `verify_work` | 复核已完成工作 |
| system | `self_check`, `resource_scan` | 系统级操作 |

**工具市场**允许用户装自定义工具——安装后持久化在沙箱,后续回合按需加入可用列表。

---

## 8. 多 LLM Provider 支持

通过 OpenAI 兼容协议接入,内置 7+ provider 配置:

- **DeepSeek** — 中文任务主力,性价比高
- **MiniMax** — 主用,中文理解强
- **OpenAI / Anthropic** — 国际厂商
- **Qwen / Moonshot / Zhipu / MiMo** — 国内多家可选
- **自定义** — 用户填 base URL + key

**Provider 隔离**:`src/providers/*.js` 独立配置,模型选择、温度、API key 都按 provider 分文件;切换 provider 不需要重启。

---

## 9. 关键代码路径速查

> 给刚接手项目的工程师——"我有个需求该看哪里":

| 我想改… | 看这些文件 |
|---|---|
| 用户消息处理逻辑 | `src/index.js` (runTurn L854-1584) |
| 工具选择策略 | `src/capabilities/schemas.js` + `src/runtime/tool-protocol.js` |
| 记忆检索逻辑 | `src/memory/injector.js` + `src/embedding.js` |
| 上下文组装 | `src/context/` + `src/prompt.js` |
| 队列/抢占 | `src/queue.js` + `src/ticker.js` |
| 主循环心跳 | `src/ticker.js` |
| 协议兜底 | `src/runtime/tool-protocol.js` |
| UI 卡片渲染 | `src/ui/brain-ui/` + `src/capabilities/ui-components.json` |
| 社交消息路由 | `src/social/` |
| 语音输入输出 | `src/voice/` |
| 数据库 schema | `src/db.js` |
| HTTP API | `src/api.js` |

---

## 10. 团队:6 个 Rein 的职责边界

这是项目刚搭好的 agent 团队,改东西之前先认领任务:

| Rein | 一句话 |
|---|---|
| `loop-runtime-expert` | 主循环 + queue + db.js facade + events |
| `memory-context-expert` | 记忆 + 上下文 + prompt + LLM 调用 |
| `capabilities-expert` | 工具 schema + 执行器 + 沙箱 + 市场 |
| `integrations-expert` | 社交连接 + 语音 + providers + Electron 壳 |
| `ui-electron-expert` | Brain UI 前端 + 9 个 HTML 入口 |
| `quality-gate` | 测试 + smoke + 依赖审计 + 密钥扫描(合并 developer + tester + code-reviewer) |

每个 rein 都有**可度量的 stop condition**(比如 `smoke:tools 6/6`、`npm audit --audit-level=high no new high`),不是"用户满意"这种虚话。

跨 rein 协调:
- **DB schema 变更** → `loop-runtime-expert` 主导,所有受影响的 rein 签字
- **工具 schema 新增** → `capabilities-expert` 主导,`quality-gate` 加 smoke
- **ACUI 新卡片** → catalog 归 `capabilities-expert`,渲染归 `ui-electron-expert`,投递归 `loop-runtime-expert`
- **密钥/凭证变更** → 任何改动都过 `quality-gate` 复审

---

## 11. 安全姿态

- **本机优先**:默认只 `127.0.0.1`,远程访问需要 `API_TOKEN` 或显式开启 LAN
- **上下文隔离**:Electron 渲染进程不直连 SQLite / Node API,所有 native 能力走 preload bridge
- **危险操作进协议流**:写文件、执行 shell、删除数据都进确认/策略流程(`src/runtime/tool-protocol.js`)
- **明文密钥问题**:`config.json` 里目前有明文火山引擎 API key(独立工单,尚未修)
- **依赖漏洞**:11 个 high-severity npm CVE 待审计(独立工单,尚未做)

---

## 12. 版本路线(从 CHANGES.md 反推)

- **Phase 1-2(基础)**:对话/记忆/工具基本闭环
- **Phase 3(上下文升级)**:彻底重做上下文管理架构,引入异步压缩、焦点栈
- **Phase 4(协议兜底)**:工具协议层,自动处理 LLM 忘调工具
- **Phase 5(语音修复)**:长句子 TTS 不再重复
- **Phase 6(社交+多媒体)**:微信发图/视频/附件、世界杯模式、主题优化

当前 v2.1.393 正在做的方向:更深的记忆能力 + 编程 skill 内化 + 上下文管理持续打磨。

---

## 13. 一句话总结

> **Jarvis = 一个有主循环心跳、按节奏整理记忆和上下文、用 ACI 预判注入给模型"喂好饭"、跑在用户本机桌面上的开源数字生命体框架。**

它想做的不是"更强的一次性 Agent",而是**更持久的、像生命一样的本地伴读 AI**。

---

## 附录:文件统计

- `src/index.js` 1848 行(含 runTurn L854-1584)
- `src/db.js` 2605 行(SQLite facade,所有 schema 在此)
- `src/llm.js` 1383 行(流式调用 + 工具解析)
- 合计 `src/` 88 个文件,约 2 万行 LoC
- 37 个测试文件(`test-*.js` 36 + `test-*.mjs` 1)
- 9 个 HTML 入口页
- Electron 33 + Node + better-sqlite3 + OpenAI 兼容 LLM + WS + d3

---

*维护:Jarvis 项目组 + 6 个 agent rein(见 `.harness/` 目录)*
