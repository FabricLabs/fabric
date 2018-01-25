'use strict';

const Vector = require('./vector');

class Message extends Vector {
  /**
   * The `Message` type is standardized in {@link class:Fabric} as a {@link function:Vector}, which can be added to any other vector to computer a resulting state.
   * @param  {Mixed} message Message data, arbitrary type.  Will be serialized by {@link function:serialize}.
   * @return {Vector} Instance of the message.
   */
  constructor (message) {
    super(message);
    self.validate(message);
  }

  validate () {
    
  }
}

export default Message;
