'use strict';

const tcp = require('tcp');
const mqtt = require('mqtt');

const Service = require('../types/service');
const merge = require('lodash.merge');

class MQTT extends Service {
  constructor (settings = {}) {
    super(settings);

    this.settings = merge({
      host: 'localhost',
      port: 1883,
      subscriptions: [],
      state: {
        status: 'STOPPED'
      }
    }, settings);

    this._state = {
      status: 'STOPPED',
      state: this.settings.state
    };

    return this;
  }

  async start () {
    this.status = 'STARTING';
    this.emit('debug', `[FABRIC:MQTT] Starting MQTT service on ${this.settings.host}:${this.settings.port}...`);

    this.client = tcp.connect(this.settings);
  }

  async stop () {
    this.status = 'STOPPING';
    this.emit('debug', `[FABRIC:MQTT] Stopping MQTT service on ${this.settings.host}:${this.settings.port}...`);

    this.client.end();
  }

  async subscribe (topic) {
    this.client.subscribe(topic);
  }

  async unsubscribe (topic) {
    this.client.unsubscribe(topic);
  }
}

module.exports = MQTT;
