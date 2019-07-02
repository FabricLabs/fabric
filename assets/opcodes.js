module.exports = {
  OP_ADD: function compute (input) {
    let a = this.stack.pop();
    let b = this.stack.pop();
    let sum = parseInt(a) + parseInt(b);
    return sum;
  },
  OP_TRUE: function compute (input) {
    return true;
  }
};
