import assert from "node:assert/strict";
import { test } from "node:test";
import { splitAdvisories } from "../scripts/audit.mjs";

function advisory(id, severity, name = "package") {
  return {
    name,
    severity,
    title: `Advisory ${id}`,
    url: `https://github.com/advisories/${id}`,
  };
}

const report = {
  vulnerabilities: {
    braces: { via: [advisory("GHSA-accepted", "high", "braces")] },
    micromatch: { via: ["braces"] },
    sharp: { via: [advisory("GHSA-blocking", "high", "sharp")] },
    lodash: { via: [advisory("GHSA-critical", "critical", "lodash")] },
    semver: { via: [advisory("GHSA-moderate", "moderate", "semver")] },
  },
};

test("blocks high and critical advisories that are not accepted", () => {
  const { blocking } = splitAdvisories(report, ["GHSA-accepted"]);

  assert.deepEqual(
    blocking.map((item) => item.url.split("/").pop()),
    ["GHSA-blocking", "GHSA-critical"],
  );
});

test("reports the accepted advisory separately and ignores dependents and moderate ones", () => {
  const { accepted, blocking } = splitAdvisories(report, ["GHSA-accepted"]);

  assert.deepEqual(accepted.map((item) => item.name), ["braces"]);
  assert.equal(blocking.some((item) => item.name === "semver"), false);
});

test("blocks everything when no advisory is accepted", () => {
  assert.equal(splitAdvisories(report, []).blocking.length, 3);
});

test("passes a clean report", () => {
  assert.deepEqual(splitAdvisories({ vulnerabilities: {} }), { blocking: [], accepted: [] });
});
