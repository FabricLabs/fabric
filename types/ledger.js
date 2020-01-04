'use strict';

const Scribe = require('./scribe');
const Stack = require('./stack');

/**
 * An ordered stack of pages.
 * @property {Buffer} memory The ledger's memory (4096 bytes).
 * @property {Stack} stack The ledger's stack.
 * @property {Mixed} tip The most recent page in the ledger.
 * @extends Scribe
 */
class Ledger extends Scribe {
  constructor (state) {
    super(state);

    this.memory = Buffer.alloc(4096);
    this.pages = new Stack(state || []);

    return this;
  }

  get tip () {
    return this.pages[this.pages.length - 1];
  }

  async start () {
    await super.start();

    if (!this.pages.length) {
      await this.append({
        name: 'genesis'
      });
    }

    this.status = 'started';

    return this;
  }

  /**
   * Attempts to append a {@link Page} to the ledger.
   * @param  {Mixed}  item Item to store.
   * @return {Promise}      Resolves after the change has been committed.
   */
  async append (item) {
    this.pages.push(item);
    await this.pages.commit();
    await this.commit();
    return this;
  }

  commit () {
    if (!this.pages) return null;
    this['@data'] = this.pages['@data'];
    return this.id;
  }

  consume (ink) {
    if (!this.ink) this.ink = ink;
    return this.ink;
  }

  render () {
    return `<Ledger id="${this['@id']}" />`;
  }
}

module.exports = Ledger;
