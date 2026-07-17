import http from 'http'
import fs from 'fs'
import crypto from 'crypto'
import { WebSocketServer } from 'ws'
import { handleSceneConnection, setSceneIntentHandler } from './scene/scene-server.js'
import { sceneStore } from './scene/scene-store.js'
import { pushMessage } from './inbound-message.js'
import { getConfig, insertUISignal } from './db.js'
import { emitEvent, setStickyEvent } from './events.js'
import { getNetworkConfig, getSecurity, setSecurity, getVoiceRuntimeConfig, getVoiceProviderConfigRecord, normalizeVoiceProvider } from './config.js'
import { paths } from './paths.js'
import { createCloudASRSession } from './voice/cloud-asr.js'
import { jsonResponse } from './api/utils.js'
import { handleActivationRoutes } from './api/routes/activation.js'
import { handleAdminRoutes } from './api/routes/admin.js'
import { handleEmbeddingRoutes } from './api/routes/embedding.js'
import { handleEventRoutes } from './api/routes/events.js'
import { handleMediaRoutes } from './api/routes/media.js'
import { handleMapRoutes } from './api/routes/map.js'
import { handleMemoryRoutes } from './api/routes/memory.js'
import { handleMessageRoutes } from './api/routes/message.js'
import { handlePanelRoutes } from './api/routes/panels.js'
import { handleSettingsRoutes } from './api/routes/settings.js'
import { handleSocialRoutes } from './api/routes/social.js'
import { handleStaticRoutes } from './api/routes/static.js'
import { handleTTSRoutes } from './api/routes/tts.js'
import {
  attachWebSocketIdleTimeout,
  authorizeWebSocketUpgrade,
  isLoopbackAddress,
  isPrivateLanAddress,
  rejectWebSocketUpgrade,
  selectWebSocketProtocol,
  timingSafeTokenEqual,
} from './api/websocket-security.js'
import { execXzCalendar, execXzNotes } from './capabilities/tools/xz.js'

export { emitEvent }

const DEFAULT_API_HOST = '127.0.0.1'

function getApiHost() {
  const envHost = String(globalThis.process?.env?.JARVIS_HOST || '').trim()
  if (envHost) return envHost
  return getNetworkConfig().allowLanAccess ? '0.0.0.0' : DEFAULT_API_HOST
}

function isLanAccessEnabled() {
  return getNetworkConfig().allowLanAccess
    || /^(1|true|yes|on)$/i.test(String(globalThis.process?.env?.JARVIS_ALLOW_LAN || '').trim())
}

function isLoopbackRequest(req) {
  return isLoopbackAddress(req.socket?.remoteAddress)
}

function isLanRequest(req) {
  return isLanAccessEnabled() && isPrivateLanAddress(req.socket?.remoteAddress)
}

function isLoopbackOrigin(origin = '') {
  if (!origin || origin === 'null') return true
  try {
    const parsed = new URL(origin)
    return ['127.0.0.1', 'localhost', '::1'].includes(parsed.hostname)
  } catch {
    return false
  }
}

function isAllowedOrigin(origin = '') {
  if (isLoopbackOrigin(origin)) return true
  if (!isLanAccessEnabled()) return false
  try {
    const parsed = new URL(origin)
    return isPrivateLanAddress(parsed.hostname)
  } catch {
    return false
  }
}

function getAuthToken() {
  return String(globalThis.process?.env?.JARVIS_API_TOKEN || '').trim()
}

function hasValidAuthToken(req, url) {
  const expected = getAuthToken()
  if (!expected) return false
  const header = req.headers.authorization || ''
  const bearer = header.match(/^Bearer\s+(.+)$/i)?.[1]?.trim()
  const queryToken = url.searchParams.get('token')
  return timingSafeTokenEqual(bearer, expected) || timingSafeTokenEqual(queryToken, expected)
}

function requireLocalOrToken(req, res, url) {
  if (isLoopbackRequest(req) || hasValidAuthToken(req, url)) return true
  jsonResponse(res, 403, { ok: false, error: 'forbidden' })
  return false
}

function hasAllowedAccess(req, url) {
  return isLoopbackRequest(req) || hasValidAuthToken(req, url) || isLanRequest(req)
}

