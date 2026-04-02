'use strict';

/**
 * Scan ES6 `class … extends …` declarations and emit a nested inheritance tree (JSON)
 * and/or a Graphviz digraph for contracts/classes.dot.
 *
 * Usage:
 *   node scripts/classtree.js              — print JSON to stdout
 *   node scripts/classtree.js --write      — write contracts/classes.dot + reports/class-inheritance.json
 *
 * Scans (relative to repo root): types/, services/, contracts/
 */

const fs = require('fs');
const path = require('path');

const REPO_ROOT = path.resolve(__dirname, '..');
const DEFAULT_SCAN_DIRS = ['types', 'services', 'contracts'];
const DOT_PATH = path.join(REPO_ROOT, 'contracts', 'classes.dot');
const JSON_REPORT = path.join(REPO_ROOT, 'reports', 'class-inheritance.json');

/** Local variable names that refer to another exported class (display as that class). */
const EXTENDS_ALIASES = {
  FabricMessage: 'Message'
};

const BUILTIN_BASES = new Set(['Object', 'EventEmitter', 'Buffer', 'String']);

/** Superclass names that are not scanned (missing file, stub, or platform type) — no warning. */
const EXTERNAL_SUPERCLASSES = new Set(['HTTP']);

const CLASS_HEAD = /^\s*class\s+([A-Za-z_]\w*)\s*(?:extends\s+([A-Za-z_][\w.]*)\s*)?{/gm;

function walkJsFiles (dir, acc = []) {
  if (!fs.existsSync(dir)) return acc;
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name === 'node_modules' || e.name.startsWith('.')) continue;
      walkJsFiles(full, acc);
    } else if (e.isFile() && e.name.endsWith('.js')) {
      acc.push(full);
    }
  }
  return acc;
}

function normalizeParent (raw) {
  if (!raw) return null;
  const tail = raw.includes('.') ? raw.split('.').pop() : raw;
  return EXTENDS_ALIASES[tail] || tail;
}

function extractClasses (filePath) {
  const text = fs.readFileSync(filePath, 'utf8');
  const out = [];
  let m;
  while ((m = CLASS_HEAD.exec(text)) !== null) {
    out.push({
      name: m[1],
      extends: normalizeParent(m[2])
    });
  }
  return out;
}

function buildMap (roots) {
  const inherits = {};
  const byFile = [];

  for (const rootName of roots) {
    const abs = path.join(REPO_ROOT, rootName);
    for (const file of walkJsFiles(abs)) {
      const decls = extractClasses(file);
      if (!decls.length) continue;
      const rel = path.relative(REPO_ROOT, file);
      byFile.push({ file: rel, classes: decls });
      for (const { name, extends: ext } of decls) {
        if (inherits[name] !== undefined && inherits[name] !== ext) {
          console.warn(`[classtree] duplicate class ${name}: was ${inherits[name]}, now ${ext} (${rel})`);
        }
        inherits[name] = ext;
      }
    }
  }

  return { inherits, byFile };
}

function buildSubtree (inherits, parent) {
  const subtree = {};
  for (const name of Object.keys(inherits)) {
    if (inherits[name] === parent) {
      subtree[name] = buildSubtree(inherits, name);
    }
  }
  return subtree;
}

function collectEdges (inherits) {
  const edges = [];
  const classes = new Set(Object.keys(inherits));
  for (const [child, parent] of Object.entries(inherits)) {
    const p = parent == null ? 'Object' : parent;
    edges.push([p, child]);
    if (!classes.has(p) && !BUILTIN_BASES.has(p) && !EXTERNAL_SUPERCLASSES.has(p)) {
      console.warn(`[classtree] external or missing superclass: ${p} (child ${child})`);
    }
  }
  return edges;
}

function edgesToDot (inherits) {
  const edges = collectEdges(inherits);
  const childrenByParent = new Map();
  for (const [p, c] of edges) {
    if (!childrenByParent.has(p)) childrenByParent.set(p, []);
    childrenByParent.get(p).push(c);
  }

  const lines = [
    'digraph FabricClasses {',
    '  label = "Fabric class inheritances (@fabric/core — generated)"',
    '  rankdir = "LR"',
    '',
    '  // Regenerate: node scripts/classtree.js --write',
    '',
    '  subgraph cluster_builtins {',
    '    label = "Built-in / external bases"',
    '    graph[style=dashed]',
    '    "Object"',
    '    "EventEmitter"',
    '    "Buffer"',
    '    "String"',
    '    "HTTP"',
    '  }',
    ''
  ];

  const emitted = new Set();
  for (const parent of [...BUILTIN_BASES].sort()) {
    if (!childrenByParent.has(parent)) continue;
    const kids = [...new Set(childrenByParent.get(parent))].sort();
    if (kids.length === 1) {
      lines.push(`  "${parent}" -> "${kids[0]}"`);
    } else {
      lines.push(`  "${parent}" -> {`);
      for (const k of kids) {
        lines.push(`    "${k}"`);
      }
      lines.push(`  }`);
    }
    emitted.add(parent);
  }

  for (const parent of [...childrenByParent.keys()].sort()) {
    if (BUILTIN_BASES.has(parent) || emitted.has(parent)) continue;
    const kids = [...new Set(childrenByParent.get(parent))].sort();
    if (kids.length === 1) {
      lines.push(`  "${parent}" -> "${kids[0]}"`);
    } else {
      lines.push(`  "${parent}" -> {`);
      for (const k of kids) {
        lines.push(`    "${k}"`);
      }
      lines.push(`  }`);
    }
  }

  lines.push('}');
  return lines.join('\n') + '\n';
}

function main () {
  const write = process.argv.includes('--write');
  const { inherits, byFile } = buildMap(DEFAULT_SCAN_DIRS);

  for (const b of BUILTIN_BASES) {
    if (b === 'Object') continue;
    if (inherits[b] === undefined) inherits[b] = null;
  }
  for (const x of EXTERNAL_SUPERCLASSES) {
    if (inherits[x] === undefined) inherits[x] = null;
  }

  const tree = buildSubtree(inherits, null);

  const payload = {
    scanRoots: DEFAULT_SCAN_DIRS,
    inherits,
    tree,
    byFile
  };

  if (write) {
    fs.mkdirSync(path.dirname(JSON_REPORT), { recursive: true });
    fs.writeFileSync(JSON_REPORT, JSON.stringify(payload, null, 2), 'utf8');
    fs.mkdirSync(path.dirname(DOT_PATH), { recursive: true });
    fs.writeFileSync(DOT_PATH, edgesToDot(inherits), 'utf8');
    console.log('[classtree] wrote', path.relative(REPO_ROOT, DOT_PATH));
    console.log('[classtree] wrote', path.relative(REPO_ROOT, JSON_REPORT));
  }

  const summary = {
    classCount: Object.keys(inherits).length,
    scanRoots: DEFAULT_SCAN_DIRS,
    tree
  };
  console.log(JSON.stringify(write ? { ...summary, note: 'full payload in reports/class-inheritance.json' } : payload, null, 2));
}

main();
