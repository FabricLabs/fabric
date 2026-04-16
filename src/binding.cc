#include <napi.h>
#include <secp256k1.h>
#include <noise/protocol.h>
extern "C"
{
#include "peer.h"
#include "message.h"
#include "errors.h"
#include "taproot.h"
#include "segwit_addr.h"
#include "sha2.h"
}

// Initialize the Fabric addon
Napi::Object Init(Napi::Env env, Napi::Object exports)
{
  // Message methods
  exports.Set("createMessage", Napi::Function::New(env, [](const Napi::CallbackInfo &info) -> Napi::Value
                                                   {
    Napi::Env env = info.Env();

    Message* msg = message_create();
    if (!msg) {
      Napi::Error::New(env, "Failed to create message").ThrowAsJavaScriptException();
      return env.Undefined();
    }

    // Return a simple object with the message pointer and all properties
    Napi::Object result = Napi::Object::New(env);
    result.Set("_ptr", Napi::External<Message>::New(env, msg));
    result.Set("magic", Napi::Number::New(env, msg->magic));

    // Format version as padded hex string for consistency with JS
    char version_hex[9];
    snprintf(version_hex, sizeof(version_hex), "%08x", msg->version);
    result.Set("version", Napi::String::New(env, version_hex));

    result.Set("type", Napi::Number::New(env, msg->type));
    result.Set("size", Napi::Number::New(env, msg->size));
    result.Set("parent", Napi::Buffer<uint8_t>::Copy(env, msg->parent, 32));
    result.Set("author", Napi::Buffer<uint8_t>::Copy(env, msg->author, 32));
    result.Set("hash", Napi::Buffer<uint8_t>::Copy(env, msg->hash, 32));
    result.Set("preimage", Napi::Buffer<uint8_t>::Copy(env, msg->preimage, 32));
    result.Set("signature", Napi::Buffer<uint8_t>::Copy(env, msg->signature, 64));

    return result; }));

  exports.Set("destroyMessage", Napi::Function::New(env, [](const Napi::CallbackInfo &info) -> Napi::Value
                                                    {
    Napi::Env env = info.Env();

    if (info.Length() < 1 || !info[0].IsObject()) {
      Napi::TypeError::New(env, "Expected message object").ThrowAsJavaScriptException();
      return env.Undefined();
    }

    Napi::Object obj = info[0].As<Napi::Object>();
    Napi::External<Message> ext = obj.Get("_ptr").As<Napi::External<Message>>();

    if (ext.Data()) {
      message_destroy(ext.Data());
      obj.Set("_ptr", Napi::External<Message>::New(env, nullptr));
    }

    return env.Undefined(); }));

  exports.Set("setBody", Napi::Function::New(env, [](const Napi::CallbackInfo &info) -> Napi::Value
                                             {
    Napi::Env env = info.Env();

    if (info.Length() < 2) {
      Napi::TypeError::New(env, "Expected message and body arguments").ThrowAsJavaScriptException();
      return env.Undefined();
    }

    if (!info[0].IsObject()) {
      Napi::TypeError::New(env, "First argument must be a message object").ThrowAsJavaScriptException();
      return env.Undefined();
    }

    if (!info[1].IsBuffer()) {
      Napi::TypeError::New(env, "Second argument must be a Buffer").ThrowAsJavaScriptException();
      return env.Undefined();
    }

    Napi::Object obj = info[0].As<Napi::Object>();
    Napi::External<Message> ext = obj.Get("_ptr").As<Napi::External<Message>>();

    if (!ext.Data()) {
      Napi::Error::New(env, "Invalid message object").ThrowAsJavaScriptException();
      return env.Undefined();
    }

    Napi::Buffer<uint8_t> buffer = info[1].As<Napi::Buffer<uint8_t>>();
    FabricError result = message_set_body(ext.Data(), buffer.Data(), buffer.Length());

    if (result != FABRIC_SUCCESS) {
      Napi::Error::New(env, "Failed to set message body").ThrowAsJavaScriptException();
      return env.Undefined();
    }

    // Update the JavaScript object with the new size value from the C struct
    Message* msg = ext.Data();
    obj.Set("size", Napi::Number::New(env, msg->size));

    return env.Undefined(); }));

  exports.Set("computeHash", Napi::Function::New(env, [](const Napi::CallbackInfo &info) -> Napi::Value
                                                 {
    Napi::Env env = info.Env();

    if (info.Length() < 1) {
      Napi::TypeError::New(env, "Expected message argument").ThrowAsJavaScriptException();
      return env.Undefined();
    }

    if (!info[0].IsObject()) {
      Napi::TypeError::New(env, "First argument must be a message object").ThrowAsJavaScriptException();
      return env.Undefined();
    }

    Napi::Object obj = info[0].As<Napi::Object>();
    Napi::External<Message> ext = obj.Get("_ptr").As<Napi::External<Message>>();

    if (!ext.Data()) {
      Napi::Error::New(env, "Invalid message object").ThrowAsJavaScriptException();
      return env.Undefined();
    }

    // Create secp256k1 context for hashing
    secp256k1_context* ctx = secp256k1_context_create(FABRIC_SECP256K1_CONTEXT_CREATE_FLAGS);
    if (!ctx) {
      Napi::Error::New(env, "Failed to create secp256k1 context").ThrowAsJavaScriptException();
      return env.Undefined();
    }

    FabricError result = message_compute_hash(ext.Data(), ctx);

    secp256k1_context_destroy(ctx);

    if (result != FABRIC_SUCCESS) {
      Napi::Error::New(env, "Failed to compute message hash").ThrowAsJavaScriptException();
      return env.Undefined();
    }

    // Update the JavaScript object with the new hash value from the C struct
    Message* msg = ext.Data();
    obj.Set("hash", Napi::Buffer<uint8_t>::Copy(env, msg->hash, 32));

    return env.Undefined(); }));

  exports.Set("signMessage", Napi::Function::New(env, [](const Napi::CallbackInfo &info) -> Napi::Value
                                                 {
    Napi::Env env = info.Env();

    if (info.Length() < 2) {
      Napi::TypeError::New(env, "Expected message and private key arguments").ThrowAsJavaScriptException();
      return env.Undefined();
    }

    if (!info[0].IsObject()) {
      Napi::TypeError::New(env, "First argument must be a message object").ThrowAsJavaScriptException();
      return env.Undefined();
    }

    if (!info[1].IsBuffer()) {
      Napi::TypeError::New(env, "Second argument must be a Buffer").ThrowAsJavaScriptException();
      return env.Undefined();
    }

    Napi::Object obj = info[0].As<Napi::Object>();
    Napi::External<Message> ext = obj.Get("_ptr").As<Napi::External<Message>>();

    if (!ext.Data()) {
      Napi::Error::New(env, "Invalid message object").ThrowAsJavaScriptException();
      return env.Undefined();
    }

    Napi::Buffer<uint8_t> privateKey = info[1].As<Napi::Buffer<uint8_t>>();
    if (privateKey.Length() != 32) {
      Napi::TypeError::New(env, "Private key must be 32 bytes").ThrowAsJavaScriptException();
      return env.Undefined();
    }

    // Create secp256k1 context for signing
    secp256k1_context* ctx = secp256k1_context_create(FABRIC_SECP256K1_CONTEXT_CREATE_FLAGS);
    if (!ctx) {
      Napi::Error::New(env, "Failed to create secp256k1 context").ThrowAsJavaScriptException();
      return env.Undefined();
    }

    FabricError result = message_sign(ext.Data(), privateKey.Data(), ctx);

    secp256k1_context_destroy(ctx);

    if (result != FABRIC_SUCCESS) {
      Napi::Error::New(env, "Failed to sign message").ThrowAsJavaScriptException();
      return env.Undefined();
    }

    // Update the JavaScript object with the new values from the C struct
    Message* msg = ext.Data();
    obj.Set("hash", Napi::Buffer<uint8_t>::Copy(env, msg->hash, 32));
    obj.Set("signature", Napi::Buffer<uint8_t>::Copy(env, msg->signature, 64));
    obj.Set("author", Napi::Buffer<uint8_t>::Copy(env, msg->author, 32));

    return env.Undefined(); }));

  exports.Set("verifyMessage", Napi::Function::New(env, [](const Napi::CallbackInfo &info) -> Napi::Value
                                                   {
    Napi::Env env = info.Env();

    if (info.Length() < 1) {
      Napi::TypeError::New(env, "Expected message argument").ThrowAsJavaScriptException();
      return env.Undefined();
    }

    if (!info[0].IsObject()) {
      Napi::TypeError::New(env, "First argument must be a message object").ThrowAsJavaScriptException();
      return env.Undefined();
    }

    Napi::Object obj = info[0].As<Napi::Object>();
    Napi::External<Message> ext = obj.Get("_ptr").As<Napi::External<Message>>();

    if (!ext.Data()) {
      Napi::Error::New(env, "Invalid message object").ThrowAsJavaScriptException();
      return env.Undefined();
    }

    // Create secp256k1 context for verification
    secp256k1_context* ctx = secp256k1_context_create(FABRIC_SECP256K1_CONTEXT_CREATE_FLAGS);
    if (!ctx) {
      Napi::Error::New(env, "Failed to create secp256k1 context").ThrowAsJavaScriptException();
      return env.Undefined();
    }

    FabricError result = message_verify(ext.Data(), ctx);

    secp256k1_context_destroy(ctx);

    if (result != FABRIC_SUCCESS) {
      return Napi::Boolean::New(env, false);
    }

    return Napi::Boolean::New(env, true); }));

  // Peer methods
  exports.Set("createPeer", Napi::Function::New(env, [](const Napi::CallbackInfo &info) -> Napi::Value
                                                {
    Napi::Env env = info.Env();

    Peer* peer = peer_create();
    if (!peer) {
      Napi::Error::New(env, "Failed to create peer").ThrowAsJavaScriptException();
      return env.Undefined();
    }

    // Return a simple object with the peer pointer
    Napi::Object result = Napi::Object::New(env);
    result.Set("_ptr", Napi::External<Peer>::New(env, peer));
    result.Set("connectionCount", Napi::Number::New(env, 0));
    result.Set("isListening", Napi::Boolean::New(env, false));

    return result; }));

  exports.Set("destroyPeer", Napi::Function::New(env, [](const Napi::CallbackInfo &info) -> Napi::Value
                                                 {
    Napi::Env env = info.Env();

    if (info.Length() < 1 || !info[0].IsObject()) {
      Napi::TypeError::New(env, "Expected peer object").ThrowAsJavaScriptException();
      return env.Undefined();
    }

    Napi::Object obj = info[0].As<Napi::Object>();
    Napi::External<Peer> ext = obj.Get("_ptr").As<Napi::External<Peer>>();

    if (ext.Data()) {
      peer_destroy(ext.Data());
      obj.Set("_ptr", Napi::External<Peer>::New(env, nullptr));
    }

    return env.Undefined(); }));

  exports.Set("generateKeypair", Napi::Function::New(env, [](const Napi::CallbackInfo &info) -> Napi::Value
                                                     {
    Napi::Env env = info.Env();

    if (info.Length() < 1 || !info[0].IsObject()) {
      Napi::TypeError::New(env, "Expected peer object").ThrowAsJavaScriptException();
      return env.Undefined();
    }

    Napi::Object obj = info[0].As<Napi::Object>();
    Napi::External<Peer> ext = obj.Get("_ptr").As<Napi::External<Peer>>();

    if (!ext.Data()) {
      Napi::Error::New(env, "Invalid peer object").ThrowAsJavaScriptException();
      return env.Undefined();
    }

    FabricError result = peer_generate_keypair(ext.Data());
    if (result != FABRIC_SUCCESS) {
      Napi::Error::New(env, "Failed to generate keypair").ThrowAsJavaScriptException();
      return env.Undefined();
    }

    // Get the generated public key from the peer
    Peer* peer = ext.Data();
    Napi::Object keypair = Napi::Object::New(env);
    keypair.Set("publicKey", Napi::Buffer<uint8_t>::Copy(env, peer->public_key, 33));
    keypair.Set("privateKey", Napi::Buffer<uint8_t>::Copy(env, peer->private_key, 32));

    return keypair; }));

  exports.Set("startListening", Napi::Function::New(env, [](const Napi::CallbackInfo &info) -> Napi::Value
                                                    {
    Napi::Env env = info.Env();

    if (info.Length() < 2) {
      Napi::TypeError::New(env, "Expected peer and port arguments").ThrowAsJavaScriptException();
      return env.Undefined();
    }

    if (!info[0].IsObject()) {
      Napi::TypeError::New(env, "First argument must be a peer object").ThrowAsJavaScriptException();
      return env.Undefined();
    }

    if (!info[1].IsNumber()) {
      Napi::TypeError::New(env, "Second argument must be a port number").ThrowAsJavaScriptException();
      return env.Undefined();
    }

    Napi::Object obj = info[0].As<Napi::Object>();
    Napi::External<Peer> ext = obj.Get("_ptr").As<Napi::External<Peer>>();

    if (!ext.Data()) {
      Napi::Error::New(env, "Invalid peer object").ThrowAsJavaScriptException();
      return env.Undefined();
    }

    int port = info[1].As<Napi::Number>().Int32Value();
    FabricError result = peer_start_listening(ext.Data(), port);

    if (result != FABRIC_SUCCESS) {
      Napi::Error::New(env, "Failed to start listening").ThrowAsJavaScriptException();
      return env.Undefined();
    }

    // Update the JavaScript object
    obj.Set("isListening", Napi::Boolean::New(env, true));

    return Napi::Boolean::New(env, true); }));

  exports.Set("connect", Napi::Function::New(env, [](const Napi::CallbackInfo &info) -> Napi::Value
                                             {
    Napi::Env env = info.Env();

    if (info.Length() < 3) {
      Napi::TypeError::New(env, "Expected peer, host, and port arguments").ThrowAsJavaScriptException();
      return env.Undefined();
    }

    if (!info[0].IsObject()) {
      Napi::TypeError::New(env, "First argument must be a peer object").ThrowAsJavaScriptException();
      return env.Undefined();
    }

    if (!info[1].IsString()) {
      Napi::TypeError::New(env, "Second argument must be a host string").ThrowAsJavaScriptException();
      return env.Undefined();
    }

    if (!info[2].IsNumber()) {
      Napi::TypeError::New(env, "Third argument must be a port number").ThrowAsJavaScriptException();
      return env.Undefined();
    }

    Napi::Object obj = info[0].As<Napi::Object>();
    Napi::External<Peer> ext = obj.Get("_ptr").As<Napi::External<Peer>>();

    if (!ext.Data()) {
      Napi::Error::New(env, "Invalid peer object").ThrowAsJavaScriptException();
      return env.Undefined();
    }

    std::string host = info[1].As<Napi::String>();
    int port = info[2].As<Napi::Number>().Int32Value();

    FabricError result = peer_connect(ext.Data(), host.c_str(), port);

    if (result != FABRIC_SUCCESS) {
      Napi::Error::New(env, "Failed to connect").ThrowAsJavaScriptException();
      return env.Undefined();
    }

    // Get the connection ID (assuming it's the first connection)
    Peer* peer = ext.Data();
    int32_t connectionCount;
    fabric_atomic_int32_get(&peer->connection_count, &connectionCount);
    int connectionId = connectionCount - 1;

    // Update the JavaScript object
    obj.Set("connectionCount", Napi::Number::New(env, connectionCount));

    return Napi::Number::New(env, connectionId); }));

  exports.Set("sendMessage", Napi::Function::New(env, [](const Napi::CallbackInfo &info) -> Napi::Value
                                                 {
    Napi::Env env = info.Env();

    if (info.Length() < 3) {
      Napi::TypeError::New(env, "Expected peer, connection ID, and message arguments").ThrowAsJavaScriptException();
      return env.Undefined();
    }

    if (!info[0].IsObject()) {
      Napi::TypeError::New(env, "First argument must be a peer object").ThrowAsJavaScriptException();
      return env.Undefined();
    }

    if (!info[1].IsNumber()) {
      Napi::TypeError::New(env, "Second argument must be a connection ID number").ThrowAsJavaScriptException();
      return env.Undefined();
    }

    if (!info[2].IsObject()) {
      Napi::TypeError::New(env, "Third argument must be a message object").ThrowAsJavaScriptException();
      return env.Undefined();
    }

    Napi::Object peerObj = info[0].As<Napi::Object>();
    Napi::External<Peer> peerExt = peerObj.Get("_ptr").As<Napi::External<Peer>>();

    if (!peerExt.Data()) {
      Napi::Error::New(env, "Invalid peer object").ThrowAsJavaScriptException();
      return env.Undefined();
    }

    Napi::Object msgObj = info[2].As<Napi::Object>();
    Napi::External<Message> msgExt = msgObj.Get("_ptr").As<Napi::External<Message>>();

    if (!msgExt.Data()) {
      Napi::Error::New(env, "Invalid message object").ThrowAsJavaScriptException();
      return env.Undefined();
    }

    int connectionId = info[1].As<Napi::Number>().Int32Value();

    FabricError result = peer_send_message(peerExt.Data(), connectionId, msgExt.Data());

    if (result != FABRIC_SUCCESS) {
      Napi::Error::New(env, "Failed to send message").ThrowAsJavaScriptException();
      return env.Undefined();
    }

    return Napi::Boolean::New(env, true); }));

  exports.Set("receiveMessage", Napi::Function::New(env, [](const Napi::CallbackInfo &info) -> Napi::Value
                                                    {
    Napi::Env env = info.Env();

    if (info.Length() < 2) {
      Napi::TypeError::New(env, "Expected peer and connection ID arguments").ThrowAsJavaScriptException();
      return env.Undefined();
    }

    if (!info[0].IsObject()) {
      Napi::TypeError::New(env, "First argument must be a peer object").ThrowAsJavaScriptException();
      return env.Undefined();
    }

    if (!info[1].IsNumber()) {
      Napi::TypeError::New(env, "Second argument must be a connection ID number").ThrowAsJavaScriptException();
      return env.Undefined();
    }

    Napi::Object peerObj = info[0].As<Napi::Object>();
    Napi::External<Peer> peerExt = peerObj.Get("_ptr").As<Napi::External<Peer>>();

    if (!peerExt.Data()) {
      Napi::Error::New(env, "Invalid peer object").ThrowAsJavaScriptException();
      return env.Undefined();
    }

    int connectionId = info[1].As<Napi::Number>().Int32Value();

    // Create a new message to receive into
    Message* msg = message_create();
    if (!msg) {
      Napi::Error::New(env, "Failed to create message for receiving").ThrowAsJavaScriptException();
      return env.Undefined();
    }

    FabricError result = peer_receive_message(peerExt.Data(), connectionId, msg);

    if (result != FABRIC_SUCCESS) {
      message_destroy(msg);
      Napi::Error::New(env, "Failed to receive message").ThrowAsJavaScriptException();
      return env.Undefined();
    }

    // Return the received message as a JavaScript object
    Napi::Object resultObj = Napi::Object::New(env);
    resultObj.Set("_ptr", Napi::External<Message>::New(env, msg));
    resultObj.Set("magic", Napi::Number::New(env, msg->magic));
    resultObj.Set("version", Napi::Number::New(env, msg->version));
    resultObj.Set("type", Napi::Number::New(env, msg->type));
    resultObj.Set("size", Napi::Number::New(env, msg->size));
    resultObj.Set("parent", Napi::Buffer<uint8_t>::Copy(env, msg->parent, 32));
    resultObj.Set("author", Napi::Buffer<uint8_t>::Copy(env, msg->author, 32));
    resultObj.Set("hash", Napi::Buffer<uint8_t>::Copy(env, msg->hash, 32));
    resultObj.Set("signature", Napi::Buffer<uint8_t>::Copy(env, msg->signature, 64));

    return resultObj; }));

  // Static constants
  exports.Set("MESSAGE_MAGIC", Napi::Number::New(env, MESSAGE_MAGIC));
  exports.Set("MESSAGE_VERSION", Napi::Number::New(env, MESSAGE_VERSION));

  // BIP340 bindings
  exports.Set("bip340Init", Napi::Function::New(env, [](const Napi::CallbackInfo &info) -> Napi::Value {
    Napi::Env env = info.Env();
    FabricError err = fabric_bip340_init();
    if (err != FABRIC_SUCCESS) {
      Napi::Error::New(env, "BIP340 init failed").ThrowAsJavaScriptException();
      return env.Undefined();
    }
    return Napi::Boolean::New(env, true);
  }));

  exports.Set("bip340Cleanup", Napi::Function::New(env, [](const Napi::CallbackInfo &info) -> Napi::Value {
    Napi::Env env = info.Env();
    fabric_bip340_cleanup();
    return env.Undefined();
  }));

  exports.Set("bip340Keygen", Napi::Function::New(env, [](const Napi::CallbackInfo &info) -> Napi::Value {
    Napi::Env env = info.Env();
    FabricBip340Keypair kp;
    FabricError err = fabric_bip340_keygen(&kp);
    if (err != FABRIC_SUCCESS) {
      Napi::Error::New(env, "BIP340 keygen failed").ThrowAsJavaScriptException();
      return env.Undefined();
    }
    Napi::Object obj = Napi::Object::New(env);
    obj.Set("privateKey", Napi::Buffer<uint8_t>::Copy(env, kp.private_key, 32));
    obj.Set("publicKeyX", Napi::Buffer<uint8_t>::Copy(env, kp.xonly_public_key, 32));
    return obj;
  }));

  exports.Set("bip340PubkeyFromPrivate", Napi::Function::New(env, [](const Napi::CallbackInfo &info) -> Napi::Value {
    Napi::Env env = info.Env();
    if (info.Length() < 1 || !info[0].IsBuffer()) {
      Napi::TypeError::New(env, "Expected 32-byte private key Buffer").ThrowAsJavaScriptException();
      return env.Undefined();
    }
    Napi::Buffer<uint8_t> sk = info[0].As<Napi::Buffer<uint8_t>>();
    if (sk.Length() != 32) {
      Napi::TypeError::New(env, "Private key must be 32 bytes").ThrowAsJavaScriptException();
      return env.Undefined();
    }
    uint8_t px[32];
    FabricError err = fabric_bip340_pubkey_from_private(sk.Data(), px);
    if (err != FABRIC_SUCCESS) {
      Napi::Error::New(env, "BIP340 pubkey derivation failed").ThrowAsJavaScriptException();
      return env.Undefined();
    }
    return Napi::Buffer<uint8_t>::Copy(env, px, 32);
  }));

  exports.Set("bip340Sign", Napi::Function::New(env, [](const Napi::CallbackInfo &info) -> Napi::Value {
    Napi::Env env = info.Env();
    if (info.Length() < 2 || !info[0].IsBuffer() || !info[1].IsBuffer()) {
      Napi::TypeError::New(env, "Expected msg32 Buffer and 32-byte private key Buffer").ThrowAsJavaScriptException();
      return env.Undefined();
    }
    Napi::Buffer<uint8_t> msg = info[0].As<Napi::Buffer<uint8_t>>();
    Napi::Buffer<uint8_t> sk = info[1].As<Napi::Buffer<uint8_t>>();
    if (msg.Length() != 32 || sk.Length() != 32) {
      Napi::TypeError::New(env, "msg must be 32 bytes and key must be 32 bytes").ThrowAsJavaScriptException();
      return env.Undefined();
    }
    uint8_t sig[64];
    FabricError err = fabric_bip340_sign(msg.Data(), sk.Data(), sig);
    if (err != FABRIC_SUCCESS) {
      Napi::Error::New(env, "BIP340 sign failed").ThrowAsJavaScriptException();
      return env.Undefined();
    }
    return Napi::Buffer<uint8_t>::Copy(env, sig, 64);
  }));

  exports.Set("bip340Verify", Napi::Function::New(env, [](const Napi::CallbackInfo &info) -> Napi::Value {
    Napi::Env env = info.Env();
    if (info.Length() < 3 || !info[0].IsBuffer() || !info[1].IsBuffer() || !info[2].IsBuffer()) {
      Napi::TypeError::New(env, "Expected msg Buffer, x-only pubkey (32), signature (64)").ThrowAsJavaScriptException();
      return env.Undefined();
    }
    Napi::Buffer<uint8_t> msg = info[0].As<Napi::Buffer<uint8_t>>();
    Napi::Buffer<uint8_t> px = info[1].As<Napi::Buffer<uint8_t>>();
    Napi::Buffer<uint8_t> sig = info[2].As<Napi::Buffer<uint8_t>>();
    if (px.Length() != 32 || sig.Length() != 64) {
      Napi::TypeError::New(env, "Invalid argument sizes").ThrowAsJavaScriptException();
      return env.Undefined();
    }
    int valid = 0;
    FabricError err = fabric_bip340_verify(msg.Data(), msg.Length(), px.Data(), sig.Data(), &valid);
    if (err != FABRIC_SUCCESS) {
      // For invalid inputs (e.g., malformed pubkey or signature), return false instead of throwing
      // to support vector-driven negative tests without crashing the process.
      if (err == FABRIC_ERROR_INVALID_KEY || err == FABRIC_ERROR_SIGNATURE_FAILED) {
        return Napi::Boolean::New(env, false);
      }
      Napi::Error::New(env, "BIP340 verify failed").ThrowAsJavaScriptException();
      return env.Undefined();
    }
    return Napi::Boolean::New(env, valid == 1);
  }));

  // Taproot scriptPubKey builder (P2TR)
  exports.Set("taprootScriptPubKey", Napi::Function::New(env, [](const Napi::CallbackInfo &info) -> Napi::Value {
    Napi::Env env = info.Env();
    if (info.Length() < 1 || !info[0].IsBuffer()) {
      Napi::TypeError::New(env, "Expected 32-byte x-only internal key Buffer").ThrowAsJavaScriptException();
      return env.Undefined();
    }
    Napi::Buffer<uint8_t> px = info[0].As<Napi::Buffer<uint8_t>>();
    if (px.Length() != 32) {
      Napi::TypeError::New(env, "Internal key must be 32 bytes").ThrowAsJavaScriptException();
      return env.Undefined();
    }
    uint8_t script[FABRIC_TAPROOT_SCRIPT_PUBKEY_SIZE];
    size_t script_len = 0;
    FabricError err = fabric_taproot_build_scriptpubkey(px.Data(), script, sizeof(script), &script_len);
    if (err != FABRIC_SUCCESS) {
      Napi::Error::New(env, "Failed to build Taproot scriptPubKey").ThrowAsJavaScriptException();
      return env.Undefined();
    }
    return Napi::Buffer<uint8_t>::Copy(env, script, script_len);
  }));

  // Taproot tweak (x-only pubkey)
  exports.Set("taprootTweakXOnly", Napi::Function::New(env, [](const Napi::CallbackInfo &info) -> Napi::Value {
    Napi::Env env = info.Env();
    if (info.Length() < 1 || !info[0].IsBuffer()) {
      Napi::TypeError::New(env, "Expected internal x-only pubkey Buffer (32 bytes)").ThrowAsJavaScriptException();
      return env.Undefined();
    }
    Napi::Buffer<uint8_t> px = info[0].As<Napi::Buffer<uint8_t>>();
    if (px.Length() != 32) {
      Napi::TypeError::New(env, "Internal key must be 32 bytes").ThrowAsJavaScriptException();
      return env.Undefined();
    }
    const uint8_t *merkle = nullptr;
    if (info.Length() >= 2 && info[1].IsBuffer()) {
      Napi::Buffer<uint8_t> mr = info[1].As<Napi::Buffer<uint8_t>>();
      if (mr.Length() == 32) merkle = mr.Data();
    }
    // Ensure Taproot/secp context initialized once
    if (fabric_taproot_init() != FABRIC_SUCCESS) {
      Napi::Error::New(env, "Taproot init failed").ThrowAsJavaScriptException();
      return env.Undefined();
    }
    uint8_t outx[32];
    FabricError err = fabric_taproot_tweak_xonly_pubkey(px.Data(), merkle, outx);
    if (err != FABRIC_SUCCESS) {
      Napi::Error::New(env, "Taproot tweak failed").ThrowAsJavaScriptException();
      return env.Undefined();
    }
    return Napi::Buffer<uint8_t>::Copy(env, outx, 32);
  }));

  // Taproot key-path signer (SIGHASH_DEFAULT outside; this signs msg32)
  exports.Set("taprootKeypathSign", Napi::Function::New(env, [](const Napi::CallbackInfo &info) -> Napi::Value {
    Napi::Env env = info.Env();
    if (info.Length() < 2 || !info[0].IsBuffer() || !info[1].IsBuffer()) {
      Napi::TypeError::New(env, "Expected msg32 Buffer and 32-byte internal seckey Buffer").ThrowAsJavaScriptException();
      return env.Undefined();
    }
    Napi::Buffer<uint8_t> msg = info[0].As<Napi::Buffer<uint8_t>>();
    Napi::Buffer<uint8_t> sk = info[1].As<Napi::Buffer<uint8_t>>();
    if (msg.Length() != 32 || sk.Length() != 32) {
      Napi::TypeError::New(env, "msg must be 32 bytes and seckey must be 32 bytes").ThrowAsJavaScriptException();
      return env.Undefined();
    }
    const uint8_t *merkle = nullptr;
    if (info.Length() >= 3 && info[2].IsBuffer()) {
      Napi::Buffer<uint8_t> mr = info[2].As<Napi::Buffer<uint8_t>>();
      if (mr.Length() == 32) merkle = mr.Data();
    }
    if (fabric_taproot_init() != FABRIC_SUCCESS) {
      Napi::Error::New(env, "Taproot init failed").ThrowAsJavaScriptException();
      return env.Undefined();
    }
    uint8_t sig[64];
    FabricError err = fabric_taproot_keypath_sign(msg.Data(), sk.Data(), merkle, sig);
    if (err != FABRIC_SUCCESS) {
      Napi::Error::New(env, "Taproot keypath sign failed").ThrowAsJavaScriptException();
      return env.Undefined();
    }
    return Napi::Buffer<uint8_t>::Copy(env, sig, 64);
  }));

  // BIP341 SIGHASH_DEFAULT helper
  exports.Set("bip341SighashDefault", Napi::Function::New(env, [](const Napi::CallbackInfo &info) -> Napi::Value {
    Napi::Env env = info.Env();
    if (info.Length() < 4 || !info[0].IsBuffer() || !info[1].IsNumber() || !info[2].IsBuffer() || !info[3].IsNumber()) {
      Napi::TypeError::New(env, "Expected tx Buffer, inputIndex Number, prevoutScript Buffer, prevoutValue Number").ThrowAsJavaScriptException();
      return env.Undefined();
    }
    Napi::Buffer<uint8_t> tx = info[0].As<Napi::Buffer<uint8_t>>();
    uint32_t index = info[1].As<Napi::Number>().Uint32Value();
    Napi::Buffer<uint8_t> script = info[2].As<Napi::Buffer<uint8_t>>();
    uint64_t value = (uint64_t) info[3].As<Napi::Number>().Int64Value();
    uint8_t out32[32];
    FabricError err = fabric_bip341_sighash_default(tx.Data(), tx.Length(), index, script.Data(), script.Length(), value, out32);
    if (err != FABRIC_SUCCESS) {
      Napi::Error::New(env, "bip341 sighash failed").ThrowAsJavaScriptException();
      return env.Undefined();
    }
    return Napi::Buffer<uint8_t>::Copy(env, out32, 32);
  }));

  // Pieter Wuille reference Bech32 / Bech32m / native segwit (ref/c/segwit_addr.c — sipa/bech32)
  exports.Set("bech32Encode", Napi::Function::New(env, [](const Napi::CallbackInfo &info) -> Napi::Value {
    Napi::Env env = info.Env();
    if (info.Length() < 3 || !info[0].IsString() || !info[1].IsBuffer() || !info[2].IsNumber()) {
      Napi::TypeError::New(env, "bech32Encode: expected (hrp: string, words: Buffer, enc: 0|1)").ThrowAsJavaScriptException();
      return env.Undefined();
    }
    std::string hrp = info[0].As<Napi::String>().Utf8Value();
    Napi::Buffer<uint8_t> words = info[1].As<Napi::Buffer<uint8_t>>();
    uint32_t encn = info[2].As<Napi::Number>().Uint32Value();
    bech32_encoding enc = (encn == 1) ? BECH32_ENCODING_BECH32M : BECH32_ENCODING_BECH32;
    char out[200];
    if (!bech32_encode(out, hrp.c_str(), words.Data(), words.Length(), enc)) {
      Napi::Error::New(env, "bech32Encode: invalid input").ThrowAsJavaScriptException();
      return env.Undefined();
    }
    return Napi::String::New(env, out);
  }));

  exports.Set("bech32Decode", Napi::Function::New(env, [](const Napi::CallbackInfo &info) -> Napi::Value {
    Napi::Env env = info.Env();
    if (info.Length() < 1 || !info[0].IsString()) {
      Napi::TypeError::New(env, "bech32Decode: expected string").ThrowAsJavaScriptException();
      return env.Undefined();
    }
    std::string input = info[0].As<Napi::String>().Utf8Value();
    char hrp[90];
    uint8_t data[90];
    size_t data_len = 0;
    bech32_encoding enc = bech32_decode(hrp, data, &data_len, input.c_str());
    if (enc == BECH32_ENCODING_NONE) {
      return env.Null();
    }
    Napi::Object o = Napi::Object::New(env);
    o.Set("hrp", Napi::String::New(env, hrp));
    o.Set("words", Napi::Buffer<uint8_t>::Copy(env, data, data_len));
    o.Set("spec", Napi::String::New(env, enc == BECH32_ENCODING_BECH32M ? "bech32m" : "bech32"));
    return o;
  }));

  exports.Set("segwitAddrEncode", Napi::Function::New(env, [](const Napi::CallbackInfo &info) -> Napi::Value {
    Napi::Env env = info.Env();
    if (info.Length() < 3 || !info[0].IsString() || !info[1].IsNumber() || !info[2].IsBuffer()) {
      Napi::TypeError::New(env, "segwitAddrEncode: expected (hrp: string, version: number, program: Buffer)").ThrowAsJavaScriptException();
      return env.Undefined();
    }
    std::string hrp = info[0].As<Napi::String>().Utf8Value();
    int ver = info[1].As<Napi::Number>().Int32Value();
    Napi::Buffer<uint8_t> prog = info[2].As<Napi::Buffer<uint8_t>>();
    char out[200];
    if (!segwit_addr_encode(out, hrp.c_str(), ver, prog.Data(), prog.Length())) {
      return env.Null();
    }
    return Napi::String::New(env, out);
  }));

  exports.Set("segwitAddrDecode", Napi::Function::New(env, [](const Napi::CallbackInfo &info) -> Napi::Value {
    Napi::Env env = info.Env();
    if (info.Length() < 2 || !info[0].IsString() || !info[1].IsString()) {
      Napi::TypeError::New(env, "segwitAddrDecode: expected (hrp: string, addr: string)").ThrowAsJavaScriptException();
      return env.Undefined();
    }
    std::string hrp = info[0].As<Napi::String>().Utf8Value();
    std::string addr = info[1].As<Napi::String>().Utf8Value();
    int witver;
    uint8_t witdata[40];
    size_t witlen = 0;
    if (!segwit_addr_decode(&witver, witdata, &witlen, hrp.c_str(), addr.c_str())) {
      return env.Null();
    }
    Napi::Object o = Napi::Object::New(env);
    o.Set("version", Napi::Number::New(env, witver));
    o.Set("program", Napi::Buffer<uint8_t>::Copy(env, witdata, witlen));
    return o;
  }));

  // Narrow acceleration surface for JS harness: double-SHA256 (wire body hash)
  exports.Set("doubleSha256", Napi::Function::New(env, [](const Napi::CallbackInfo &info) -> Napi::Value {
    Napi::Env env = info.Env();
    if (info.Length() < 1 || !info[0].IsBuffer()) {
      Napi::TypeError::New(env, "doubleSha256: expected Buffer").ThrowAsJavaScriptException();
      return env.Undefined();
    }
    Napi::Buffer<uint8_t> in = info[0].As<Napi::Buffer<uint8_t>>();
    uint8_t tmp[32], out32[32];
    if (!fabric_sha256(in.Data(), in.Length(), tmp)) {
      Napi::Error::New(env, "doubleSha256: inner sha256 failed").ThrowAsJavaScriptException();
      return env.Undefined();
    }
    if (!fabric_sha256(tmp, sizeof(tmp), out32)) {
      Napi::Error::New(env, "doubleSha256: outer sha256 failed").ThrowAsJavaScriptException();
      return env.Undefined();
    }
    return Napi::Buffer<uint8_t>::Copy(env, out32, 32);
  }));

  return exports;
}

NODE_API_MODULE(fabric, Init)
