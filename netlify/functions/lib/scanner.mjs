import { getStore } from "@netlify/blobs";

const BINANCE = "https://fapi.binance.com";

const cfg = {
  defaultInterval: process.env.DEFAULT_INTERVAL || "1h",
  topN: Math.min(100, Math.max(10, Number(process.env.TOP_N || 100))),
  klineLimit: Math.min(500, Math.max(160, Number(process.env.KLINE_LIMIT || 320))),
  concurrency: Math.min(12, Math.max(1, Number(process.env.CONCURRENCY || 8))),
  pivotBars: Math.max(2, Number(process.env.PIVOT_BARS || 5)),
  atrPeriod: Math.max(5, Number(process.env.ATR_PERIOD || 14)),
  minMoveAwayAtr: Math.max(0.25, Number(process.env.MIN_MOVE_AWAY_ATR || 1.0)),
  moveAwayBars: Math.max(5, Number(process.env.MOVE_AWAY_BARS || 12)),
  maxStructureAgeBars: Math.max(20, Number(process.env.MAX_STRUCTURE_AGE_BARS || 720)),
  discordEnabled: String(process.env.DISCORD_ENABLED || "1") !== "0",
  discordWebhookUrl: process.env.DISCORD_WEBHOOK_URL || "",
};

export const VALID_INTERVALS = new Set(["5m", "15m", "30m", "1h", "2h", "4h"]);
export const CONFIG = cfg;

const stateStore = () => getStore({ name: "reclaim-radar-state", consistency: "strong" });
const signalStore = () => getStore({ name: "reclaim-radar-signals", consistency: "strong" });

const nowIso = () => new Date().toISOString();
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function fetchJson(url, attempts = 3) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      const response = await fetch(url, { headers: { "User-Agent": "grand-line-reclaim-radar-netlify/3.0" } });
      if (!response.ok) throw new Error(`HTTP ${response.status}: ${await response.text()}`);
      return await response.json();
    } catch (error) {
      lastError = error;
      if (attempt < attempts) await sleep(300 * attempt);
    }
  }
  throw lastError;
}

export async function getTopVolumeUniverse() {
  const exchangeInfo = await fetchJson(`${BINANCE}/fapi/v1/exchangeInfo`);
  const allowed = new Set(
    (exchangeInfo.symbols || [])
      .filter((s) => s.status === "TRADING" && s.contractType === "PERPETUAL" && s.quoteAsset === "USDT")
      .map((s) => s.symbol)
  );

  const tickers = await fetchJson(`${BINANCE}/fapi/v1/ticker/24hr`);
  return tickers
    .filter((t) => allowed.has(t.symbol))
    .map((t) => ({
      symbol: t.symbol,
      lastPrice: Number(t.lastPrice),
      quoteVolume: Number(t.quoteVolume),
      priceChangePercent: Number(t.priceChangePercent),
    }))
    .filter((t) => Number.isFinite(t.lastPrice) && Number.isFinite(t.quoteVolume) && t.quoteVolume > 0)
    .sort((a, b) => b.quoteVolume - a.quoteVolume)
    .slice(0, cfg.topN)
    .map((row, index) => ({ ...row, rank: index + 1 }));
}

async function getKlines(symbol, interval) {
  const url = `${BINANCE}/fapi/v1/klines?symbol=${encodeURIComponent(symbol)}&interval=${encodeURIComponent(interval)}&limit=${cfg.klineLimit}`;
  const rows = await fetchJson(url);
  return rows.map((k) => ({
    openTime: Number(k[0]), open: Number(k[1]), high: Number(k[2]), low: Number(k[3]), close: Number(k[4]),
    volume: Number(k[5]), closeTime: Number(k[6]),
  }));
}

function rollingAtr(candles, period = cfg.atrPeriod) {
  const out = new Array(candles.length).fill(null);
  const tr = candles.map((c, i) => {
    if (i === 0) return c.high - c.low;
    const p = candles[i - 1].close;
    return Math.max(c.high - c.low, Math.abs(c.high - p), Math.abs(c.low - p));
  });
  if (tr.length < period) return out;
  let seed = 0;
  for (let i = 0; i < period; i++) seed += tr[i];
  out[period - 1] = seed / period;
  for (let i = period; i < tr.length; i++) out[i] = ((out[i - 1] * (period - 1)) + tr[i]) / period;
  return out;
}

function isPivotLow(c, i, bars) {
  if (i < bars || i + bars >= c.length) return false;
  for (let j = i - bars; j <= i + bars; j++) if (j !== i && c[j].low < c[i].low) return false;
  return true;
}
function isPivotHigh(c, i, bars) {
  if (i < bars || i + bars >= c.length) return false;
  for (let j = i - bars; j <= i + bars; j++) if (j !== i && c[j].high > c[i].high) return false;
  return true;
}

