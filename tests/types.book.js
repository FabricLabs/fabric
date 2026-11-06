'use strict';

const assert = require('assert');
const Book = require('../types/book');

describe('types/book', function () {
  it('evicts the oldest row past capacity', function () {
    const book = new Book({ maxEntries: 2 });
    book._insert('a', { n: 1 });
    book._insert('b', { n: 2 });
    book._insert('c', { n: 3 });
    assert.strictEqual(book.size, 2);
    assert.strictEqual(book.has('a'), false);
    assert.deepStrictEqual(book._list().map((r) => r.n), [2, 3]);
  });

  it('a refreshed row moves to the newest position', function () {
    const book = new Book({ maxEntries: 2 });
    book._put('a', { n: 1 });
    book._put('b', { n: 2 });
    book._put('a', { n: 10 });
    book._put('c', { n: 3 });
    assert.deepStrictEqual([...book._entries.keys()], ['a', 'c']);
    assert.strictEqual(book._row('a').n, 10);
  });

  it('honors a subclass capacity', function () {
    class Small extends Book {
      get capacity () {
        return this.settings.maxThings;
      }
    }
    const book = new Small({ maxThings: 1 });
    book._insert('a', {});
    book._insert('b', {});
    assert.deepStrictEqual([...book._entries.keys()], ['b']);
  });

  it('never loops on a zero capacity', function () {
    const book = new Book({ maxEntries: 0 });
    book._insert('a', {});
    book._insert('b', {});
    assert.deepStrictEqual([...book._entries.keys()], ['b']);
  });

  it('forgets rows by predicate and lists with a filter', function () {
    const book = new Book();
    book._insert('a', { owner: 'x' });
    book._insert('b', { owner: 'y' });
    book._insert('c', { owner: 'x' });
    assert.deepStrictEqual(book._list((r) => r.owner === 'x').length, 2);
    assert.strictEqual(book._forget((r) => r.owner === 'x'), 2);
    assert.deepStrictEqual([...book._entries.keys()], ['b']);
    assert.strictEqual(book._delete('b'), true);
    assert.strictEqual(book._delete('b'), false);
    assert.strictEqual(book.size, 0);
  });

  it('uses the injected clock', function () {
    const book = new Book({ now: () => 42 });
    assert.strictEqual(book.now(), 42);
  });
});
