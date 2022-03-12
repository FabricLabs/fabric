// State
import * as defaults from '../settings/state';

// Dependencies
import merge from 'lodash.merge';
import FabricComponent from '../types/component';

// Components
import {
  Button,
  Card,
  Feed,
  Icon,
  Label
} from 'semantic-ui-react';

// Fabric Types
// import * as Store from '@fabric/core/types/store';
// import * as Worker from '@fabric/core/types/worker';
import * as Remote from '@fabric/http/types/remote';

class FabricBridge extends FabricComponent {
  constructor (props) {
    super(props);

    this.settings = Object.assign({
      host: 'localhost',
      port: 9999,
      secure: false
    }, defaults, props);

    this.state = merge({
      integrity: 'sha256-deadbeefbabe',
      status: 'disconnected',
      messages: [],
      meta: {
        messages: {
          count: 0
        }
      }
    }, this.settings);

    console.log('bridge settings:', this.settings);

    this.remote = new Remote({
      host: this.settings.host,
      port: this.settings.port,
      secure: this.settings.secure
    });

    /* this.agent = new Worker({
      service: main,
      settings: settings
    }); */

    return this;
  }

  _handleRemoteMessage (message) {
    console.log('Remote message:', message);
    this._syncState();
  }

  _handleRemoteError (error) {
    console.log('Remote error:', error);
  }

  _syncState () {
    this.setState({
      status: this.remote._state.status,
      messages: this.remote._state.messages,
      meta: this.remote._state.meta
    });
  }

  componentDidMount () {
    console.log('bridge mounted! starting...');
    // this.agent.executeMethod('connect');
    // this.process.executeMethod('connect');
    this.start();
  }

  connect () {
    this._syncState();
    this.remote.connect();
    this._syncState();
  }

  executeMethod (name, params) {
    return this.remote.executeMethod(name, params);
  }

  ping () {
    this.remote.ping();
  }

  render () {
    return (
      <>
        <Card fluid>
          <Card.Content>
            <Button.Group floated='right'>
              <Button onClick={this.ping.bind(this)}>Ping <Icon name='info' /></Button>
              <Button onClick={this.connect.bind(this)}>Connect <Icon name='lightning' /></Button>
            </Button.Group>
            <Card.Header as='h3'>Bridge</Card.Header>
          </Card.Content>
          <Card.Content>
            <Feed>
              {this.state.messages.map((message, i) => {
                return (
                  <Feed.Event size='small' key={i} style={{ fontSize: '0.8em', fontFamily: 'monospace' }}>
                    <Feed.Content>
                      <div style={{color: 'black'}}>{JSON.stringify(message, null, '  ')}</div>
                    </Feed.Content>
                  </Feed.Event>
                );
              })}
            </Feed>
          </Card.Content>
          <Card.Content extra>
            <Label><Icon name='info' /> {this.remote._state.status}</Label>
            <Label><Icon name='mail' /> {this.remote._state.meta.messages.count}</Label>
          </Card.Content>
        </Card>
      </>
    );
  }

  async send (message) {
    return this.remote.send(message);
  }

  async start () {
    this.remote.on('ready', this.props.remoteReady.bind(this));
    this.remote.on('message', this._handleRemoteMessage.bind(this));
    this.remote.on('error', this._handleRemoteError.bind(this));
    this.connect();
  }
}

export default FabricBridge;
