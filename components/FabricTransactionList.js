import FabricComponent from '../types/component';

// Components
import {
  Button,
  // Card,
  // Container,
  Icon,
  // Grid,
  Header,
  // Label,
  // Menu,
  // Segment,
  Table,
  Card
} from 'semantic-ui-react';

class TransactionList extends FabricComponent {
  constructor (props) {
    super(props);
    this.state = {
      transactions: [],
      integrity: 'sha256-deadbeefbabe'
    };
  }

  _addKey (key) {
    // TODO: merge proper
    this.setState({ keys: this.state.keys.concat(key) });
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
                    <Header><h1><Icon name='tasks' /> Transactions</h1></Header>
                    <Table celled>
                      <Table.Header>
                        <Table.Row>
                          <Table.HeaderCell>ID</Table.HeaderCell>
                          <Table.HeaderCell>Version</Table.HeaderCell>
                          <Table.HeaderCell>Inputs</Table.HeaderCell>
                          <Table.HeaderCell>Outputs</Table.HeaderCell>
                          <Table.HeaderCell>Signature</Table.HeaderCell>
                        </Table.Row>
                      </Table.Header>
                      <Table.Body>
                        {this.state.transactions.map((transaction, index) => {
                          return (
                            <Table.Row key={index}>
                              <Table.Cell>{transaction.id}</Table.Cell>
                              <Table.Cell>{transaction.version}</Table.Cell>
                              <Table.Cell>{transaction.inputs}</Table.Cell>
                              <Table.Cell>{transaction.outputs}</Table.Cell>
                              <Table.Cell>{transaction.signature}</Table.Cell>
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
                </Card>
              </div>
            </div>
          </div>
        </div>
      </>
    );
  }
}

export default TransactionList;
