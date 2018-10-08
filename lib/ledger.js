'use strict';

const Scribe = require('./scribe');
const Stack = require('./stack');

/**
 * An ordered stack of pages.
 * @extends Scribe
 */
class Ledger extends Scribe {
  constructor (state) {
    super(state);

    this.memory = Buffer.alloc(4096);
    this.pages = new Stack(state);

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

    this.trust(this.pages);
    this.status = 'started';

    return this;
  }

  async append (item) {
    this.log('[LEDGER]', 'appending:', `:${typeof item}<${(JSON.stringify(item).length | 0)}>`, `|${JSON.stringify(item)}|`);
    this.pages.push(item);

    await this.pages.commit();
    await this.commit();

    return this;
  }

  commit () {
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
