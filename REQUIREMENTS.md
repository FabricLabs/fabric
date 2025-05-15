# Requirements for Fabric Nodes
The following requirements are necessary to run a Fabric node:

1. bitcoind >= 0.21.1
2. 166 MHz x86 CPU
3. 256 MB RAM

## Bandwidth
1MB/s is considered minimal for Fabric connections.  When possible, Fabric will attempt to use a constant stream of 1MB/s of over-the-wire bandwith (after compression and encryption).  High-latency connections (those with a connection exceeding 250ms ping) should expect some operations to take longer than an hour.
