import { readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
const html = await readFile("client/dist/index.html");
const version = createHash("sha256").update(html).digest("hex").slice(0, 12);
const file = "client/dist/sw.js";
const source = await readFile(file, "utf8");
const assets = [...html.toString().matchAll(/(?:src|href)="([^\"]+)"/g)]
  .map((m) => m[1])
  .filter((x) => x.startsWith("/assets/"));
await writeFile(
  file,
  source
    .replace("trailway-shell-v1", `trailway-shell-${version}`)
    .replace(
      "const PRECACHE=['/','/icon.svg','/manifest.webmanifest'];",
      `const PRECACHE=${JSON.stringify(["/", "/icon.svg", "/manifest.webmanifest", ...assets])};`,
    ),
);
