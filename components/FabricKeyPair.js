// Dependencies
import merge from 'lodash.merge';
import React, { Component } from 'react';

// Components
import {
  Button,
  // Container,
  Dropdown,
  Form,
  // Grid,
  Icon
  // Menu,
  // Segment
} from 'semantic-ui-react';

// Fabric Types
import * as Actor from '@fabric/core/types/actor';
// import * as Key from '@fabric/core/types/key';
// import * as Signer from '@fabric/core/types/signer';
// import * as bcoin from 'bcoin';

class FabricKeyPair extends Component {
  constructor (props) {
    super(props);

    this.settings = merge({
      network: 'regtest'
    }, props);

    // TODO: prepare Fabric
    // i.e., use _state here, then import from getter and apply properties
    // _from_ @react
    this.state = merge({
      keys: [],
      keypair: {
        private: null,
        public: null
      }
    }, props);

    return this;
  }

  render () {
    // const { fields } = this.state;
    console.log('KeyPair state:', this.state);
    console.log('      keypair:', this.state.keypair);

    return (
      <>
        <Form>
          <Form.Group widths='equal'>
            <Form.Field disabled type='password' control='input' label='Private' value={this.state.keypair.private || 'Loading...'} />
            <Form.Field disabled type='text' control='input' label='Public' value={this.state.keypair.public || 'Loading...'} />
          </Form.Group>
        </Form>
      </>
    );
  }
}

export default FabricKeyPair;