function isSensitivePath(pathname) {
  return pathname === '/activate'
    || pathname === '/activate/prepare'
    || pathname === '/settings'
    || pathname.startsWith('/settings/')
    || pathname.startsWith('/admin/')
    || pathname.startsWith('/memories/')
}

function setCorsHeaders(req, res, origin) {
  if (isAllowedOrigin(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin || 'null')
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization')
}

async function dispatchHttpRoutes(req, res, url, context) {
  if (await handleMessageRoutes(req, res, url)) return true
  if (await handleEventRoutes(req, res, url)) return true
  if (await handleMemoryRoutes(req, res, url)) return true
  if (await handlePanelRoutes(req, res, url, context)) return true
  if (await handleMediaRoutes(req, res, url)) return true
  if (await handleMapRoutes(req, res, url, context)) return true
  if (await handleActivationRoutes(req, res, url, context)) return true
  if (await handleSettingsRoutes(req, res, url, context)) return true
  if (await handleEmbeddingRoutes(req, res, url)) return true
  if (await handleAdminRoutes(req, res, url, context)) return true
  if (await handleTTSRoutes(req, res, url)) return true
  if (await handleStaticRoutes(req, res, url)) return true
  return false
}

function attachCloudASR() {
  const cloudWss = new WebSocketServer({
    noServer: true,
    maxPayload: 256 * 1024,
    handleProtocols: selectWebSocketProtocol,
  })
  cloudWss.on('connection', (ws) => {
    let session = null
    let configured = false
    let cleanedUp = false
    const cleanup = () => {
      if (cleanedUp) return
      cleanedUp = true
      session?.close()
      session = null
    }
    attachWebSocketIdleTimeout(ws, 60 * 1000, cleanup)

    ws.on('message', (raw) => {
      if (!configured) {
        try {
          const msg = JSON.parse(raw.toString())
          if (msg.type !== 'config') return
          // ASR 凭据自 schema v3 起按 provider 拆到 voice/<provider>.json，不再存 config.json 的 .voice 块。
          // 客户端 msg.provider 是用户在 UI 的实时选择，优先于 active.json 的持久化默认值——
          // 否则用户切到"本机识别(local)"也会被 active.json(可能=aliyun)强制覆盖，本机识别永远走不到。
          const requested = normalizeVoiceProvider(msg.provider, '')
          const runtimeCfg = requested
            ? getVoiceProviderConfigRecord(requested)
            : getVoiceRuntimeConfig()
          session = createCloudASRSession(
            { ...runtimeCfg, lang: msg.lang || 'zh' },
            (text, isFinal, seg) => {
              try { ws.send(JSON.stringify({ type: 'transcript', text, is_final: isFinal, seg })) } catch {}
            },
            (errMsg) => {
              try { ws.send(JSON.stringify({ type: 'error', message: errMsg })) } catch {}
            },
            () => { try { ws.close() } catch {} },
            (event, info) => {
              try { ws.send(JSON.stringify({ type: 'diag', event, info })) } catch {}
            },
          )
          configured = true
        } catch {}
        return
      }

      if (raw instanceof Buffer) {
        session?.sendAudio(raw)
      } else {
        try {
          const msg = JSON.parse(raw.toString())
          if (msg.type === 'flush') session?.flush()
        } catch {}
      }
    })

    ws.on('close', cleanup)
    ws.on('error', cleanup)
  })

  return cloudWss
}

function attachSceneProtocol() {
  const sceneWss = new WebSocketServer({
    noServer: true,
    maxPayload: 1024 * 1024,
    handleProtocols: selectWebSocketProtocol,
  })
  sceneWss.on('connection', (ws) => handleSceneConnection(ws))

  const SCENE_PASSIVE_INTENTS = new Set(['dismiss', 'ended', 'mounted', 'dwell'])
  setSceneIntentHandler(async (msg) => {
   try {
    const surface = msg.surface || 'scene'
    const name = msg.name || 'unknown'
    const data = msg.data || {}
    const id = insertUISignal({ type: `scene.intent.${name}`, target: msg.surface || null, payload: data, ts: msg.ts || Date.now() })
    emitEvent('ui_signal', { id, type: name, target: msg.surface, payload: data })

    if (name === 'select' && surface.startsWith('security-confirm-')) {
      const pending = sceneStore.get(surface)?.data?.pending || {}
      sceneStore.set(surface, null)
      if (data.value === 'confirm') {
        const updates = {}
        if (pending.file_sandbox !== undefined) updates.fileSandbox = pending.file_sandbox === true
        if (pending.exec_sandbox !== undefined) updates.execSandbox = pending.exec_sandbox === true
        const result = Object.keys(updates).length > 0 ? setSecurity(updates) : getSecurity()
        const desc = Object.entries(updates).map(([k, v]) => `${k}=${v}`).join(', ')
        pushMessage(
          'SYSTEM',
          `[security settings updated] User confirmed changes: ${desc}. changed_at=${result.updatedAt || 'not recorded'}\n(Internal context refresh only. Do NOT call send_message.)`,
          'APP_SIGNAL',
          { queue: 'background', persist: false, silent: true },
        )
      } else {
        pushMessage(
          'SYSTEM',
          '[security settings change] User cancelled - settings unchanged\n(Internal context refresh only. Do NOT call send_message.)',
          'APP_SIGNAL',
          { queue: 'background', persist: false, silent: true },
        )
      }
      return
    }

    if (name === 'select' && surface.startsWith('xz-confirm-')) {
      const pending = sceneStore.get(surface)?.data?.pending || {}
      sceneStore.set(surface, null)
      if (!pending.tool) return  // #15 幂等守卫：第二次 select（双击/重放）surface 已 null
      // #5 nonce 校验：intent 必须回显 pending 签发的 nonce（防未授权 WS 客户端确认）。
      // fail-closed：pending.nonce 缺失也是异常（execXzWithConfirm 总会签发 nonce）。
      if (!pending.nonce || data.nonce !== pending.nonce) {
        console.warn('[xz-confirm] nonce missing or mismatch, ignoring select intent')
        return
      }
      // 校验 pending.tool 合法性（#14 防 SYSTEM 消息反射注入）
      const validTools = { xz_calendar: execXzCalendar, xz_notes: execXzNotes }
      const execFn = validTools[pending.tool]
      if (!execFn) return  // 非法 tool 忽略
      if (data.value === 'confirm') {
        // KTD1: handler 直接执行 pending {tool,args}——不依赖 Agent 重新调用（消除 #1 死循环）。
        // 仿 set_security 的 setSecurity 直调模式。结果推回 Agent 队列。
        try {
          const result = await execFn(pending.args || {}, {})
          pushMessage(
            'SYSTEM',
            `[xz write executed] User confirmed ${pending.tool} ${pending.args?.command || ''}. The tool has been executed by the system. Result:\n${String(result).slice(0, 2000)}\n(Do NOT call send_message or retry the tool — it already ran. Use this result to continue.)`,
            'APP_SIGNAL',
            { queue: 'background', persist: false, silent: true },
          )
        } catch (err) {
          pushMessage(
            'SYSTEM',
            `[xz write failed] User confirmed ${pending.tool} ${pending.args?.command || ''} but execution failed: ${err?.message || err}. Do not retry automatically.\n(Internal context refresh only. Do NOT call send_message.)`,
            'APP_SIGNAL',
            { queue: 'background', persist: false, silent: true },
          )
        }
      } else {
        // cancel：返回明确失败信封（#13 修复——Agent 收到明确失败而非静默放弃）
        pushMessage(
          'SYSTEM',
          `[xz write cancelled] User cancelled ${pending.tool} ${pending.args?.command || ''}. The tool was NOT executed. Do not retry.\n(Internal context refresh only. Do NOT call send_message.)`,
          'APP_SIGNAL',
          { queue: 'background', persist: false, silent: true },
        )
      }
      return
    }

    // #10 修复：xz-cli-missing 引导卡的 open-settings 按钮处理。
    if (name === 'select' && surface === 'xz-cli-missing') {
      sceneStore.set(surface, null)  // 关闭引导卡
      if (data.value === 'open-settings') {
        emitEvent('open_settings', { tab: 'advanced' })  // 通知 UI 打开设置面板
      }
      return
    }

    if (!SCENE_PASSIVE_INTENTS.has(name)) {
      pushMessage(`UI:${surface}`, `[UI intent surface=${surface} name=${name}]\n${JSON.stringify(data, null, 2)}`, 'APP_SIGNAL')
    }
   } catch (e) {
     // 整个 handler 顶层兜底：任何 I/O 失败（insertUISignal/pushMessage/emitEvent）
     // 不应成为未捕获的 Promise rejection 导致进程崩溃或静默丢失用户点击。
     console.warn('[scene-intent] handler error', e?.message || e)
   }
  })

  return sceneWss
}

function attachWebSocketUpgrades(server, port, { sceneWss, cloudWss }) {
  const routes = new Map([
    ['/scene', sceneWss],
    ['/voice/cloud', cloudWss],
  ])
  const knownPaths = new Set(routes.keys())
  server.on('upgrade', (req, socket, head) => {
    let url
    try { url = new URL(req.url, `http://localhost:${port}`) } catch {
      return rejectWebSocketUpgrade(socket, 404)
    }
    const target = routes.get(url.pathname)
    const auth = authorizeWebSocketUpgrade(req, {
      pathname: url.pathname,
      lanEnabled: isLanAccessEnabled(),
      expectedToken: getAuthToken(),
      knownPaths,
    })
    if (!auth.ok || !target) return rejectWebSocketUpgrade(socket, auth.status)
    target.handleUpgrade(req, socket, head, (ws) => target.emit('connection', ws, req))
  })
}

export function startAPI(port = 3721, { getStateSnapshot = null, onActivated = null } = {}) {
  const onActivatedCallback = onActivated
  const host = getApiHost()
  let pendingActivation = null

  function storePreparedActivation({ apiKey, info }) {
    pendingActivation = {
      token: crypto.randomUUID(),
      apiKey: String(apiKey || '').trim(),
      info,
      expiresAt: Date.now() + 10 * 60 * 1000,
    }
    return pendingActivation
  }

  function getPreparedActivation(token, apiKey) {
    if (!pendingActivation) return null
    if (pendingActivation.expiresAt <= Date.now()) {
      pendingActivation = null
      return null
    }
    if (!token || pendingActivation.token !== token) return null
    if (pendingActivation.apiKey !== String(apiKey || '').trim()) return null
    return pendingActivation
  }

  function clearPreparedActivation() {
    pendingActivation = null
  }

  try {
    const storedName = (getConfig('agent_name') || '').trim()
    if (storedName) setStickyEvent('agent_name_updated', { name: storedName })
  } catch {}

  const routeContext = {
    getStateSnapshot,
    hasAllowedAccess,
    requireLocalOrToken,
    storePreparedActivation,
    getPreparedActivation,
    clearPreparedActivation,
    onActivated: onActivatedCallback,
  }

  const server = http.createServer(async (req, res) => {
    const base = `http://localhost:${port}`
    const url = new URL(req.url, base)
    const origin = req.headers.origin

    try {
      if (await handleSocialRoutes(req, res, url, { hasAllowedAccess, requireLocalOrToken })) return

      if (origin && !isAllowedOrigin(origin)) {
        return jsonResponse(res, 403, { ok: false, error: 'forbidden origin' })
      }

      if (!hasAllowedAccess(req, url)) {
        return jsonResponse(res, 403, { ok: false, error: 'forbidden' })
      }

      setCorsHeaders(req, res, origin)

      if (req.method !== 'OPTIONS' && isSensitivePath(url.pathname) && !requireLocalOrToken(req, res, url)) return

      if (req.method === 'OPTIONS') {
        res.writeHead(204)
        res.end()
        return
      }

      if (await dispatchHttpRoutes(req, res, url, routeContext)) return
      jsonResponse(res, 404, { error: 'not found' })
    } catch (err) {
      console.error('[API] request failed:', err)
      if (!res.headersSent) jsonResponse(res, 500, { ok: false, error: err.message || 'internal error' })
      else try { res.end() } catch {}
    }
  })

  const cloudWss = attachCloudASR()
  const sceneWss = attachSceneProtocol()
  attachWebSocketUpgrades(server, port, { sceneWss, cloudWss })

  server.listen(port, host, () => {
    console.log(`[API] Listening at http://${host}:${port}`)
    console.log('[API]   POST /message  - send message to agent')
    console.log('[API]   GET  /events   - SSE real-time stream (receive agent messages)')
    console.log('[API]   GET  /memories - query memories')
    console.log('[API]   GET  /audit/recall, /audit/extract, /audit/stats - memory observability (Phase 0)')
    console.log('[API]   GET  /status   - status')
    console.log('[API]   WS   /scene    - Scene declarative UI channel')
  })

  return server
}
