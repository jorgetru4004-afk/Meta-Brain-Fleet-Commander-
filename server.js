'use strict';
// ╔══════════════════════════════════════════════════════════════════╗
// ║   NEXUS META BRAIN — Fleet Commander V4.0                        ║
// ║   Capital Allocation · Fleet Coordination · Collective Intel     ║
// ║   Built Once — Built Permanently — No Ceiling Ever               ║
// ╚══════════════════════════════════════════════════════════════════╝

const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const axios = require('axios');
const fs = require('fs');
const path = require('path');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });
app.use(express.json());
app.use(express.static(__dirname));

// ── CONFIG ──
const PORT = process.env.PORT || 8080;
const ANTHROPIC_KEY = process.env.ANTHROPIC_KEY || process.env.ANTHROPIC_API_KEY || '';
const MODEL = 'claude-sonnet-4-6';
const TOTAL_CAPITAL = parseFloat(process.env.TOTAL_CAPITAL || '100000'); // Paper account

// ── DYNAMIC FLEET DISCOVERY ──
// Same convention as ARCHITECT: BOT_[NAME]=https://url
function discoverFleet() {
  const fleet = {};
  for (const [key, val] of Object.entries(process.env)) {
    if (key.startsWith('BOT_') && val && val.startsWith('http')) {
      const name = key.slice(4).toLowerCase();
      const displayName = key.slice(4).replace(/_/g, ' ');
      fleet[name] = { url: val, displayName };
    }
  }
  if (Object.keys(fleet).length === 0) {
    fleet['brain'] = { url: 'https://apexbrainv3-production.up.railway.app', displayName: 'BRAIN V3' };
    fleet['quantum'] = { url: 'https://apexquantumv3-production.up.railway.app', displayName: 'QUANTUM V3' };
    fleet['titan'] = { url: 'https://apextitanv1-production.up.railway.app', displayName: 'TITAN V1' };
  }
  return fleet;
}
let FLEET = discoverFleet();

