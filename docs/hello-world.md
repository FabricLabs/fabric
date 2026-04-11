# Hello World with Fabric
Fabric offers a familiar API for most web developers:

```js
import App from 'fabric';
const app = new App();

app.start();
```

That's it.  That's all there is to it.  By running the above code, you should
now have a running application on your desktop.

Of course, we'll want to add more functionality.  To do that, let's add some
[Resources][resources].

## Adding Resources
Fabric uses a simple JSON format to configure resources that it makes accessible
to your application.

To add one, simply use `app.define(name, definition)`, where `name` is the
human-friendly name for the resource, and `definition` is the JSON-encoded
representation.

```js
await app.define('Person', {
  attributes: {
    username: String
  }
});
```

Note the use of the `await` keyword here, as it indicates we want to wait for a
response.  For documentation, check [the `Resource` API definition][resources].

Just as before, start your application and you'll now see something like this:

![Fabric Application with One Resource](...)

## Configuration
By default, Fabric Applications expose one Resource, the `Asset` class.  Each
additional Resource added is served through the Fabric interface, operating
under the rules of its original definition.

[resources]: https://api.fabric.fm/Resource.html
