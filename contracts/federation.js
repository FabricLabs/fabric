import * as Block from '../types/block';

export default function OP_ADVANCE_BLOCK (input) {
  console.log('advancing block:', this.state);

  const parent = this.state.chain[this.state.chain.length - 1];
  console.log('parent:', parent);

  const block = new Block({
    parent: this.state.chain[this.state.chain.length - 1],
    transactions: input
  });

  for (let i = 0; i < this.state.validators; i++) {
    const validator = this.state.validators[i];
    console.log('processing for validator:', validator);
    // TODO: get signatures
  }

  this.state.blocks[block.id] = block;
  this.state.chain.push(block.id);

  this.commit();

  return this.state;
}
