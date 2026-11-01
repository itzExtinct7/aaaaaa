"use strict";
const { readdirSync } = require("node:fs");
const { join } = require("node:path");
const { execFileSync } = require("node:child_process");
function check(directory) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const file = join(directory, entry.name);
    if (entry.isDirectory()) check(file);
    else if (file.endsWith(".js")) execFileSync(process.execPath, ["--check", file], { stdio: "inherit" });
  }
}
check(join(__dirname, "../src"));
check(join(__dirname, "../test"));
console.log("JavaScript syntax checks passed.");
