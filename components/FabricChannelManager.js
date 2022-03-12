import merge from 'lodash.merge';
import FabricComponent from '../types/component';

// Components
import {
  Button,
  Card,
  // Container,
  Header,
  Icon,
  // Grid,
  // Label,
  // Menu,
  // Segment,
  Table
} from 'semantic-ui-react';

class ChannelManager extends FabricComponent {
  constructor (props) {
    super(props);

    this.state = merge({
      channels: [],
      integrity: 'sha256-deadbeefbabe'
    }, props);

    return this;
  }

  render () {
    return (
      <>
        <div className='ui vertical stripe segment'>
          <div className='ui middle aligned stackable grid container'>
            <div className='row'>
              <div className='column'>
                <Card fluid>
                  <Card.Content attached='top'>
                    <Button.Group floated='right'>
                      <Button><Icon name='history' /></Button>
                      <Button><Icon name='refresh' /></Button>
                    </Button.Group>
                    <Button.Group>
                      <Button><Icon name='info' /></Button>
                      <Button><Icon name='star' /></Button>
                    </Button.Group>
                  </Card.Content>
                  <Card.Content>
                    <Header>
                      <Button.Group floated='right' icon>
                        <Button icon labelPosition='right' color='green'> Connect <Icon name='add' /></Button>
                      </Button.Group>
                      <h1><Icon name='road' /> Channels</h1>
                    </Header>
                    <p>Channels are funded contracts between yourself and your peers.</p>
                    <Table celled>
                      <Table.Header>
                        <Table.Row>
                          <Table.HeaderCell>Status</Table.HeaderCell>
                          <Table.HeaderCell>Peer</Table.HeaderCell>
                          <Table.HeaderCell>Outbound Potential</Table.HeaderCell>
                          <Table.HeaderCell>Inbound Potential</Table.HeaderCell>
                        </Table.Row>
                      </Table.Header>
                      <Table.Body>
                        {this.state.channels.map((x, i) => {
                          return (
                            <Table.Row key={i}>
                              <Table.Cell>{x.status}</Table.Cell>
                              <Table.Cell>{x.peer}</Table.Cell>
                              <Table.Cell>{x.balances.outbound}</Table.Cell>
                              <Table.Cell>{x.balances.inbound}</Table.Cell>
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
                  </Card.Content>
                  <Card.Content extra>
                    <Button.Group floated='right'>
                      <Button icon labelPosition='left'>
                        <a href={this.link}>{this.link}</a>
                        <Icon name='linkify' />
                      </Button>
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

export default ChannelManager;
