// mood-ambient.js —— 点云球的「氛围底色」层
//
// 哲学：不新增颜色档（那会显得像状态切换，张扬）。氛围是对 voice-core 的 STATE_CFG
// 渲染目标做「调制」——色温偏移、节奏微调、待机呼吸幅度。用户「能感受到但说不清」，
// 守住人设里 "keep the warmth lower" 的克制线。
//
// 信号全部来自已存在的系统，不新增采集：
//   时段（本地时间分档，复刻 time.js 的 period 划分）
//   忙碌度（SSE 事件流：思考 / 工具 / 说话 → energy↑，本轮结束 → 缓落）
//   会话阶段（awakening 刚苏醒兴奋 / 长期 idle 缓）
//   用户活跃度（最近一次 SSE 事件距今多久）
//
// 输出 ambientMood，单例。voice-core.js 的 drawFrame 每帧用它调制 STATE_CFG 目标值；
// 主窗口 + 悬浮球窗口共用同一份 ambientMood（主窗口算好经 IPC 推过去）。
//
// 阶段 2 会在这之上叠加 agentMood（小白龙自表达的情绪），同样的调制机制、独立的输入。

// ─── 阶段 2：agentMood → 调制偏移映射 ───
// 小白龙每轮可选地用 [MOOD: x] 自表达情绪（后端解析后发 agent_mood 事件）。
// 这里把情绪词映射成「叠加在 ambientMood 之上的偏移」，同样守氛围级克制：
// 每个 mood 只在色温/节奏/呼吸上做小幅推/拉，不新增颜色档、不显示情绪标签。
//   warmthΔ 加在 out.warmth 上（-1..1 区间内）
//   energyΔ 加在 out.energy 上（0..1 区间内）
//   breatheΔ 乘在 out.breathe 上（1.0 = 无影响）
// 未匹配的情绪词走 fallback（中性微影响），不报错、不阻断。
const MOOD_MAP = {
  focused:    { warmthΔ: 0.05, energyΔ: 0.20, breatheΔ: 0.95 }, // 冷静专注：节奏加快、呼吸收紧
  curious:    { warmthΔ: 0.20, energyΔ: 0.25, breatheΔ: 1.10 }, // 暖、活跃：色温略升、呼吸放大
  playful:    { warmthΔ: 0.35, energyΔ: 0.30, breatheΔ: 1.20 }, // 最暖最活跃（dry humor / tease）
  thoughtful: { warmthΔ: 0.10, energyΔ: 0.05, breatheΔ: 1.05 }, // 缓思：几近中性，呼吸略放
  calm:       { warmthΔ:-0.05, energyΔ:-0.10, breatheΔ: 0.95 }, // 平静：节奏略缓
  tired:      { warmthΔ:-0.15, energyΔ:-0.20, breatheΔ: 0.80 }, // 疲惫：色温偏冷、节奏放慢、呼吸收
  wary:       { warmthΔ:-0.10, energyΔ: 0.15, breatheΔ: 0.85 }, // 警觉：冷、紧、略快
};
const MOOD_FALLBACK = { warmthΔ: 0, energyΔ: 0.05, breatheΔ: 1.0 }; // 未知情绪词：中性微推

// ─── 调制幅度（克制原则：量级小，用户说不清但感觉得到）───
const MOOD = {
  // warmth: -1..1 → 色温 RGB 偏移幅度。深夜偏冷（+蓝 -红），午后/苏醒偏暖（+红 -蓝）。
  WARMTH_RGB: 8,
  // energy: 0..1 → 节奏系数范围 [0.85, 1.15]，干活/思考时略快、idle 略慢。
  SPD_MIN: 0.85, SPD_MAX: 1.15,
  // breathe: 0.5..1.5 → 待机微动幅度。深夜/久静收小，刚苏醒放大。
  AMP_MIN: 0.5, AMP_MAX: 1.5,
};

// ─── 平滑过渡 ───
// ambientMood 不应跳变（时段切换、忙↔闲都该缓慢漂移），否则球会「抽搐」。
// 每个分量用指数平滑（EMA），1 - α 越大跟得越紧。
const SMOOTH = { warmth: 0.04, energy: 0.06, breathe: 0.03 };

