#!/usr/bin/env node
/**
 * Sync Android version from client/package.json into client/android/app/build.gradle.
 *
 * versionName is taken directly from package.json (e.g. "1.2.3").
 * versionCode is derived as a stable, monotonic integer from the version:
 *   major * 10000 + minor * 100 + patch
 * This yields a 6-digit code that increases with every semver release while
 * staying well below Android's 2,147,483,647 versionCode limit.
 */

const { readFileSync, writeFileSync } = require('node:fs');
const { resolve } = require('node:path');

const ROOT = process.cwd();
const PACKAGE_JSON_PATH = resolve(ROOT, 'client/package.json');
const BUILD_GRADLE_PATH = resolve(ROOT, 'client/android/app/build.gradle');

const pkg = JSON.parse(readFileSync(PACKAGE_JSON_PATH, 'utf8'));
const version = pkg.version;

if (typeof version !== 'string' || !/^\d+\.\d+\.\d+/.test(version)) {
  console.error(`ERROR: client/package.json has invalid version: ${version}`);
  process.exit(1);
}

// Strip any pre-release suffix (e.g. "-alpha") before deriving versionCode.
const baseVersion = version.split('-')[0];
const [major, minor, patch] = baseVersion.split('.').map(Number);
const versionCode = major * 10_000 + minor * 100 + patch;

let gradle = readFileSync(BUILD_GRADLE_PATH, 'utf8');

const versionNameRegex = /versionName\s+"[^"]*"/;
const versionCodeRegex = /versionCode\s+\d+/;

if (!versionNameRegex.test(gradle)) {
  // Add versionName inside defaultConfig if it is missing.
  gradle = gradle.replace(
    /defaultConfig\s*\{/,
    `defaultConfig {\n        versionName "${version}"`
  );
} else {
  gradle = gradle.replace(versionNameRegex, `versionName "${version}"`);
}

if (!versionCodeRegex.test(gradle)) {
  // Add versionCode inside defaultConfig if it is missing.
  gradle = gradle.replace(
    /defaultConfig\s*\{/,
    `defaultConfig {\n        versionCode ${versionCode}`
  );
} else {
  gradle = gradle.replace(versionCodeRegex, `versionCode ${versionCode}`);
}

writeFileSync(BUILD_GRADLE_PATH, gradle, 'utf8');
console.log(`Synced Android version: versionName "${version}", versionCode ${versionCode}`);
