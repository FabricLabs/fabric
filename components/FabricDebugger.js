// State
import * as defaults from '../settings/state';

// Dependencies
import merge from 'lodash.merge';
import FabricComponent from '../types/component';

// Components
import {
  Accordion,
  Icon
} from 'semantic-ui-react';

import FabricNodeList from './FabricNodeList';

class FabricDebugger extends FabricComponent {
  constructor (props) {
    super(props);

    this.state = merge({
      nodes: [],
      nodes: ['localhost'],
      integrity: 'sha256-deadbeefbabe',
      activeIndex: -1
    }, defaults, props);

    return this;
  }

  _handleAccordionClick = (e, titleProps) => {
    const { index } = titleProps
    const { activeIndex } = this.state
    const newIndex = activeIndex === index ? -1 : index
    this.setState({ activeIndex: newIndex })
  }

  render () {
    const { activeIndex } = this.state;

    return (
      <>
        <div>
          <h2><Icon name='bug' /> debug</h2>
          <Accordion inverted>
            <Accordion.Title as='h3' active={activeIndex === 0} index={0} onClick={this._handleAccordionClick}><Icon name='database' /> Nodes</Accordion.Title>
            <Accordion.Content active={activeIndex === 0}>
              <FabricNodeList />
            </Accordion.Content>
            <Accordion.Title as='h3' active={activeIndex === 1} index={1} onClick={this._handleAccordionClick}><Icon name='code' /> State</Accordion.Title>
            <Accordion.Content active={activeIndex === 1}>
              <code><pre>{JSON.stringify(this.state, null, '  ')}</pre></code>
            </Accordion.Content>
          </Accordion>
        </div>
      </>
    );
  }
}

export default FabricDebugger;
