'use strict';

const assert = require('assert');
const net = require('net');
const { PassThrough } = require('stream');

const Message = require('../types/message');
const Peer = require('../types/peer');
const {
  HEADER_SIZE,
  MAX_MESSAGE_SIZE,
  MAX_FRAME_BYTES,
  LEGACY_MAX_FRAME_BYTES,
  MAX_DOCUMENT_ID_LENGTH,
  INVENTORY_RESPONSE_PAGE_BYTES
} = require('../constants');
const { paginateInventoryItems } = require('../types/documentBook');
const {
  NODEB,
  offlinePeerSettings,
  hubBaseSettings,
  memberBaseSettings,
  waitUntil,
  getFreePort
} = require('./helpers/peer');

function offlinePeer (overrides = {}) {
  return new Peer(offlinePeerSettings(overrides));
}

function frameOfBodyBytes (bytes) {
  return Message.fromVector(['P2P_BASE_MESSAGE', 'x'.repeat(bytes)]).toBuffer();
}

function sealedLikeItem (id, blobCount) {
  const blobs = [];
  for (let i = 0; i < blobCount; i++) {
    blobs.push({ index: i, hash: i.toString(16).padStart(64, '0'), size: 24576, rateSats: 716 });
  }
  return {
    id,
    contentHash: 'ab'.repeat(32),
    rateSats: 716 * blobCount,
    blobTotal: blobCount,
    blobs,
    documentBlobIndex: { root: 'cd'.repeat(32), leavesInline: true, blobs: blobs.map((b) => b.hash) }
  };
}

function smallItems (count) {
  const items = [];
  for (let i = 0; i < count; i++) {
    items.push({ id: `doc-${i}`, contentHash: 'ef'.repeat(32), rateSats: 1000 + i, note: 'n'.repeat(400) });
  }
  return items;
}

function parsePages (writes) {
  return writes.map((buf) => {
    const msg = Message.fromBuffer(buf);
    assert.strictEqual(msg.type, 'P2P_INVENTORY_RESPONSE');
    const parsed = Message.tryParseLegacyBody(msg);
    assert.ok(parsed.ok && parsed.encoding === 'fields');
    return parsed.value;
  });
}

function socketClosed (socket, timeoutMs) {
  return new Promise((resolve, reject) => {
    if (socket.destroyed) return resolve();
    const timer = setTimeout(() => reject(new Error(`socket still open after ${timeoutMs}ms`)), timeoutMs);
    socket.once('close', () => {
      clearTimeout(timer);
      resolve();
    });
  });
}

