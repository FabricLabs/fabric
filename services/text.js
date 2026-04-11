'use strict';

const Service = require('../types/service');
const truncateMiddle = require('../functions/truncateMiddle');
const oxfordJoin = require('../functions/oxfordJoin');

/**
 * Text-oriented {@link Service} stub (legacy name was <code>TXT</code>).
 * Static helpers mirror small utilities used in Sensemaker (tokenize, middle truncation,
 * relative time strings) and core helpers ({@link module:functions/oxfordJoin}).
 * @class Text
 * @extends Service
 */
class Text extends Service {
  constructor (config) {
    super(config);
    this.config = Object.assign({}, config);
  }

  /**
   * Split on runs of whitespace (Sensemaker-style tokenization).
   * @param {string} string
   * @returns {string[]}
   */
  static tokenize (string) {
    return String(string).split(/\s/g);
  }

  /**
   * Shorten a string in the middle if longer than <code>strLen</code>.
   * @param {string} fullStr
   * @param {number} strLen
   * @param {string} [separator]
   * @returns {string}
   */
  static truncateMiddle (fullStr, strLen, separator) {
    return truncateMiddle(fullStr, strLen, separator);
  }

  /**
   * Human-readable relative time (e.g. <code>3 days ago</code>), ported from Sensemaker.
   * @param {Date|string|number} date
   * @returns {string}
   */
  static toRelativeTime (date) {
    const now = new Date();
    const then = new Date(date);
    const diff = now - then;
    const seconds = Math.floor(diff / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);
    const weeks = Math.floor(days / 7);
    const months = Math.floor(weeks / 4);
    const years = Math.floor(months / 12);

    if (years > 0) return `${years} year${years === 1 ? '' : 's'} ago`;
    if (months > 0) return `${months} month${months === 1 ? '' : 's'} ago`;
    if (weeks > 0) return `${weeks} week${weeks === 1 ? '' : 's'} ago`;
    if (days > 0) return `${days} day${days === 1 ? '' : 's'} ago`;
    if (hours > 0) return `${hours} hour${hours === 1 ? '' : 's'} ago`;
    if (minutes > 0) return `${minutes} minute${minutes === 1 ? '' : 's'} ago`;
    if (seconds > 0) return `${seconds} second${seconds === 1 ? '' : 's'} ago`;
    return 'just now';
  }

  /**
   * Join a list with an Oxford comma (delegates to {@link module:functions/oxfordJoin}).
   * @param {string[]} list
   * @returns {string}
   */
  static oxfordJoin (list) {
    return oxfordJoin(list);
  }
}

module.exports = Text;
