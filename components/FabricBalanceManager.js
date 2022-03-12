import * as defaults from '../settings/state';

import merge from 'lodash.merge';
import FabricComponent from '../types/component';

// import * as Bitcoin from '@fabric/core/services/bitcoin';

// Components
import {
  Button,
  Card,
  // Card,
  // Container,
  Header,
  Icon,
  // Grid,
  Label,
  // Menu,
  // Segment,
  Table
} from 'semantic-ui-react';
import FabricIdentityManager from './FabricIdentityManager';

class BalanceManager extends FabricComponent {
  constructor (props) {
    super(props);

    this.state = merge({
      balances: [],
      integrity: 'sha256-deadbeefbabe'
    }, defaults, props);

    // this.bitcoin = new Bitcoin();

    return this;
  }

  componentDidMount () {
    super.componentDidMount();
    console.log('mounted');
  }

  render () {
    return (
      <>
        <div className='ui vertical stripe segment'>
          <div className='ui middle aligned stackable grid container'>
            <div className='row'>
              <div className='column'>
                <Card fluid>
                  <Card.Content>
                    <Header>
                      <h1><Icon name='bitcoin' /> Balances</h1>
                    </Header>
                    <FabricIdentityManager />
                    <Table celled>
                      <Table.Header>
                        <Table.Row>
                          <Table.HeaderCell>Symbol</Table.HeaderCell>
                          <Table.HeaderCell>Asset</Table.HeaderCell>
                          <Table.HeaderCell>Type</Table.HeaderCell>
                          <Table.HeaderCell>Balance</Table.HeaderCell>
                        </Table.Row>
                      </Table.Header>
                      <Table.Body>
                        {this.state.balances.map((x, i) => {
                          return (
                            <Table.Row key={i}>
                              <Table.Cell>{x.symbol}</Table.Cell>
                              <Table.Cell>{x.asset}</Table.Cell>
                              <Table.Cell><Label>{x.type}</Label></Table.Cell>
                              <Table.Cell>{x.confirmed}</Table.Cell>
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

export default BalanceManager;
