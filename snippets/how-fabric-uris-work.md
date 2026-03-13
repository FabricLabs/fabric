# How Fabric URIs Work
## Overview
### Documents
The term "documents" covers the general class of information which may be stored in the Fabric Network.  In its simplest form, a document is any bit of digital data, but in practice a human-readable form is always made manifest.  For example, a printed letter to your mother on 8.5" by 11" paper can be considered a "document" but certainly we can conclude that the rasterized version of its digital source is the true document — after all, the physical version could not be produced without the source material.

### Resources
#### The Client-Server Model
```
(client) CONNECT $host ---------------------> (server) # Establish Connection
(client) GET / -----------------------------> (server) # Document Request
(client) <-------------------- SEND $response (server) # Document Response
```

#### Hierarchies
/ - root resource

attributes
/questions - collection
/questions/1 - element in collection

```json
{
  "questions": [
    { "content": "Who are you?" },
    { "content": "Are you a robot?" }
  ],
  "answers": []
}
```

## Networking
### Protocols
#### Basic Definitions
#### Human Protocols
#### Machine Protocols

### The Internet
#### Uniform Resource Identifiers (URIs)

#### The World Wide Web (WWW)
##### Uniform Resource Locators (URLs)
The Uniform Resource Locator is a subset of the URI.

#### Fabric
**Principles:**
- each document is retrievable by its SHA256 hash
- documents may contain pointers to other documents
- peers can sell their documents for Bitcoin

##### Format
`fabric:(SHA256(document))`
