'use strict';

// Components
import {
  Button,
  // Container,
  Dropdown,
  Form,
  // Grid,
  Header,
  Icon,
  Image,
  Input,
  // Menu,
  Modal,
  // Segment
} from 'semantic-ui-react';

// Fabric Types
import FabricComponent from '../types/component';

class FabricModal extends FabricComponent {
  constructor (settings = {}) {
    super(settings);

    this.state = {
      open: false
    };

    return this;
  }

  render () {
    function setOpen (open) {

    }

    return (
      <Modal
        ref={this.props.modal}
        onClose={() => setOpen(false)}
        onOpen={() => setOpen(true)}
        open={this.state.open}>
        <Modal.Header>Select a Photo</Modal.Header>
        <Modal.Content image>
          <Image size='medium' src='/images/avatar/large/rachel.png' wrapped />
          <Modal.Description>
            <Header>Default Profile Image</Header>
            <p>
              We've found the following gravatar image associated with your e-mail
              address.
            </p>
            <p>Is it okay to use this photo?</p>
          </Modal.Description>
        </Modal.Content>
        <Modal.Actions>
          <Button color='black' onClick={() => setOpen(false)}>
            Nope
          </Button>
          <Button
            content="Yep, that's me"
            labelPosition='right'
            icon='checkmark'
            onClick={() => setOpen(false)}
            positive
          />
        </Modal.Actions>
      </Modal>
    )
  }
}

export default FabricModal;
