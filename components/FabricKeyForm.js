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

class FabricKeyForm extends Component {
  constructor (props) {
    super(props);

    this.settings = merge({
      network: 'regtest'
    }, props);

    /* this.wallet = new Wallet({
      network: this.settings.network
    }); */

    // this.key = new Key(this.settings);
    // this._key = new bcoin.hd.key();

    // TODO: prepare Fabric
    // i.e., use _state here, then import from getter and apply properties
    // _from_ @react
    this.state = merge({
      assets: [],
      balances: [],
      btca: { tip: null, height: 0 },
      btcb: { tip: null, height: 0 },
      confirmation: 'Awaiting transaction...',
      counterparty: 'Awaiting transaction...',
      fields: {
        seed: '',
        password: ''
      },
      inputs: [],
      integrity: 'sha256-deadbeefbabe',
      keys: [],
      order: {
        bid: {},
        ask: {}
      },
      peers: [],
      secret: Actor.randomBytes(32) // solution hash (revealed on trade)
    }, props);

    return this;
  }

  handleAskAssetSelection (e) {
    this.setState({
      ask: {
        asset: e.target.value
      }
    });
  }

  handleBidAssetSelection (e) {
    this.setState({
      bid: {
        asset: e.target.value
      }
    });
  }

  handleAskAmountSelection (e) {
    this.setState({
      ask: {
        amount: e.target.value
      }
    });
  }

  handleBidAmountSelection (e) {
    this.setState({
      bid: {
        amount: e.target.value
      }
    });
  }

  handleLocktimeSelection (e) {
    this.setState({
      locktime: e.target.value
    });
  }

  handleChange (e) {
    const newFields = { ...this.state.fields, [e.target.name]: e.target.value };
    // TODO: merge old state
    this.setState({ fields: newFields });
  }

  handleSubmit (e) {
    e.preventDefault();
    // whatever you want to do when user submits a form
    console.log('e:', e);
    console.log('e.target:', e.target);
    console.log('e.target value:', e.target.value);

    return false;
  }

  render () {
    // const { fields } = this.state;
    console.log('assets:', this.assets);

    return (
      <>
        <Form onSubmit={this.props.handleSubmit.bind(this)}>
          {/*<Form.Group widths='equal'>
            <Form.Field>
              <label>Local Public Key</label>
              <pre>{this.state.pubkey}</pre>
            </Form.Field>
          </Form.Group>*/}
          <Button.Group floated='right'>
            <Button disabled icon='upload' labelPosition='left' color='blue' content='Import' />
            <Button icon='leaf' labelPosition='right' color='green' content='Generate' onClick={this.props._generateNewKey.bind(this)} />
          </Button.Group>
          <br className='clearfix' />
        </Form>
      </>
    );
  }

  saveAndContinue (e) {
    e.preventDefault();
    this.props.nextStep();
  }

  _handleRestoreButtonClick () {
    this.setState({ modalOpen: true });
  }

  _handleGeneratorButtonClick () {
    this.setState({ modalOpen: true });
  }

  _handleGenerateClick () {
    console.log('generate request click');
  }

  _handleGenerateKeyPress (e) {
    if (e.charCode === 32 || e.charCode === 13) {
      // Prevent the default action to stop scrolling when space is pressed
      e.preventDefault();
      console.log('Button received click with keyboard');
    }
  }

  _handleRestoreKeyPress (e) {
    if (e.charCode === 32 || e.charCode === 13) {
      // Prevent the default action to stop scrolling when space is pressed
      e.preventDefault();
      console.log('Button received click with keyboard');
    }
  }
}

export default FabricKeyForm;
