import * as defaults from '../settings/state';

import merge from 'lodash.merge';
import FabricComponent from '../types/component';

// Components
import {
  Button,
  // Button,
  // Card,
  // Container,
  Dropdown,
  Form,
  Icon,
  Input,
  // Grid,
  Label,
  // Menu,
  Segment,
  Table
} from 'semantic-ui-react';

class NodeList extends FabricComponent {
  constructor (props) {
    super(props);

    this.state = merge({
      nodes: [],
      nodes: ['localhost'],
      integrity: 'sha256-deadbeefbabe'
    }, defaults, props);

    return this;
  }

  get nodes () {
    // TODO: create real Node objects (@fabric/core/type/node)
    return this.state.nodes.map((x, i) => {
      return {
        id: null,
        address: x,
        label: x,
        status: 'disconnected'
      };
    });
  }

  handleNodeAddition (e) {
    console.log('node added:', e.target.value);
  }

  handleNodeReload (e) {
    // TODO: implement a getPropertyFromEventTarget() method on `types/component`
    console.log('node to reload:', e.target.attributes[0].value);
  }

  render () {
    return (
      <>
        <div inverted>
          <Table celled inverted>
            <Table.Header>
              <Table.Row>
                <Table.HeaderCell>Status</Table.HeaderCell>
                <Table.HeaderCell>Name (local)</Table.HeaderCell>
                <Table.HeaderCell>ID</Table.HeaderCell>
                <Table.HeaderCell>Address</Table.HeaderCell>
                <Table.HeaderCell>Controls</Table.HeaderCell>
              </Table.Row>
            </Table.Header>
            <Table.Body>
              {this.nodes.map((x, i) => {
                return (
                  <Table.Row key={i}>
                    <Table.Cell><Label>{x.status}</Label></Table.Cell>
                    <Table.Cell>{x.name}</Table.Cell>
                    <Table.Cell>{x.id}</Table.Cell>
                    <Table.Cell>{x.address}</Table.Cell>
                    <Table.Cell>
                      <Button.Group fluid>
                        <Button icon='refresh' onClick={this.handleNodeReload.bind(this)} node={x} />
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
        </div>
      </>
    );
  }
}

export default NodeList;
