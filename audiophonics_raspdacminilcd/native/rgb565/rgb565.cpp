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

    // Convert RGB888 to RGB565
    uint8_t* inputData = input.Data();
    uint16_t* outputData = reinterpret_cast<uint16_t*>(output.Data());
for (size_t i = 0, j = 0; i < length; i += 4, j++) {
    uint8_t r = inputData[i];
    uint8_t g = inputData[i + 1];
    uint8_t b = inputData[i + 2];

    uint16_t bgr565 = (b >> 3) | ((g >> 2) << 5) | ((r >> 3) << 11);
    if (j < outputLength / 2) {
        outputData[j] = bgr565;
    }
}
    return output;
  
}

Napi::Object Init(Napi::Env env, Napi::Object exports) {
    exports.Set("rgb888ToRgb565", Napi::Function::New(env, Rgb888ToRgb565));
    return exports;
}

NODE_API_MODULE(addon, Init)