function meaningfulStructures(candles, atr, lastClosedIndex) {
  const structures = [];
  const maxOrigin = Math.min(lastClosedIndex - cfg.pivotBars - 1, candles.length - cfg.pivotBars - 2);

  for (let i = Math.max(cfg.atrPeriod, cfg.pivotBars); i <= maxOrigin; i++) {
    const originAtr = atr[i];
    if (!Number.isFinite(originAtr) || originAtr <= 0) continue;

    if (isPivotLow(candles, i, cfg.pivotBars)) {
      let maxAway = 0;
      const end = Math.min(i + cfg.moveAwayBars, lastClosedIndex - 1);
      for (let j = i + 1; j <= end; j++) maxAway = Math.max(maxAway, (candles[j].high - candles[i].low) / originAtr);
      if (maxAway >= cfg.minMoveAwayAtr) structures.push({
        type: "SUPPORT", originIndex: i, availableIndex: i + cfg.pivotBars, reference: candles[i].low,
        moveAwayAtr: maxAway, originTime: candles[i].openTime, originAtr,
      });
    }

    if (isPivotHigh(candles, i, cfg.pivotBars)) {
      let maxAway = 0;
      const end = Math.min(i + cfg.moveAwayBars, lastClosedIndex - 1);
      for (let j = i + 1; j <= end; j++) maxAway = Math.max(maxAway, (candles[i].high - candles[j].low) / originAtr);
      if (maxAway >= cfg.minMoveAwayAtr) structures.push({
        type: "RESISTANCE", originIndex: i, availableIndex: i + cfg.pivotBars, reference: candles[i].high,
        moveAwayAtr: maxAway, originTime: candles[i].openTime, originAtr,
      });
    }
  }
  return structures;
}

function latestReclaimSignal(symbol, candles, interval, volumeRank, quoteVolume) {
  if (candles.length < 100) return null;
  const lastClosedIndex = candles.length - 2;
  const last = candles[lastClosedIndex];
  const previous = candles[lastClosedIndex - 1];
  const atr = rollingAtr(candles);
  const currentAtr = atr[lastClosedIndex];
  if (!Number.isFinite(currentAtr) || currentAtr <= 0) return null;

  const candidates = [];
  for (const s of meaningfulStructures(candles, atr, lastClosedIndex)) {
    const age = lastClosedIndex - s.originIndex;
    if (age < cfg.pivotBars + 1 || age > cfg.maxStructureAgeBars || s.availableIndex >= lastClosedIndex) continue;

    let firstBreakIndex = null;
    for (let j = s.availableIndex + 1; j <= lastClosedIndex; j++) {
      if (s.type === "SUPPORT" && candles[j].low < s.reference) { firstBreakIndex = j; break; }
      if (s.type === "RESISTANCE" && candles[j].high > s.reference) { firstBreakIndex = j; break; }
    }
    if (firstBreakIndex !== lastClosedIndex) continue;

    if (s.type === "SUPPORT" && previous.close > s.reference && last.low < s.reference && last.close > s.reference) {
      candidates.push({
        symbol, side: "LONG", interval, volumeRank, quoteVolume,
        detectedAt: last.closeTime, candleTime: last.openTime, currentPrice: last.close,
        level: s.reference, levelType: "MEANINGFUL SWING LOW", originTime: s.originTime,
        originTouchPrice: s.reference, originTouchTime: s.originTime,
        sweepTouchPrice: last.low, sweepTouchTime: last.openTime,
        reclaimPrice: last.close, reclaimTime: last.closeTime,
        structureAgeBars: age, moveAwayAtr: s.moveAwayAtr,
        sweepDepthAtr: (s.reference - last.low) / currentAtr,
        reclaimDepthAtr: (last.close - s.reference) / currentAtr,
        wick: last.low,
      });
    }

    if (s.type === "RESISTANCE" && previous.close < s.reference && last.high > s.reference && last.close < s.reference) {
      candidates.push({
        symbol, side: "SHORT", interval, volumeRank, quoteVolume,
        detectedAt: last.closeTime, candleTime: last.openTime, currentPrice: last.close,
        level: s.reference, levelType: "MEANINGFUL SWING HIGH", originTime: s.originTime,
        originTouchPrice: s.reference, originTouchTime: s.originTime,
        sweepTouchPrice: last.high, sweepTouchTime: last.openTime,
        reclaimPrice: last.close, reclaimTime: last.closeTime,
        structureAgeBars: age, moveAwayAtr: s.moveAwayAtr,
        sweepDepthAtr: (last.high - s.reference) / currentAtr,
        reclaimDepthAtr: (s.reference - last.close) / currentAtr,
        wick: last.high,
      });
    }
  }

  if (!candidates.length) return null;
  candidates.sort((a, b) => (b.moveAwayAtr + b.reclaimDepthAtr) - (a.moveAwayAtr + a.reclaimDepthAtr));
  return candidates[0];
}

