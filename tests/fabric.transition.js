'use strict';

const assert = require('assert');
const Transition = require('../types/transition');

const stateSample = [
  { id: 1, something: 1 },
  { id: 2, something: 2 },
  { id: 3, something: 3 }
];

describe('@fabric/core/types/transition', function () {
  describe('Transition', function () {
    it('can fromTarget(target)', async () => {
      const transition = new Transition({
        origin: stateSample[0],
        target: stateSample[1]
      });

      const result = transition.fromTarget(stateSample[2]);

      assert.equal(result.data.origin, '44136fa355b3678a1146ad16f7e8649e94fb4fc21fe77e8310c060f61caaff8a');
      assert.equal(result.data.target, 'e44d57fe4579390236fc75367f8213f67da1b1c7810f3f0868818dc9d49c5984');
    });

    it('can between(origin,target)', async () => {
      const result = Transition.between(stateSample[0], stateSample[1]);
      const changes = result.data.changes;
      const expected = [
        {
          op: 'replace',
          path: '/something',
          value: 2
        },
        {
          op: 'replace',
          path: '/id',
          value: 2
        }
      ];

      for (const c in changes) {
        const change = changes[c];
        for (const p in change) {
          assert.equal(changes[c][p], expected[c][p]);
        }
      }
    });
  });
});
