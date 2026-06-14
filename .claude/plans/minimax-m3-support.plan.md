# Plan: MiniMax-M3 模型支持

**Source PRD**: `.claude/prds/minimax-m3-support.prd.md`
**Selected Milestone**: #1 — M3 可选并可用
**Complexity**: Small（单文件、一处数组追加）

## Summary
在 `src/config.js` 的 `MINIMAX_MODELS` 数组里追加一条 `MiniMax-M3`（非默认、仅可选）。由于该数组经 `PROVIDER_CONFIG.minimax.models` 直接喂给模型选择器，且 `POST /settings/model` 切模型无需重输 key，**新增条目会自动出现在设置里并可切换**，零额外接线。默认模型保持 `MiniMax-M2.7` 不变。MiniMax-M3 的 API model id 经 research 确认为 `MiniMax-M3`（与现有 `MiniMax-M2.7`/`MiniMax-M1` 同命名惯例；1M 上下文，主打 agentic reasoning + tool use + coding，正中 PRD 痛点）。

## Patterns to Mirror
| Category | Source | Pattern |
|---|---|---|
| Naming | `src/config.js:44-55` | `MINIMAX_MODELS = [{ id, label, deprecated }]`；`id` 与 `label` 同名（如 `MiniMax-M2.7`） |
| Default | `src/config.js:14` | `DEFAULT_MINIMAX_MODEL` 保持 `'MiniMax-M2.7'`（M3 非默认，不改） |
| Data access | `src/config.js` PROVIDER_CONFIG.minimax | `models: MINIMAX_MODELS` 直接喂 picker——新增条目自动可见，无需别处登记 |
| Model switch | `src/api.js:950` `POST /settings/model` | 切模型不重输 key；选 M3 即生效 |
| Tests | `src/test-tool-protocol.js` | 最简模式：`import` + `node:assert/strict` + `console.log('... passed')`；纯 `node` 跑 |

## Files to Change
| File | Action | Why |
|---|---|---|
| `src/config.js` | UPDATE | 在 `MINIMAX_MODELS`（L44-55）追加 M3 条目 |
| `src/test-minimax-models.js` | CREATE（可选） | 最小单测：断言 M3 条目存在、`deprecated:false`、默认未变 |

## Tasks

### Task 1: 追加 MiniMax-M3 条目
- **Action**: 在 `src/config.js` 的 `MINIMAX_MODELS` 数组（L44-55）追加：
  ```js
  {
    id: 'MiniMax-M3',
    label: 'MiniMax-M3',
    deprecated: false,
  },
  ```
  建议放在 `MiniMax-M2.7` 之后（最新主力靠前，但默认仍是 M2.7，位置不影响默认）。
- **Mirror**: 现有条目结构 `{ id, label, deprecated }`。
- **Validate**: `node src/test-config-upgrade.js`（确认 config 加载未被破坏）。

### Task 2（可选）: 最小单测
- **Action**: 新建 `src/test-minimax-models.js`，镜像 `test-tool-protocol.js` 模式，断言：
  - `MINIMAX_MODELS.some(m => m.id === 'MiniMax-M3' && m.deprecated === false)` 为真；
  - `DEFAULT_MINIMAX_MODEL === 'MiniMax-M2.7'`（默认未变）。
- **Mirror**: `src/test-tool-protocol.js`（import + `node:assert/strict` + `console.log('passed')`）。
- **Validate**: `node src/test-minimax-models.js`。

### Task 3: 运行时冒烟（决定 milestone #1 完成）
- **Action**: `npm start` → 设置里 MiniMax provider 选 **MiniMax-M3** → 发一条**需要工具调用**的消息 → 确认正常返回且工具被调用。
- **作用**：这一步同时验证两个 PRD open question —— ① `MiniMax-M3` id 是否被端点接受；② 是否在 `api.minimax.chat/v1` 可用。

## Validation
```bash
node src/test-config-upgrade.js      # config 加载未被破坏（必跑）
node src/test-minimax-models.js      # （若加了测试）模型条目存在、默认未变
# 运行时（人工）：npm start → 设置选 MiniMax-M3 → 发一条工具调用消息冒烟
```

## Risks
| Risk | Likelihood | Mitigation |
|---|---|---|
| `MiniMax-M3` id 不被 `api.minimax.chat/v1`（国内端点）接受 | 中 | Task 3 冒烟即暴露；若 404/model-not-found，查 `platform.minimax.io` list-models 确认确切 id 串 |
| M3 仅在国际端点 `platform.minimax.io` 上线、国内端点暂无 | 低-中 | 冒烟暴露；若如此，超出 MVP（需单独 baseURL），回落 PRD 重新决策——**不改代码**，改 config.json 的 baseURL 走 custom 机制即可 |
| 误改默认模型 | 低 | `DEFAULT_MINIMAX_MODEL` 显式保持 `'MiniMax-M2.7'`；可选单测断言 |

## Acceptance
- [ ] `MINIMAX_MODELS` 含 `MiniMax-M3` 条目（`deprecated: false`）
- [ ] `DEFAULT_MINIMAX_MODEL` 仍为 `'MiniMax-M2.7'`（默认未变）
- [ ] `node src/test-config-upgrade.js` 通过（config 加载未破坏）
- [ ] 运行时可选到 M3 并成功发消息（冒烟通过）—— 同时关闭 PRD 两个 open question
- [ ] 模式照搬现有 `{id,label,deprecated}` 结构，未自创新约定