// ─── 时段分档（复刻 src/time.js 的 formatTick period 划分）───
// 返回 { warmth, breathe } 基线：一天的色温/呼吸节律。
function timeOfDayMood(hour) {
  // early morning 5-9   苏醒暖、呼吸放大（「刚睡醒」）
  // morning    9-12     温和偏暖
  // noon       12-14    中性
  // afternoon  14-18    温和偏暖（午后）
  // evening    18-21    微暖
  // late night 21-24    偏冷、呼吸收小
  // midnight   0-5      最冷、呼吸最小（深夜）
  if (hour >= 5 && hour < 9)   return { warmth: 0.55, breathe: 1.35 };  // 苏醒
  if (hour >= 9 && hour < 12)  return { warmth: 0.30, breathe: 1.10 };
  if (hour >= 12 && hour < 14) return { warmth: 0.10, breathe: 1.00 };
  if (hour >= 14 && hour < 18) return { warmth: 0.25, breathe: 1.05 };
  if (hour >= 18 && hour < 21) return { warmth: 0.15, breathe: 0.95 };
  if (hour >= 21 && hour < 24) return { warmth: -0.40, breathe: 0.75 };
  return { warmth: -0.70, breathe: 0.60 };                              // midnight 0-5
}

function lerp(a, b, t) { return a + (b - a) * t; }

// ─── 单例状态 ───
let core = null;            // voice-core 实例（注入 setAmbientMood 用）
let orbMood = null;         // 推送给悬浮球窗口的通道（可选，注入）
let inited = false;

// 目标值（瞬时，由信号派生）
let tgt = { warmth: 0, energy: 0.3, breathe: 1.0 };
// 平滑后的实际输出值（EMA）
let out = { warmth: 0, energy: 0.3, breathe: 1.0 };

// ── 阶段 2：agentMood 状态 ──
// 收到 agent_mood 事件时设为 { mood, ts }；每轮情绪有「持续衰减」——不会回复一结束就
// 瞬间消失，而是几十秒内慢慢退回氛围底色，像情绪余韵。null = 无情绪叠加（纯氛围）。
let agentMoodState = null;          // { mood, ts } 或 null
const MOOD_DECAY_MS = 45000;        // 情绪余韵：45s 内线性衰减到 0

// ─── 忙碌度：从 SSE 事件流派生 ───
// agentBusyState: 'idle' | 'thinking' | 'tool' | 'speaking'
let agentBusyState = 'idle';
let lastBusyTs = Date.now();    // 最近一次「Agent 在干活」事件
let lastAnyEventTs = Date.now(); // 最近一次任何 SSE 事件（活跃度）
let turnsSinceBoot = 0;         // 累计对话轮数（粗略的「苏醒度」）
let bootTs = Date.now();

function onAgentEvent(type, _data) {
  lastAnyEventTs = Date.now();
  switch (type) {
    case 'message_received':
      turnsSinceBoot++;
      // fallthrough —— 用户发消息 → 即将思考
    case 'stream_start':
      agentBusyState = 'thinking';
      lastBusyTs = Date.now();
      break;
    case 'tool_preparing':
    case 'tool_executing':
    case 'tool_call':
      agentBusyState = 'tool';
      lastBusyTs = Date.now();
      break;
    case 'stream_chunk':
      // Agent 开始吐正文 → 即将/正在说话
      agentBusyState = 'speaking';
      lastBusyTs = Date.now();
      break;
    case 'response':
    case 'processing_preempted':
    case 'protocol_violation':
      agentBusyState = 'idle';
      break;
    default:
      break;
  }
}

