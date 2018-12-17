'use strict';

import Fabric from '../';

var jade2cli = require('../lib/jade2ui.js');

const DEFAULT_PEER_LIST = require('../data/peers');

var self = {
    actor : null,
    commandHistory: new Set(),
    clock: 0,
    stack: [],
    known: {},
    log: console.log,
    inform: console.log,
    name: "CLI"
};


// TODO: use deep assign
self.config = Object.assign({
    ui: './assets/cli.jade',
    oracle: true,
    swarm: {
        peer: {
            port: process.env['PEER_PORT'] || 7777
        },
        peers: DEFAULT_PEER_LIST
    }
}, {});

if (self.config.oracle) {
    self.oracle = new Fabric.HTTP(Object.assign({
        name: 'fabric',
        port: 3007
    }, self.config.oracle));

    // this.oracle.on('changes', this._handleChanges.bind(this));
    self.oracle.on('info', self.inform.bind(self));

    // TODO: move to lib/chat.js
    self.oracle.define('Message', {
        routes: {
            list: '/messages',
            get: '/messages/:id'
        }
    });

    self.oracle.define('Peer', {
        routes: {
            list: '/peers',
            get: '/peers/:id'
        }
    });
}


var event_handlers = {
    on_form_submit: async function (data) {
        if (!data) return self.log('No data.');

        let now = new Date();

        self.commandHistory.add(data.input);

        if (data && data.input && data.input.charAt(0) === '/') {
            let parts = data.input.trim().split(' ');
            switch (parts[0].substring(1)) {
                default:
                    self.log('Unknown command:', parts[0]);
                    break;
                case 'help':
                    self.log('Available commands:',
                        '/help',
                        '/test',
                        '/keys',
                        '/peers',
                        '/ping',
                        '/state',
                        '/history',
                        '/clear',
                        '/wipe'
                    );
                    break;
                case 'test':
                    self.log('test!');
                    break;
                case 'keys':
                    self.log('keys:', self.oracle.keys);
                    break;
                case 'peers':
                    self.log('peers:', self.swarm.peers);
                    break;
                case 'ping':
                    self.log('pinging peers...');
                    // select a random number, broadcast with ping
                    self.swarm._broadcastTypedMessage(0x12, Math.random());
                    break;
                case 'state':
                    self.log('state (self):', self.state);
                    self.log('state (oracle):', self.oracle.state);
                    self.log('state (machine):', self.oracle.machine.state);
                    break;
                case 'history':
                    self.log('history:', self.commandHistory);
                    break;
                case 'clear':
                    self.logs.clearItems();
                    self.log('Cleared logs.');
                    break;
                case 'wipe':
                    await self.oracle.flush();
                    self.log('shutting down in 5s...');
                    setTimeout(function () {
                        process.exit();
                    }, 5000);
            }
        } else {
            if (!data.input) {
                return self.log(`Message is required.`);
            }
            // TODO: visual indicator of "sending..." status
            let result = await self.oracle._POST('/messages', {
                created: now.toISOString(),
                input: data.input
            });

            if (!result) {
                return self.log('Could not post message.');
            }
        }

        self.form.reset();
        self.screen.render();
    },
    on_submit_press: function () {
        self.form.submit();
    },
    on_textbox_key_up: function (ch, key) {
        self.log('up press:', self.commandHistory[0], ch, key);
        self.textbox.setValue(self.commandHistory[self.commandHistory.size - 1]);
    },
    on_textbox_key_enter: function (ch, key) {
        self.form.submit();
        self.textbox.clearValue();
        self.textbox.readInput();
    },
    on_screen_key_esc:  function (ch, key) {
        self.screen.destroy();
        // console.log('the machine:', self.oracle.machine);
        // console.log('the mempool:', self.oracle.mempool);
        process.exit();
    },
}

jade2cli.renderJadeFile('./assets/cli2.jade', self, event_handlers);

console.log(Object.keys(self))