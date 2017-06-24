var util = require('util');
var Vector = require('./vector');

function Store (vector) {
  this['@data'] = vector || {
    get: function GET() {},
    put: function PUT() {},
    del: function DEL() {},
    createReadStream: function createReadStream() {},
  };
}

// could be looked up by name of parameter in #4
util.inherits(Store, Vector);

Store.prototype.get = function GET () {
  
}

Store.prototype.put = function PUT () {
  
}

Store.prototype.del = function DEL () {
  
}

Store.prototype.createReadStream = function createReadStream () {
  
}

module.exports = Store;
