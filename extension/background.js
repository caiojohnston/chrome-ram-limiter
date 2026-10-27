const HOST = 'com.ramlimiter.host';
const MB = 1024 * 1024;
const MAX_DISCARDS_PER_CYCLE = 12;
const IDLE_CHOICES = [2, 5, 10, 15, 30, 60];

const DEFAULTS = {
  enabled: true,
  limitGB: 4,
  hardLimit: false,
  idleMinutes: 10,
  metric: 'physical', // 'physical' = coluna Memoria do Gerenciador de Tarefas; 'commit' = memoria comprometida
  sysGuard: true,
  sysMinGB: 2,
  protectPinned: true,
  protectAudible: true,
  whitelist: [],
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const today = () => new Date().toLocaleDateString('sv');
const clamp = (v, min, max, fallback) => (Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : fallback);

// ---------- configuracoes ----------

function normalize(cfg) {
  const c = { ...DEFAULTS, ...cfg };
  c.limitGB = clamp(Number(c.limitGB), 0.5, 32, DEFAULTS.limitGB);
  c.sysMinGB = clamp(Number(c.sysMinGB), 0.5, 16, DEFAULTS.sysMinGB);
  c.idleMinutes = IDLE_CHOICES.includes(Number(c.idleMinutes)) ? Number(c.idleMinutes) : DEFAULTS.idleMinutes;
  c.metric = c.metric === 'commit' ? 'commit' : 'physical';
  c.whitelist = (Array.isArray(c.whitelist) ? c.whitelist : [])
    .map((s) => String(s).trim().toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, ''))
    .filter(Boolean);
  for (const k of ['enabled', 'hardLimit', 'sysGuard', 'protectPinned', 'protectAudible']) c[k] = Boolean(c[k]);
  return c;
}

async function getSettings() {
  const { settings } = await chrome.storage.local.get('settings');
  return normalize(settings);
}

async function saveSettings(patch) {
  const cfg = normalize({ ...(await getSettings()), ...patch });
  await chrome.storage.local.set({ settings: cfg });
  return cfg;
}

// ---------- medicao ----------

// Uma unica conexao com o medidor, reaproveitada em todas as leituras (nao cria processo a cada medicao).
let port = null;
let waiting = null;
let readQueue = Promise.resolve();

function connectHost() {
  try {
    port = chrome.runtime.connectNative(HOST);
    port.onMessage.addListener((msg) => {
      const done = waiting;
      waiting = null;
      done?.(msg);
    });
    port.onDisconnect.addListener(() => {
      void chrome.runtime.lastError; // evita aviso no console quando o medidor nao esta instalado
      port = null;
      const done = waiting;
      waiting = null;
      done?.(null);
    });
  } catch {
    port = null;
  }
}

function askHost() {
  if (!port) connectHost();
  if (!port) return Promise.resolve(null);
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      waiting = null;
      resolve(null);
    }, 3000);
    waiting = (msg) => {
      clearTimeout(timer);
      resolve(msg && msg.ok ? msg : null);
    };
    try {
      port.postMessage({ cmd: 'mem' });
    } catch {
      clearTimeout(timer);
      waiting = null;
      port = null;
      resolve(null);
    }
  });
}

// Leituras em fila: o popup e o ciclo automatico podem pedir ao mesmo tempo.
function readHost() {
  const result = readQueue.then(askHost);
  readQueue = result.catch(() => null);
  return result;
}

async function measure() {
  const [host, sys] = await Promise.all([readHost(), chrome.system.memory.getInfo()]);
  return {
    hostOk: Boolean(host),
    physicalMB: host ? host.privateWsMB : null,
    commitMB: host ? host.privateMB : null,
    procs: host ? host.procs : null,
    sysFreeMB: Math.round(sys.availableCapacity / MB),
    sysTotalMB: Math.round(sys.capacity / MB),
    at: Date.now(),
  };
}

const usedMB = (cfg, r) => (r.hostOk ? (cfg.metric === 'commit' ? r.commitMB : r.physicalMB) : null);

function pressure(cfg, r) {
  const used = usedMB(cfg, r);
  if (used != null && used > cfg.limitGB * 1024) return 'limit';
  if (cfg.sysGuard && r.sysFreeMB < cfg.sysMinGB * 1024) return 'system';
  return null;
}

function relieved(cfg, r, reason) {
  if (reason === 'limit') {
    const used = usedMB(cfg, r);
    return used == null || used <= cfg.limitGB * 1024 * 0.9;
  }
  if (reason === 'system') return r.sysFreeMB >= cfg.sysMinGB * 1024 * 1.15;
  return false;
}

// ---------- abas ----------

function whitelisted(url, list) {
  if (!list.length) return false;
  let u;
  try {
    u = new URL(url);
  } catch {
    return false;
  }
  const host = u.hostname.replace(/^www\./, '');
  const hostPath = host + u.pathname;
  return list.some((entry) =>
    entry.includes('/') ? hostPath.startsWith(entry) : host === entry || host.endsWith('.' + entry));
}

