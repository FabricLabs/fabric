function Definition () {
  this.name = 'Person';
}

Definition.prototype.attributes = {
  username: { type: String }
}

Definition.prototype.components = {
  query: 'maki-person-list',
  get: 'maki-person-view'
}

module.exports = Definition;
