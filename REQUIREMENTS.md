# Requirements for Fabric Nodes
The following requirements are necessary to run a Fabric node:

1. bitcoind >= 0.21.1
2. > 1 GHz CPU
3. > 1 GB RAM
4. > 1 TB storage
5. > 500 MB/day bandwidth

Some configuration options can reduce these requirements, but they should be considered the minimum specification for a full Fabric node.

## Bandwidth
1MB/s is considered minimal for Fabric connections.  When possible, Fabric will attempt to use a constant stream of 1MB/s of over-the-wire bandwith (after compression and encryption).  High-latency connections (those with a connection exceeding 250ms ping) should expect some operations to take longer than an hour.
