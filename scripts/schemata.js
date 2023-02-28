'use strict';

const fs = require('fs');

async function main () {
  const schemata = {};

  fs.readdirSync(__dirname + '/../schemata').forEach(function (file) {
    if (file.match(/\.json$/) !== null && file !== 'index.js') {
      const name = file
        .replace('.json', '')
        .replace('.js', '');

      schemata[name] = null;
      // ... do stuff with the schemas?
      // or whatever else.
      // TODO: here for Eric's review.
    }
  });

  return { schemata };
}

main().then((output) => {
  console.log('Schemata:', output);
});
