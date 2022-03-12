import * as EC from '../../node_modules/elliptic/lib/elliptic/ec';
import {
  Button,
  Card,
  Form,
  Header,
  Icon,
  Input,
  Label,
  Segment,
  Table
} from 'semantic-ui-react';

import * as Actor from '@fabric/core/types/actor';
import FabricComponent from '../types/component';
import FabricKeyForm from './FabricKeyForm';

class KeyManager extends FabricComponent {
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

  render () {
    const { values } = this.props;

    return (
      <>
        <Card fluid>
          <Card.Content>
            <h3><Icon name='key' /> Keys</h3>
            <Table celled>
              <Table.Header>
                <Table.Row>
                  <Table.HeaderCell>ID</Table.HeaderCell>
                  <Table.HeaderCell>Label</Table.HeaderCell>
                  <Table.HeaderCell>Private</Table.HeaderCell>
                  <Table.HeaderCell>Public</Table.HeaderCell>
                  {/*
                  <Table.HeaderCell>xprv</Table.HeaderCell>
                  <Table.HeaderCell>xpub</Table.HeaderCell>
                  */}
                  <Table.HeaderCell>Announcements</Table.HeaderCell>
                </Table.Row>
              </Table.Header>
              <Table.Body>
                {this.state.keys.map((key, index) => {
                  return (
                    <Table.Row key={index}>
                      <Table.Cell>
                        <Input disabled value={key.id} />
                      </Table.Cell>
                      <Table.Cell>
                        <Input disabled value={key.label} />
                      </Table.Cell>
                      <Table.Cell>
                        <Input disabled value={key.private} />
                      </Table.Cell>
                      <Table.Cell>
                        <Input disabled value={key.public} />
                      </Table.Cell>
                      {/*
                      <Table.Cell>
                        <Input disabled value={key.xprv} />
                      </Table.Cell>
                      <Table.Cell>
                        <Input disabled value={key.xpub} />
                      </Table.Cell>
                      */}
                      <Table.Cell>
                        <Label>{key.announcements || 0}</Label>
                      </Table.Cell>
                    </Table.Row>
                  );
                })}
              </Table.Body>
              {/* <Table.Footer>
                <Table.Row>
                  <Table.HeaderCell colSpan='3'>
                    <Menu floated='right' pagination>
                      <Menu.Item as='a' icon>
                        <Icon name='chevron left' />
                      </Menu.Item>
                      <Menu.Item as='a'>1</Menu.Item>
                      <Menu.Item as='a'>2</Menu.Item>
                      <Menu.Item as='a'>3</Menu.Item>
                      <Menu.Item as='a'>4</Menu.Item>
                      <Menu.Item as='a' icon>
                        <Icon name='chevron right' />
                      </Menu.Item>
                    </Menu>
                  </Table.HeaderCell>
                </Table.Row>
              </Table.Footer> */}
            </Table>
            <FabricKeyForm handleSubmit={this._handleKeyFormSubmit.bind(this)} _generateNewKey={this._generateNewKey.bind(this)} />
          </Card.Content>
        </Card>
      </>
    );
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
}

export default KeyManager;
