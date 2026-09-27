{
  "targets": [
    {
      "target_name": "skycord_audio_capture",
      "sources": [ "src/capture.cc" ],
      "include_dirs": [ "<!@(node -p \"require('node-addon-api').include\")" ],
      "defines": [ "NAPI_DISABLE_CPP_EXCEPTIONS", "NOMINMAX", "UNICODE", "_UNICODE" ],
      "conditions": [
        [ "OS=='win'", {
          "libraries": [ "-lmmdevapi.lib", "-lole32.lib", "-lavrt.lib" ],
          "msvs_settings": {
            "VCCLCompilerTool": { "ExceptionHandling": 1, "AdditionalOptions": [ "/std:c++17" ] }
          }
        } ]
      ]
    }
  ]
}
