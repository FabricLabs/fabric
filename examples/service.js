//importScripts('/app.min.js');

const url = require('url');

/** Minimal URI → response cache (replaces legacy Stash type). */
const stash = new Map();

if (typeof self === 'undefined' || typeof self.addEventListener !== 'function') {
  console.log('[EXAMPLES:SERVICE]', 'This example targets a Service Worker context (run in browser).');
  process.exit(0);
}

self.addEventListener('message', function (e) {
  e.source.postMessage('[GUARDIAN]', 'Hello! Your message was: ' + e.data);
});

self.addEventListener('fetch', async function (event) {
  console.log('[GUARDIAN]', 'request:', event);

  const path = event.request.url;
  const target = url.parse(path);
  const uri = target.pathname;

  console.log('stash:', stash);
  console.log('target:', target);

  //await stash.set('/messages', [{ foo: 'bar' }]);
  console.log('recovery:', stash.get('/messages'));

  const value = stash.get(uri);
  if (value) {
    console.log('was cached:', uri, value.length, 'bytes');
    const request = new Request(uri, {
      // TODO: revert to OPTIONS (this was a temporary fix for an NGINX bug)
      method: 'HEAD'
    });

    const response = await fetch(request);
    //const content = await response.text();
    return value;
  } else {
    const request = new Request(uri, {
      headers: {
        'X-Identity': 'foo'
      }
    });

    const response = await fetch(request);
    const content = await response.text();
    console.log('response:', uri, content.length);

    if (content) {
      stash.set(uri, content);
    }

    return request;
  }
});
