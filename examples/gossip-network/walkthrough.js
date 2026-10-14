'use strict';

/**
 * Scroll-driven stage for examples/gossip-network walkthroughs.
 * Scene tables live on window.WALKTHROUGH (gossip.js / arc.js).
 */

var cfg = window.WALKTHROUGH || {};
var NODES = cfg.nodes || {
  you: { x: 90, y: 250, label: 'You' },
  alice: { x: 250, y: 90, label: 'Alice' },
  relay: { x: 368, y: 250, label: 'Relay' },
  bob: { x: 548, y: 90, label: 'Bob' },
  dest: { x: 620, y: 390, label: 'Dest' }
};
var EDGES = cfg.edges || [
  ['you', 'alice'],
  ['you', 'relay'],
  ['alice', 'relay'],
  ['alice', 'bob'],
  ['relay', 'bob'],
  ['relay', 'dest'],
  ['bob', 'dest']
];
var CAPTIONS = cfg.captions || {};
var SCENES = cfg.scenes || {};

var packetsLayer;
var reduceMotion = false;
var packets = [];
var sceneName = '';
var lastSpawn = 0;

function edgeKey (a, b) {
  return a < b ? a + '-' + b : b + '-' + a;
}

function hasPair (list, a, b) {
  if (!list) return false;
  for (var i = 0; i < list.length; i++) {
    if ((list[i][0] === a && list[i][1] === b) || (list[i][0] === b && list[i][1] === a)) return true;
  }
  return false;
}

function shows (spec, id) {
  return spec && spec.show && spec.show.indexOf(id) !== -1;
}

function fillChips (names) {
  var chips = document.getElementById('chips');
  if (!chips) return;
  chips.innerHTML = '';
  (names || []).forEach(function (name) {
    var li = document.createElement('li');
    li.textContent = name;
    chips.appendChild(li);
  });
}

function setArcState (arc) {
  if (!document.getElementById('arc')) return;
  if (!arc) {
    togglePanel('arc', false);
    return;
  }
  togglePanel('arc', true);
  var ns = document.getElementById('arc-ns');
  var clock = document.getElementById('arc-clock');
  var digest = document.getElementById('arc-digest');
  var note = document.getElementById('arc-note');
  var journal = document.getElementById('arc-journal');
  var roster = document.getElementById('arc-roster');
  if (ns) ns.textContent = arc.ns || '';
  if (clock) clock.textContent = arc.clock != null ? 'clock ' + arc.clock : '';
  if (digest) digest.textContent = arc.digest || '';
  if (note) note.textContent = arc.note || '';
  var spend = document.getElementById('arc-spend');
  if (spend) spend.textContent = arc.spend || '';
  if (journal) {
    journal.innerHTML = '';
    (arc.journal || []).forEach(function (row) {
      var li = document.createElement('li');
      li.textContent = row.text;
      if (row.tone) li.className = row.tone;
      journal.appendChild(li);
    });
  }
  if (roster) {
    roster.innerHTML = '';
    (arc.roster || []).forEach(function (row) {
      var li = document.createElement('li');
      li.textContent = row;
      roster.appendChild(li);
    });
  }
}

function buildMesh () {
  var linksG = document.getElementById('links');
  var nodesG = document.getElementById('nodes');
  packetsLayer = document.getElementById('packets');
  if (!linksG || !nodesG || !packetsLayer) return;

  EDGES.forEach(function (pair) {
    var a = NODES[pair[0]];
    var b = NODES[pair[1]];
    var line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    line.setAttribute('x1', a.x);
    line.setAttribute('y1', a.y);
    line.setAttribute('x2', b.x);
    line.setAttribute('y2', b.y);
    line.setAttribute('class', 'link');
    line.dataset.edge = edgeKey(pair[0], pair[1]);
    linksG.appendChild(line);
  });

  Object.keys(NODES).forEach(function (id) {
    var n = NODES[id];
    var g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    g.setAttribute('class', 'node' + (id === 'you' ? ' you' : '') + (id === 'relay' ? ' relay' : ''));
    g.dataset.id = id;
    var disc = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    disc.setAttribute('class', 'node-disc');
    disc.setAttribute('cx', n.x);
    disc.setAttribute('cy', n.y);
    disc.setAttribute('r', id === 'you' || id === 'relay' ? 16 : 13);
    var label = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    label.setAttribute('class', 'node-label');
    label.setAttribute('x', n.x);
    label.setAttribute('y', n.y + 28);
    label.textContent = n.label;
    g.appendChild(disc);
    g.appendChild(label);
    nodesG.appendChild(g);
  });
}

