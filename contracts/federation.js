const Actor = require('../types/actor');
const Block = require('../types/block');

module.exports = function OP_ADVANCE_BLOCK (input) {
  const actor = new Actor(input);
  return {
    input: actor
  };
}
