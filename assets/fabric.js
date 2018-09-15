/**
 * # Fabric: an experimental p2p framework
 * Providing an interface to Fabric network, this file defines the available
 * components and abstractions used when relying on this library.
 */
'use strict';

Object.defineProperty(exports, '__esModule', {
  value: true
});

var _createClass = (function () { function defineProperties (target, props) { for (var i = 0; i < props.length; i++) { var descriptor = props[i]; descriptor.enumerable = descriptor.enumerable || false; descriptor.configurable = true; if ('value' in descriptor) descriptor.writable = true; Object.defineProperty(target, descriptor.key, descriptor); } } return function (Constructor, protoProps, staticProps) { if (protoProps) defineProperties(Constructor.prototype, protoProps); if (staticProps) defineProperties(Constructor, staticProps); return Constructor; }; }());

function _classCallCheck (instance, Constructor) { if (!(instance instanceof Constructor)) { throw new TypeError('Cannot call a class as a function'); } }

function _possibleConstructorReturn (self, call) { if (!self) { throw new ReferenceError("this hasn't been initialised - super() hasn't been called"); } return call && (typeof call === 'object' || typeof call === 'function') ? call : self; }

function _inherits (subClass, superClass) { if (typeof superClass !== 'function' && superClass !== null) { throw new TypeError('Super expression must either be null or a function, not ' + typeof superClass); } subClass.prototype = Object.create(superClass && superClass.prototype, { constructor: { value: subClass, enumerable: false, writable: true, configurable: true } }); if (superClass) Object.setPrototypeOf ? Object.setPrototypeOf(subClass, superClass) : subClass.__proto__ = superClass; }

var Fabric = require('./fabric');

/**
 * Default interface to {@link Fabric}.  Exposes immutable types for all
 * requisite {@link Component} elements of the `components` option.
 * @property {Configuration} config Initial {@link Vector}.
 * @property {Map} config.components Transformation function of `Σ ⇒ Δ`.
 */

var App = (function (_Fabric) {
  _inherits(App, _Fabric);

  /**
   * Create a new instance of the Fabric App.
   * @param  {Object} config Configuration object.
   * @param  {Object} config.store Path to local storage.
   * @return {App}
   */
  function App (config) {
    var _ret;

    _classCallCheck(this, App);

    var _this = _possibleConstructorReturn(this, (App.__proto__ || Object.getPrototypeOf(App)).call(this, config));

    _this.config = Object.assign({
      store: './data/' + _this.constructor.name.toLowerCase()
    }, config);
    return _ret = _this, _possibleConstructorReturn(_this, _ret);
  }

  _createClass(App, [{
    key: 'render',
    value: function render () {
      return '<Fabric />';
    }
  }]);

  return App;
}(Fabric));

exports.default = App;

module.exports = App;
