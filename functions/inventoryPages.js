'use strict';

/**
 * @fileoverview Split `P2P_INVENTORY_RESPONSE` items into pages whose JSON fits one AMP frame.
 *
 * Items that fit are packed greedily. An item larger than a page (e.g. a sealed
 * document with ~130 per-blob rows) is repeated with consecutive slices of its
 * `blobs` (`blobsPartial: true`) and its `documentBlobIndex` leaves dropped
 * (`leavesInline: false`); every slice still carries the item id, root, and
 * blob total, so receivers that upsert offers per blob (`Book`) merge the
 * pages without further work. Items that cannot be made to fit are returned in
 * `skipped`.
 */

const {
  INVENTORY_RESPONSE_PAGE_BYTES
} = require('../constants');

/**
 * @private
 * @param {*} value
 * @returns {number}
 */
function jsonBytes (value) {
  return Buffer.byteLength(JSON.stringify(value), 'utf8');
}

/**
 * @private
 * @param {Object} item
 * @param {number} pageBytes
 * @returns {Object[]|null} slices, or null when even one blob per slice does not fit
 */
function sliceItemBlobs (item, pageBytes) {
  const blobs = Array.isArray(item.blobs) ? item.blobs : [];
  if (blobs.length < 2) return null;
  const base = Object.assign({}, item, { blobs: [], blobsPartial: true });
  if (base.documentBlobIndex && typeof base.documentBlobIndex === 'object') {
    base.documentBlobIndex = Object.assign({}, base.documentBlobIndex, { leavesInline: false, blobs: [] });
  }
  const baseBytes = jsonBytes(base);
  if (baseBytes >= pageBytes) return null;

  const slices = [];
  let current = [];
  let used = baseBytes;
  for (const blob of blobs) {
    const size = jsonBytes(blob) + 1;
    if (baseBytes + size > pageBytes) return null;
    if (current.length && used + size > pageBytes) {
      slices.push(Object.assign({}, base, { blobs: current }));
      current = [];
      used = baseBytes;
    }
    current.push(blob);
    used += size;
  }
  if (current.length) slices.push(Object.assign({}, base, { blobs: current }));
  return slices;
}

/**
 * Pack inventory items into pages.
 * @param {Object[]} items
 * @param {Object} [opts]
 * @param {number} [opts.pageBytes=INVENTORY_RESPONSE_PAGE_BYTES] Max JSON bytes of one page's `items` array.
 * @returns {{ pages: Object[][], skipped: Object[] }}
 */
function paginateInventoryItems (items, opts = {}) {
  const requested = Math.floor(Number(opts.pageBytes));
  const pageBytes = Number.isFinite(requested) && requested > 2 ? requested : INVENTORY_RESPONSE_PAGE_BYTES;
  const pages = [];
  const skipped = [];
  let current = [];
  let used = 2;

  const place = (entry, size) => {
    if (current.length && used + size + 1 > pageBytes) {
      pages.push(current);
      current = [];
      used = 2;
    }
    current.push(entry);
    used += size + (current.length > 1 ? 1 : 0);
  };

  for (const item of Array.isArray(items) ? items : []) {
    if (!item || typeof item !== 'object') continue;
    const size = jsonBytes(item);
    if (size + 2 <= pageBytes) {
      place(item, size);
      continue;
    }
    const slices = sliceItemBlobs(item, pageBytes - 2);
    if (!slices) {
      skipped.push(item);
      continue;
    }
    for (const slice of slices) place(slice, jsonBytes(slice));
  }
  if (current.length) pages.push(current);
  return { pages, skipped };
}

module.exports = {
  paginateInventoryItems
};
