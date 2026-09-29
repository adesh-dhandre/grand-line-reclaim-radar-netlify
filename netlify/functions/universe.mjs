import { getTopVolumeUniverse } from "./lib/scanner.mjs";
export default async () => Response.json(await getTopVolumeUniverse());
