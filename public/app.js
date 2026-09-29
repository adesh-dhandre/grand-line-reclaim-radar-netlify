const $ = (id) => document.getElementById(id);
const el = {
  interval: $("interval"), scanBtn: $("scanBtn"), scannerStatus: $("scannerStatus"), lastScan: $("lastScan"),
  discordBadge: $("discordBadge"), scanMessage: $("scanMessage"), universeCount: $("universeCount"), signalCount: $("signalCount"),
  longCount: $("longCount"), shortCount: $("shortCount"), signals: $("signals"), universeBody: $("universeBody"),
};
const price = (v) => { v=Number(v); if(!Number.isFinite(v)) return "—"; if(v>=1000) return v.toLocaleString("en-US",{maximumFractionDigits:2}); if(v>=1) return v.toLocaleString("en-US",{maximumFractionDigits:5}); return v.toPrecision(6); };
const compact = (v) => new Intl.NumberFormat("en-US",{notation:"compact",maximumFractionDigits:2}).format(Number(v)||0);
const when = (v) => v ? new Date(v).toLocaleString() : "—";

function renderUniverse(rows){
  el.universeCount.textContent=rows.length;
  el.universeBody.innerHTML=rows.map(r=>`<tr><td class="mono">#${r.rank}</td><td class="pair">${r.symbol}</td><td class="mono">${price(r.lastPrice)}</td><td class="${Number(r.priceChangePercent)>=0?"up":"down"}">${Number(r.priceChangePercent)>=0?"+":""}${Number(r.priceChangePercent).toFixed(2)}%</td><td class="mono">${compact(r.quoteVolume)} USDT</td></tr>`).join("");
}
function renderSignals(signals){
  const longs=signals.filter(s=>s.side==="LONG").length, shorts=signals.filter(s=>s.side==="SHORT").length;
  el.signalCount.textContent=signals.length; el.longCount.textContent=longs; el.shortCount.textContent=shorts;
  if(!signals.length){ el.signals.innerHTML=`<div class="empty glass"><div class="compass">✦</div><h3>No fresh reclaim on the latest closed candle</h3><p>The radar waits for a meaningful swing's first sweep and same-candle reclaim.</p></div>`; return; }
  el.signals.innerHTML=signals.map(s=>`<article class="signal ${s.side==="SHORT"?"short":""} glass"><div class="signal-top"><div><div class="side">${s.side==="LONG"?"▲":"▼"} ${s.side} RECLAIM</div><div class="symbol">${s.symbol}</div><div class="dim">${s.interval} · ${s.levelType}</div></div><div class="rank">VOL #${s.volumeRank}</div></div><div class="metrics"><div class="metric"><span>Original touch</span><b class="mono">${price(s.originTouchPrice)}</b><small>${when(s.originTouchTime)}</small></div><div class="metric"><span>Sweep touch</span><b class="mono">${price(s.sweepTouchPrice)}</b><small>${when(s.sweepTouchTime)}</small></div><div class="metric"><span>Reclaim close</span><b class="mono">${price(s.reclaimPrice)}</b><small>${when(s.reclaimTime)}</small></div><div class="metric"><span>Move away</span><b>${Number(s.moveAwayAtr).toFixed(2)} ATR</b></div><div class="metric"><span>Sweep depth</span><b>${Number(s.sweepDepthAtr).toFixed(2)} ATR</b></div><div class="metric"><span>Reclaim depth</span><b>${Number(s.reclaimDepthAtr).toFixed(2)} ATR</b></div></div></article>`).join("");
}
async function loadConfig(){ const r=await fetch("/api/config"); const c=await r.json(); el.interval.value=c.defaultInterval; el.universeCount.textContent=c.topN; el.discordBadge.textContent=c.discordConfigured?"CONNECTED":"NOT SET"; }
async function loadUniverse(){ try{const r=await fetch("/api/universe"); const rows=await r.json(); if(!r.ok) throw new Error(rows.error||"Universe failed"); renderUniverse(rows);}catch(e){el.universeBody.innerHTML=`<tr><td colspan="5" class="loading">${e.message}</td></tr>`;} }
async function loadStatus(){ try{const r=await fetch("/api/status",{cache:"no-store"}); const s=await r.json(); el.scannerStatus.textContent=s.running?"SCANNING GRAND LINE":s.error?"ROUTE ERROR":"ON COURSE"; el.scanBtn.disabled=Boolean(s.running); el.scanBtn.textContent=s.running?"SCANNING...":"SAIL & SCAN"; el.lastScan.textContent=when(s.lastCompletedAt); renderSignals(Array.isArray(s.signals)?s.signals:[]); if(s.lastCompletedAt) el.scanMessage.textContent=`${s.scanned||0} PAIRS · ${s.interval}`; if(s.error) el.scanMessage.textContent=s.error; }catch{el.scannerStatus.textContent="OFFLINE";} }
async function runScan(){ el.scanBtn.disabled=true; el.scanBtn.textContent="QUEUING..."; el.scanMessage.textContent="Launching background scan of all 100 pairs..."; try{const r=await fetch("/api/scan",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({interval:el.interval.value})}); const d=await r.json(); if(!r.ok) throw new Error(d.error||"Trigger failed"); el.scanMessage.textContent=`Scan queued · ${d.interval}`; setTimeout(loadStatus,1500);}catch(e){el.scanMessage.textContent=e.message; el.scanBtn.disabled=false; el.scanBtn.textContent="SAIL & SCAN";} }
el.scanBtn.addEventListener("click",runScan);
(async function init(){await loadConfig(); await Promise.all([loadUniverse(),loadStatus()]); setInterval(loadStatus,5000);})();