describe('@fabric/core Peer wire limits', function () {
  this.timeout(60000);

  describe('DocumentBook.paginateInventoryItems', function () {
    it('packs small items into pages under the byte budget', function () {
      const items = smallItems(200);
      const { pages, skipped } = paginateInventoryItems(items, { pageBytes: 8192 });
      assert.strictEqual(skipped.length, 0);
      assert.ok(pages.length > 1);
      for (const page of pages) assert.ok(Buffer.byteLength(JSON.stringify(page)) <= 8192);
      assert.deepStrictEqual(pages.flat(), items);
    });

    it('splits a many-blob item into blobsPartial slices that merge back', function () {
      const item = sealedLikeItem('sealed-installer', 400);
      const { pages, skipped } = paginateInventoryItems([item], { pageBytes: 4096 });
      assert.strictEqual(skipped.length, 0);
      assert.ok(pages.length > 1);
      const slices = pages.flat();
      for (const page of pages) assert.ok(Buffer.byteLength(JSON.stringify(page)) <= 4096);
      for (const slice of slices) {
        assert.strictEqual(slice.id, item.id);
        assert.strictEqual(slice.blobsPartial, true);
        assert.strictEqual(slice.blobTotal, 400);
        assert.strictEqual(slice.documentBlobIndex.root, item.documentBlobIndex.root);
        assert.strictEqual(slice.documentBlobIndex.leavesInline, false);
      }
      assert.deepStrictEqual(slices.flatMap((s) => s.blobs), item.blobs);
    });

    it('skips an item that cannot fit even one blob per page', function () {
      const item = { id: 'huge', note: 'z'.repeat(5000) };
      const { pages, skipped } = paginateInventoryItems([item, { id: 'ok' }], { pageBytes: 1024 });
      assert.deepStrictEqual(skipped, [item]);
      assert.deepStrictEqual(pages, [[{ id: 'ok' }]]);
    });
  });

  describe('inventory response pagination', function () {
    function collect (peer, name, remoteCap) {
      const writes = [];
      const conn = { _writeFabric (buf) { writes.push(Buffer.from(buf)); return true; } };
      if (remoteCap) conn._fabricRemoteMaxFrameBytes = remoteCap;
      peer.connections[name] = conn;
      return writes;
    }

    for (const [label, cap] of [['full-size', MAX_FRAME_BYTES], ['legacy', LEGACY_MAX_FRAME_BYTES]]) {
      it(`pages fit a ${label} peer's frame cap and merge to the original items`, function () {
        const peer = offlinePeer();
        const writes = collect(peer, '127.0.0.1:1', cap);
        const items = smallItems(150).concat([sealedLikeItem('sealed', 300)]);
        assert.strictEqual(peer._sendLocalInventoryDocumentsWireResponse('127.0.0.1:1', items), true);
        assert.ok(writes.length > 1);
        for (const buf of writes) assert.ok(buf.length <= cap, `${buf.length} > ${cap}`);
        const pages = parsePages(writes);
        const inventoryId = pages[0].inventoryId;
        assert.match(inventoryId, /^[0-9a-f]{16}$/);
        pages.forEach((page, i) => {
          assert.strictEqual(page.kind, 'documents');
          assert.strictEqual(page.inventoryId, inventoryId);
          assert.strictEqual(page.page, i + 1);
          assert.strictEqual(page.pages, pages.length);
        });
        const received = pages.flatMap((p) => p.items);
        const plain = received.filter((it) => !it.blobsPartial);
        assert.deepStrictEqual(plain, items.slice(0, 150));
        const slices = received.filter((it) => it.blobsPartial);
        assert.deepStrictEqual(slices.flatMap((s) => s.blobs), items[150].blobs);
      });
    }

    it('keeps the page budget inside INVENTORY_RESPONSE_PAGE_BYTES without a known remote cap', function () {
      const peer = offlinePeer();
      const writes = collect(peer, '127.0.0.1:2');
      peer._sendLocalInventoryDocumentsWireResponse('127.0.0.1:2', smallItems(400));
      for (const buf of writes) assert.ok(buf.length - HEADER_SIZE <= INVENTORY_RESPONSE_PAGE_BYTES + 256);
    });

    it('sends one empty page when allowEmpty is set', function () {
      const peer = offlinePeer();
      const writes = collect(peer, '127.0.0.1:3', LEGACY_MAX_FRAME_BYTES);
      assert.strictEqual(peer._sendLocalInventoryDocumentsWireResponse('127.0.0.1:3', [], { allowEmpty: true }), true);
      const pages = parsePages(writes);
      assert.strictEqual(pages.length, 1);
      assert.deepStrictEqual(pages[0].items, []);
      assert.strictEqual(pages[0].pages, 1);
    });
  });

  describe('frame-size negotiation', function () {
    function noisePair () {
      return { encrypt: new PassThrough(), decrypt: new PassThrough() };
    }

    it('treats a session without maxFrameBytes as a legacy 4096-byte peer', function () {
      const peer = offlinePeer();
      const stream = noisePair();
      peer.connections['127.0.0.1:9'] = { _noiseClient: stream };
      assert.strictEqual(peer._recordRemoteFrameCap('127.0.0.1:9', { challenge: 'x' }), LEGACY_MAX_FRAME_BYTES);
      assert.strictEqual(stream._fabricRemoteMaxFrameBytes, LEGACY_MAX_FRAME_BYTES);

      const warnings = [];
      peer.on('warning', (w) => warnings.push(String(w)));
      const sent = [];
      stream.encrypt.on('data', (chunk) => sent.push(chunk.length));
      assert.strictEqual(peer._writeFabric(frameOfBodyBytes(LEGACY_MAX_FRAME_BYTES - HEADER_SIZE), stream), true);
      assert.strictEqual(peer._writeFabric(frameOfBodyBytes(LEGACY_MAX_FRAME_BYTES - HEADER_SIZE + 1), stream), false);
      assert.ok(warnings.some((w) => w.includes('over remote frame cap 4096')), warnings.join(' | '));
      assert.deepStrictEqual(sent, [LEGACY_MAX_FRAME_BYTES]);
    });

    it('clamps an advertised cap to MAX_FRAME_BYTES', function () {
      const peer = offlinePeer();
      const stream = noisePair();
      peer.connections['127.0.0.1:10'] = { _noiseHandler: stream };
      assert.strictEqual(peer._recordRemoteFrameCap('127.0.0.1:10', { maxFrameBytes: 10 * MAX_FRAME_BYTES }), MAX_FRAME_BYTES);
      assert.strictEqual(peer._recordRemoteFrameCap('127.0.0.1:10', { maxFrameBytes: 'big' }), LEGACY_MAX_FRAME_BYTES);
      assert.strictEqual(peer._recordRemoteFrameCap('127.0.0.1:10', { maxFrameBytes: 8192 }), 8192);
      assert.strictEqual(stream._fabricRemoteMaxFrameBytes, 8192);
    });

    it('advertises its own cap from maxMessageSize', function () {
      assert.strictEqual(offlinePeer()._localMaxFrameBytes(), MAX_FRAME_BYTES);
      assert.strictEqual(offlinePeer({ maxMessageSize: 1000 })._localMaxFrameBytes(), HEADER_SIZE + 1000);
      assert.strictEqual(offlinePeer({ maxMessageSize: 10 * MAX_MESSAGE_SIZE })._localMaxFrameBytes(), MAX_FRAME_BYTES);
    });
  });

  describe('document id cap', function () {
    const longId = 'd'.repeat(MAX_DOCUMENT_ID_LENGTH + 1);

    it('requestDocument refuses ids over MAX_DOCUMENT_ID_LENGTH', function () {
      const peer = offlinePeer();
      const writes = [];
      peer.connections['127.0.0.1:20'] = { _writeFabric (buf) { writes.push(buf); return true; } };
      assert.strictEqual(peer.requestDocument(longId, '127.0.0.1:20'), false);
      assert.strictEqual(writes.length, 0);
    });

    it('_publishDocument refuses ids over MAX_DOCUMENT_ID_LENGTH', function () {
      const peer = offlinePeer();
      assert.strictEqual(peer._publishDocument(longId, 'body'), false);
      assert.ok(!peer._state.content.documents || !peer._state.content.documents[longId]);
      peer._publishDocument('d'.repeat(MAX_DOCUMENT_ID_LENGTH), 'body');
      assert.strictEqual(peer._state.content.documents['d'.repeat(MAX_DOCUMENT_ID_LENGTH)], 'body');
    });

    it('ignores DOCUMENT_REQUEST for an over-long id', function () {
      const peer = offlinePeer({ autoFulfillDocumentRequests: true });
      peer._state.content.documents = { [longId]: 'x' };
      const warnings = [];
      peer.on('warning', (w) => warnings.push(String(w)));
      const writes = [];
      peer.connections['127.0.0.1:21'] = { _writeFabric (buf) { writes.push(buf); return true; } };
      peer._handleDocumentRequestWire({ data: JSON.stringify({ document: longId }) }, { name: '127.0.0.1:21' }, null);
      assert.ok(warnings.some((w) => w.includes('invalid document id')), warnings.join(' | '));
      assert.strictEqual(writes.length, 0);
    });
  });

  describe('live NOISE transport', function () {
    let hub = null;
    let member = null;

    afterEach(async function () {
      for (const peer of [member, hub]) {
        if (peer) await peer.stop().catch(() => {});
      }
      hub = null;
      member = null;
    });

    async function startHub (overrides = {}) {
      const port = await getFreePort();
      hub = new Peer(hubBaseSettings(port, overrides));
      hub.on('error', () => {});
      hub.on('warning', () => {});
      await hub.start();
      return port;
    }

    function dial (port) {
      return new Promise((resolve, reject) => {
        const socket = net.connect(port, '127.0.0.1', () => resolve(socket));
        socket.on('error', () => {});
        socket.once('error', reject);
      });
    }

    it('drops a raw client announcing a huge NOISE message without allocating it', async function () {
      const port = await startHub();
      const socket = await dial(port);
      const before = process.memoryUsage().arrayBuffers;
      // varint(0xFFFFFFFF): announces a 4 GiB handshake message.
      socket.write(Buffer.from([0xff, 0xff, 0xff, 0xff, 0x0f]));
      await socketClosed(socket, 5000);
      assert.ok(process.memoryUsage().arrayBuffers - before < 16 * 1024 * 1024);
    });

    it('enforces an absolute handshake deadline against a trickling client', async function () {
      const port = await startHub({ handshakeTimeout: 400 });
      const socket = await dial(port);
      // Announce a 1000-byte handshake message, then trickle bytes to keep the idle timer alive.
      socket.write(Buffer.from([0xe8, 0x07]));
      const drip = setInterval(() => {
        if (!socket.destroyed) socket.write(Buffer.from([0x00]));
      }, 100);
      const started = Date.now();
      try {
        await socketClosed(socket, 5000);
      } finally {
        clearInterval(drip);
      }
      assert.ok(Date.now() - started < 3000);
    });

    it('records MAX_FRAME_BYTES for both ends of a live session and carries a full frame', async function () {
      const port = await startHub();
      member = new Peer(memberBaseSettings(hub, NODEB));
      member.on('error', () => {});
      member.on('warning', () => {});
      await member.start();

      const capOf = (peer) => Object.values(peer.connections).map((c) => c && c._fabricRemoteMaxFrameBytes);
      await waitUntil(() => capOf(hub).includes(MAX_FRAME_BYTES) && capOf(member).includes(MAX_FRAME_BYTES), 20000);

      const arrived = [];
      const handle = hub._handleFabricMessage;
      hub._handleFabricMessage = function (buffer, ...rest) {
        if (Buffer.isBuffer(buffer)) arrived.push(buffer.length);
        return handle.call(this, buffer, ...rest);
      };
      const memberConn = Object.values(member.connections).find((c) => c && c._fabricRemoteMaxFrameBytes === MAX_FRAME_BYTES);
      const frame = Message.fromVector(['P2P_BASE_MESSAGE', 'q'.repeat(MAX_MESSAGE_SIZE)]).signWithKey(member.key).toBuffer();
      assert.strictEqual(frame.length, MAX_FRAME_BYTES);
      assert.notStrictEqual(memberConn._writeFabric(frame), false);
      await waitUntil(() => arrived.includes(MAX_FRAME_BYTES), 10000);
    });
  });
});
