'use strict';

// JSDoc/JSDoc2MD can JSON.stringify parse metadata that includes bigint values.
// Define BigInt serialization for the docs generation process only.
if (typeof BigInt !== 'undefined' && typeof BigInt.prototype.toJSON !== 'function') {
  Object.defineProperty(BigInt.prototype, 'toJSON', {
    value: function toJSON () {
      return this.toString();
    },
    writable: true,
    configurable: true,
    enumerable: false
  });
}
