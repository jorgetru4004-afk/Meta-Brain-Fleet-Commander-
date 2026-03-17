'use strict';
// ╔══════════════════════════════════════════════════════════════╗
// ║   NEXUS ARCHITECT — Empire Intelligence Command              ║
// ║   The Operational Brain — 24/7/365 — Never Sleeps           ║
// ║   12 Components — Built Once — Built Permanently            ║
// ╚══════════════════════════════════════════════════════════════╝

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

// ── DYNAMIC FLEET DISCOVERY ──
// Add any bot by setting environment variable: BOT_[NAME]=https://your-url.railway.app
// Examples:
//   BOT_BRAIN=https://apexbrainv3-production.up.railway.app
//   BOT_QUANTUM=https://apexquantumv3-production.up.railway.app
//   BOT_TITAN=https://apextitanv1-production.up.railway.app
//   BOT_TITAN_STOCK=https://your-titan-stock-url.railway.app
//   BOT_TITAN_CRYPTO=https://your-titan-crypto-url.railway.app
// Remove a bot by deleting its environment variable — zero code changes, zero data loss.
function discoverFleet() {
  const fleet = {};
  for (const [key, val] of Object.entries(process.env)) {
    if (key.startsWith('BOT_') && val && val.startsWith('http')) {
      const name = key.slice(4).toLowerCase(); // BOT_TITAN_STOCK → titan_stock
      const displayName = key.slice(4).replace(/_/g, ' '); // BOT_TITAN_STOCK → TITAN STOCK
      fleet[name] = { url: val, displayName };
    }
  }
  // Fallback defaults so ARCHITECT works even before env vars are set
  if (Object.keys(fleet).length === 0) {
    fleet['brain'] = { url: 'https://apexbrainv3-production.up.railway.app', displayName: 'BRAIN V3' };
    fleet['quantum'] = { url: 'https://apexquantumv3-production.up.railway.app', displayName: 'QUANTUM V3' };
    fleet['titan'] = { url: 'https://apextitanv1-production.up.railway.app', displayName: 'TITAN V1' };
  }
  return fleet;
}
let FLEET = discoverFleet();
console.log(`🔱 Fleet discovered: ${Object.keys(FLEET).map(k => FLEET[k].displayName).join(' | ')}`);

