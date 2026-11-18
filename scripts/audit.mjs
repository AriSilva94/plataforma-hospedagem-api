import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const acceptedAdvisories = ["GHSA-fc5q-39xc-vjpf"];
const blockingSeverities = ["high", "critical"];

function advisoryId(advisory) {
  return advisory.url.split("/").pop();
}

export function splitAdvisories(report, accepted = acceptedAdvisories) {
  const found = new Map();
  for (const vulnerability of Object.values(report.vulnerabilities ?? {})) {
    for (const via of vulnerability.via) {
      if (typeof via === "object" && blockingSeverities.includes(via.severity)) {
        found.set(advisoryId(via), via);
      }
    }
  }
  const advisories = [...found.values()];
  return {
    blocking: advisories.filter((advisory) => !accepted.includes(advisoryId(advisory))),
    accepted: advisories.filter((advisory) => accepted.includes(advisoryId(advisory))),
  };
}

function describe(advisory) {
  return `  ${advisory.severity}  ${advisory.name}  ${advisory.title}  ${advisory.url}`;
}

function run() {
  const audit = spawnSync("npm audit --json", { encoding: "utf8", shell: true });
  const report = JSON.parse(audit.stdout);
  if (report.error) {
    throw new Error(`npm audit failed: ${report.error.summary ?? report.error.code}`);
  }

  const { blocking, accepted } = splitAdvisories(report);
  if (accepted.length > 0) {
    console.log("Accepted advisories without an upstream fix:");
    console.log(accepted.map(describe).join("\n"));
  }
  if (blocking.length > 0) {
    console.error("Blocking advisories:");
    console.error(blocking.map(describe).join("\n"));
    process.exit(1);
  }
  console.log("No blocking advisories.");
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  run();
}
