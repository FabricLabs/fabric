'use strict';

require('debug-trace')({ always: true });

const Witness = require('../types/witness');
const sample = 'Hello, world!';
const privkey = 'e6324f909a861b953e42438c2d4068dee59d576c32150309eaee07ceb21233a';

async function main () {
  let witness = new Witness({
    data: sample,
    keypair: {
      private: privkey
    }
  });

  console.log('Witness:', witness);
  console.log('Signature:', witness.signature);
  console.log('Bitcoin DER:', witness.toCompactDER());
  console.log('Bitcoin DER as hex:', witness.toCompactDER().toString('hex'));
  console.log('Witness pubkey:', witness.pubkey);

  let verifier = new Witness({
    keypair: { public: witness.pubkey }
  });

  console.log('Verifier:', verifier);
  console.log('Verifier keypair:', verifier.keypair);

  let verification = verifier.verify(sample, witness.signature);
  console.log('Verification:', verification);
}

main();