import * as defaults from '../settings/state';

import merge from 'lodash.merge';
import FabricComponent from '../types/component';

// import { connect } from 'react-redux';

// Components
import {
  Button,
  Card,
  // Card,
  // Container,
  Header,
  Icon,
  // Grid,
  // Label,
  // Menu,
  // Segment,
  Table
} from 'semantic-ui-react';

/* function mapStateToProps (state) {
  return merge({}, state);
} */

class PeerList extends FabricComponent {
  constructor (props) {
    super(props);
    this.state = merge({
      integrity: 'sha256-deadbeefbabe',
      peers: []
    }, defaults, props);
  }

  _addKey (key) {
    // TODO: merge proper
    // this.setState({ keys: this.state.keys.concat(key) });
  }

  _addPeer () {
    this.props.dispatch({ type: 'PEER_ADD' });
  }

  render () {
    return (
      <>
        <div className='ui vertical stripe segment'>
          <div className='ui stackable grid container'>
            <div className='row'>
              <div className='column'>
                <Card fluid>
                  <Card.Content>
                    <Header><h1><Icon name='users' /> Peers</h1></Header>
                    <Table celled>
                      <Table.Header>
                        <Table.Row>
                          <Table.HeaderCell>ID</Table.HeaderCell>
                          <Table.HeaderCell>Alias</Table.HeaderCell>
                          <Table.HeaderCell>Host</Table.HeaderCell>
                          <Table.HeaderCell>Port</Table.HeaderCell>
                          <Table.HeaderCell>Controls</Table.HeaderCell>
                        </Table.Row>
                      </Table.Header>
                      <Table.Body>
                        {this.state.peers.map((peer, index) => {
                          return (
                            <Table.Row key={index}>
                              <Table.Cell>{peer.id}</Table.Cell>
                              <Table.Cell>{peer.alias}</Table.Cell>
                              <Table.Cell>{peer.host}</Table.Cell>
                              <Table.Cell>{peer.port}</Table.Cell>
                              <Table.Cell>
                                <Button.Group fluid>
                                  <Button icon labelPosition='right'>reconnect <Icon name='refresh' /></Button>
                                  <Button icon labelPosition='right' disabled>disconnect <Icon name='remove' /></Button>
                                </Button.Group>
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
                    <Button.Group floated='right' icon>
                        <Button icon labelPosition='right' color='green'>Connect <Icon name='add' /></Button>
                      </Button.Group>
                  </Card.Content>
                </Card>
              </div>
            </div>
          </div>
        </div>
      </>
    );
  }
}

export default PeerList;
// export default connect(mapStateToProps)(PeerList);
