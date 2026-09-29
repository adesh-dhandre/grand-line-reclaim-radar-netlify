import { getStatus } from "./lib/scanner.mjs";
export default async () => Response.json(await getStatus());
