---
title: xz Scene-Shell Review Findings 修复 - Plan
type: fix
date: 2026-07-17
artifact_contract: ce-unified-plan/v1
artifact_readiness: implementation-ready
product_contract_source: ce-plan-bootstrap
execution: code
---

# xz Scene-Shell Review Findings 修复 - Plan

## Goal Capsule

- **Objective:** 修复 ce-code-review 发现的 17 个 findings，按 3 个 triage group 优先级推进：确认流架构重构（P0/P1）→ 隐私脱敏修复（P1）→ 可靠性修复（P2）。目标是把 verdict 从 "Not ready" 提升到 "Ready to merge"。
- **Authority hierarchy:** AGENTS.md 硬规则优先（工具 JSON 形状 / system-context prompt 分离）；SCENE-PROTOCOL.md 声明式原则优先；set_security 先例模式优先（handler 直接执行而非依赖 Agent 重新调用）。
- **Stop conditions:** 全部 17 个 findings 修复且验证通过；或遇到架构性冲突无法用 set_security 先例模式解决时暂停报告。
- **Tail ownership:** 完成后由用户决定是否提交到 rebuild/on-upstream 分支。

---

## Product Contract

### Summary

ce-code-review 对 xz Scene-Shell 集成（6 个单元 U1-U6）做了 6-reviewer 审查，发现 17 个 findings（1 P0 / 4 P1 / 9 P2 / 3 P3），verdict "Not ready"。本计划修复全部 findings，聚焦三个缺陷群：确认流死循环（#1 P0）、隐私脱敏失效（#3 P1）、可靠性/死代码（#6-#10）。

### Problem Frame

确认流有设计级缺陷：execXzWithConfirm 无绕过标记，用户确认后 api.js 让 Agent 重新调用工具，但重新调用会再次匹配不可逆检测弹第二个确认卡——死循环。根因是偏离了 set_security 先例（后者在 confirm handler 里直接调用 setSecurity()）。脱敏功能只覆盖 title 字段，body 中的电话号码等 PII 明文泄露——隐私功能在临床场景失效。可靠性方面有 5 个独立的小缺陷（Promise.all 无 try/catch、TICK 无并发守卫、catch 吞错误、死代码、死按钮）。

### Requirements

**确认流架构重构（triage group 1，最高优先）**

- R1. 确认流改为 handler 直接执行模式（修复 #1 P0 死循环）：api.js confirm handler 直接调用 execXzCalendar/execXzNotes 执行 pending {tool,args}，不依赖 Agent 重新调用。同时解决 #13（cancel 无失败信号）和 #14（SYSTEM 消息未校验 pending.tool）。
- R2. 无界面客户端时不可逆写操作 fail-closed（修复 #2 P1）：改为返回硬错误而非静默执行。
- R3. checkXzIrreversible 反转为 allowlist（修复 #12 P2）：枚举已知 READ 命令，其余都需确认。
- R4. xz-confirm 加身份绑定/nonce（修复 #5 P1）：创建 surface 时签发 nonce，intent 必须回显。
- R5. 双击确认卡幂等守卫（修复 #15 P3）：读 pending 后 if(!pending.tool) return。

**隐私/脱敏修复（triage group 2）**

- R6. applyRedact 扩展到 body PII（修复 #3 P1）：脱敏电话/邮箱等 PII 模式，不止 title。
- R7. redactName 换 sha256（修复 #11 P2）：从 4 位十进制（10000 桶）改为 sha256 前 8 位 hex（~4 亿桶）。

**可靠性/错误处理修复（triage group 3）**

- R8. projectXzSurfaceForTurn 加 try/catch（修复 #6 P2）：.catch(()=>null) 防中断 runtimeInjection。
- R9. TICK 工作台刷新加 in-flight 守卫（修复 #7 P2）：防重叠 TICK 堆积 CLI 进程。
- R10. TICK 刷新 catch 加日志（修复 #8 P2）：从 .catch(()=>{}) 改为 .catch(e=>console.warn)。
- R11. 删除死代码 projectXzQuerySurface/sceneStoreSafeSet/getSceneStore（修复 #9 P2）。
- R12. open-settings 按钮加 handler 或移除（修复 #10 P2）。

**文档/一致性修复**

- R13. XZ_SCENE_GUIDE 更新说明 core 已自动投影（修复 #16 P3）。

