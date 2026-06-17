import { fileURLToPath } from "url";
import { dirname } from "path";
import { createPluginBuild } from "@repo/config/esbuild";

const pluginDir = dirname(fileURLToPath(import.meta.url));
const production = process.argv[2] === "production";

await createPluginBuild({ pluginDir, production });