async function candidates(cfg, ignoreIdle) {
  const tabs = await chrome.tabs.query({});
  const now = Date.now();
  return tabs
    .filter((t) => {
      const url = t.url || t.pendingUrl || '';
      if (t.active || t.discarded || t.autoDiscardable === false) return false;
      if (!/^(https?|file):/.test(url)) return false;
      if (cfg.protectPinned && t.pinned) return false;
      if (cfg.protectAudible && t.audible) return false;
      if (whitelisted(url, cfg.whitelist)) return false;
      return ignoreIdle || now - (t.lastAccessed || 0) >= cfg.idleMinutes * 60000;
    })
    .sort((a, b) => (a.lastAccessed || 0) - (b.lastAccessed || 0));
}

async function discardTab(id) {
  try {
    return Boolean(await chrome.tabs.discard(id));
  } catch {
    return false;
  }
}

// ---------- estatisticas e badge ----------

async function getStats() {
  const { stats } = await chrome.storage.local.get('stats');
  if (!stats || stats.day !== today()) return { day: today(), discardedToday: 0, lastAction: stats?.lastAction ?? null };
  return stats;
}

async function recordAction(count, beforeMB, afterMB, reason) {
  const stats = await getStats();
  stats.discardedToday += count;
  stats.lastAction = { at: Date.now(), count, beforeMB, afterMB, reason };
  await chrome.storage.local.set({ stats });
}

const fmtGB = (mb) => (mb / 1024).toLocaleString('pt-BR', { maximumFractionDigits: 1, minimumFractionDigits: 1 });

async function updateBadge(cfg, r) {
  let text = '';
  let color = '#5b5563';
  let title = 'Limitador de RAM';
  if (!cfg.enabled) {
    text = 'OFF';
    title += ' — desativado';
  } else if (!r.hostOk) {
    text = '!';
    color = '#d98e04';
    title += ' — medidor não instalado';
  } else {
    const used = usedMB(cfg, r);
    const ratio = used / (cfg.limitGB * 1024);
    text = used >= 10240 ? String(Math.round(used / 1024)) : fmtGB(used);
    color = ratio >= 1 ? '#e5243f' : ratio >= 0.8 ? '#d98e04' : '#1f9d55';
    title += ` — Chrome: ${fmtGB(used)} GB de ${cfg.limitGB} GB`;
  }
  await chrome.action.setBadgeText({ text });
  await chrome.action.setBadgeBackgroundColor({ color });
  await chrome.action.setTitle({ title });
}

async function publish(cfg, reading) {
  await chrome.storage.session.set({ reading });
  await updateBadge(cfg, reading);
}

// ---------- logica principal ----------

async function reclaim(cfg, reading, reason) {
  const ignoreIdle = reason !== 'limit' || cfg.hardLimit;
  const queue = await candidates(cfg, ignoreIdle);
  const beforeMB = usedMB(cfg, reading);
  let count = 0;

  if (reason === 'manual') {
    for (const tab of queue) if (await discardTab(tab.id)) count++;
    await sleep(1500);
    reading = await measure();
  } else {
    while (queue.length && count < MAX_DISCARDS_PER_CYCLE) {
      for (const tab of queue.splice(0, 2)) if (await discardTab(tab.id)) count++;
      await sleep(1500);
      reading = await measure();
      if (relieved(cfg, reading, reason)) break;
    }
  }

  await publish(cfg, reading);
  const afterMB = usedMB(cfg, reading);
  if (count) await recordAction(count, beforeMB, afterMB, reason);
  return { count, beforeMB, afterMB, reading };
}

let busy = false;

async function tick() {
  if (busy) return;
  busy = true;
  try {
    const cfg = await getSettings();
    const reading = await measure();
    await publish(cfg, reading);
    if (!cfg.enabled) return;
    const reason = pressure(cfg, reading);
    if (reason) await reclaim(cfg, reading, reason);
  } finally {
    busy = false;
  }
}

let pendingTick;
function tickSoon() {
  clearTimeout(pendingTick);
  pendingTick = setTimeout(tick, 4000);
}

async function ensureAlarm() {
  if (!(await chrome.alarms.get('tick'))) await chrome.alarms.create('tick', { periodInMinutes: 0.5 });
}

chrome.runtime.onInstalled.addListener(() => ensureAlarm().then(tick));
chrome.runtime.onStartup.addListener(() => ensureAlarm().then(tick));
chrome.alarms.onAlarm.addListener((alarm) => alarm.name === 'tick' && tick());
chrome.tabs.onCreated.addListener(tickSoon);
chrome.tabs.onUpdated.addListener((_id, info) => info.status === 'complete' && tickSoon());

chrome.runtime.onMessage.addListener((msg, _sender, reply) => {
  handle(msg).then(reply, (err) => reply({ error: String(err) }));
  return true;
});

async function handle(msg) {
  const cfg = await getSettings();
  switch (msg.type) {
    case 'state': {
      const reading = await measure();
      await publish(cfg, reading);
      const eligible = (await candidates(cfg, true)).length;
      return { cfg, reading, stats: await getStats(), eligible };
    }
    case 'save': {
      const saved = await saveSettings(msg.patch);
      tick();
      return { cfg: saved };
    }
    case 'freeNow':
      return reclaim(cfg, await measure(), 'manual');
    default:
      throw new Error('mensagem desconhecida');
  }
}

ensureAlarm();