### Scope Boundaries

**In scope**

- R1-R13 的全部修复。

**Deferred to Follow-Up Work**

- 命令分类跨 4 文件统一为 xz-commands.js registry（#17 P3）——架构级重构，单独 PR 更合适。
- 添加完整测试套件（#4 P1 testing gaps）——本计划在各修复单元含测试场景，但完整 test 文件创建作为 follow-up。

**Outside this product's identity**

- security-confirm 的同类 nonce/身份绑定问题（pre-existing，不在本次范围）。

---

## Planning Contract

Product Contract preservation: N/A（solo bootstrap，无上游 Product Contract）。

### Key Technical Decisions

- **KTD1. 确认流 handler 直接执行（用户决策确认）。** api.js confirm handler 直接调用 execXzCalendar/execXzNotes 执行 pending {tool,args}，把结果推回 Agent 队列。不依赖 Agent 重新调用——消除了死循环根因（#1），同时自然解决 #13（cancel 可返回明确失败信封）和 #14（不再有 SYSTEM 消息反射 pending.tool）。仿 set_security 的 setSecurity 直调模式。

- **KTD2. checkXzIrreversible 反转为 allowlist。** 从 denylist（3 条不可逆命令）改为 allowlist（枚举已知 READ 命令，其余默认确认）。临床写工具安全默认是确认一切非已知读命令。

- **KTD3. redactName 换 sha256。** 从 4 位十进制 DJB 哈希（10000 桶，~118 人碰撞）改为 crypto.createHash('sha256') 前 8 位 hex（~4 亿桶，碰撞概率可忽略）。

- **KTD4. TICK 工作台刷新加 in-flight 守卫。** 模块级 `_wbRefresh` 变量，若 in-flight 则返回同一 promise（合并并发刷新请求）。

### High-Level Technical Design

确认流重构后的数据流（KTD1 handler 直接执行）：

```mermaid
flowchart TB
    AGENT[Agent 调不可逆 xz 命令] --> EXEC[execXzWithConfirm]
    EXEC -->|irreversible + 有客户端| CARD[弹 choice+confront 卡<br/>pending 存 {tool, args, nonce}]
    EXEC -->|返回 pending_confirmation| AGENT
    USER[用户点确认] --> WS[scene intent: select xz-confirm-]
    WS --> HANDLER[api.js confirm handler]
    HANDLER -->|校验 nonce + pending.tool| DIRECT[直接调 execXzCalendar/execXzNotes<br/>执行 pending.args]
    DIRECT --> RESULT[结果推回 Agent 队列]
    RESULT --> AGENT2[Agent 看到结果继续]
    HANDLER -->|cancel| FAIL[返回 {ok:false, cancelled:true}]
```

关键区别：旧路径 handler 推 SYSTEM 消息让 Agent 重新调用 → 死循环。新路径 handler 直接执行 → 结果推回 → Agent 看到结果继续。

---

## Implementation Units

### U1. 确认流 handler 直接执行（#1 P0 + #13 + #14）

- **Goal:** api.js confirm handler 直接执行 pending {tool,args}，消除死循环根因。
- **Requirements:** R1
- **Dependencies:** 无
- **Files:** `src/api.js`（xz-confirm handler 分支），`src/capabilities/executor.js`（execXzWithConfirm 返回 message 更新）
- **Approach:**
  api.js 的 xz-confirm select handler，confirm 分支改为：校验 pending.tool ∈ {xz_calendar, xz_notes}（解决 #14）→ 直接调用 execXzCalendar/execXzNotes(pending.args) → 把结果作为 SYSTEM APP_SIGNAL 推回 Agent 队列（"工具已执行，结果如下"）。cancel 分支返回明确 {ok:false, status:'cancelled'} 信封（解决 #13）。不再推 "re-execute the tool now" 消息。
  executor.js 的 execXzWithConfirm 返回 message 更新为"确认卡已挂出，等待用户确认后系统自动执行"。
