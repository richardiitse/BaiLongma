# Plan: 项目品牌重命名（Milestone #1 — 用户可见文案 白龙马→Jarvis）

**Source PRD**: `.claude/prds/rebrand-to-jarvis.prd.md`
**Selected Milestone**: #1 — 用户可见文案改名（中文「白龙马」→ `Jarvis`）
**Complexity**: Medium（~30 处编辑、16 个文件，机械替换为主；风险点 = 正则匹配器 + test fixture + prompt 同句跨 token）

## Summary
把项目里所有**用户可见的中文「白龙马」**统一替换为 `Jarvis`，覆盖 UI 文案、agent 自我介绍、自知识/FAQ 文档、项目文档、安装器对话框。形式约定：显示串 = `Jarvis`。拉丁 `Bailongma`/`bailongma` 标识与 `profile/infer.js` 匹配器逻辑**留给 Milestone #2**，本里程碑不碰——唯一的例外是 `prompt.js:285` 一句话里 `BaiLongma` 与 `白龙马` 同现，为避免半改矛盾，该句显示层一并改。非盲替：逐处已审查分类（见下）。

## Patterns to Mirror
| Category | Source | Pattern |
|---|---|---|
| 显示形式 | PRD 约定 | 用户可见串 → `Jarvis`（首字母大写）；标识/包名留给 M2 用 `jarvis` |
| 自知识注入 | `src/docs/self-knowledge.js` | `content`/`summary`/`title` 字段是 agent 自述文档，按显示串改 |
| 主题匹配器 | `src/docs/self-knowledge.js:307` | 是正则 `/白龙马.*代码/`，非显示——改为 `/Jarvis.*代码/`，老名查询不再命中（重品牌可接受） |
| 测试 fixture | `src/test-verbatim.js:11` | 是测试输入样本，**先读确认断言不依赖该确切串**再改 |
| 安装器 | `build/installer.nsh` | NSIS `MessageBox` 文案，用户安装/卸载时可见；改源，重新打包生效 |

## Files to Change（M1 scope — 中文「白龙马」）

| File | Action | Why |
|---|---|---|
| `src/ui/brain-ui/wechat-popup.js` | UPDATE | 微信提示文案 ×3（L40/90/94），用户可见 |
| `src/ui/brain-ui/doc.js` | UPDATE | UI tab label `关于白龙马`（L503）+ 注释（L499） |
| `src/ui/brain-ui/styles.css` | UPDATE | 注释（L3692，一致性） |
| `src/prompt.js` | UPDATE | agent 自我介绍 L285（`白龙马`+`BaiLongma` 同句，显示层一并改） |
| `src/docs/self-knowledge.js` | UPDATE | 自述文档多处 + L307 正则匹配器 |
| `src/docs/config-faq.js` | UPDATE | FAQ 文案 L27 |
| `src/docs/voice-config-faq.js` | UPDATE | 语音 FAQ 文案 L23/100/245 |
| `src/docs/auto-catalog.js` | UPDATE | 注释 L3（一致性） |
| `src/memory/tool-router.js` | UPDATE | 注释 L33/403（一致性） |
| `src/test-verbatim.js` | UPDATE（先验证） | fixture L11 |
| `ARCHITECTURE.md` | UPDATE | 架构文档多处（L1/5/6/14/26/34/48/132/145/318） |
| `AGENTS.md` | UPDATE | 项目指南 L1/10 |
| `.harness/agent.md` | UPDATE | rein 描述 L3 |
| `agent-message-flow.html` | UPDATE | 流程图标题 L6/166 |
| `build/installer.nsh` | UPDATE | 安装器对话框 L79/356（用户可见） |
| `.claude/CLAUDE.md` | UPDATE | 项目约定文档标题（我此前所写） |

**明确留给 Milestone #2（本里程碑不动）**
- `src/profile/infer.js:125` — 语义匹配器 `/白龙马/.test` + `projects.push('Bailongma')`，非显示，随拉丁标识决策一起处理。
- 所有拉丁 `Bailongma`/`bailongma`（package name / appId / productName / 仓库 / 其余拉丁落点）。

## Tasks

