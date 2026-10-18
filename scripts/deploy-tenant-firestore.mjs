import { execFileSync } from "node:child_process";

function option(name) {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? String(process.argv[index + 1] || "").trim() : "";
}

function hasFlag(name) {
  return process.argv.includes(`--${name}`);
}

function main() {
  const projectId = option("project");
  if (!/^[a-z][a-z0-9-]{4,28}[a-z0-9]$/.test(projectId)) {
    throw new Error("--project must be a valid tenant Firebase project ID.");
  }

  const targets = [];
  if (hasFlag("rules")) targets.push("firestore:rules");
  if (hasFlag("indexes")) targets.push("firestore:indexes");
  if (targets.length === 0) {
    throw new Error("Select at least one deployment target with --rules or --indexes.");
  }

  const args = [
    "--yes",
    "firebase-tools",
    "deploy",
    "--only",
    targets.join(","),
    "--project",
    projectId,
    "--config",
    "firebase.json",
  ];
  console.log(`Deploying ${targets.join(" and ")} to tenant project ${projectId}...`);
  if (process.platform === "win32") {
    execFileSync(
      process.env.ComSpec || "cmd.exe",
      ["/d", "/s", "/c", `npx.cmd ${args.join(" ")}`],
      { stdio: "inherit" },
    );
  } else {
    execFileSync("npx", args, { stdio: "inherit" });
  }
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