- **Patterns to follow:** `execSetSecurity`（executor.js:1123）——confirm handler 直接调用 setSecurity(updates) 而非让 Agent 重新调用。
- **Test scenarios:**
  - **confirm 后直接执行：** 模拟 select value=confirm + pending {tool:'xz_calendar', args:{command:'appointment create'}} → handler 调 execXzCalendar → 结果推回队列。不再有 "re-execute" 消息。
  - **cancel 返回失败信封：** 模拟 select value=cancel → 推回 {ok:false, status:'cancelled'} → Agent 收到明确失败。
  - **pending.tool 校验：** 模拟 pending.tool='malicious_tool' → handler 忽略不执行（#14 修复）。
  - **Covers R1, #1, #13, #14.**
- **Verification:** confirm 后工具执行一次不重复弹卡；cancel 返回明确失败；非法 tool 被拒。

### U2. 无界面 fail-closed + allowlist + nonce（#2 + #12 + #5 + #15）

- **Goal:** 四个确认流安全修复打包在一个单元。
- **Requirements:** R2, R3, R4, R5
- **Dependencies:** U1（handler 直接执行模式已就位）
- **Files:** `src/capabilities/executor.js`（execXzWithConfirm fail-closed + nonce 签发），`src/capabilities/tools/xz.js`（checkXzIrreversible 改 allowlist），`src/api.js`（nonce 校验 + 幂等守卫）
- **Approach:**
  - **#2 fail-closed：** execXzWithConfirm 的 `sceneClientCount()===0` 分支从 `return execFn` 改为 `return toolJson({ok:false, error:'无界面客户端，无法确认不可逆操作'})`。
  - **#12 allowlist：** checkXzIrreversible 从 XZ_IRREVERSIBLE_PATTERNS（denylist）改为 XZ_READ_COMMANDS allowlist（today/upcoming/overdue/list/summary/capabilities/help/context/doctor），非匹配返回 irreversible:true。
  - **#5 nonce：** execXzWithConfirm 创建 surface 时 data.pending 加 `nonce: crypto.randomUUID()`；api.js handler 校验 data.nonce === pending.nonce。
  - **#15 幂等：** handler 读 pending 后 `if(!pending.tool) return`（第二次 select surface 已 null）。
- **Patterns to follow:** `execSetSecurity` 的 sceneClientCount===0 硬错误模式（executor.js:1127-1129）。
- **Test scenarios:**
  - **fail-closed：** sceneClientCount()===0 + 不可逆命令 → 返回 {ok:false}，不执行。
  - **allowlist 覆盖：** today/list/summary → irreversible:false（直接执行）；appointment update/note compile → irreversible:true（需确认）。
  - **nonce 校验：** select intent 不带 nonce 或 nonce 不匹配 → handler 拒绝。
  - **幂等：** 第二次 select 同一 surface → if(!pending.tool) return，不推垃圾消息。
  - **Covers R2, R3, R4, R5, #2, #5, #12, #15.**
- **Verification:** 无界面不执行；未知写命令需确认；nonce 不匹配被拒；双击安全。

### U3. 脱敏 PII 扩展 + sha256（#3 + #11）

- **Goal:** applyRedact 扩展到 body PII；redactName 换 sha256。
- **Requirements:** R6, R7
- **Dependencies:** 无
- **Files:** `src/capabilities/tools/xz-scene.js`（applyRedact + redactName）
- **Approach:**
  - **#3 PII 扩展：** applyRedact 的 walk 函数，除了 title 还处理 body——用正则脱敏电话（`\d{11}` / `\d{3}-\d{4}-\d{4}`）和邮箱（`[\w.]+@[\w.]+`）。或在 builder 层标记敏感字段（phone/email），applyRedact 按标记脱敏。
  - **#11 sha256：** redactName 从 `((hash<<5)-hash)|0` + padStart(4) 改为 `crypto.createHash('sha256').update(key).digest('hex').slice(0,8)`。import crypto from 'crypto'。
- **Patterns to follow:** 现有 applyRedact 的递归 walk 结构（xz-scene.js applyRedact）。
- **Test scenarios:**
  - **body 电话脱敏：** redactMode=true + body 含 "13812345678" → body 中电话被脱敏。
  - **工作台 body 脱敏：** redactMode=true + wb-today body 含来访者名 → body 中姓名脱敏。
  - **sha256 碰撞：** 两个不同名字 → 不同代号（100 个测试名字无碰撞）。
  - **sha256 稳定性：** 同一名字多次 → 相同代号。
  - **Covers R6, R7, #3, #11.**
- **Verification:** redactMode=true 时 body 无明文电话/姓名；代号 8 位 hex 无碰撞。

