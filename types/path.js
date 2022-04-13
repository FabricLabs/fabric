'use strict';

/**
 * A {@link Path} is a {@link Fabric}-native link to a {@link Document}
 * within the network.
 */
class Path extends String {
  /**
   * Create a new {@link Path}.
   * @param {String|Object} input Named path.
   */
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
    );
  }
}

module.exports = Path;
