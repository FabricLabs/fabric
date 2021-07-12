'use strict';

// External Dependencies
const monitor = require('fast-json-patch');

// Internal Types
const Capability = require('./capability');
const EncryptedPromise = require('./promise');
const Entity = require('./entity');
const Witness = require('./witness');

/**
 * The {@link Transition} type reflects a change from one finite
 * {@link State} to another.
 */
class Transition extends Entity {
  /**
   *
   * @param {Object} settings Configuration for the transition object.
   */
  constructor (settings = {}) {
    super(settings);

    this.status = 'constructing';
    this._state = {
      origin: null,
      target: null,
      changes: [],
      program: [],
      witness: null
    };

    this.settings = Object.assign({}, this._state, settings);
    this.witness = new Witness(this.settings);

    this._setOrigin(this.settings.origin);
    this._setTarget(this.settings.target);

    this.status = 'constructed';
  }

  static between (origin, target) {
    let x = new Entity(origin);
    let y = new Entity(target);

    let actor = Object.assign({}, origin);
    let observer = monitor.observe(actor);

    Object.assign(actor, target);

    let transition = new Transition({
      origin: x.id,
      target: y.id,
      changes: monitor.generate(observer)
    });

    return transition;
  }

  fromTarget (target) {
    let base = new Entity();
    let entity = this._describeTarget(target);
    let transition = new Transition({
      origin: base.id,
      target: entity.id
    });

    return transition;
  }

  _applyTo (state) {
    if (!state) throw new Error('State must be provided.');
    if (!(state instanceof Entity)) throw new Error('State not of known Entity type.');

    let instance = Object.assign({}, state);
    let observer = monitor.observe(instance);

    try {
      monitor.applyPatch(instance, this._state.changes);
    } catch (E) {
      console.error('Could not apply changes:', E);
    }

    let changes = monitor.generate(observer);
    // console.log('changes:', changes);
    return instance;
  }

  _setChanges (changes) {
    if (!changes) throw new Error('No changes specified.');
    this._state.changes = changes;
  }

  _setOrigin (origin) {
    if (!origin) throw new Error('No origin specified.');
    this._state.origin = origin;
  }

  _setTarget (target) {
    if (!target) throw new Error('No target specified.');
    this._state.target = target;
  }

  _describeTarget (target) {
    if (!target) throw new Error('No target specified.');
    let entity = new Entity(target);
    this._setTarget(entity.id);
    return entity;
  }
}

module.exports = Transition;