### U4. 可靠性修复群（#6 + #7 + #8 + #9 + #10）

- **Goal:** 五个独立的可靠性/死代码修复。
- **Requirements:** R8, R9, R10, R11, R12
- **Dependencies:** 无（互不依赖）
- **Files:** `src/index.js`（#6 #7 #8 #10 #12），`src/capabilities/tools/xz-scene.js`（#9 删死代码），`src/api.js`（#10 open-settings handler）
- **Approach:**
  - **#6 try/catch：** index.js 的 xzSurfacePromise 调用点加 `.catch(()=>null)`。
  - **#7 in-flight 守卫：** index.js 加 `let _wbRefresh = null`，refreshWorkbenchIfPresent 开头 `if(_wbRefresh) return _wbRefresh`，finally 清 null。
  - **#8 catch 日志：** `.catch(()=>{})` 改为 `.catch(e=>console.warn('[xz-workbench] refresh failed', e?.message||e))`。
  - **#9 删死代码：** xz-scene.js 删除 projectXzQuerySurface + getSceneStore + sceneStoreSafeSet + _sceneStore。
  - **#10 open-settings：** api.js 加 `surface==='xz-cli-missing' && data.value==='open-settings'` 分支 emit 'open_settings' 事件；或移除 CTA 改纯文本。
  - **#12（R13）XZ_SCENE_GUIDE：** capability-registry.js 的 guide 末尾加"core 已自动投影 today/upcoming 等，Agent 不需重复投影"。
- **Test scenarios:**
  - **#6 Promise.all 隔离：** projectXzSurfaceForTurn throw → runtimeInjection 仍正常解析。
  - **#7 in-flight：** 并发两次 refreshWorkbenchIfPresent → 只执行一次 buildWorkbenchSurface。
  - **#9 死代码已删：** grep projectXzQuerySurface 无结果。
  - **#10 open-settings 可用：** 模拟 select xz-cli-missing open-settings → emit 事件（或纯文本无按钮）。
  - **Covers R8-R13, #6-#10, #16.**
- **Verification:** Promise.all 异常隔离；TICK 不堆积 CLI；死代码已删；catch 有日志。

---

## Verification Contract

| 验证项 | 方法 | 适用单元 | 通过标准 |
|---|---|---|---|
| 确认流 handler 直接执行 | 模拟 confirm → handler 直接执行不弹第二卡 | U1 | 执行一次不循环 |
| cancel 明确失败 | 模拟 cancel → {ok:false, cancelled:true} | U1 | Agent 收到失败信封 |
| 无界面 fail-closed | sceneClientCount=0 + 不可逆 → {ok:false} | U2 | 不执行 |
| allowlist 覆盖 | today=可逆 / note compile=不可逆 | U2 | 读命令直过写命令确认 |
| nonce 校验 | 无 nonce / 不匹配 → 拒绝 | U2 | 身份绑定生效 |
| body PII 脱敏 | redactMode=true + 电话 → 脱敏 | U3 | 无明文 PII |
| sha256 无碰撞 | 100 个名字 → 无重复代号 | U3 | 碰撞概率可忽略 |
| Promise.all 隔离 | projectXz throw → runtimeInjection 正常 | U4 | 异常隔离 |
| TICK in-flight | 并发 refresh → 单次执行 | U4 | 无堆积 |
| 死代码删除 | grep projectXzQuerySurface 无结果 | U4 | 已清理 |
| 语法检查 | node --check 全部改动文件 | U1-U4 | 全部通过 |

---

## Definition of Done

### 全局完成标准

- 全部 17 个 review findings 修复（1 P0 + 4 P1 + 9 P2 + 3 P3）。
- 全部改动文件语法检查通过。
- 确认流端到端可用（confirm→执行一次，cancel→明确失败）。
- 脱敏功能在 body 和 title 都生效。
- 无死代码、无死按钮、无吞错误的 catch。

### 按单元完成标准

- **U1：** confirm 后工具执行一次不循环；cancel 返回明确失败；非法 tool 被拒。
- **U2：** 无界面不执行；allowlist 覆盖；nonce 校验；双击安全。
- **U3：** body PII 脱敏；sha256 无碰撞。
- **U4：** Promise.all 隔离；TICK 不堆积；死代码删；catch 有日志；open-settings 可用。