### Task 1: UI 可见文案
- **Action**: 改 `wechat-popup.js`（3 处微信提示）、`doc.js`（tab label `关于白龙马`→`关于 Jarvis` + 注释）、`styles.css` 注释。
- **Mirror**: 显示串 → `Jarvis`。
- **Validate**: 启动后微信绑定弹窗 / 文档 tab 显示 Jarvis。

### Task 2: agent 自我介绍 + 自知识/FAQ 文档
- **Action**: 
  - `prompt.js:285` → `You run as the Jarvis desktop app, currently version ${appVersion}...`（同句 BaiLongma 一并去掉）。
  - `src/docs/self-knowledge.js` 全部 `白龙马`→`Jarvis`；**L307 正则** `/白龙马.*代码/`→`/Jarvis.*代码/`。
  - `config-faq.js`、`voice-config-faq.js`、`auto-catalog.js`(注释)、`tool-router.js`(注释)。
- **Mirror**: 自述文档字段按显示串改；正则匹配器同步换名。
- **Validate**: `node src/test-config-upgrade.js`；启动后问"你的架构"看自知识输出含 Jarvis。

### Task 3: 项目文档 + 安装器 + CLAUDE.md
- **Action**: `ARCHITECTURE.md`、`AGENTS.md`、`.harness/agent.md`、`agent-message-flow.html`、`build/installer.nsh`（L79/356 对话框）、`.claude/CLAUDE.md`。
- **Mirror**: 显示串 → `Jarvis`。
- **Validate**: 文档 grep 无白龙马；安装器文案需重新打包（M3/发版）才生效。

### Task 4: test-verbatim fixture（先验证后改）
- **Action**: 先读 `src/test-verbatim.js`，确认其断言**不依赖** `original` 串里的「白龙马」字面（多半只测 verbatim 处理行为）。若安全 → 改 `白龙马`→`Jarvis`；若断言依赖 → 连同断言一起改或保留并记录。
- **Validate**: `node src/test-verbatim.js` 通过。

### Task 5: 残留归零校验
- **Action**: grep `白龙马`，期望仅剩 `.claude/prds/*`（历史 PRD 记录）与 `profile/infer.js`（M2 待办）。
- **Validate**: 见 Validation。

## Validation
```bash
# M1 残留校验：白龙马 只允许出现在 PRD 历史 + profile/infer.js(M2 待办)
grep -rn "白龙马" . \
  --exclude-dir=node_modules --exclude-dir=.git --exclude-dir=dist \
  --exclude-dir=.opencode --exclude-dir=.codegraph --exclude-dir=.mavis \
  | grep -vE "/\.claude/prds/|profile/infer\.js"
# ↑ 期望输出为空

node src/test-verbatim.js        # fixture 改动未破坏
node src/test-config-upgrade.js  # config 加载未破坏
# 启动冒烟（人工）：npm start → 微信提示 / 关于页 / 自我介绍 = Jarvis
```

## Risks
| Risk | Likelihood | Mitigation |
|---|---|---|
| `self-knowledge.js:307` 正则改后，老用户问"白龙马的代码"不再命中主题 | 中 | 重品牌可接受；新名 `Jarvis` 命中 |
| `prompt.js:285` 同句含 BaiLongma（M2 token），M1 提前改显示层 | 低 | 标记为合理的跨 milestone 触碰，避免半改矛盾 |
| `test-verbatim` fixture 断言依赖该字面串 | 低 | Task 4 先读确认再改 |
| `installer.nsh` 改源后未重新打包 → 老安装器仍显示白龙马 | 中 | 源改对即满足 M1；重新打包属 M3/发版 |
| 漏改某处 → grep 不归零 | 中 | Task 5 归零校验 |

## Acceptance
- [ ] 用户可见 UI / prompt / 自知识 / FAQ / 项目文档 / 安装器 / CLAUDE.md 的 `白龙马` → `Jarvis`
- [ ] `prompt.js:285` 自我介绍无 BaiLongma/白龙马 残留（显示层）
- [ ] `profile/infer.js` 与所有拉丁 `Bailongma` 明确留给 M2（本里程碑不动）
- [ ] `白龙马` grep 归零（仅剩 `.claude/prds/` 历史 + `profile/infer.js`）
- [ ] `test-verbatim` + `test-config-upgrade` 通过
- [ ] 显示形式统一为 `Jarvis`（首字母大写），未误用全大写/全小写
