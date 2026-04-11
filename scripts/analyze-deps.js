#!/usr/bin/env node

const { execSync } = require('child_process');
const path = require('path');
const fs = require('fs');

// Get current dependencies from package.json
function getCurrentDependencies () {
  const packageJson = JSON.parse(fs.readFileSync('package.json', 'utf-8'));
  const deps = new Set();
  
  // Combine both regular dependencies and devDependencies
  Object.keys(packageJson.dependencies || {}).forEach(dep => deps.add(dep));
  Object.keys(packageJson.devDependencies || {}).forEach(dep => deps.add(dep));
  
  return deps;
}

// Get all commits that modified package-lock.json
function getPackageLockCommits () {
  const cmd = 'git log --format="%H" -- package-lock.json';
  return execSync(cmd, { encoding: 'utf-8' })
    .trim()
    .split('\n');
}

// Get package-lock.json content at a specific commit
function getPackageLockAtCommit (commit) {
  try {
    const cmd = `git show ${commit}:package-lock.json`;
    const content = execSync(cmd, { encoding: 'utf-8' });
    return JSON.parse(content);
  } catch (err) {
    // Skip if package-lock.json didn't exist at this commit
    return null;
  }
}

// Extract all package versions from package-lock
function extractPackageVersions (lockfile) {
  if (!lockfile || !lockfile.packages) return new Map();

  const versions = new Map();
  for (const [pkg, info] of Object.entries(lockfile.packages)) {
    if (pkg === '') continue; // Skip root package
    const name = pkg.replace('node_modules/', '');
    versions.set(name, info.version);
  }
  return versions;
}

// Track version changes between commits
function analyzePackageUpdates () {
  const commits = getPackageLockCommits();
  const updates = new Map(); // package -> update count
  let prevVersions = new Map();
  const currentDeps = getCurrentDependencies();

  for (const commit of commits) {
    const lockfile = getPackageLockAtCommit(commit);
    if (!lockfile) continue;

    const currentVersions = extractPackageVersions(lockfile);

    // Compare with previous versions
    for (const [pkg, version] of currentVersions) {
      // Only track updates for current dependencies
      if (!currentDeps.has(pkg)) continue;
      
      const prevVersion = prevVersions.get(pkg);
      if (prevVersion && prevVersion !== version) {
        updates.set(pkg, (updates.get(pkg) || 0) + 1);
      }
    }

    prevVersions = currentVersions;
  }

  return updates;
}

// Main execution
try {
  console.log('Analyzing package update frequency...\n');

  const updates = analyzePackageUpdates();

  // Sort packages by update frequency
  const sortedUpdates = [...updates.entries()]
    .sort(([, a], [, b]) => b - a)
    .slice(0, 25); // Get top 25

  if (sortedUpdates.length === 0) {
    console.log('No updates found for current dependencies.');
    process.exit(0);
  }

  // Calculate max lengths for formatting
  const maxNameLength = Math.max(...sortedUpdates.map(([name]) => name.length));
  const maxCountLength = Math.max(...sortedUpdates.map(([, count]) => String(count).length));

  // Print header
  console.log('Most Frequently Updated Current Dependencies:');
  console.log('═'.repeat(maxNameLength + maxCountLength + 7));

  // Print results in a formatted table
  sortedUpdates.forEach(([pkg, count], index) => {
    const position = `${index + 1}.`.padEnd(3);
    const name = pkg.padEnd(maxNameLength);
    const updates = String(count).padStart(maxCountLength);
    console.log(`${position} ${name} │ ${updates} updates`);
  });
} catch (error) {
  console.error('Error analyzing package updates:', error.message);
  process.exit(1);
} 