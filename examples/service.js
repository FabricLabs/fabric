//importScripts('/app.min.js');

var url = require('url');
var Stash = require('../types/stash');

self.addEventListener('message', function (e) {
  e.source.postMessage('[GUARDIAN]', 'Hello! Your message was: ' + e.data);
});

self.addEventListener('fetch', async function (event) {
  var self = this;
  
  return true;
  console.log('[GUARDIAN]', 'request:', event);

  var path = event.request.url;
  var target = url.parse(path);
  var uri = target.pathname;

  var stash = new Stash();
  console.log('stash:', stash);
  console.log('target:', target);

  //await stash.set('/messages', [{ foo: 'bar' }]);
  console.log('recovery:', await stash.get('/messages'));

  var value = await stash.get(uri);
  if (value) {
    console.log('was cached:', uri, value.length, 'bytes');
    var request = new Request(uri, {
      // TODO: revert to OPTIONS (this was a temporary fix for an NGINX bug)
      method: 'HEAD'
    });

    var response = await fetch(request);
    //var content = await response.text();
    return value;
  } else {
    var request = new Request(uri, {
      headers: {
        'X-Identity': 'foo'
      }
    });

    var response = await fetch(request);
    var content = await response.text();
    console.log('response:', uri, content.length);

    if (content) {
      stash.set(uri, content);
    }

    return request;
  }
});
