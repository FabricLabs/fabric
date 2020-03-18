'use strict';

class Layer extends Entity {
  constructor (state = {}) {
    super(state);

    // Assign Appropriate Settings
    this.settings = Object.assign({
      parents: [],
      children: [],
      session: {
        key: null
      },
      size: 256
    }, state);

    this._state = Object.assign({}, this.settings);

    return this;
  }

  get size () {
    return this._state.size;
  }

  get parents () {
    return this._state.parents;
  }

  get children () {
    return this._state.children;
  }
}
