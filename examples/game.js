const _ = require('../contracts/functions');

const Fabric = require('../types/fabric');
const game = new Fabric({
  spawns: []
});

const template = require('../data/mob');

game.use('tick', function (input) {
  const self = this;
  console.log('tick!', self.clock);
  return input;
});

game.use('spawn', function (input) {
  var self = this;
  var data = _.clone(template);

  data.id = Math.random();

  var mob = new Fabric(data);

  mob.use('attack', function (target, stack) {
    console.log('attack!', target);
    console.log('attack stack:', stack);
    
    mob.broadcast('attack', '/spawns/1');

    /*var tx = new Transaction({
      
    });*/

    //target.transactions.push(tx);
    //target.transactions.push(tx);

    // TODO: use fabric call
    //input.spawns[1].life -= 5;
    
    return target;
  });
  
  mob.on('attack', function (target) {
    console.log('mob attack:', target);
    game.patch([
      { op: 'replace', path: target + '/life', value: 0 }
    ]);
    //game.compute();
  });

  mob.compute();

  input.spawns.push(mob);

  return input;
});

game.use('battle', function (input) {
  var self = this;
  
  console.log('battling...', input.spawns);
  
  input.spawns[0].stack.push('attack');
  input.spawns[0].compute();
  
  return input;
});

game.stack.push('spawn');
game.stack.push('spawn');
//game.stack.push('spawn');
game.stack.push('battle');

game.on('mutation', function(i) {
  console.log('m:', i.map(function(x) {
    return x.path;
  }));
});

game.compute();

console.log('world:', game['@data'].spawns.map(function(x) {
  return x;
}));
