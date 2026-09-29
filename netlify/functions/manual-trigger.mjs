import { CONFIG, VALID_INTERVALS } from "./lib/scanner.mjs";

export default async (request) => {
  let interval = CONFIG.defaultInterval;
  try {
    const body = await request.json();
    if (body?.interval && VALID_INTERVALS.has(body.interval)) interval = body.interval;
  } catch {}

  const url = new URL("/.netlify/functions/scan-background", request.url);
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-scan-token": process.env.SCAN_TOKEN || "" },
    body: JSON.stringify({ interval }),
  });
  return Response.json({ accepted: response.ok || response.status === 202, interval }, { status: response.ok || response.status === 202 ? 202 : 500 });
};
