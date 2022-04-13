global.LOCAL_SERVER_CONFIG = {
  host: 'localhost',
  port: 9999,
  secure: false
};

const http = require('http');

class Server {
  constructor () {
    this.server = http.createServer((req, res) => {
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ status: 200 }));
    });
  }

  async start () {
    return this.server.listen(LOCAL_SERVER_CONFIG.port);
  }

  async stop () {
    return this.server.close();
  }
}

module.exports = { Server };
