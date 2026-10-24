const $ = (id) => document.getElementById(id);
const ARC_LEN = 2 * Math.PI * 50 * 0.75;
const send = (msg) => chrome.runtime.sendMessage(msg);

const gb = (mb, digits = 1) =>
  (mb / 1024).toLocaleString('pt-BR', { minimumFractionDigits: digits, maximumFractionDigits: digits });
const gbLimit = (v) => v.toLocaleString('pt-BR', { maximumFractionDigits: 1 });
const time = (ts) => new Date(ts).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });

let cfg = null;
let busy = false;

function renderSettings() {
  $('enabled').checked = cfg.enabled;
  $('limit').value = cfg.limitGB;
  $('limitOut').textContent = `${gbLimit(cfg.limitGB)} GB`;
  $('hardLimit').checked = cfg.hardLimit;
  $('idleMinutes').value = String(cfg.idleMinutes);
  $('metric').value = cfg.metric;
  $('sysGuard').checked = cfg.sysGuard;
  $('sysMinGB').value = cfg.sysMinGB;
  $('protectPinned').checked = cfg.protectPinned;
  $('protectAudible').checked = cfg.protectAudible;
  if (document.activeElement !== $('whitelist')) $('whitelist').value = cfg.whitelist.join('\n');
  renderDependent();
}

function renderDependent() {
  document.body.classList.toggle('off', !cfg.enabled);
  $('idleRow').hidden = cfg.hardLimit;
  $('sysMinRow').hidden = !cfg.sysGuard;
  $('hardHint').textContent = cfg.hardLimit
    ? 'Ao passar do limite, suspende qualquer aba em segundo plano na hora.'
    : 'Ao passar do limite, suspende só abas paradas há algum tempo.';
}

function renderReading(reading, stats, eligible) {
  const limitMB = cfg.limitGB * 1024;
  const physical = cfg.metric === 'physical';
  const used = reading.hostOk ? (physical ? reading.physicalMB : reading.commitMB) : null;

  $('hostWarn').hidden = reading.hostOk;
  $('of').textContent = `de ${gbLimit(cfg.limitGB)} GB`;
  $('procs').textContent = reading.procs ?? '—';
  $('otherLabel').textContent = physical ? 'Comprometida' : 'RAM física';
  $('other').textContent = reading.hostOk ? `${gb(physical ? reading.commitMB : reading.physicalMB)} GB` : '—';
  $('sysFree').textContent = `${gb(reading.sysFreeMB)} GB`;

  const arc = $('arc');
  const status = $('status');
  if (used == null) {
    $('used').textContent = '—';
    arc.style.strokeDasharray = `0 999`;
    status.textContent = '';
  } else {
    const ratio = used / limitMB;
    const color = ratio >= 1 ? 'var(--danger)' : ratio >= 0.8 ? 'var(--warn)' : 'var(--ok)';
    $('used').textContent = gb(used);
    arc.style.strokeDasharray = `${ARC_LEN * Math.min(ratio, 1)} 999`;
    arc.style.stroke = color;
    arc.style.color = color;
    status.style.color = color;
    status.textContent = !cfg.enabled ? 'desativado' : ratio >= 1 ? 'acima do limite' : ratio >= 0.8 ? 'perto do limite' : 'tudo certo';
  }

  $('eligible').textContent = eligible
    ? `${eligible} ${eligible === 1 ? 'aba pode' : 'abas podem'} ser suspensa${eligible === 1 ? '' : 's'} agora.`
    : 'Nenhuma aba em segundo plano para suspender.';

  $('today').textContent = `Hoje: ${stats.discardedToday} ${stats.discardedToday === 1 ? 'aba suspensa' : 'abas suspensas'}`;
  const last = stats.lastAction;
  if (last) {
    const why = { limit: 'limite', system: 'Windows com pouca RAM', manual: 'manual' }[last.reason] ?? last.reason;
    const freed = last.beforeMB != null && last.afterMB != null ? ` · −${Math.max(0, last.beforeMB - last.afterMB).toLocaleString('pt-BR')} MB` : '';
    $('last').textContent = `Última: ${time(last.at)} · ${last.count} aba${last.count === 1 ? '' : 's'}${freed} (${why})`;
  } else {
    $('last').textContent = '';
  }
}

async function refresh(first = false) {
  if (busy) return;
  const state = await send({ type: 'state' });
  if (!state || state.error) return;
  if (first || !cfg) {
    cfg = state.cfg;
    renderSettings();
  }
  renderReading(state.reading, state.stats, state.eligible);
}

async function save(patch) {
  cfg = { ...cfg, ...patch };
  renderDependent();
  const res = await send({ type: 'save', patch });
  if (res?.cfg) cfg = res.cfg;
  refresh();
}

function bindSwitch(id) {
  $(id).addEventListener('change', (e) => save({ [id]: e.target.checked }));
}

['enabled', 'hardLimit', 'sysGuard', 'protectPinned', 'protectAudible'].forEach(bindSwitch);

$('limit').addEventListener('input', (e) => {
  $('limitOut').textContent = `${gbLimit(Number(e.target.value))} GB`;
});
$('limit').addEventListener('change', (e) => save({ limitGB: Number(e.target.value) }));
$('idleMinutes').addEventListener('change', (e) => save({ idleMinutes: Number(e.target.value) }));
$('metric').addEventListener('change', (e) => save({ metric: e.target.value }));
$('sysMinGB').addEventListener('change', (e) => save({ sysMinGB: Number(e.target.value) }));

let whitelistTimer;
$('whitelist').addEventListener('input', (e) => {
  clearTimeout(whitelistTimer);
  whitelistTimer = setTimeout(() => save({ whitelist: e.target.value.split('\n') }), 600);
});

$('freeNow').addEventListener('click', async () => {
  const btn = $('freeNow');
  btn.disabled = true;
  btn.textContent = 'Liberando…';
  busy = true;
  try {
    const res = await send({ type: 'freeNow' });
    const freed = res.beforeMB != null && res.afterMB != null ? Math.max(0, res.beforeMB - res.afterMB) : null;
    btn.textContent = res.count
      ? `${res.count} aba${res.count === 1 ? '' : 's'} suspensa${res.count === 1 ? '' : 's'}${freed != null ? ` · −${freed.toLocaleString('pt-BR')} MB` : ''}`
      : 'Nada para suspender';
  } finally {
    busy = false;
    refresh();
    setTimeout(() => {
      btn.textContent = 'Liberar memória agora';
      btn.disabled = false;
    }, 2500);
  }
});

refresh(true);
setInterval(refresh, 3000);
