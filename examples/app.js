'use strict';

const App = require('../lib/app');

const Person = require('../resources/person');
const Post = require('../resources/post');
const Relationship = require('../resources/relationship');

window.app = new App({
  scripts: ['app.min.js'],
  resources: {
    'Person': Person,
    'Post': Post,
    'Relationship': Relationship,
  }
});

app._load();

if ('serviceWorker' in navigator) {
  window.addEventListener('load', function() {
    navigator.serviceWorker.register('/service.min.js').then(function(registration) {
      console.log('[GUARDIAN]', 'ready: ', registration.scope);
    }, function(err) {
      console.log('[GUARDIAN]', 'failed: ', err);
    });
  });
}

window.onload = function () {
  document.querySelector('body').appendChild(window.app.element());
}
