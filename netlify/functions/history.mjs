import { getHistory } from "./lib/scanner.mjs";
export default async () => Response.json(await getHistory());
