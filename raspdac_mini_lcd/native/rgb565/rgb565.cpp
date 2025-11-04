#include "./node_modules/node-addon-api/napi.h"  


Napi::Value Rgb888ToRgb565(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();

    if (info.Length() < 1 || !info[0].IsBuffer()) {
        Napi::TypeError::New(env, "Buffer expected").ThrowAsJavaScriptException();
        return env.Null();
    }

    Napi::Buffer<uint8_t> input = info[0].As<Napi::Buffer<uint8_t>>();
    size_t length = input.Length();



    // Create an output buffer (half the size of the input buffer)
    size_t outputLength = length / 2;
    Napi::Buffer<uint8_t> output = Napi::Buffer<uint8_t>::New(env, outputLength);

    // Convert RGBA to BGR565
    uint8_t* inputData = input.Data();
    uint8_t* outputData = output.Data();
    
for (size_t i = 0, j = 0; i < length && j + 1 < outputLength; i += 4, j += 2) {
    uint8_t r = inputData[i];
    uint8_t g = inputData[i + 1];
    uint8_t b = inputData[i + 2];

    // BGR565: BBBBBGGG GGGRRRRR (big-endian byte order for ILI9341)
    uint16_t bgr565 = ((b >> 3) << 11) | ((g >> 2) << 5) | (r >> 3);
    
    // Write as big-endian bytes
    outputData[j] = (bgr565 >> 8) & 0xFF;     // High byte first
    outputData[j + 1] = bgr565 & 0xFF;        // Low byte second
}
    return output;
  
}

Napi::Object Init(Napi::Env env, Napi::Object exports) {
    exports.Set("rgb888ToRgb565", Napi::Function::New(env, Rgb888ToRgb565));
    return exports;
}

NODE_API_MODULE(addon, Init)