'use strict';

/**
 * Development-only dependency graph helper. Not part of the RC public surface
 * (`package.json` `files[]` excludes this module). Optional `dependency-tree`
 * is never a runtime requirement of `@fabric/core`.
 *
 * @fileoverview Quarantined TypeTree scaffold (not shipped).
 * @module types/typetree
 * @deprecated Prefer PRODUCTION_MARCH keep/remove inventory over this helper.
 */

let DepTree = null;
try {
  DepTree = require('dependency-tree');
} catch (_) {
  DepTree = null;
}

class TypeTree {
  constructor (settings = {}) {
    this.settings = Object.assign({}, settings);
    this.tree = null;
    return this;
  }

  _loadFile (name) {
    if (!DepTree) {
      throw new Error(
        'TypeTree requires optional dependency-tree (not declared; module is not shipped in @fabric/core)'
      );
    }
    this.tree = DepTree({
      filename: name
    });
  }
}

module.exports = TypeTree;
