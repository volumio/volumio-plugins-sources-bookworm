{
  "targets": [
    {
      "target_name": "rgb565",
      "sources": [ "rgb565.cpp" ],
      "include_dirs": ["<!(node -p \"require('node-addon-api').include\")"],
      "dependencies": ["<!(node -p \"require('node-addon-api').gyp\")"],
      "defines": [ "NAPI_DISABLE_CPP_EXCEPTIONS" ]
    }
  ]
}