// ── PERSISTENCE ──
const DATA_DIR = path.join(__dirname, 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
function loadJSON(f, fb) { try { return JSON.parse(fs.readFileSync(path.join(DATA_DIR, f), 'utf8')); } catch { return fb; } }
function saveJSON(f, d) { try { fs.writeFileSync(path.join(DATA_DIR, f), JSON.stringify(d, null, 2)); } catch (e) {} }

// ── COMPONENT 1: TICKER COORDINATION REGISTRY ──
// No two bots ever analyze the same ticker simultaneously
let tickerRegistry = loadJSON('registry.json', {
  active: {},      // { 'AAPL': { bot: 'brain', type: 'analyzing|holding', since: iso } }
  history: [],     // last 200 coordination events
  conflicts: []    // blocked conflict log
});

function registerTicker(ticker, bot, type = 'analyzing') {
  const existing = tickerRegistry.active[ticker];
  if (existing && existing.bot !== bot) {
    // Conflict — log and block
    const conflict = { ticker, requestingBot: bot, ownerBot: existing.bot, type, time: new Date().toISOString() };
    tickerRegistry.conflicts = [conflict, ...tickerRegistry.conflicts].slice(0, 100);
    saveJSON('registry.json', tickerRegistry);
    return false; // blocked
  }
  tickerRegistry.active[ticker] = { bot, type, since: new Date().toISOString() };
  saveJSON('registry.json', tickerRegistry);
  return true;
}

function deregisterTicker(ticker, bot) {
  if (tickerRegistry.active[ticker]?.bot === bot) {
    tickerRegistry.history = [{ ticker, bot, action: 'released', time: new Date().toISOString() }, ...tickerRegistry.history].slice(0, 200);
    delete tickerRegistry.active[ticker];
    saveJSON('registry.json', tickerRegistry);
  }
}

function getRegistryStatus() {
  return {
    activeTickers: Object.keys(tickerRegistry.active).length,
    byBot: Object.entries(tickerRegistry.active).reduce((acc, [ticker, data]) => {
      if (!acc[data.bot]) acc[data.bot] = [];
      acc[data.bot].push({ ticker, type: data.type });
      return acc;
    }, {}),
    recentConflicts: tickerRegistry.conflicts.slice(0, 10)
  };
}

// ── COMPONENT 2: PORTFOLIO CORRELATION MATRIX ──
// Fleet-wide position overlap detection with decay tracking
let correlationState = loadJSON('correlation.json', {
  matrix: {},           // { 'AAPL-MSFT': { correlation: 0.8, lastUpdated: iso, decayScore: 0 } }
  fleetExposure: {},    // { 'tech': 0.6, 'biotech': 0.2 }
  riskScore: 0,         // 0-100 overall fleet concentration risk
  scenarioPnl: {},      // { 'drop5': -x, 'drop10': -x, 'drop20': -x }
  lastCalculated: null
});

// Sector mapping for concentration analysis
const SECTOR_MAP = {
  'AAPL':'tech','MSFT':'tech','GOOGL':'tech','META':'tech','NVDA':'tech','AMD':'tech','TSLA':'tech','AMZN':'tech',
  'COIN':'crypto','MSTR':'crypto','MARA':'crypto','BTBT':'crypto',
  'ACHR':'defense','BBAI':'defense','CACI':'defense','PLTR':'defense',
  'SOUN':'ai','APLD':'ai','AIXI':'ai',
  'ONDS':'defense','DRUG':'biotech','URGN':'biotech','GOVX':'biotech','IMVT':'biotech',
  'RZLT':'biotech','HIMS':'health','PAYO':'fintech',
  'GLD':'commodity','XOM':'energy','OIL':'energy',
  'BTC':'crypto','ETH':'crypto','SOL':'crypto','INJ':'crypto',
  'PENDLE':'defi','AAVE':'defi','LINK':'oracle'
};

function getSector(ticker) {
  return SECTOR_MAP[ticker?.toUpperCase()] || 'other';
}

function calculateFleetCorrelation(allPositions) {
  const sectorExposure = {};
  const directionExposure = { long: 0, short: 0 };
  let totalValue = 0;

  for (const [bot, positions] of Object.entries(allPositions)) {
    for (const [ticker, pos] of Object.entries(positions || {})) {
      const sector = getSector(ticker);
      const value = Math.abs(pos.value || pos.budget || 100);
      sectorExposure[sector] = (sectorExposure[sector] || 0) + value;
      if (pos.type === 'SHORT' || pos.isShort) directionExposure.short += value;
      else directionExposure.long += value;
      totalValue += value;
    }
  }

  // Normalize to percentages
  const normalized = {};
  for (const [sector, val] of Object.entries(sectorExposure)) {
    normalized[sector] = totalValue > 0 ? parseFloat((val / totalValue * 100).toFixed(1)) : 0;
  }

  // Risk score — penalize concentration
  const maxSectorPct = Math.max(...Object.values(normalized), 0);
  const riskScore = Math.min(100, Math.round(maxSectorPct * 1.2));

  // Scenario P&L estimates
  const scenarioPnl = {
    drop5: -(directionExposure.long * 0.05 - directionExposure.short * 0.05).toFixed(2),
    drop10: -(directionExposure.long * 0.10 - directionExposure.short * 0.10).toFixed(2),
    drop20: -(directionExposure.long * 0.20 - directionExposure.short * 0.20).toFixed(2),
    rally5: +(directionExposure.long * 0.05 - directionExposure.short * 0.05).toFixed(2)
  };

  correlationState.fleetExposure = normalized;
  correlationState.riskScore = riskScore;
  correlationState.scenarioPnl = scenarioPnl;
  correlationState.lastCalculated = new Date().toISOString();
  saveJSON('correlation.json', correlationState);

  return { normalized, riskScore, scenarioPnl, maxSectorPct, totalValue };
}

// ── COMPONENT 3: FLEET STATE ──
function buildFleetState() {
  const bots = {};
  for (const [name, info] of Object.entries(FLEET)) {
    bots[name] = {
      displayName: info.displayName,
      status: 'UNKNOWN',
      positions: {},
      positionCount: 0,
      heat: 0,
      pnl: 0,
      openPnl: 0,
      dailyPnl: 0,
      weeklyPnl: 0,
      totalTrades: 0,
      totalWins: 0,
      winRate: 0,
      regime: 'UNKNOWN',
      personality: 'UNKNOWN',
      allocation: 0,
      allocationPct: 0,
      lastSeen: null,
      sharpe: 0,
      consecutiveWins: 0,
      consecutiveLoss: 0
    };
  }
  return bots;
}

let fleetState = {
  bots: buildFleetState(),
  empirePnl: 0,
  empireOpenPnl: 0,
  empirePeak: 0,
  empireDrawdown: 0,
  totalCapital: TOTAL_CAPITAL,
  deployedCapital: 0,
  availableCapital: TOTAL_CAPITAL,
  settlementReserve: 0,
  empireRegime: 'UNKNOWN',
  syncCount: 0,
  lastSync: null,
  startTime: new Date().toISOString(),
  killSwitchActive: false,
  killSwitchReason: null,
  recoveryMode: false,
  recoveryStartPnl: null
};

// ── COMPONENT 4: DYNAMIC CAPITAL ALLOCATION ──
let allocation = loadJSON('allocation.json', {
  current: {},      // { botName: { capital: n, pct: n } }
  history: [],      // allocation change log
  lastRebalanced: null,
  rebalanceCount: 0,
  settlementAware: true
});

function calculateOptimalAllocation(bots, totalCapital) {
  const botNames = Object.keys(bots);
  if (botNames.length === 0) return {};

  // Score each bot based on performance
  const scores = {};
  let totalScore = 0;

  for (const [name, bot] of Object.entries(bots)) {
    if (bot.status === 'OFFLINE') { scores[name] = 0; continue; }

    let score = 50; // base score

    // Win rate factor (most important)
    if (bot.totalTrades >= 5) {
      score += (bot.winRate - 50) * 0.8; // +/- 0.8 per % above/below 50%
    }

    // P&L factor
    if (bot.pnl > 0) score += 10;
    if (bot.pnl < 0) score -= 15;

    // Drawdown penalty
    if (bot.consecutiveLoss >= 3) score -= 20;
    if (bot.consecutiveLoss >= 5) score -= 30;

    // Consecutive wins bonus
    if (bot.consecutiveWins >= 3) score += 10;

    // Regime match factor (crypto bot in fear market should get less)
    if (name.includes('quantum') || name.includes('crypto')) {
      if (bot.regime === 'EXTREME_FEAR' || bot.regime === 'FEAR') score -= 15;
    }

    // Kill switch active — zero allocation
    if (fleetState.killSwitchActive) score = 0;

    // Recovery mode — reduce all by 50%
    if (fleetState.recoveryMode) score *= 0.5;

    scores[name] = Math.max(0, score);
    totalScore += scores[name];
  }

  // Calculate allocations
  const result = {};
  for (const [name, score] of Object.entries(scores)) {
    const pct = totalScore > 0 ? score / totalScore : 1 / botNames.length;
    const capital = parseFloat((totalCapital * pct).toFixed(2));
    result[name] = {
      capital,
      pct: parseFloat((pct * 100).toFixed(1)),
      score: parseFloat(score.toFixed(1)),
      displayName: bots[name].displayName
    };
  }

  return result;
}

function rebalanceAllocation() {
  const newAlloc = calculateOptimalAllocation(fleetState.bots, fleetState.totalCapital);
  const prev = { ...allocation.current };

  // Gradual rebalancing — max 10% shift per cycle
  for (const [name, data] of Object.entries(newAlloc)) {
    const prevPct = prev[name]?.pct || (100 / Object.keys(newAlloc).length);
    const maxShift = 10;
    const shift = data.pct - prevPct;
    if (Math.abs(shift) > maxShift) {
      data.pct = prevPct + Math.sign(shift) * maxShift;
      data.capital = parseFloat((fleetState.totalCapital * data.pct / 100).toFixed(2));
    }
  }

  allocation.current = newAlloc;
  allocation.lastRebalanced = new Date().toISOString();
  allocation.rebalanceCount++;
  allocation.history = [{
    time: new Date().toISOString(),
    allocations: { ...newAlloc },
    reason: fleetState.recoveryMode ? 'RECOVERY_MODE' : 'PERFORMANCE_REBALANCE'
  }, ...allocation.history].slice(0, 50);

  saveJSON('allocation.json', allocation);

  // Update fleet state with new allocations
  for (const [name, data] of Object.entries(newAlloc)) {
    if (fleetState.bots[name]) {
      fleetState.bots[name].allocation = data.capital;
      fleetState.bots[name].allocationPct = data.pct;
    }
  }

  return newAlloc;
}

// ── COMPONENT 5: BOT DATA SYNC ──
async function fetchBotData(name, url) {
  // Try multiple endpoints — different bots use different structures
  const endpoints = ['/api/snapshot', '/api/status', '/'];
  for (const endpoint of endpoints) {
    try {
      const resp = await axios.get(`${url}${endpoint}`, { timeout: 8000 });
      const d = resp.data;
      if (!d || d.status === 'OFFLINE') continue;
      const positions = d.positions || {};
      const totalWins = d.totalWins || 0;
      const totalTrades = d.totalTrades || 0;
      // Handle both snapshot format and status format
      const pnl = d.totalPnl || d.pnl || 0;
      const heat = d.portfolioHeat || d.heat || 0;
      const openPnl = d.openPnl || Object.values(positions).reduce((s, p) => s + (p.unrealizedPnl || 0), 0);
      const winRate = d.winRate || (totalTrades > 0 ? parseFloat((totalWins / totalTrades * 100).toFixed(1)) : 0);
      return {
        status: 'ONLINE', positions,
        positionCount: d.positions ? Object.keys(positions).length : (d.openPositions || d.positionCount || 0),
        heat, pnl, openPnl,
        dailyPnl: d.dailyPnl || 0, weeklyPnl: d.weeklyPnl || 0,
        totalTrades, totalWins, winRate,
        regime: d.marketRegime || d.regime || d.cryptoRegime || 'UNKNOWN',
        personality: d.personality || 'UNKNOWN',
        consecutiveWins: d.consecutiveWins || 0,
        consecutiveLoss: d.consecutiveLoss || 0,
        lastSeen: new Date().toISOString()
      };
    } catch (e) { continue; }
  }
  return {
    status: 'OFFLINE', positions: {}, positionCount: 0, heat: 0,
    pnl: 0, openPnl: 0, dailyPnl: 0, weeklyPnl: 0,
    totalTrades: 0, totalWins: 0, winRate: 0,
    regime: 'UNKNOWN', personality: 'UNKNOWN',
    consecutiveWins: 0, consecutiveLoss: 0,
    lastSeen: new Date().toISOString()
  };
}

async function syncFleet() {
  fleetState.syncCount++;
  fleetState.lastSync = new Date().toISOString();

  // Fetch all bots in parallel
  const results = await Promise.all(
    Object.entries(FLEET).map(async ([name, { url }]) => [name, await fetchBotData(name, url)])
  );

  // Collect all positions for correlation analysis
  const allPositions = {};

  let empirePnl = 0, empireOpenPnl = 0, deployedCapital = 0;

  for (const [name, data] of results) {
    fleetState.bots[name] = {
      ...fleetState.bots[name],
      ...data,
      displayName: FLEET[name].displayName
    };
    empirePnl += data.pnl || 0;
    empireOpenPnl += data.openPnl || 0;
    deployedCapital += Object.values(data.positions || {}).reduce((s, p) => s + Math.abs(p.value || p.budget || 0), 0);
    allPositions[name] = data.positions || {};
  }

  fleetState.empirePnl = parseFloat(empirePnl.toFixed(2));
  fleetState.empireOpenPnl = parseFloat(empireOpenPnl.toFixed(2));
  fleetState.deployedCapital = parseFloat(deployedCapital.toFixed(2));
  fleetState.availableCapital = parseFloat((fleetState.totalCapital - deployedCapital).toFixed(2));

  if (fleetState.empirePnl > fleetState.empirePeak) {
    fleetState.empirePeak = fleetState.empirePnl;
  }

  // Drawdown calculation
  fleetState.empireDrawdown = fleetState.empirePeak > 0
    ? parseFloat(((fleetState.empirePeak - fleetState.empirePnl) / Math.max(fleetState.empirePeak, 1) * 100).toFixed(2))
    : 0;

  // Recovery mode check
  if (fleetState.empireDrawdown > 15 && !fleetState.recoveryMode) {
    fleetState.recoveryMode = true;
    fleetState.recoveryStartPnl = fleetState.empirePnl;
    addIntelligence('🔄 RECOVERY MODE ACTIVATED — positions sized at 50% until drawdown recovered', 'CRITICAL');
  }
  if (fleetState.recoveryMode && fleetState.empiroPnl >= (fleetState.recoveryStartPnl || 0)) {
    fleetState.recoveryMode = false;
    addIntelligence('✅ RECOVERY MODE COMPLETE — full position sizing restored', 'INFO');
  }

  // Empire regime — majority vote
  const regimes = Object.values(fleetState.bots)
    .filter(b => b.regime !== 'UNKNOWN')
    .map(b => b.regime);
  const regimeCounts = regimes.reduce((acc, r) => { acc[r] = (acc[r] || 0) + 1; return acc; }, {});
  fleetState.empireRegime = Object.keys(regimeCounts).sort((a, b) => regimeCounts[b] - regimeCounts[a])[0] || 'UNKNOWN';

  // Run correlation analysis
  calculateFleetCorrelation(allPositions);

  // Run ticker registry sync
  syncTickerRegistry(allPositions);

  // Rebalance allocation every 10 syncs
  if (fleetState.syncCount % 10 === 0) {
    rebalanceAllocation();
  }

  // Broadcast to dashboard
  broadcast('FLEET_UPDATE', getSnapshot());

  const onlineCount = Object.values(fleetState.bots).filter(b => b.status === 'ONLINE').length;
  console.log(`🔱 META SYNC #${fleetState.syncCount} — ${onlineCount}/${Object.keys(FLEET).length} online | Empire P&L: $${fleetState.empirePnl.toFixed(2)} | Open: $${fleetState.empireOpenPnl.toFixed(2)}`);
}

function syncTickerRegistry(allPositions) {
  // Clear registry and rebuild from current positions
  tickerRegistry.active = {};
  for (const [bot, positions] of Object.entries(allPositions)) {
    for (const ticker of Object.keys(positions || {})) {
      tickerRegistry.active[ticker] = { bot, type: 'holding', since: tickerRegistry.active[ticker]?.since || new Date().toISOString() };
    }
  }
  saveJSON('registry.json', tickerRegistry);
}

// ── COMPONENT 6: COLLECTIVE INTELLIGENCE SYNTHESIS ──
let intelligence = loadJSON('intelligence.json', {
  signals: [],          // Active cross-fleet signals
  broadcasts: [],       // Signals broadcast to bots
  narratives: [],       // Active market narratives
  lastSynthesis: null
});

function addIntelligence(message, severity = 'INFO', targetBots = 'all') {
  const signal = { message, severity, targetBots, time: new Date().toISOString(), id: Date.now() };
  intelligence.signals = [signal, ...intelligence.signals].slice(0, 100);
  saveJSON('intelligence.json', intelligence);
  broadcast('INTEL_SIGNAL', signal);
  console.log(`🧠 META INTEL [${severity}]: ${message}`);
}

async function runCollectiveIntelligence() {
  if (!ANTHROPIC_KEY) return;

  const botSummaries = Object.entries(fleetState.bots).map(([name, bot]) => ({
    name: bot.displayName,
    status: bot.status,
    regime: bot.regime,
    pnl: bot.pnl,
    openPnl: bot.openPnl,
    winRate: bot.winRate,
    trades: bot.totalTrades,
    heat: (bot.heat * 100).toFixed(0) + '%',
    topPositions: Object.keys(bot.positions || {}).slice(0, 3)
  }));

  const correlData = {
    riskScore: correlationState.riskScore,
    topSectors: Object.entries(correlationState.fleetExposure).sort((a, b) => b[1] - a[1]).slice(0, 3),
    scenarioPnl: correlationState.scenarioPnl
  };

  const prompt = `You are NEXUS META BRAIN — Fleet Commander synthesizing collective intelligence.

Fleet Status:
${JSON.stringify(botSummaries, null, 2)}

Correlation Analysis:
${JSON.stringify(correlData, null, 2)}

Empire P&L: $${fleetState.empirePnl.toFixed(2)}
Empire Drawdown: ${fleetState.empireDrawdown.toFixed(1)}%
Recovery Mode: ${fleetState.recoveryMode}
Empire Regime: ${fleetState.empireRegime}

Synthesize cross-fleet intelligence:
1. What patterns are emerging across the fleet?
2. Are there concentration risks that need addressing?
3. Which bot should get more capital right now and why?
4. What macro signals should all bots be aware of?
5. Any urgent coordination needed between bots?

Return JSON: {
  "summary": "2 sentence fleet summary",
  "urgentSignals": [{"message":"...","severity":"CRITICAL|WARNING|INFO","targetBots":"all|brain|quantum|titan|titan_stock"}],
  "allocationRecommendation": {"reasoning":"...","changes":[{"bot":"...","action":"INCREASE|DECREASE|HOLD","reason":"..."}]},
  "narratives": ["active narrative 1", "narrative 2"],
  "concentrationAlert": true|false,
  "concentrationNote": "..."
}`;

  const result = await callClaude(prompt, 1200);
  if (!result) return;

  try {
    const match = result.match(/\{[\s\S]*\}/);
    if (!match) return;
    const data = JSON.parse(match[0]);

    // Process urgent signals
    for (const signal of (data.urgentSignals || [])) {
      addIntelligence(signal.message, signal.severity, signal.targetBots);
    }

    // Update narratives
    if (data.narratives?.length) {
      intelligence.narratives = data.narratives;
    }

    // Concentration alert
    if (data.concentrationAlert) {
      addIntelligence(`⚠️ CONCENTRATION ALERT: ${data.concentrationNote}`, 'WARNING');
    }

    intelligence.lastSynthesis = new Date().toISOString();
    intelligence.broadcasts = [{
      summary: data.summary,
      allocationRec: data.allocationRecommendation,
      time: new Date().toISOString()
    }, ...intelligence.broadcasts].slice(0, 20);

    saveJSON('intelligence.json', intelligence);
    broadcast('INTEL_UPDATE', { signals: intelligence.signals.slice(0, 20), narratives: intelligence.narratives, lastBroadcast: intelligence.broadcasts[0] });

    console.log(`🧠 META INTEL synthesis complete — ${data.urgentSignals?.length || 0} signals broadcast`);
  } catch (e) {
    console.error('Intel synthesis error:', e.message);
  }
}

// ── COMPONENT 7: DRAWDOWN RECOVERY COMMAND ──
let recoveryLog = loadJSON('recovery.json', { events: [], active: false });

async function activateRecoveryProtocol(reason) {
  fleetState.recoveryMode = true;
  fleetState.killSwitchActive = false;

  const event = {
    type: 'RECOVERY_ACTIVATED',
    reason,
    empirePnl: fleetState.empirePnl,
    drawdown: fleetState.empireDrawdown,
    time: new Date().toISOString()
  };

  recoveryLog.events = [event, ...recoveryLog.events].slice(0, 50);
  recoveryLog.active = true;
  saveJSON('recovery.json', recoveryLog);

  // Force immediate rebalance at 50% sizes
  rebalanceAllocation();
  addIntelligence(`🔄 RECOVERY PROTOCOL: ${reason} — All positions sized at 50% until recovery confirmed`, 'CRITICAL');
  broadcast('RECOVERY_MODE', { active: true, reason });
}

// ── COMPONENT 8: EMPIRE KILL SWITCH ──
let killLog = loadJSON('killswitch.json', { events: [] });

async function triggerKillSwitch(reason, jorge = false) {
  fleetState.killSwitchActive = true;
  fleetState.killSwitchReason = reason;

  const event = { reason, triggeredBy: jorge ? 'JORGE' : 'AUTO', time: new Date().toISOString(), empirePnl: fleetState.empirePnl };
  killLog.events = [event, ...killLog.events].slice(0, 50);
  saveJSON('killswitch.json', killLog);

  addIntelligence(`☠️ KILL SWITCH: ${reason}`, 'CRITICAL');
  broadcast('KILL_SWITCH_ACTIVE', { active: true, reason, time: event.time });
  console.log(`☠️ EMPIRE KILL SWITCH TRIGGERED: ${reason}`);
}

function resumeEmpire(jorge = false) {
  fleetState.killSwitchActive = false;
  fleetState.killSwitchReason = null;

  const event = { action: 'RESUME', by: jorge ? 'JORGE' : 'AUTO', time: new Date().toISOString() };
  killLog.events = [event, ...killLog.events].slice(0, 50);
  saveJSON('killswitch.json', killLog);

  addIntelligence('✅ Empire RESUMED — Kill switch deactivated', 'INFO');
  broadcast('KILL_SWITCH_INACTIVE', { active: false });
}

// Auto kill switch triggers
function checkAutoKill() {
  // Daily loss limit — $500
  const dailyLoss = Object.values(fleetState.bots).reduce((s, b) => s + Math.min(0, b.dailyPnl || 0), 0);
  if (dailyLoss <= -500 && !fleetState.killSwitchActive) {
    triggerKillSwitch(`Daily loss limit reached: $${Math.abs(dailyLoss).toFixed(2)}`);
    return;
  }
  // Drawdown limit — 20%
  if (fleetState.empireDrawdown >= 20 && !fleetState.killSwitchActive) {
    triggerKillSwitch(`Empire drawdown ${fleetState.empireDrawdown.toFixed(1)}% exceeds 20% limit`);
    return;
  }
}

// ── CLAUDE API ──
async function callClaude(prompt, maxTokens = 800) {
  if (!ANTHROPIC_KEY) return null;
  try {
    const resp = await axios.post('https://api.anthropic.com/v1/messages', {
      model: MODEL,
      max_tokens: maxTokens,
      messages: [{ role: 'user', content: prompt }]
    }, {
      headers: { 'Content-Type': 'application/json', 'x-api-key': ANTHROPIC_KEY, 'anthropic-version': '2023-06-01' },
      timeout: 30000
    });
    return resp.data?.content?.[0]?.text || null;
  } catch (e) {
    console.error('Claude API error:', e.message);
    return null;
  }
}

// ── BROADCAST ──
function broadcast(type, data) {
  const msg = JSON.stringify({ type, data, ts: Date.now() });
  wss.clients.forEach(c => { if (c.readyState === WebSocket.OPEN) try { c.send(msg); } catch (e) {} });
}

// ── SNAPSHOT ──
function getSnapshot() {
  return {
    fleetState,
    allocation: allocation.current,
    correlation: {
      exposure: correlationState.fleetExposure,
      riskScore: correlationState.riskScore,
      scenarioPnl: correlationState.scenarioPnl,
      lastCalculated: correlationState.lastCalculated
    },
    registry: getRegistryStatus(),
    intelligence: {
      signals: intelligence.signals.slice(0, 20),
      narratives: intelligence.narratives,
      lastBroadcast: intelligence.broadcasts[0] || null
    },
    killSwitch: { active: fleetState.killSwitchActive, reason: fleetState.killSwitchReason },
    recovery: { active: fleetState.recoveryMode },
    serverTime: new Date().toISOString()
  };
}

// ── SCHEDULING ──
let syncInterval, intelInterval, allocationInterval;

function startSchedules() {
  // Fleet sync — every 30 seconds
  syncInterval = setInterval(() => syncFleet(), 30 * 1000);

  // Collective intelligence — every 10 minutes
  intelInterval = setInterval(() => {
    runCollectiveIntelligence();
    checkAutoKill();
  }, 10 * 60 * 1000);

  // Initial runs
  setTimeout(() => syncFleet(), 2000);
  setTimeout(() => runCollectiveIntelligence(), 20000);
  setTimeout(() => rebalanceAllocation(), 5000);
}

// ── REST API ──
app.get('/health', (req, res) => res.json({ status: 'ok', syncs: fleetState.syncCount }));
app.get('/api/snapshot', (req, res) => res.json(getSnapshot()));
app.get('/api/fleet', (req, res) => res.json(fleetState));
app.get('/api/allocation', (req, res) => res.json(allocation));
app.get('/api/correlation', (req, res) => res.json(correlationState));
app.get('/api/registry', (req, res) => res.json(tickerRegistry));
app.get('/api/intelligence', (req, res) => res.json(intelligence));
app.get('/api/killswitch', (req, res) => res.json(killLog));

// Registry endpoints for bots
app.post('/api/registry/check', (req, res) => {
  const { ticker, bot } = req.body;
  const existing = tickerRegistry.active[ticker];
  if (existing && existing.bot !== bot) {
    res.json({ allowed: false, owner: existing.bot, ownerDisplay: FLEET[existing.bot]?.displayName || existing.bot });
  } else {
    registerTicker(ticker, bot, 'analyzing');
    res.json({ allowed: true });
  }
});

app.post('/api/registry/release', (req, res) => {
  const { ticker, bot } = req.body;
  deregisterTicker(ticker, bot);
  res.json({ released: true });
});

// Kill switch
app.post('/api/killswitch/activate', async (req, res) => {
  const { reason } = req.body;
  await triggerKillSwitch(reason || 'Manual activation by Jorge', true);
  res.json({ activated: true });
});

app.post('/api/killswitch/resume', (req, res) => {
  resumeEmpire(true);
  res.json({ resumed: true });
});

// Recovery
app.post('/api/recovery/activate', async (req, res) => {
  const { reason } = req.body;
  await activateRecoveryProtocol(reason || 'Manual activation');
  res.json({ activated: true });
});

app.post('/api/recovery/deactivate', (req, res) => {
  fleetState.recoveryMode = false;
  recoveryLog.active = false;
  saveJSON('recovery.json', recoveryLog);
  addIntelligence('✅ Recovery mode manually deactivated', 'INFO');
  res.json({ deactivated: true });
});

// Capital allocation
app.get('/api/allocation/rebalance', (req, res) => {
  const newAlloc = rebalanceAllocation();
  res.json({ allocation: newAlloc });
});

app.post('/api/capital', (req, res) => {
  const { amount } = req.body;
  if (amount && amount > 0) {
    fleetState.totalCapital = parseFloat(amount);
    rebalanceAllocation();
    res.json({ totalCapital: fleetState.totalCapital });
  } else {
    res.status(400).json({ error: 'Invalid amount' });
  }
});

// Force intelligence synthesis
app.post('/api/intelligence/run', async (req, res) => {
  res.json({ message: 'Synthesis running...' });
  await runCollectiveIntelligence();
});

// WebSocket
wss.on('connection', ws => {
  console.log('📱 META BRAIN dashboard connected');
  ws.send(JSON.stringify({ type: 'SNAPSHOT', data: getSnapshot(), ts: Date.now() }));
});

// ── STARTUP ──
server.listen(PORT, () => {
  console.log('');
  console.log('╔══════════════════════════════════════════════════════════════╗');
  console.log('║   NEXUS META BRAIN — Fleet Commander V4.0                    ║');
  console.log('║   Capital Allocation · Correlation · Collective Intelligence  ║');
  console.log('║   No Ceiling — Dynasty Not A Trade — Strong Together          ║');
  console.log('╚══════════════════════════════════════════════════════════════╝');
  console.log('');
  console.log(`🌌 Claude AI:       ${ANTHROPIC_KEY ? '✅' : '❌ No key'}`);
  console.log(`💰 Total Capital:   $${TOTAL_CAPITAL.toLocaleString()}`);
  console.log(`🔱 Fleet:           ${Object.keys(FLEET).map(k => FLEET[k].displayName).join(' · ')}`);
  console.log(`   Add bot:         BOT_[NAME]=https://url (Railway env var)`);
  console.log(`   Remove bot:      Delete env var — zero data loss`);
  console.log('');
  console.log('⚡ Starting fleet coordination...');
  startSchedules();
  console.log('✅ NEXUS META BRAIN V4.0 — Fleet Commander online');
});
