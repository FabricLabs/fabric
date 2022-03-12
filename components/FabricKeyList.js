import * as EC from '../../node_modules/elliptic/lib/elliptic/ec';

import React, {
  Component
} from 'react';

// Components
import {
  Button,
  // Card,
  // Container,
  Header,
  Icon,
  Input,
  // Grid,
  // Label,
  // Menu,
  Segment,
  Table
} from 'semantic-ui-react';

import * as Actor from '@fabric/core/types/actor';
import FabricKeyManager from './FabricKeyManager';

class KeyList extends Component {
  constructor (props) {
    super(props);

    this.state = {
      status: 'PAUSED',
      keys: [],
      integrity: 'sha256-deadbeefbabe'
    };

    this.ec = new EC('secp256k1');

    return this;
  }

  _addKey (key) {
    // TODO: merge proper
    this.setState({ keys: this.state.keys.concat(key) });
  }

  _generateNewKey () {
    const last = this.state.status;
    if (this.state.status == 'GENERATING') return null;
    this.state.status = 'GENERATING';
    const keypair = this.ec.genKeyPair();
    const keys = [...this.state.keys];
    const actor = new Actor({
      private: keypair.getPrivate('hex'),
      public: keypair.getPublic().encodeCompressed('hex')
    });

    keys.push({ id: actor.id, ...actor.toObject()});

    this.setState({ keys });
    this.state.status = last;
    return keypair;
  }

  _handleKeyFormSubmit (e) {
    console.log('keyformsubmit:', e.target.value);
    console.log('keys:', this.state.keys);
  }

  render () {
    return (
      <>
        <div className='ui vertical stripe segment'>
          <div className='ui stackable grid container'>
            <div className='row'>
              <div className='column'>
                <FabricKeyManager keys={this.state.keys} />
              </div>
            </div>
          </div>
        </div>
      </>
    );
  }
}

export default KeyList;
