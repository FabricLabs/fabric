#!/usr/bin/env node
'use strict';

/**
 * Minimal static file server (replaces deprecated http-server devDependency).
 * Usage: node scripts/static-server.js [root] [-p port]
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.htm': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.map': 'application/json',
  '.md': 'text/markdown; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.wasm': 'application/wasm',
  '.xml': 'application/xml'
};

function parseArgs (argv) {
  let root = '.';
  let port = 8080;
  const positional = [];
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '-p' || a === '--port') {
      port = Number(argv[++i]);
    } else if (a.startsWith('-p') && a.length > 2) {
      port = Number(a.slice(2));
    } else if (a === '-h' || a === '--help') {
      console.log('Usage: node scripts/static-server.js [root] [-p port]');
      process.exit(0);
    } else {
      positional.push(a);
    }
  }
  if (positional.length) root = positional[0];
  return { root: path.resolve(root), port };
}

function safeJoin (root, reqPath) {
  let decoded;
  try {
    decoded = decodeURIComponent(String(reqPath || '/').split('?')[0]);
  } catch {
    return null;
  }
  const rel = decoded.replace(/^\/+/, '') || 'index.html';
  const resolved = path.normalize(path.join(root, rel));
  const rootResolved = path.resolve(root);
  const rootPrefix = rootResolved.endsWith(path.sep) ? rootResolved : rootResolved + path.sep;
  if (resolved !== rootResolved && !resolved.startsWith(rootPrefix)) return null;
  return resolved;
}

function contentType (filePath) {
  return MIME[path.extname(filePath).toLowerCase()] || 'application/octet-stream';
}

function serveFile (res, filePath) {
  const stream = fs.createReadStream(filePath);
  res.writeHead(200, { 'Content-Type': contentType(filePath), 'Cache-Control': 'no-cache' });
  stream.pipe(res);
  stream.on('error', () => {
    if (res.headersSent) {
      res.destroy();
      return;
    }
    res.writeHead(500);
    res.end('Internal Server Error');
  });
}

function handler (root) {
  return (req, res) => {
    let filePath = safeJoin(root, req.url || '/');
    if (!filePath) {
      res.writeHead(403);
      res.end('Forbidden');
      return;
    }
    fs.stat(filePath, (err, stat) => {
      if (!err && stat.isDirectory()) {
        filePath = path.join(filePath, 'index.html');
      }
      fs.stat(filePath, (err2, stat2) => {
        if (err2 || !stat2.isFile()) {
          res.writeHead(404);
          res.end('Not Found');
          return;
        }
        serveFile(res, filePath);
      });
    });
  };
}

function listenHost () {
  const host = String(process.env.FABRIC_STATIC_HOST || '127.0.0.1').trim() || '127.0.0.1';
  return host;
}

function listen (port, root) {
  const host = listenHost();
  const server = http.createServer(handler(root));
  server.listen(port, host, () => {
    const addr = server.address();
    const actual = typeof addr === 'object' && addr ? addr.port : port;
    const base = host === '0.0.0.0' || host === '::'
      ? `http://127.0.0.1:${actual}`
      : `http://${host}:${actual}`;
    console.log('Serving', root);
    console.log('Available on:', base, `(bind ${host})`);
    console.log('Hit CTRL-C to stop');
  });
  return server;
}

module.exports = {
  parseArgs,
  safeJoin,
  contentType,
  serveFile,
  handler,
  listenHost,
  listen
};

if (require.main === module) {
  const { root, port } = parseArgs(process.argv);
  if (!fs.existsSync(root) || !fs.statSync(root).isDirectory()) {
    console.error('Not a directory:', root);
    process.exit(1);
  }

  if (port === 0) {
    const host = listenHost();
    const server = http.createServer(handler(root));
    server.listen(0, host, () => {
      const addr = server.address();
      const actual = typeof addr === 'object' && addr ? addr.port : 0;
      const base = host === '0.0.0.0' || host === '::'
        ? `http://127.0.0.1:${actual}`
        : `http://${host}:${actual}`;
      console.log('Serving', root);
      console.log('Available on:', base, `(bind ${host})`);
    });
  } else {
    listen(port, root);
  }
}
