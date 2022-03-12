// Dependencies
import merge from 'lodash.merge';
import TrezorConnect from 'trezor-connect';

import FabricComponent from '../types/component';

// Components
import {
  Button,
  Card,
  Form,
  // Container,
  Icon,
  // Grid,
  // Menu,
  // Segment
} from 'semantic-ui-react';

import IdentityPicker from './IdentityPicker';
import SeedEntryForm from './SeedEntryForm';

class FabricIdentityManager extends FabricComponent {
  constructor (props) {
    super(props);

    this.settings = merge({
      explain: false,
      keys: []
    }, props);

    // TODO: prepare Fabric
    // i.e., use _state here, then import from getter and apply properties
    // _from_ @react
    this.state = {
      explain: true,
      hash: null,
      identities: [],
      integrity: 'sha256-deadbeefbabe',
      status: 'PAUSED',
      step: 1
    };

    return this;
  }

  handleChange = input => event => {
    this.setState({[input]: event.target.value})
  }

  setStep () {
    const { step } = this.state;
    this.setState({ step });
  }

  nextStep () {
    const { step } = this.state;
    this.setState({
      step: step + 1
    });
  }

  previoustStep () {
    const { step } = this.state;
    this.setState({
      step: step - 1
    });
  }

  start () {
    TrezorConnect.manifest({
      email: 'labs@fabric.pub',
      appUrl: 'https://hub.fabric.pub'
    });

    this.setState({ status: 'STARTED' });
    return this;
  }

  render () {
    const { step } = this.state;
    const { firstName, lastName, email, age, city, country } = this.state;
    const values = { firstName, lastName, email, age, city, country };

    let element = null;

    switch (step) {
      case 1:
        element = (
          <IdentityPicker nextStep={this.nextStep.bind(this)} setStep={this.setStep.bind(this)} handleChange={this.handleChange.bind(this)} values={values} />
        );
        break;
      case 2:
        element = (
          <SeedEntryForm nextStep={this.nextStep.bind(this)} setStep={this.setStep.bind(this)} handleChange={this.handleChange.bind(this)} values={values} />
        );
        break;
      case 3:
        element = (
          <IdentityPicker nextStep={this.nextStep.bind(this)} setStep={this.setStep.bind(this)} handleChange={this.handleChange.bind(this)} values={values} />
        );
        break;
      case 4:
        element = (
          <IdentityPicker nextStep={this.nextStep.bind(this)} setStep={this.setStep.bind(this)} handleChange={this.handleChange.bind(this)} values={values} />
        );
        break;
    }

    return (
      <>
        <Card fluid>
          <Card.Content attached='top'>
            <Form>
              <Form.Group inline widths='equal'>
                <Form.Field>
                  <Form.Input disabled value={this.state.hash} />
                </Form.Field>
                <Form.Field>
                  <Button.Group floated='right'>
                    <Button><Icon name='history' /></Button>
                    <Button><Icon name='refresh' /></Button>
                  </Button.Group>
                  {/*
                  <Button.Group>
                    <Button><Icon name='info' /></Button>
                    <Button><Icon name='star' /></Button>
                  </Button.Group>
                  */}
                </Form.Field>
              </Form.Group>
            </Form>
          </Card.Content>
          <Card.Content hidden={(!this.isVisible())}>
            <Card.Header>Identity Manager</Card.Header>
            <Card.Meta>
              <div><strong>Status:</strong> <pre>{this.state.status}</pre></div>
              <div><strong>State:</strong> <pre>{JSON.stringify(this.state, null, '  ')}</pre></div>
            </Card.Meta>
            <Card.Description>Get started by restoring from an existing seed phrase or generating a new one.</Card.Description>
          </Card.Content>
          <Card.Content extra attached='bottom'>{element}</Card.Content>
        </Card>
      </>
    );
  }

  isVisible () {
    if (this.state.explain) return true;
    return false;
  }
}

export default FabricIdentityManager;
