import { CONFIG } from "./lib/scanner.mjs";

export default async (request) => {
  const url = new URL("/.netlify/functions/scan-background", request.url);
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-scan-token": process.env.SCAN_TOKEN || "" },
    body: JSON.stringify({ interval: CONFIG.defaultInterval }),
  });
  if (!response.ok && response.status !== 202) throw new Error(`Background trigger failed: ${response.status}`);
  return new Response(null, { status: 204 });
};
