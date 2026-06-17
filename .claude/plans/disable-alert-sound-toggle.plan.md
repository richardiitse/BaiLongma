# Plan: 回复提示音关闭开关

**Source PRD**: `.claude/prds/disable-alert-sound-toggle.prd.md`
**Selected Milestone**: #1 — 提示音开关可用
**Complexity**: Small（一处闸门 + 一个开关 + 一个小单测）

## Summary
在 `chat.js` 的 `playJarvisAlert()` 顶部加一个 localStorage 闸门（key `jarvis.alertSound`，默认开、`'0'`=关），关时直接 return——**一处改动同时覆盖 `beginLiveJarvisMsg` 与 `appendMessage` 两个调用点**。再在设置面板加一个"关闭提示音"开关读写该 key。持久化用 localStorage，复用 `tts-fx.js` 先例（纯前端、最小改动、刷新即生效，无需后端/config.json）。

## Patterns to Mirror
| Category | Source | Pattern |
|---|---|---|
| Storage key 命名 | `tts-fx.js:17` `FX_STORAGE_KEY='jarvis.ttsfx.v2'` | `jarvis.<feature>` 命名空间 |
| 读/写 + 布尔开关 | `tts-fx.js:109,132,139` `UNLOCK_KEY`：`getItem(…) === '1'` / `setItem(UNLOCK_KEY,'1')` + try/catch | absent/`'1'`=开，`'0'`=关 |
| Gate 位置 | `chat.js:111` `playJarvisAlert`（`initChat` 闭包内） | 函数顶部 early-return，自动覆盖两调用点（L190/L479） |
| Tests | `src/test-tool-protocol.js` | `import` + `node:assert/strict` + `console.log('passed')`；纯 `node` |

## Files to Change
| File | Action | Why |
|---|---|---|
| `src/ui/brain-ui/chat.js` | UPDATE | 抽 `isAlertEnabled()` 谓词 + `playJarvisAlert` 顶部闸门 |
| 设置面板（待定位，疑 `voice-panel.js` / 配置 tab） | UPDATE | 加"关闭提示音"开关，读写 `jarvis.alertSound` |
| `src/test-alert-sound.js` | CREATE | 测 `isAlertEnabled` 默认开 / `'0'`=关 |

## Tasks

### Task 1: playJarvisAlert 加闸门
- **Action**: `chat.js` 抽 `function isAlertEnabled()`（读 `localStorage.getItem('jarvis.alertSound')`，默认 `true`，`'0'`→`false`，try/catch 包裹）；`playJarvisAlert` 顶部 `if (!isAlertEnabled()) return;`。
- **Mirror**: `tts-fx.js` `UNLOCK_KEY` 的 getItem/setItem + try/catch。
- **Validate**: `node src/test-alert-sound.js`。

### Task 2: 设置面板加开关
- **Action**: 先 grep 定位设置面板（voice/tts 设置 UI，疑 `voice-panel.js` 或配置 tab），加一个"关闭提示音"开关：初始化时读 `isAlertEnabled()` 同步状态，change 时 `localStorage.setItem('jarvis.alertSound', checked ? '1' : '0')`。镜像 tts-fx 控件的读写绑定风格。
- **Mirror**: tts-fx 面板控件的"读初值 → 绑 change → 写 localStorage"。
- **Validate**: `npm start` → 设置切开关 → 发消息触发 Jarvis 回复 → 关时不响 / 开时响；reload 保持。

### Task 3: 单测 + 冒烟
- **Action**: `test-alert-sound.js` 测 `isAlertEnabled`（默认开、`'0'`=关、异常容错）；运行时冒烟如 Task 2。
- **Validate**: `node src/test-alert-sound.js`；手动冒烟。

## Validation
```bash
node src/test-alert-sound.js        # 闸门谓词逻辑
node src/test-config-upgrade.js     # config 加载未受影响
# 运行时（人工）：npm start → 设置切"关闭提示音" → 发消息 → 关时不响、开时响；reload 保持
```

## Risks
| Risk | Likelihood | Mitigation |
|---|---|---|
| 设置面板位置定位错 → 开关加错文件 | 中 | Task 2 先 grep 定位 voice/tts 设置 UI 再动手 |
| `playJarvisAlert` 在闭包内、`isAlertEnabled` 抽出后可测性 | 低 | 谓词做成无副作用纯函数（只读 localStorage）便于单测 |
| localStorage 在 Electron 渲染进程 `file://` 下可用 | 低 | `tts-fx.js` 已用同机制验证可行 |
| 闸门默认值设反 → 改变现状 | 低 | 显式默认 `true` + 单测断言 |

## Acceptance
- [ ] `playJarvisAlert` 关时不响、开时响（两调用点 L190/L479 都覆盖）
- [ ] 默认开（未设 localStorage 时仍响，现状不变）
- [ ] 设置刷新 / 重启后开关状态保持
- [ ] `test-alert-sound` + `test-config-upgrade` 通过
- [ ] 复用 `tts-fx.js` localStorage 模式，未造新机制
