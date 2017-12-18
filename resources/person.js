'use strict';

function Person () {

}

Person.prototype.name = 'Person';

Person.prototype.attributes = {
  username: { type: String }
};

Person.prototype.components = {
  query: 'maki-person-list',
  get: 'maki-person-view'
};

Person.prototype.routes = {
  query: '/people',
  get: '/people/:id'
};

module.exports = Person;
