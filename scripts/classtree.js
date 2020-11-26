'use strict';

const fs = require('fs');
const path = process.argv[2];

let files = fs.readdirSync(path);
let classExtends = {};

for (let i = 0; i < files.length; i++) {
  if (!files[i].includes('.js')) continue;
  let text = fs.readFileSync(path + "/" + files[i], 'utf8');
  let ci = text.indexOf('class ');

  let decl = '';
  if (ci >= 0) {
    for (var j = ci; j < text.length; j++) {
      if (text[j] === '{') break;
      decl += text[j];
    }
  }

  decl = decl.trim();
  if (!decl) continue;

  let parts = decl.split(' ');
  if (parts.length > 4) continue;

  let className = parts[1];
  let extendsClassName = null;

  if (parts.includes('extends')) {
    let classPath = parts[3].split('.');
    extendsClassName = classPath[classPath.length - 1];
  }

  classExtends[className] = extendsClassName;
  if (!classExtends[extendsClassName]) classExtends[extendsClassName] = null;
}

classExtends['EventEmitter'] = null;

function buildSubtree(subtree, parent=null) {
  for (let k in classExtends) {
    if (k === 'null' || k === null) continue;
    if (classExtends[k] === parent) {
      subtree[k] = {};
      buildSubtree(subtree[k], k);
    }
  }
}

buildSubtree(tree);
console.log(JSON.stringify(tree, null, 2));
