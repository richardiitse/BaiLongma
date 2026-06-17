// CLI 白名单纯逻辑单测（mergeWhitelist / isAllowed / 默认 gbrain / 可配置扩展）。
// 只测零依赖纯函数，保证纯 node 可跑。见 .claude/plans/cli-tool-invocation.plan.md M1。
import assert from 'node:assert/strict'
import {
  DEFAULT_WHITELIST, mergeWhitelist, isAllowed, listAllowedClis, isCliAllowed,
} from './cli-whitelist.js'

let passed = 0
const ok = n => { passed += 1; console.log('  ✓', n) }

console.log('test-cli-whitelist: 白名单纯逻辑\n')

// --- 默认白名单含 gbrain ---
{
  assert.ok(DEFAULT_WHITELIST.some(e => e.name === 'gbrain'))
  assert.ok(DEFAULT_WHITELIST.find(e => e.name === 'gbrain').path, 'gbrain 应有 path（避开 Electron PATH 问题）')
  ok('默认白名单含 gbrain 且带绝对 path')
}

// --- isAllowed：gbrain 放行，危险/未列名拒绝 ---
{
  const w = DEFAULT_WHITELIST
  assert.equal(isAllowed('gbrain', w), true)
  assert.equal(isAllowed('curl', w), false)
  assert.equal(isAllowed('rm', w), false)
  assert.equal(isAllowed('', w), false)
  assert.equal(isAllowed(undefined, w), false)
  ok('isAllowed：gbrain 放行；curl/rm/空 拒绝')
}

// --- mergeWhitelist：空/非法 → default；configured 合并（default ∪ configured）---
{
  assert.equal(mergeWhitelist(null), DEFAULT_WHITELIST)
  assert.equal(mergeWhitelist([]), DEFAULT_WHITELIST)
  assert.equal(mergeWhitelist(undefined), DEFAULT_WHITELIST)

  // 加一个 CLI：default(gbrain) + extra 都在
  const merged = mergeWhitelist([{ name: 'extra_cli', description: 'd' }])
  assert.equal(merged.some(e => e.name === 'gbrain'), true)
  assert.equal(merged.some(e => e.name === 'extra_cli'), true)

  // configured 同名覆盖 default（如改 gbrain 的 description/path）
  const over = mergeWhitelist([{ name: 'gbrain', description: '覆盖', path: '/x/gbrain' }])
  const gb = over.find(e => e.name === 'gbrain')
  assert.equal(gb.description, '覆盖')
  assert.equal(gb.path, '/x/gbrain')
  assert.equal(over.filter(e => e.name === 'gbrain').length, 1, '同名不重复')
  ok('mergeWhitelist：空→default；加 CLI 合并；同名 configured 覆盖且不重复')
}

// --- 不改代码即可扩展（M2 验证形态）：configured 加 CLI 后 isAllowed 放行 ---
{
  const w = mergeWhitelist([{ name: 'rg', description: 'ripgrep' }])
  assert.equal(isAllowed('rg', w), true)
  assert.equal(isAllowed('gbrain', w), true)   // default 仍在
  assert.equal(isAllowed('curl', w), false)
  ok('可配置扩展：加 rg 后 rg 放行、gbrain 仍在、curl 仍拒')
}

console.log(`\ntest-cli-whitelist: ${passed} passed`)
