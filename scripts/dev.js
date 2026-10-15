import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const children = [
  spawn(process.execPath, ["--watch", "server/src/index.js"], {
    cwd: root,
    stdio: "inherit",
  }),
  spawn(
    process.execPath,
    ["node_modules/vite/bin/vite.js", "--config", "client/vite.config.js"],
    { cwd: root, stdio: "inherit" },
  ),
];
function stop() {
  for (const p of children) p.kill();
}
for (const s of ["SIGINT", "SIGTERM"]) process.on(s, stop);
for (const p of children)
  p.on("exit", (code) => {
    stop();
    process.exitCode = code || 0;
  });