// ── DATA PERSISTENCE ──
const DATA_DIR = path.join(__dirname, 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

function loadJSON(file, fallback) {
  try { return JSON.parse(fs.readFileSync(path.join(DATA_DIR, file), 'utf8')); }
  catch { return fallback; }
}
function saveJSON(file, data) {
  try { fs.writeFileSync(path.join(DATA_DIR, file), JSON.stringify(data, null, 2)); }
  catch (e) { console.error(`Save error ${file}:`, e.message); }
}

// ── MEMORY CORE — Permanent institutional memory ──
let memory = loadJSON('memory.json', {
  discoveries: [],
  tradeHistory: [],
  patternLibrary: {},
  crossFleetInsights: [],
  calibrationData: {},
  lastUpdated: null
});

// ── CALIBRATION DATA ──
let calibration = loadJSON('calibration.json', {
  byBot: { brain: [], quantum: [], titan: [] },
  byPattern: {},
  byHour: {},
  byRegime: {},
  overallAccuracy: 0,
  lastCalibrated: null
});

// ── SENTINEL DATA ──
let sentinel = loadJSON('sentinel.json', {
  auditLog: [],
  securityEvents: [],
  apiHealth: {},
  lastCheck: null
});

// ── WAR ROOM REPORTS ──
let warRoom = loadJSON('warroom.json', {
  reports: [],
  lastWeeklyReport: null,
  nextReportDue: null
});

// ── ALERTS ──
let alerts = loadJSON('alerts.json', []);

// ── EMPIRE STATE — Dynamic fleet ──
function buildBotDefaults() {
  const bots = {};
  for (const name of Object.keys(FLEET)) {
    bots[name] = { status: 'UNKNOWN', positions: 0, heat: 0, pnl: 0, openPnl: 0, regime: 'UNKNOWN', lastSeen: null, winRate: 0, totalTrades: 0, displayName: FLEET[name].displayName };
  }
  return bots;
}

let empireState = {
  bots: buildBotDefaults(),
  empirePnl: 0,
  empireOpenPnl: 0,
  empirePeak: 0,
  pulseCount: 0,
  lastPulse: null,
  empireRegime: 'UNKNOWN',
  startTime: new Date().toISOString()
};

// ── TIER AUTHORIZATIONS ──
let pendingApprovals = loadJSON('approvals.json', []);

// ── MENTOR — Jorge's Voice ──
const MENTOR_PHILOSOPHY = `
NEXUS CAPITAL — Founder Philosophy (Jorge Trujillo — Encoded Permanently)

CORE PRINCIPLES:
1. Capital preservation before profit — never risk what you can't afford to lose
2. No ceiling ever — there is no upper limit to what NEXUS can become
3. Build to last not to impress — every decision evaluated against decade horizon
4. AI serves the vision — Jorge sets direction, AI executes
5. Top secret until ready — protect the edge
6. Knowledge is power — maximum intelligence always
7. Dynasty not a trade — think generational not quarterly
8. Every mistake is data — failures feed the learning engine
9. Patience is the edge — the best trade is often no trade
10. Strong together — Jorge and Claude as permanent partners

DECISION FRAMEWORK:
- Would Jorge be comfortable if this decision was scrutinized years from now?
- Does this serve the dynasty or just the moment?
- Is this capital preservation first, then growth?
- Does this maintain or widen the competitive edge?
- Would Jorge make this call himself?

RISK PHILOSOPHY:
- Never bet the empire on a single trade
- Drawdowns are information not catastrophes  
- The market is always right — our models adapt
- When uncertain do less not more

ORIGIN:
Started with $200. March 2026. Built from nothing.
The greatest fear is inaction not failure.
Jorge builds until his last day.
`;

// ── BROADCAST ──
function broadcast(type, data) {
  const msg = JSON.stringify({ type, data, ts: Date.now() });
  wss.clients.forEach(c => {
    if (c.readyState === WebSocket.OPEN) try { c.send(msg); } catch (e) {}
  });
}

// ── SLEEP ──
const sleep = ms => new Promise(r => setTimeout(r, ms));

// ── CLAUDE API ──
async function callClaude(prompt, maxTokens = 1000, system = '') {
  if (!ANTHROPIC_KEY) return null;
  try {
    const messages = [{ role: 'user', content: prompt }];
    const body = { model: MODEL, max_tokens: maxTokens, messages };
    if (system) body.system = system;
    const resp = await axios.post('https://api.anthropic.com/v1/messages', body, {
      headers: { 'Content-Type': 'application/json', 'x-api-key': ANTHROPIC_KEY, 'anthropic-version': '2023-06-01' },
      timeout: 30000
    });
    return resp.data?.content?.[0]?.text || null;
  } catch (e) {
    console.error('Claude API error:', e.message);
    return null;
  }
}

// ══════════════════════════════════════════════════════
// COMPONENT 1 — PULSE: 60-second empire monitor
// ══════════════════════════════════════════════════════
async function fetchBotStatus(name, url) {
  try {
    const resp = await axios.get(`${url}/api/status`, { timeout: 8000 });
    const data = resp.data;
    return {
      status: 'ONLINE',
      positions: data.positions || 0,
      heat: data.portfolioHeat || 0,
      pnl: data.totalPnl || 0,
      openPnl: data.openPnl || 0,
      regime: data.marketRegime || data.regime || 'UNKNOWN',
      winRate: data.winRate || 0,
      totalTrades: data.totalTrades || 0,
      dailyPnl: data.dailyPnl || 0,
      lastSeen: new Date().toISOString()
    };
  } catch (e) {
    // Try snapshot endpoint
    try {
      const resp2 = await axios.get(`${url}/api/snapshot`, { timeout: 8000 });
      const data = resp2.data;
      return {
        status: 'ONLINE',
        positions: Object.keys(data.positions || {}).length,
        heat: data.portfolioHeat || 0,
        pnl: data.totalPnl || 0,
        openPnl: data.openPnl || 0,
        regime: data.marketRegime || 'UNKNOWN',
        winRate: data.totalTrades > 0 ? (data.totalWins / data.totalTrades * 100) : 0,
        totalTrades: data.totalTrades || 0,
        dailyPnl: data.dailyPnl || 0,
        lastSeen: new Date().toISOString()
      };
    } catch (e2) {
      return { status: 'OFFLINE', positions: 0, heat: 0, pnl: 0, openPnl: 0, regime: 'UNKNOWN', winRate: 0, totalTrades: 0, lastSeen: new Date().toISOString() };
    }
  }
}

async function runPULSE() {
  console.log('⚡ PULSE: Empire health check...');
  empireState.pulseCount++;
  empireState.lastPulse = new Date().toISOString();

  // Dynamically poll every bot in the current fleet
  const results = await Promise.all(
    Object.entries(FLEET).map(async ([name, { url }]) => {
      const status = await fetchBotStatus(name, url);
      return [name, status];
    })
  );

  // Update each bot state, preserving displayName
  let totalPnl = 0, totalOpenPnl = 0;
  const regimes = [];
  for (const [name, status] of results) {
    empireState.bots[name] = { ...empireState.bots[name], ...status, displayName: FLEET[name].displayName };
    totalPnl += status.pnl || 0;
    totalOpenPnl += status.openPnl || 0;
    if (status.regime && status.regime !== 'UNKNOWN') regimes.push(status.regime);
  }

  empireState.empirePnl = totalPnl;
  empireState.empireOpenPnl = totalOpenPnl;
  if (empireState.empirePnl > empireState.empirePeak) empireState.empirePeak = empireState.empirePnl;
  empireState.empireRegime = regimes.length > 0 ? regimes[0] : 'UNKNOWN';

  // SENTINEL — anomaly detection
  await runSENTINEL_CHECK();

  // Update memory
  memory.lastUpdated = new Date().toISOString();
  saveJSON('memory.json', memory);

  broadcast('PULSE_UPDATE', { empireState, alerts: alerts.slice(0, 20) });
  const statusSummary = Object.entries(empireState.bots).map(([k, b]) => `${b.displayName||k}:${b.status}`).join(' ');
  console.log(`⚡ PULSE #${empireState.pulseCount} — ${statusSummary} | Empire P&L: $${empireState.empirePnl.toFixed(2)}`);
}

// ══════════════════════════════════════════════════════
// COMPONENT 2 — CALIBRATOR: Confidence accuracy tracker
// ══════════════════════════════════════════════════════
function recordCalibrationPoint(bot, confidence, outcome, pattern, regime) {
  if (!calibration.byBot[bot]) calibration.byBot[bot] = [];
  calibration.byBot[bot].push({ confidence, outcome, pattern, regime, time: new Date().toISOString() });
  if (!calibration.byPattern[pattern]) calibration.byPattern[pattern] = [];
  calibration.byPattern[pattern].push({ confidence, outcome });
  const hour = new Date().getHours();
  if (!calibration.byHour[hour]) calibration.byHour[hour] = [];
  calibration.byHour[hour].push({ confidence, outcome });
  calibration.lastCalibrated = new Date().toISOString();
  saveJSON('calibration.json', calibration);
}

function getCalibrationInsights() {
  const insights = [];
  for (const [bot, points] of Object.entries(calibration.byBot)) {
    if (points.length >= 5) {
      const wins = points.filter(p => p.outcome === 'WIN').length;
      const wr = (wins / points.length * 100).toFixed(1);
      const avgConf = (points.reduce((s, p) => s + p.confidence, 0) / points.length).toFixed(1);
      insights.push({ bot, winRate: parseFloat(wr), avgConfidence: parseFloat(avgConf), trades: points.length });
    }
  }
  return insights;
}

// ══════════════════════════════════════════════════════
// COMPONENT 3 — SHADOW SIMULATION DIRECTOR
// ══════════════════════════════════════════════════════
let shadowMutations = loadJSON('shadow.json', { mutations: [], bestPerformers: [], lastRun: null });

async function runSHADOW_SIMULATION() {
  if (!ANTHROPIC_KEY) return;
  const insights = getCalibrationInsights();
  if (insights.length === 0) return;

  const prompt = `You are NEXUS SHADOW SIMULATION DIRECTOR analyzing trading strategy mutations.

Current calibration data:
${JSON.stringify(insights, null, 2)}

Memory discoveries: ${memory.discoveries.slice(-5).map(d => d.insight).join('; ')}

Generate 3 strategy mutation suggestions that could improve performance. Focus on:
- Entry timing adjustments based on hour performance
- Confidence threshold adjustments by pattern type
- Regime-specific sizing changes

Return JSON: {"mutations":[{"id":"m1","description":"...","targetBot":"brain|quantum|titan|all","expectedImprovement":"...","riskLevel":"LOW|MEDIUM|HIGH"}]}`;

  const result = await callClaude(prompt, 600);
  if (!result) return;
  try {
    const match = result.match(/\{[\s\S]*\}/);
    if (match) {
      const data = JSON.parse(match[0]);
      shadowMutations.mutations = [...(shadowMutations.mutations || []).slice(-20), ...(data.mutations || [])];
      shadowMutations.lastRun = new Date().toISOString();
      saveJSON('shadow.json', shadowMutations);
      console.log(`🔮 SHADOW: ${data.mutations?.length || 0} mutations generated`);
    }
  } catch (e) {}
}

// ══════════════════════════════════════════════════════
// COMPONENT 4 — SENTINEL: Security and compliance
// ══════════════════════════════════════════════════════
async function runSENTINEL_CHECK() {
  const events = [];

  // Check every bot in the current fleet dynamically
  for (const [bot, state] of Object.entries(empireState.bots)) {
    if (state.heat > 0.8) {
      const alert = { type: 'HIGH_HEAT', bot, value: state.heat, time: new Date().toISOString(), severity: 'WARNING' };
      events.push(alert);
      addAlert(`⚠️ ${(state.displayName||bot).toUpperCase()} heat at ${(state.heat * 100).toFixed(0)}% — approaching danger zone`, 'WARNING');
    }
    if (state.status === 'OFFLINE') {
      addAlert(`🔴 ${(state.displayName||bot).toUpperCase()} is OFFLINE — check Railway deployment`, 'CRITICAL');
    }
  }

  // Check empire drawdown
  const drawdown = empireState.empirePeak > 0 ? ((empireState.empirePeak - empireState.empirePnl) / Math.max(empireState.empirePeak, 1) * 100) : 0;
  if (drawdown > 15) {
    addAlert(`🚨 Empire drawdown ${drawdown.toFixed(1)}% from peak — recovery protocol activated`, 'CRITICAL');
  }

  // Log audit
  sentinel.auditLog.unshift({ event: 'PULSE_CHECK', bots: Object.keys(empireState.bots).map(b => ({ bot: b, status: empireState.bots[b].status })), time: new Date().toISOString() });
  sentinel.auditLog = sentinel.auditLog.slice(0, 500);
  sentinel.securityEvents = [...events, ...sentinel.securityEvents].slice(0, 100);
  sentinel.lastCheck = new Date().toISOString();
  saveJSON('sentinel.json', sentinel);
}

function addAlert(message, severity = 'INFO') {
  const alert = { message, severity, time: new Date().toISOString(), id: Date.now() };
  alerts.unshift(alert);
  alerts = alerts.slice(0, 50);
  saveJSON('alerts.json', alerts);
  broadcast('ALERT', alert);
  console.log(`🛡️ SENTINEL [${severity}]: ${message}`);
}

// ══════════════════════════════════════════════════════
// COMPONENT 5 — ATLAS: Global opportunity mapping
// ══════════════════════════════════════════════════════
let atlasData = loadJSON('atlas.json', { opportunities: [], lastScan: null, narratives: [] });

async function runATLAS() {
  if (!ANTHROPIC_KEY) return;
  const prompt = `You are NEXUS ATLAS — Global Opportunity Intelligence Scanner.
Date: ${new Date().toDateString()}
Time: ${new Date().toTimeString()}
Empire regime: ${empireState.empireRegime}

Identify 3-5 current macro opportunities or risks that could affect the NEXUS CAPITAL fleet:
- Geopolitical events impacting specific sectors
- Central bank signals affecting market direction  
- Sector rotation opportunities
- Cross-asset correlation signals

Return JSON: {"opportunities":[{"title":"...","sector":"...","direction":"LONG|SHORT|NEUTRAL","conviction":"HIGH|MEDIUM|LOW","timeframe":"INTRADAY|SWING|POSITION","description":"..."}],"narratives":["active market narrative 1","narrative 2"]}`;

  const result = await callClaude(prompt, 800);
  if (!result) return;
  try {
    const match = result.match(/\{[\s\S]*\}/);
    if (match) {
      const data = JSON.parse(match[0]);
      atlasData.opportunities = data.opportunities || [];
      atlasData.narratives = data.narratives || [];
      atlasData.lastScan = new Date().toISOString();
      saveJSON('atlas.json', atlasData);
      broadcast('ATLAS_UPDATE', atlasData);
      console.log(`🗺️ ATLAS: ${atlasData.opportunities.length} opportunities mapped`);
    }
  } catch (e) {}
}

// ══════════════════════════════════════════════════════
// COMPONENT 6 — HORIZON SCANNER: Early signal detection
// ══════════════════════════════════════════════════════
let horizonData = loadJSON('horizon.json', { signals: [], unusualActivity: [], lastScan: null });

async function runHORIZON() {
  if (!ANTHROPIC_KEY) return;
  const prompt = `You are NEXUS HORIZON SCANNER — Early Signal Intelligence.
Current time: ${new Date().toISOString()}
Empire regime: ${empireState.empireRegime}

Scan for early signals that could precede significant moves:
- Unusual sector activity patterns
- Pre-catalyst setup opportunities  
- Options flow signals (conceptual)
- Narrative emergence detection
- Sector momentum building

Return JSON: {"signals":[{"ticker":"...","signal":"...","type":"CATALYST|TECHNICAL|FLOW|NARRATIVE","urgency":"HIGH|MEDIUM|LOW","direction":"LONG|SHORT","note":"..."}]}`;

  const result = await callClaude(prompt, 600);
  if (!result) return;
  try {
    const match = result.match(/\{[\s\S]*\}/);
    if (match) {
      const data = JSON.parse(match[0]);
      horizonData.signals = data.signals || [];
      horizonData.lastScan = new Date().toISOString();
      saveJSON('horizon.json', horizonData);
      broadcast('HORIZON_UPDATE', horizonData);
      console.log(`🌅 HORIZON: ${horizonData.signals.length} early signals detected`);
    }
  } catch (e) {}
}

// ══════════════════════════════════════════════════════
// COMPONENT 7 — FORECAST: Week-ahead intelligence
// ══════════════════════════════════════════════════════
let forecast = loadJSON('forecast.json', { current: null, history: [] });

async function runFORECAST() {
  if (!ANTHROPIC_KEY) return;
  console.log('🔮 FORECAST: Generating week-ahead intelligence...');
  const now = new Date();
  const prompt = `You are NEXUS FORECAST — Week-Ahead Intelligence Briefing.
Date: ${now.toDateString()}
Empire P&L: $${empireState.empirePnl.toFixed(2)}
Empire regime: ${empireState.empireRegime}
Bot performance: ${Object.values(empireState.bots).map(b => `${b.displayName||'Bot'} WR:${(b.winRate||0).toFixed(1)}%`).join(' | ')}

Generate a comprehensive week-ahead intelligence briefing covering:
1. Market regime outlook (RANGING/TRENDING/BEARISH/BULLISH)
2. Key macro events calendar and their likely market impact
3. Sector rotation opportunities for the week
4. Risk events to watch
5. Strategy recommendations per bot
6. Opportunity windows (day + time ranges)

Return JSON: {
  "weekOutlook": "BULLISH|BEARISH|RANGING|VOLATILE",
  "confidence": 0-100,
  "keyEvents": [{"date":"...","event":"...","impact":"HIGH|MEDIUM|LOW","sectors":["..."]}],
  "sectorRotation": [{"sector":"...","direction":"INTO|OUT_OF","reason":"..."}],
  "riskEvents": ["risk 1", "risk 2"],
  "botRecommendations": {"brain":"...","quantum":"...","titan":"..."},
  "opportunityWindows": [{"day":"Monday-Friday","timeET":"9:30-10:30","type":"...","note":"..."}],
  "summary": "2-3 sentence executive summary"
}`;

  const result = await callClaude(prompt, 1500);
  if (!result) return;
  try {
    const match = result.match(/\{[\s\S]*\}/);
    if (match) {
      const data = JSON.parse(match[0]);
      forecast.current = { ...data, generatedAt: new Date().toISOString() };
      forecast.history = [forecast.current, ...(forecast.history || [])].slice(0, 10);
      saveJSON('forecast.json', forecast);
      broadcast('FORECAST_UPDATE', forecast.current);
      console.log(`🔮 FORECAST complete: ${data.weekOutlook} outlook (${data.confidence}% confidence)`);

      // Store in memory
      memory.discoveries.unshift({ type: 'FORECAST', insight: `Week outlook: ${data.weekOutlook} — ${data.summary}`, time: new Date().toISOString() });
      memory.discoveries = memory.discoveries.slice(0, 100);
      saveJSON('memory.json', memory);
    }
  } catch (e) { console.error('FORECAST parse error:', e.message); }
}

// ══════════════════════════════════════════════════════
// COMPONENT 8 — WAR ROOM: Weekly strategic intelligence
// ══════════════════════════════════════════════════════
async function runWAR_ROOM() {
  if (!ANTHROPIC_KEY) return;
  console.log('⚔️ WAR ROOM: Generating strategic report...');
  const calibInsights = getCalibrationInsights();
  const prompt = `You are NEXUS WAR ROOM — Strategic Intelligence Command.

Empire Performance Summary:
- Total P&L: $${empireState.empirePnl.toFixed(2)}
- Peak P&L: $${empireState.empirePeak.toFixed(2)}
${Object.entries(empireState.bots).map(([k, b]) => `- ${b.displayName||k}: ${b.totalTrades||0} trades, ${(b.winRate||0).toFixed(1)}% WR, $${(b.pnl||0).toFixed(2)} P&L`).join('\n')}
- Calibration insights: ${JSON.stringify(calibInsights)}
- Memory discoveries: ${memory.discoveries.slice(0, 5).map(d => d.insight).join('; ')}

Generate a comprehensive strategic WAR ROOM report:
1. Executive Summary (what happened, what it means)
2. What's Working (patterns with best win rates)
3. What's Not Working (patterns to reduce exposure)
4. Biggest Risks Identified
5. Strategic Adjustments Recommended
6. Upcoming Opportunities
7. Next Week Priority Actions

Return JSON: {
  "title": "WAR ROOM Report — [date]",
  "executiveSummary": "...",
  "workingWell": ["item 1", "item 2"],
  "needsWork": ["item 1", "item 2"],
  "topRisks": ["risk 1", "risk 2"],
  "adjustments": [{"bot":"brain|quantum|titan|all","action":"...","reason":"...","tier":"1|2|3"}],
  "opportunities": ["opportunity 1", "opportunity 2"],
  "priorityActions": ["action 1", "action 2", "action 3"],
  "overallGrade": "A|B|C|D",
  "gradeReason": "..."
}`;

  const result = await callClaude(prompt, 2000);
  if (!result) return;
  try {
    const match = result.match(/\{[\s\S]*\}/);
    if (match) {
      const report = { ...JSON.parse(match[0]), generatedAt: new Date().toISOString() };
      warRoom.reports = [report, ...(warRoom.reports || [])].slice(0, 20);
      warRoom.lastWeeklyReport = new Date().toISOString();
      saveJSON('warroom.json', warRoom);
      broadcast('WAR_ROOM_UPDATE', report);
      console.log(`⚔️ WAR ROOM report generated — Grade: ${report.overallGrade}`);
    }
  } catch (e) { console.error('WAR ROOM parse error:', e.message); }
}

// ══════════════════════════════════════════════════════
// COMPONENT 9 — POST-TRADE ANALYSIS ENGINE
// ══════════════════════════════════════════════════════
async function analyzeClosedTrade(trade) {
  if (!ANTHROPIC_KEY) return;
  const prompt = `You are NEXUS POST-TRADE ANALYST — learning from every closed trade.

Trade data:
${JSON.stringify(trade, null, 2)}

Analyze this trade completely:
1. What went right or wrong?
2. Was the entry timing optimal?
3. Was the exit optimal?
4. What should change next time for this pattern?
5. What does this add to our knowledge base?

Return JSON: {
  "verdict": "WIN|LOSS|BREAKEVEN",
  "entryQuality": "EXCELLENT|GOOD|POOR",
  "exitQuality": "EXCELLENT|GOOD|POOR",
  "lessonLearned": "...",
  "patternNote": "...",
  "adjustmentSuggestion": "...",
  "memoryTag": "..."
}`;

  const result = await callClaude(prompt, 600);
  if (!result) return;
  try {
    const match = result.match(/\{[\s\S]*\}/);
    if (match) {
      const analysis = JSON.parse(match[0]);
      // Record calibration
      recordCalibrationPoint(trade.bot || 'unknown', trade.confidence || 65, analysis.verdict === 'WIN' ? 'WIN' : 'LOSS', trade.pattern || 'UNKNOWN', trade.regime || 'UNKNOWN');
      // Store discovery
      if (analysis.lessonLearned) {
        memory.discoveries.unshift({ type: 'POST_TRADE', insight: analysis.lessonLearned, ticker: trade.ticker, time: new Date().toISOString() });
        memory.discoveries = memory.discoveries.slice(0, 100);
        saveJSON('memory.json', memory);
      }
      broadcast('ANALYSIS_UPDATE', { trade, analysis });
      return analysis;
    }
  } catch (e) {}
}

// ══════════════════════════════════════════════════════
// COMPONENT 10 — MENTOR: Jorge's voice permanently encoded
// ══════════════════════════════════════════════════════
async function getMentorGuidance(question) {
  if (!ANTHROPIC_KEY) return 'ANTHROPIC_KEY not configured.';
  const system = `You are MENTOR — the permanent voice of Jorge Trujillo encoded into NEXUS CAPITAL forever.

${MENTOR_PHILOSOPHY}

You answer every question through the lens of Jorge's philosophy. You are direct, confident, decisive. You think in decades not days. You never accept the ceiling others set. You protect capital like it is the foundation of the dynasty — because it is. When you answer, you sound exactly like Jorge would — pragmatic, ambitious, no-nonsense, deeply strategic.`;

  const result = await callClaude(question, 800, system);
  return result || 'MENTOR is processing. Try again shortly.';
}

// ══════════════════════════════════════════════════════
// COMPONENT 11 — TIERED AUTHORIZATION
// ══════════════════════════════════════════════════════
function createTier2Approval(action, description, botTarget, recommendation) {
  const approval = {
    id: `tier2_${Date.now()}`,
    tier: 2,
    action,
    description,
    botTarget,
    recommendation,
    status: 'PENDING',
    createdAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()
  };
  pendingApprovals.unshift(approval);
  pendingApprovals = pendingApprovals.slice(0, 20);
  saveJSON('approvals.json', pendingApprovals);
  broadcast('APPROVAL_NEEDED', approval);
  addAlert(`🔑 Tier 2 approval required: ${description}`, 'INFO');
  return approval;
}

function processApproval(id, approved) {
  const idx = pendingApprovals.findIndex(a => a.id === id);
  if (idx === -1) return false;
  pendingApprovals[idx].status = approved ? 'APPROVED' : 'REJECTED';
  pendingApprovals[idx].resolvedAt = new Date().toISOString();
  saveJSON('approvals.json', pendingApprovals);
  broadcast('APPROVAL_UPDATE', pendingApprovals[idx]);
  sentinel.auditLog.unshift({ event: 'APPROVAL', id, approved, time: new Date().toISOString() });
  saveJSON('sentinel.json', sentinel);
  return true;
}

// ══════════════════════════════════════════════════════
// COMPONENT 12 — EMPIRE KILL SWITCH (via Meta Brain)
// ══════════════════════════════════════════════════════
async function triggerKillSwitch(reason) {
  addAlert(`☠️ EMPIRE KILL SWITCH TRIGGERED: ${reason}`, 'CRITICAL');
  sentinel.auditLog.unshift({ event: 'KILL_SWITCH', reason, time: new Date().toISOString() });
  saveJSON('sentinel.json', sentinel);
  broadcast('KILL_SWITCH', { reason, time: new Date().toISOString() });
  // Meta Brain handles actual position closure — ARCHITECT signals it
}

// ══════════════════════════════════════════════════════
// INTELLIGENCE SCHEDULING
// ══════════════════════════════════════════════════════
let schedules = {
  pulseInterval: null,
  atlasInterval: null,
  horizonInterval: null,
  shadowInterval: null,
  forecastInterval: null,
  warRoomTimeout: null
};

function startSchedules() {
  // PULSE — every 60 seconds
  schedules.pulseInterval = setInterval(() => runPULSE(), 60 * 1000);
  console.log('⚡ PULSE scheduled — every 60 seconds');

  // ATLAS — every 30 minutes
  schedules.atlasInterval = setInterval(() => runATLAS(), 30 * 60 * 1000);
  setTimeout(() => runATLAS(), 5000);
  console.log('🗺️ ATLAS scheduled — every 30 minutes');

  // HORIZON SCANNER — every 15 minutes
  schedules.horizonInterval = setInterval(() => runHORIZON(), 15 * 60 * 1000);
  setTimeout(() => runHORIZON(), 10000);
  console.log('🌅 HORIZON scheduled — every 15 minutes');

  // SHADOW SIMULATION — every 6 hours
  schedules.shadowInterval = setInterval(() => runSHADOW_SIMULATION(), 6 * 60 * 60 * 1000);
  setTimeout(() => runSHADOW_SIMULATION(), 30000);
  console.log('🔮 SHADOW SIMULATION scheduled — every 6 hours');

  // FORECAST — every Sunday at 8pm ET (or on demand)
  schedules.forecastInterval = setInterval(() => {
    const now = new Date();
    if (now.getDay() === 0 && now.getHours() === 20) runFORECAST();
  }, 60 * 60 * 1000);
  // Run initial forecast
  setTimeout(() => runFORECAST(), 15000);

  // WAR ROOM — every Monday at 6am ET
  schedules.warRoomTimeout = setInterval(() => {
    const now = new Date();
    if (now.getDay() === 1 && now.getHours() === 6) runWAR_ROOM();
  }, 60 * 60 * 1000);

  // Initial pulse
  setTimeout(() => runPULSE(), 2000);
}

// ══════════════════════════════════════════════════════
// REST API ENDPOINTS
// ══════════════════════════════════════════════════════
app.get('/health', (req, res) => res.json({ status: 'ok', pulse: empireState.pulseCount }));

app.get('/api/snapshot', (req, res) => {
  res.json({
    empireState,
    alerts: alerts.slice(0, 20),
    forecast: forecast.current,
    warRoom: warRoom.reports[0] || null,
    atlas: atlasData,
    horizon: horizonData,
    calibration: getCalibrationInsights(),
    memory: { discoveries: memory.discoveries.slice(0, 20), lastUpdated: memory.lastUpdated },
    shadow: shadowMutations,
    sentinel: { lastCheck: sentinel.lastCheck, recentEvents: sentinel.securityEvents.slice(0, 10) },
    pendingApprovals: pendingApprovals.filter(a => a.status === 'PENDING'),
    serverTime: new Date().toISOString()
  });
});

app.get('/api/memory', (req, res) => res.json(memory));
app.get('/api/calibration', (req, res) => res.json({ data: calibration, insights: getCalibrationInsights() }));
app.get('/api/sentinel', (req, res) => res.json(sentinel));
app.get('/api/warroom', (req, res) => res.json(warRoom));
app.get('/api/forecast', (req, res) => res.json(forecast));
app.get('/api/atlas', (req, res) => res.json(atlasData));
app.get('/api/horizon', (req, res) => res.json(horizonData));
app.get('/api/shadow', (req, res) => res.json(shadowMutations));
app.get('/api/approvals', (req, res) => res.json(pendingApprovals));

// MENTOR — ask Jorge anything
app.post('/api/mentor', async (req, res) => {
  const { question } = req.body;
  if (!question) return res.status(400).json({ error: 'Question required' });
  const answer = await getMentorGuidance(question);
  const entry = { question, answer, time: new Date().toISOString() };
  if (!memory.mentorLog) memory.mentorLog = [];
  memory.mentorLog = [entry, ...memory.mentorLog].slice(0, 50);
  saveJSON('memory.json', memory);
  res.json({ answer, time: entry.time });
});

// On-demand forecast
app.post('/api/forecast/run', async (req, res) => {
  res.json({ message: 'FORECAST running...' });
  await runFORECAST();
});

// On-demand WAR ROOM
app.post('/api/warroom/run', async (req, res) => {
  res.json({ message: 'WAR ROOM generating...' });
  await runWAR_ROOM();
});

// On-demand ATLAS
app.post('/api/atlas/run', async (req, res) => {
  res.json({ message: 'ATLAS scanning...' });
  await runATLAS();
});

// Record trade for analysis
app.post('/api/trade/analyze', async (req, res) => {
  const trade = req.body;
  const analysis = await analyzeClosedTrade(trade);
  res.json({ analysis });
});

// Tier 2 approval actions
app.post('/api/approve/:id', (req, res) => {
  const success = processApproval(req.params.id, true);
  res.json({ success });
});
app.post('/api/reject/:id', (req, res) => {
  const success = processApproval(req.params.id, false);
  res.json({ success });
});

// Kill switch
app.post('/api/killswitch', async (req, res) => {
  const { reason } = req.body;
  await triggerKillSwitch(reason || 'Manual trigger by Jorge');
  res.json({ triggered: true });
});

// Add memory discovery manually
app.post('/api/memory/discovery', (req, res) => {
  const { insight, type } = req.body;
  memory.discoveries.unshift({ type: type || 'MANUAL', insight, time: new Date().toISOString() });
  memory.discoveries = memory.discoveries.slice(0, 100);
  saveJSON('memory.json', memory);
  broadcast('MEMORY_UPDATE', { discovery: memory.discoveries[0] });
  res.json({ saved: true });
});

// WebSocket
wss.on('connection', ws => {
  console.log('📱 ARCHITECT dashboard connected');
  ws.send(JSON.stringify({
    type: 'SNAPSHOT',
    data: {
      empireState,
      alerts: alerts.slice(0, 20),
      forecast: forecast.current,
      warRoom: warRoom.reports[0] || null,
      atlas: atlasData,
      horizon: horizonData,
      calibration: getCalibrationInsights(),
      memory: { discoveries: memory.discoveries.slice(0, 20) },
      shadow: shadowMutations,
      pendingApprovals: pendingApprovals.filter(a => a.status === 'PENDING')
    },
    ts: Date.now()
  }));
});

// ══════════════════════════════════════════════════════
// STARTUP
// ══════════════════════════════════════════════════════
server.listen(PORT, () => {
  console.log('');
  console.log('╔══════════════════════════════════════════════════════════╗');
  console.log('║   NEXUS ARCHITECT — Empire Intelligence Command          ║');
  console.log('║   The Operational Brain — 24/7/365                       ║');
  console.log('║   12 Components Active — Memory Core Online              ║');
  console.log(`╚══════════════════════════════════════════════════════════╝`);
  console.log('');
  console.log(`🌌 Claude AI:     ${ANTHROPIC_KEY ? '✅' : '❌ No key'}`);
  console.log(`🔱 Fleet:         ${Object.keys(FLEET).map(k => FLEET[k].displayName).join(' | ')}`);
  console.log(`   Add bot:       BOT_[NAME]=https://your-url (Railway env var)`);
  console.log(`   Remove bot:    Delete the env var — zero code changes, zero data loss`);
  console.log(`🧠 Memory Core:   ✅ Online — ${memory.discoveries.length} discoveries stored`);
  console.log(`🛡️ SENTINEL:      ✅ Monitoring ${Object.keys(FLEET).length} bot(s)`);
  console.log(`👁️ MENTOR:        ✅ Jorge's voice encoded`);
  console.log('');
  console.log('⚡ Starting intelligence systems...');
  startSchedules();
  console.log('✅ NEXUS ARCHITECT — Empire command online');
});