function applyScene (name) {
  sceneName = name;
  document.documentElement.dataset.scene = name;
  var spec = SCENES[name] || {};
  var caption = document.getElementById('stage-caption');
  if (caption) caption.textContent = CAPTIONS[name] || '';
  document.documentElement.dataset.dimMesh = spec.dimMesh ? '1' : '0';

  document.querySelectorAll('.node').forEach(function (el) {
    var on = spec.glow && spec.glow.indexOf(el.dataset.id) !== -1;
    el.classList.toggle('on', !!on);
  });

  document.querySelectorAll('.link').forEach(function (el) {
    el.classList.remove('on', 'dash', 'dim');
    var parts = el.dataset.edge.split('-');
    var a = parts[0];
    var b = parts[1];
    if (hasPair(spec.dash, a, b)) {
      el.classList.add('dash');
    } else if (hasPair(spec.links, a, b)) {
      el.classList.add('on');
    } else if (spec.links && spec.links.length) {
      el.classList.add('dim');
    }
  });

  togglePanel('amp', shows(spec, 'amp'));
  togglePanel('gates', shows(spec, 'gates'));
  togglePanel('chips', shows(spec, 'chips'));
  togglePanel('hash-row', shows(spec, 'hash'));
  if (shows(spec, 'chips')) fillChips(spec.chips || cfg.chips || []);
  setArcState(spec.arc || null);

  packets = [];
  if (packetsLayer) {
    while (packetsLayer.firstChild) packetsLayer.removeChild(packetsLayer.firstChild);
  }
  lastSpawn = 0;
}

function togglePanel (id, on) {
  var el = document.getElementById(id);
  if (!el) return;
  el.classList.toggle('is-shown', !!on);
  el.setAttribute('aria-hidden', on ? 'false' : 'true');
}

function spawnPacket (fromId, toId, now) {
  var from = NODES[fromId];
  var to = NODES[toId];
  if (!from || !to || !packetsLayer) return;
  var circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
  circle.setAttribute('class', 'pkt');
  circle.setAttribute('r', 5);
  circle.setAttribute('cx', from.x);
  circle.setAttribute('cy', from.y);
  packetsLayer.appendChild(circle);
  packets.push({
    el: circle,
    x0: from.x,
    y0: from.y,
    x1: to.x,
    y1: to.y,
    start: now,
    dur: 900
  });
}

function spawnPattern (kind, now) {
  if (kind === 'none') return;
  if (kind === 'session') {
    spawnPacket('you', 'alice', now);
    spawnPacket('alice', 'you', now + 420);
    return;
  }
  if (kind === 'onion') {
    spawnPacket('you', 'alice', now);
    spawnPacket('alice', 'bob', now + 50);
    return;
  }
  if (kind === 'burst') {
    spawnPacket('alice', 'relay', now);
    spawnPacket('alice', 'relay', now);
    spawnPacket('alice', 'relay', now);
    return;
  }
  var flood = [
    ['you', 'alice'],
    ['you', 'relay'],
    ['alice', 'bob'],
    ['relay', 'bob'],
    ['relay', 'dest'],
    ['bob', 'dest']
  ];
  flood.forEach(function (pair, i) {
    spawnPacket(pair[0], pair[1], now + i * 80);
  });
}

function tickPackets (now) {
  var spec = SCENES[sceneName] || {};
  var kind = spec.packets || 'none';
  var interval = kind === 'flood' ? 1600 : kind === 'flood-slow' ? 2400 : kind === 'burst' ? 1400 : kind === 'session' ? 1200 : kind === 'onion' ? 1800 : 0;

  if (!reduceMotion && interval && now - lastSpawn > interval) {
    lastSpawn = now;
    spawnPattern(kind, now);
  }

  for (var i = packets.length - 1; i >= 0; i--) {
    var p = packets[i];
    var t = (now - p.start) / p.dur;
    if (t >= 1) {
      p.el.remove();
      packets.splice(i, 1);
      continue;
    }
    if (t < 0) t = 0;
    p.el.setAttribute('cx', p.x0 + (p.x1 - p.x0) * t);
    p.el.setAttribute('cy', p.y0 + (p.y1 - p.y0) * t);
  }
}

function loop (now) {
  tickPackets(now);
  window.requestAnimationFrame(loop);
}

function updateProgress () {
  var el = document.getElementById('progress-bar');
  if (!el) return;
  var max = document.documentElement.scrollHeight - window.innerHeight;
  var pct = max <= 0 ? 0 : Math.min(1, Math.max(0, window.scrollY / max));
  el.style.width = (pct * 100) + '%';
}

function pickScene () {
  var chapters = document.querySelectorAll('.chapter');
  if (!chapters.length) return;
  var chosen = chapters[0];
  var best = Infinity;
  var mid = window.innerHeight * 0.42;
  chapters.forEach(function (ch) {
    var r = ch.getBoundingClientRect();
    var d = Math.abs(r.top - mid);
    if (r.bottom > 80 && d < best) {
      best = d;
      chosen = ch;
    }
  });
  chapters.forEach(function (ch) {
    ch.classList.toggle('is-active', ch === chosen);
  });
  var name = chosen.getAttribute('data-scene');
  if (name && name !== sceneName) applyScene(name);
}

function onScroll () {
  updateProgress();
  pickScene();
}

function start () {
  if (!document.getElementById('mesh')) return;
  reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  buildMesh();
  var first = document.querySelector('.chapter');
  applyScene(first ? first.getAttribute('data-scene') : 'island');
  updateProgress();
  pickScene();
  window.addEventListener('scroll', onScroll, { passive: true });
  window.addEventListener('resize', onScroll);
  if (!reduceMotion) window.requestAnimationFrame(loop);
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', start);
} else {
  start();
}