const signalKey = (s) => [s.symbol, s.side, s.interval, s.candleTime, Number(s.level).toPrecision(10)].join("|");
const fmt = (v) => !Number.isFinite(v) ? "-" : Math.abs(v) >= 1000 ? v.toFixed(2) : Math.abs(v) >= 1 ? v.toFixed(5) : v.toPrecision(6);
const discordTime = (ms) => `<t:${Math.floor(ms / 1000)}:f>`;

async function sendDiscord(signal) {
  if (!cfg.discordEnabled || !cfg.discordWebhookUrl) return { sent: false, reason: "not-configured" };
  const store = signalStore();
  const key = `sent/${encodeURIComponent(signalKey(signal))}`;
  const exists = await store.get(key, { type: "text" });
  if (exists) return { sent: false, reason: "duplicate" };

  const long = signal.side === "LONG";
  const content = [
    `${long ? "🟢" : "🔴"} **${signal.side} RECLAIM — ${signal.symbol}**`,
    `**TF:** ${signal.interval}  |  **Volume Rank:** #${signal.volumeRank}`,
    `**Original ${long ? "Swing Low" : "Swing High"}:** ${fmt(signal.originTouchPrice)}  •  ${discordTime(signal.originTouchTime)}`,
    `**Sweep Touch:** ${fmt(signal.sweepTouchPrice)}  •  ${discordTime(signal.sweepTouchTime)}`,
    `**Reclaim Close:** ${fmt(signal.reclaimPrice)}  •  ${discordTime(signal.reclaimTime)}`,
    `**Move-away:** ${signal.moveAwayAtr.toFixed(2)} ATR`,
    `**Sweep depth:** ${signal.sweepDepthAtr.toFixed(2)} ATR`,
    `**Reclaim depth:** ${signal.reclaimDepthAtr.toFixed(2)} ATR`,
    "",
    long ? "**Meaningful swing low swept and reclaimed on the same candle.**" : "**Meaningful swing high swept and reclaimed on the same candle.**",
  ].join("\n");

  const response = await fetch(cfg.discordWebhookUrl, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: "Grand Line Reclaim Radar", content, allowed_mentions: { parse: [] } }),
  });
  if (!response.ok) throw new Error(`Discord HTTP ${response.status}: ${await response.text()}`);
  await store.set(key, nowIso(), { onlyIfNew: true });
  return { sent: true };
}

async function mapWithConcurrency(items, limit, worker) {
  const results = new Array(items.length);
  let next = 0;
  async function runner() {
    while (true) {
      const i = next++;
      if (i >= items.length) return;
      try { results[i] = await worker(items[i], i); }
      catch (error) { results[i] = { error: error.message, item: items[i] }; }
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => runner()));
  return results;
}

export async function performScan(interval = cfg.defaultInterval, deliverDiscord = true) {
  if (!VALID_INTERVALS.has(interval)) throw new Error(`Unsupported interval: ${interval}`);
  const store = stateStore();
  const startedAt = nowIso();
  await store.setJSON("status", { running: true, interval, lastStartedAt: startedAt, lastCompletedAt: null, scanned: 0, signals: [], error: null });

  try {
    const universe = await getTopVolumeUniverse();
    const rows = await mapWithConcurrency(universe, cfg.concurrency, async (market) => {
      const candles = await getKlines(market.symbol, interval);
      const signal = latestReclaimSignal(market.symbol, candles, interval, market.rank, market.quoteVolume);
      if (signal && deliverDiscord) {
        try { signal.discord = await sendDiscord(signal); }
        catch (error) { signal.discord = { sent: false, reason: error.message }; }
      }
      return { ...market, signal };
    });

    const signals = rows.filter((r) => r && !r.error && r.signal).map((r) => r.signal);
    const completed = { running: false, interval, lastStartedAt: startedAt, lastCompletedAt: nowIso(), scanned: universe.length, signals, error: null };
    await store.setJSON("status", completed);
    await store.setJSON("universe", universe);
    await store.setJSON("latest-signals", signals);

    const history = (await store.get("history", { type: "json", consistency: "strong" })) || [];
    const merged = [...signals.map((s) => ({ ...s, savedAt: nowIso() })), ...history]
      .filter((v, i, arr) => arr.findIndex((x) => signalKey(x) === signalKey(v)) === i)
      .slice(0, 100);
    await store.setJSON("history", merged);
    return completed;
  } catch (error) {
    const failed = { running: false, interval, lastStartedAt: startedAt, lastCompletedAt: nowIso(), scanned: 0, signals: [], error: error.message };
    await store.setJSON("status", failed);
    throw error;
  }
}

export async function getStatus() {
  return (await stateStore().get("status", { type: "json", consistency: "strong" })) || {
    running: false, interval: cfg.defaultInterval, lastStartedAt: null, lastCompletedAt: null, scanned: 0, signals: [], error: null,
  };
}
export async function getHistory() {
  return (await stateStore().get("history", { type: "json", consistency: "strong" })) || [];
}
