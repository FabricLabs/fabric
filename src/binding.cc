#include <napi.h>
#include <secp256k1.h>
#include <noise/protocol.h>

extern "C"
{
#include "peer.h"
#include "message.h"
#include "errors.h"
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
    secp256k1_context* ctx = secp256k1_context_create(SECP256K1_CONTEXT_SIGN | SECP256K1_CONTEXT_VERIFY);
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
    secp256k1_context* ctx = secp256k1_context_create(SECP256K1_CONTEXT_SIGN | SECP256K1_CONTEXT_VERIFY);
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
    secp256k1_context* ctx = secp256k1_context_create(SECP256K1_CONTEXT_SIGN | SECP256K1_CONTEXT_VERIFY);
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

  return exports;
}

NODE_API_MODULE(fabric, Init)
