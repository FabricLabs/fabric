# Actors
The `Actor` class is the parent class of most `@fabric/core` components; you
can use it for any Fabric-enabled application.

## Role
The `Actor` is the basis for most, if not all, native types in the Fabric Compute Space.  It is an `EventEmitter` and will typically emit the following events:

1. `message`
2. `debug`
3. `log`
4. `warning`
5. `error`

Some Actor types (such as `Service`) also provide `beat`, `tick`, or `state` events.

## Behavior
The `Actor` is a standard ECMAScript object with the following properties:
```
id: String
state: Object
```

## Example
Interacting with a Fabric Actor:
```js
// Use `npm i @fabric/core` first
const Actor = require('@fabric/core/types/actor');
const actor = new Actor({ foo: 'bar' });

// Listen for events
actor.on('message', (message) => {
  console.log('Message from Actor:', message);
});

// Adopt a set of changes
actor.adopt([
  { op: 'replace', path: '/baz', value: 'plop' }
]);

console.log('My Actor:', JSON.stringify(actor, null, '  '));
```

Output:

```
My Actor: {
  "foo": "bar",
  "baz": "bop"
}
```
