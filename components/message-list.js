'use strict';

const Component = require('@fabric/http/components/component');

class MessageList extends Component {
  constructor (settings = {}) {
    super(settings);
    this.settings = Object.assign({
      title: 'Message List',
      handle: 'fabric-message-list'
    });
    return this;
  }
}

module.exports = MessageList;
