'use strict';

var Fabric = require('../');
var fabric = new Fabric();

fabric.use('OP_CHECKSIG', function (sig) {
  console.log('computing with OP_CHECKSIG:', sig);
  return true; // ;)
  //return this.validateSignature(sig, 'test');
});

fabric.stack.push('<PUBLIC_KEY>');
fabric.stack.push('<SIGNATURE>');
fabric.stack.push('OP_CHECKSIG');

fabric.compute();

console.log('test:', fabric);
