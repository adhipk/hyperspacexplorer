#!/usr/bin/env bun

const fs = require("node:fs");

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

const packageJson = JSON.parse(fs.readFileSync("package.json", "utf8"));
const packagedFiles = packageJson.files || [];
const skill = fs.readFileSync("skills/hyperspace-html-artifacts/SKILL.md", "utf8");

const forbiddenPackageEntries = [
  "AGENTS.md",
  "plan.html",
  "current-state.html",
  "phase2.html",
  "distributables.html",
  "hyperclay-local-server.html",
  "comment-isolation.html",
  "scripts/*.js",
];

for (const entry of forbiddenPackageEntries) {
  assert(
    !packagedFiles.includes(entry),
    `Project-specific agent or planning file must not be distributed: ${entry}`
  );
}

const forbiddenSkillPhrases = [
  "this repo",
  "AGENTS.md",
  "Build Hyperspace",
  "building Hyperspace",
  "docs.css",
];

for (const phrase of forbiddenSkillPhrases) {
  assert(
    !skill.includes(phrase),
    `Consumer skill contains project-specific instruction: ${phrase}`
  );
}

assert(
  skill.includes("using Hyperspace") || skill.includes("reviewed in Hyperspace"),
  "Consumer skill should explain how to build artifacts using Hyperspace."
);

console.log("Agent configuration boundary verified.");
