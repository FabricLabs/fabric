'use strict';

const Component = require('@fabric/http/components/component');

class CircuitList extends Component {
  constructor (settings = {}) {
    super(settings);

    this.settings = Object.assign({
      title: 'Circuit List',
      handle: 'fabric-circuit-list'
    });

    return this;
  }

  _getInnerHTML () {
    return `<div class="ui segment">
      <div class="content">
        <h3>${this.settings.title}</h3>
        <fabric-grid-row>
          <a href="/circuits/00"><small class="subtle">#</small></a>
        </fabric-grid-row>
      </div>
    </div>`;
  }
}

module.exports = CircuitList;
