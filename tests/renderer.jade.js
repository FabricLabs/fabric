'use strict';

const assert = require('assert');
const path = require('path');

const Renderer = require('../types/renderer');

describe('Renderer jade reference', function () {
  it('maps cli.jade regions onto blessed widgets', function () {
    const renderer = new Renderer();
    const widgets = renderer._describeTemplate(path.join(__dirname, '../assets/cli.jade'));
    const byId = {};
    for (const widget of widgets) if (widget.id) byId[widget.id] = widget;

    assert.strictEqual(byId.history.widget, 'box');
    assert.strictEqual(byId.peers.widget, 'list');
    assert.strictEqual(byId.logs.widget, 'list');
    assert.strictEqual(byId.controls.widget, 'box');
    assert.ok(widgets.some((widget) => widget.widget === 'textbox'));
    assert.ok(widgets.some((widget) => widget.widget === 'button'));
    assert.ok(widgets.some((widget) => widget.widget === 'form'));
  });

  it('skips script tags', function () {
    const renderer = new Renderer();
    const widgets = renderer._describeSource('screen\n  script.\n    console.log(1)\n  box#history\n', 'mem.jade');
    assert.ok(!widgets.some((widget) => widget.tag === 'script'));
    assert.ok(widgets.some((widget) => widget.id === 'history'));
  });
});
