module.exports = {
  OP_ADD: function compute (input) {
    const a = this.stack.pop();
    const b = this.stack.pop();
    const sum = parseInt(a) + parseInt(b);
    return sum;
  },
  OP_TRUE: function compute (input) {
    return true;
  }
};
