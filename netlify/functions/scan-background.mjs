import { performScan, CONFIG } from "./lib/scanner.mjs";

export default async (request) => {
  const token = request.headers.get("x-scan-token") || "";
  if (!process.env.SCAN_TOKEN || token !== process.env.SCAN_TOKEN) return new Response("Unauthorized", { status: 401 });
  let interval = CONFIG.defaultInterval;
  try {
    const body = await request.json();
    if (body?.interval) interval = body.interval;
  } catch {}
  await performScan(interval, true);
};

export const config = { background: true, path: "/.netlify/functions/scan-background" };
