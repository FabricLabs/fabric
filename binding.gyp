{
  "targets": [{
    "target_name": "fabric",
    "sources": [
      "src/binding.cc",
      "native/sipa/segwit_addr.c",
      "src/peer.c",
      "src/message.c",
      "src/errors.c",
      "src/threads.c",
      "src/scoring.c",
      "src/validation.c",
      "src/secure_memory.c",
      "src/secure_random.c",
      "src/bip340.c",
      "src/taproot.c"
    ],
    "include_dirs": [
      "<!@(node -p \"require('node-addon-api').include\")",
      "src",
      "native/sipa"
    ],
    "conditions": [
      ["OS=='linux'", {
        "include_dirs": ["/usr/include", "/usr/local/include"],
        "libraries": ["-L/usr/lib", "-L/usr/local/lib", "-lsecp256k1", "-lnoiseprotocol", "-lnoisekeys", "-lwallycore"]
      }],
      ["OS=='mac'", {
        "include_dirs": ["/opt/homebrew/opt/secp256k1/include", "/opt/homebrew/opt/libwally-core/include", "/usr/local/include"],
        "libraries": ["-L/opt/homebrew/opt/secp256k1/lib", "-L/opt/homebrew/opt/libwally-core/lib", "-L/usr/local/lib", "-lsecp256k1", "-lnoiseprotocol", "-lnoisekeys", "-lwallycore"]
      }]
    ],
    "cflags!": ["-fno-exceptions"],
    "cflags_cc!": ["-fno-exceptions"],
    "xcode_settings": {
      "GCC_ENABLE_CPP_EXCEPTIONS": "YES",
      "CLANG_CXX_LIBRARY": "libc++",
      "MACOSX_DEPLOYMENT_TARGET": "10.15"
    },
    "msvs_settings": {
      "VCCLCompilerTool": {"ExceptionHandling": 1}
    },
    "defines": ["NAPI_DISABLE_CPP_EXCEPTIONS"]
  }]
}
