'use strict';

module.exports = function oxfordJoin(list) {
  if (!Array.isArray(list) || list.length === 0) {
    return '';
  }

  if (list.length === 1) {
    return list[0];
  }

  if (list.length === 2) {
    return list.join(' and ');
  }

  // For more than two items, use Oxford comma style
  return list.slice(0, -1).join(', ') + ', and ' + list.slice(-1);
}
