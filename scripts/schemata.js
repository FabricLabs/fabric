'use strict';

const fs = require('fs');

fs.readdirSync(__dirname + '/../schemata').forEach(function (file) {
  if (file.match(/\.json$/) !== null && file !== 'index.js') {
    const name = file
      .replace('.json', '')
      .replace('.js', '');

    console.log('schema name:', name);
    // ... do stuff with the schemas?
    // or whatever else.
    // TODO: here for Eric's review.
  }
});
