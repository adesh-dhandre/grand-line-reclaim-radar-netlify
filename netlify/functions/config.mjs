import { CONFIG, VALID_INTERVALS } from "./lib/scanner.mjs";
export default async () => Response.json({
  defaultInterval: CONFIG.defaultInterval,
  autoScanMinutes: 5,
  topN: CONFIG.topN,
  validIntervals: [...VALID_INTERVALS],
  discordConfigured: Boolean(CONFIG.discordWebhookUrl && CONFIG.discordEnabled),
  pivotBars: CONFIG.pivotBars,
  minMoveAwayAtr: CONFIG.minMoveAwayAtr,
});