// ─── 主计算：把信号融合成目标 ambientMood ───
function computeTargets() {
  const now = Date.now();

  // 1. 时段基线
  const tod = timeOfDayMood(new Date().getHours());

  // 2. 忙碌度 energy
  //    干活中（thinking/tool/speaking）→ 高；刚结束 6s 内缓慢回落；长期 idle → 低
  const BUSY_FALL_MS = 6000;
  let energy;
  if (agentBusyState === 'thinking') energy = 0.85;
  else if (agentBusyState === 'tool') energy = 0.95;
  else if (agentBusyState === 'speaking') energy = 0.70;
  else {
    // idle：距最近一次忙碌越久，energy 越低（缓落）
    const sinceBusy = now - lastBusyTs;
    energy = sinceBusy < BUSY_FALL_MS
      ? lerp(0.5, 0.15, sinceBusy / BUSY_FALL_MS)
      : 0.15;
  }

  // 3. 呼吸 breathe：时段基线 × 苏醒兴奋系数
  //    开机 5 分钟内（前若干轮）给一点「刚苏醒」的放大
  const UPTIME_MS = 5 * 60 * 1000;
  const uptimeFactor = Math.max(0, 1 - (now - bootTs) / UPTIME_MS); // 1→0
  const awakeningBoost = uptimeFactor * 0.20 + Math.min(0.15, turnsSinceBoot * 0.03);
  let breathe = tod.breathe * (1 + awakeningBoost);

  // 4. warmth：时段基线 + 活跃度微调（深夜还在密集对话 → 稍暖一点点，像「陪你」）
  const ACT_WINDOW_MS = 5 * 60 * 1000;
  const recentActivity = now - lastAnyEventTs < ACT_WINDOW_MS ? 1 : 0;
  let warmth = tod.warmth + (recentActivity ? 0.08 : 0);

  // 5. 长期 idle 安静下来（很久没任何事件 → breathe 进一步收）
  const IDLE_QUIET_MS = 10 * 60 * 1000;
  if (now - lastAnyEventTs > IDLE_QUIET_MS) {
    breathe *= 0.85;
    energy = Math.min(energy, 0.10);
  }

  tgt.warmth = clamp(warmth, -1, 1);
  tgt.energy = clamp(energy, 0, 1);
  tgt.breathe = clamp(breathe, MOOD.AMP_MIN, MOOD.AMP_MAX);
}

function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }

// ─── 平滑 + 下发：每秒跑一次 ───
const TICK_MS = 1000;
let tickTimer = null;
function tick() {
  computeTargets();
  // EMA 平滑：避免时段/忙闲切换时球抽搐
  out.warmth = lerp(out.warmth, tgt.warmth, SMOOTH.warmth);
  out.energy = lerp(out.energy, tgt.energy, SMOOTH.energy);
  out.breathe = lerp(out.breathe, tgt.breathe, SMOOTH.breathe);

  // ── 阶段 2：叠加 agentMood（小白龙自表达的情绪余韵）──
  // 情绪不覆盖氛围底色，而是在其上做偏移；按时间线性衰减，回复说完后慢慢退回底色。
  let delivered = out;
  if (agentMoodState) {
    const age = Date.now() - agentMoodState.ts;
    const w = Math.max(0, 1 - age / MOOD_DECAY_MS);   // 1→0 over MOOD_DECAY_MS
    if (w <= 0) {
      agentMoodState = null;                           // 余韵散尽，回到纯氛围
    } else {
      const m = MOOD_MAP[agentMoodState.mood] || MOOD_FALLBACK;
      delivered = {
        warmth: clamp(out.warmth + m.warmthΔ * w, -1, 1),
        energy: clamp(out.energy + m.energyΔ * w, 0, 1),
        breathe: clamp(out.breathe * (1 + (m.breatheΔ - 1) * w), MOOD.AMP_MIN, MOOD.AMP_MAX),
      };
    }
  }

  // 下发给 voice-core（drawFrame 每帧用 delivered 调制 STATE_CFG 目标）
  try { core?.setAmbientMood?.(delivered); } catch {}
  // 下发给悬浮球窗口（主窗口算好、球窗复用同一份氛围 + 情绪）
  try { orbMood?.(delivered); } catch {}
}

// ─── 阶段 2：接收 Agent 自表达的情绪（app.js 监听 agent_mood 事件后调用）───
// mood 为小写情绪词（focused/curious/playful/thoughtful/calm/tired/wary 或自定义）。
// 设为 null / 空串立即清掉情绪叠加。
function setAgentMood(mood) {
  const m = String(mood || '').trim().toLowerCase();
  agentMoodState = m ? { mood: m, ts: Date.now() } : null;
}

// ─── 初始化 ───
// opts: { core, orbMood? } —— core 必传；orbMood 是推送给悬浮球窗口的通道（可选）。
export function initMoodAmbient({ core: c, orbMood: om } = {}) {
  if (inited) return;
  core = c || core;
  orbMood = om || orbMood;
  bootTs = Date.now();
  lastAnyEventTs = Date.now();
  lastBusyTs = Date.now();
  inited = true;
  tick();                       // 立即跑一次，球起步就有氛围（而非从灰扑扑的默认值开始）
  tickTimer = setInterval(tick, TICK_MS);
}

export function getAmbientMood() { return out; }

// 外部接线点：app.js 的 SSE handle() 总入口调用，把事件喂进来。
export { onAgentEvent as moodAmbientOnAgentEvent, setAgentMood as moodAmbientSetAgentMood };
