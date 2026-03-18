import { spawn } from "node:child_process";

function runPnpmScript(script: string, args: string[] = []): Promise<number> {
  return new Promise((resolve) => {
    const child = spawn("pnpm", ["run", script, ...(args.length > 0 ? ["--", ...args] : [])], {
      stdio: "inherit",
      shell: process.platform === "win32",
    });

    child.on("close", (code, signal) => {
      if (signal) {
        resolve(1);
        return;
      }
      resolve(code ?? 1);
    });

    child.on("error", () => {
      resolve(1);
    });
  });
}

function needsFullArtistRebuild(targetScript: string): boolean {
  return targetScript === "sync:nordiska:raw"
    || targetScript === "sync:europeana:raw"
    || targetScript === "sync:shm:raw"
    || targetScript === "sync:shm:fast:raw";
}

async function main() {
  const targetScript = process.argv[2];
  const forwardArgs = process.argv.slice(3);

  if (!targetScript) {
    console.error("Usage: tsx scripts/run-sync-with-stats-refresh.ts <sync-script> [...args]");
    process.exit(1);
  }

  console.log("Ensuring schema and FTS index are healthy…");
  const migrateExitCode = await runPnpmScript("migrate:schema");
  if (migrateExitCode !== 0) {
    process.exit(migrateExitCode);
  }

  const syncExitCode = await runPnpmScript(targetScript, forwardArgs);
  if (syncExitCode !== 0) {
    process.exit(syncExitCode);
  }

  console.log("\nSync complete. Refreshing materialized site stats…");
  const refreshExitCode = await runPnpmScript("stats:refresh");
  if (refreshExitCode !== 0) {
    console.warn("Warning: stats refresh failed. Sync data was written successfully.");
  }

  console.log("\nRefreshing related artwork materializations…");
  if (needsFullArtistRebuild(targetScript)) {
    const artistExitCode = await runPnpmScript("related:artists:refresh");
    if (artistExitCode !== 0) {
      console.warn("Warning: artist refresh failed. Sync data was written successfully.");
      return;
    }

    const neighborsExitCode = await runPnpmScript("related:refresh", ["--neighbors-only", "--recent=10000"]);
    if (neighborsExitCode !== 0) {
      console.warn("Warning: neighbor refresh failed. Sync data was written successfully.");
    }
    return;
  }

  const relatedExitCode = await runPnpmScript("related:refresh", ["--recent=10000"]);
  if (relatedExitCode !== 0) {
    console.warn("Warning: related refresh failed. Sync data was written successfully.");
  }
}

main().catch((error) => {
  console.error("Failed to run sync wrapper:", error);
  process.exit(1);
});
