import { readdir } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import path from "node:path";
async function files(dir) {
  const out = [];
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...(await files(p)));
    else if (p.endsWith(".js")) out.push(p);
  }
  return out;
}
for (const p of [
  ...(await files("server/src")),
  ...(await files("scripts")),
  ...(await files("tests")),
]) {
  const result = spawnSync(process.execPath, ["--check", p], {
    stdio: "inherit",
  });
  if (result.status !== 0) process.exit(result.status || 1);
}
console.log("JavaScript syntax OK. JSX is checked by Vite build.");
