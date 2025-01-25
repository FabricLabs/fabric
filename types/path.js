'use strict';

class Path extends String {
  constructor (input = {}) {
    super(input);

    if (typeof input === 'string') input = { input };

    this.settings = Object.assign({
      input: '/'
    }, settings);

    return this;
  }

  /**
   * @returns {Boolean} Whether or not the Path is valid.
   */
  isValid () {
    return (
      this.id.length === 32
    ) ? true : false;
  }
}

module.exports = Path;
