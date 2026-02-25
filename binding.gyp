{
  "targets": [{
    "target_name": "fabric",
    "sources": [
      "src/binding.cc",
      "src/peer.c",
      "src/message.c",
      "src/errors.c",
      "src/threads.c",
      "src/scoring.c"
    ],
    "include_dirs": [
      "<!@(node -p \"require('node-addon-api').include\")",
      "src"
    ],
    "conditions": [
      ["OS=='linux'", {
        "include_dirs": ["/usr/include", "/usr/local/include"],
        "libraries": ["-L/usr/lib", "-L/usr/local/lib", "-lsecp256k1", "-lnoiseprotocol", "-lnoisekeys"]
      }],
      ["OS=='mac'", {
        "include_dirs": ["/opt/homebrew/opt/secp256k1/include", "/usr/local/include"],
        "libraries": ["-L/opt/homebrew/opt/secp256k1/lib", "-L/usr/local/lib", "-lsecp256k1", "-lnoiseprotocol", "-lnoisekeys"]
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
