// WASAPI process loopback: the sound one application's process tree plays.
//
// Windows has had this since Windows 10 version 2004 (build 19041), through
// ActivateAudioInterfaceAsync with AUDIOCLIENT_ACTIVATION_PARAMS. Chromium
// does not expose it, which is the whole reason this file exists.
//
// This reports facts and captures audio. It makes no decisions: which process
// counts as "the application" is worked out in TypeScript, where it can be
// tested without Windows.
#include <napi.h>

#ifdef _WIN32
#include <windows.h>
#include <audioclient.h>
#include <audioclientactivationparams.h>
#include <mmdeviceapi.h>
#include <mmreg.h>
#include <tlhelp32.h>
#include <wrl/client.h>
#include <wrl/implements.h>
#include <atomic>
#include <thread>
#include <vector>

using Microsoft::WRL::ComPtr;
using Microsoft::WRL::RuntimeClass;
using Microsoft::WRL::RuntimeClassFlags;
using Microsoft::WRL::ClassicCom;
using Microsoft::WRL::FtmBase;

namespace {

constexpr int kSampleRate = 48000;
constexpr int kChannels   = 2;
constexpr int kFrames     = 480;   // 10 ms

std::atomic<bool> g_running{false};
std::thread       g_thread;
Napi::ThreadSafeFunction g_tsfn;

// ActivateAudioInterfaceAsync answers on another thread; this waits for it.
//
// FtmBase is a base class, not a RuntimeClassFlags value — it makes the
// handler free-threaded, which activation requires. Putting it in the flags
// does not compile.
class ActivationHandler
    : public RuntimeClass<RuntimeClassFlags<ClassicCom>, FtmBase,
                          IActivateAudioInterfaceCompletionHandler> {
 public:
  HRESULT STDMETHODCALLTYPE ActivateCompleted(IActivateAudioInterfaceAsyncOperation* op) override {
    HRESULT hr = S_OK;
    ComPtr<IUnknown> unknown;
    if (SUCCEEDED(op->GetActivateResult(&hr, &unknown)) && SUCCEEDED(hr)) {
      unknown.As(&client);
    }
    result = hr;
    SetEvent(done);
    return S_OK;
  }
  ComPtr<IAudioClient> client;
  HRESULT result = E_FAIL;
  HANDLE  done   = CreateEventW(nullptr, TRUE, FALSE, nullptr);
};

bool IsSupported() {
  // Process loopback needs build 19041. RtlGetVersion is the only version
  // call Windows does not lie about to unmanifested processes.
  using RtlGetVersionFn = LONG(WINAPI*)(PRTL_OSVERSIONINFOW);
  HMODULE ntdll = GetModuleHandleW(L"ntdll.dll");
  if (!ntdll) return false;
  auto fn = reinterpret_cast<RtlGetVersionFn>(GetProcAddress(ntdll, "RtlGetVersion"));
  if (!fn) return false;
  RTL_OSVERSIONINFOW info{};
  info.dwOSVersionInfoSize = sizeof(info);
  if (fn(&info) != 0) return false;
  return info.dwMajorVersion > 10 ||
         (info.dwMajorVersion == 10 && info.dwBuildNumber >= 19041);
}

void Deliver(std::vector<float>* chunk) {
  auto callback = [](Napi::Env env, Napi::Function cb, std::vector<float>* c) {
    cb.Call({ Napi::Buffer<float>::Copy(env, c->data(), c->size()) });
    delete c;
  };
  if (g_tsfn.BlockingCall(chunk, callback) != napi_ok) delete chunk;
}

// The capture loop. Event-driven: Windows signals when a buffer is ready.
void CaptureLoop(DWORD pid) {
  CoInitializeEx(nullptr, COINIT_MULTITHREADED);

  AUDIOCLIENT_ACTIVATION_PARAMS params{};
  params.ActivationType = AUDIOCLIENT_ACTIVATION_TYPE_PROCESS_LOOPBACK;
  params.ProcessLoopbackParams.TargetProcessId = pid;
  params.ProcessLoopbackParams.ProcessLoopbackMode =
      PROCESS_LOOPBACK_MODE_INCLUDE_TARGET_PROCESS_TREE;

  PROPVARIANT pv{};
  pv.vt = VT_BLOB;
  pv.blob.cbSize = sizeof(params);
  pv.blob.pBlobData = reinterpret_cast<BYTE*>(&params);

  auto handler = Microsoft::WRL::Make<ActivationHandler>();
  ComPtr<IActivateAudioInterfaceAsyncOperation> op;
  if (FAILED(ActivateAudioInterfaceAsync(VIRTUAL_AUDIO_DEVICE_PROCESS_LOOPBACK,
                                         __uuidof(IAudioClient), &pv, handler.Get(), &op))) {
    g_running = false; CoUninitialize(); return;
  }
  WaitForSingleObject(handler->done, 5000);
  if (!handler->client) { g_running = false; CoUninitialize(); return; }

  // Process loopback is shared-mode only and takes the format we ask for.
  WAVEFORMATEX fmt{};
  fmt.wFormatTag      = WAVE_FORMAT_IEEE_FLOAT;
  fmt.nChannels       = kChannels;
  fmt.nSamplesPerSec  = kSampleRate;
  fmt.wBitsPerSample  = 32;
  fmt.nBlockAlign     = static_cast<WORD>(fmt.nChannels * fmt.wBitsPerSample / 8);
  fmt.nAvgBytesPerSec = fmt.nSamplesPerSec * fmt.nBlockAlign;

  if (FAILED(handler->client->Initialize(
          AUDCLNT_SHAREMODE_SHARED,
          AUDCLNT_STREAMFLAGS_LOOPBACK | AUDCLNT_STREAMFLAGS_EVENTCALLBACK,
          2000000 /* 200 ms */, 0, &fmt, nullptr))) {
    g_running = false; CoUninitialize(); return;
  }

  HANDLE ready = CreateEventW(nullptr, FALSE, FALSE, nullptr);
  handler->client->SetEventHandle(ready);

  ComPtr<IAudioCaptureClient> capture;
  if (FAILED(handler->client->GetService(__uuidof(IAudioCaptureClient), &capture)) ||
      FAILED(handler->client->Start())) {
    g_running = false; CloseHandle(ready); CoUninitialize(); return;
  }

  // Windows hands over whatever is ready; the renderer wants fixed 10 ms
  // chunks, so leftovers carry into the next one.
  std::vector<float> pending;
  pending.reserve(static_cast<size_t>(kFrames) * kChannels * 4);
  const size_t per = static_cast<size_t>(kFrames) * kChannels;

  while (g_running) {
    if (WaitForSingleObject(ready, 200) != WAIT_OBJECT_0) continue;
    UINT32 packet = 0;
    while (SUCCEEDED(capture->GetNextPacketSize(&packet)) && packet > 0 && g_running) {
      BYTE* data = nullptr;
      UINT32 frames = 0;
      DWORD flags = 0;
      if (FAILED(capture->GetBuffer(&data, &frames, &flags, nullptr, nullptr))) break;
      const size_t samples = static_cast<size_t>(frames) * kChannels;
      if (flags & AUDCLNT_BUFFERFLAGS_SILENT) {
        // An app that plays nothing still produces buffers. They must be sent:
        // silence keeps the stream's timing, and a gap would not.
        pending.insert(pending.end(), samples, 0.0f);
      } else {
        const float* in = reinterpret_cast<const float*>(data);
        pending.insert(pending.end(), in, in + samples);
      }
      capture->ReleaseBuffer(frames);

      while (pending.size() >= per) {
        Deliver(new std::vector<float>(pending.begin(), pending.begin() + per));
        pending.erase(pending.begin(), pending.begin() + per);
      }
    }
  }

  handler->client->Stop();
  CloseHandle(ready);
  CoUninitialize();
}

Napi::Value Supported(const Napi::CallbackInfo& info) {
  return Napi::Boolean::New(info.Env(), IsSupported());
}

Napi::Value PidForWindow(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  if (info.Length() < 1 || !info[0].IsNumber()) return env.Null();
  // desktopCapturer gives the HWND in decimal, so it arrives as a JS number.
  HWND hwnd = reinterpret_cast<HWND>(static_cast<uintptr_t>(info[0].As<Napi::Number>().Int64Value()));
  if (!IsWindow(hwnd)) return env.Null();
  DWORD pid = 0;
  GetWindowThreadProcessId(hwnd, &pid);
  return pid ? Napi::Number::New(env, pid) : env.Null();
}

Napi::Value ProcessTable(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  Napi::Array out = Napi::Array::New(env);
  HANDLE snap = CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0);
  if (snap == INVALID_HANDLE_VALUE) return out;

  PROCESSENTRY32W entry{};
  entry.dwSize = sizeof(entry);
  uint32_t i = 0;
  if (Process32FirstW(snap, &entry)) {
    do {
      // Creation time distinguishes a real parent from a recycled pid. A
      // process we may not open gets 0, which never looks later than a child.
      double created = 0;
      HANDLE h = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, FALSE, entry.th32ProcessID);
      if (h) {
        FILETIME c{}, e{}, k{}, u{};
        if (GetProcessTimes(h, &c, &e, &k, &u)) {
          created = static_cast<double>((static_cast<uint64_t>(c.dwHighDateTime) << 32) | c.dwLowDateTime);
        }
        CloseHandle(h);
      }
      Napi::Object row = Napi::Object::New(env);
      row.Set("pid", Napi::Number::New(env, entry.th32ProcessID));
      row.Set("parentPid", Napi::Number::New(env, entry.th32ParentProcessID));
      row.Set("exe", Napi::String::New(env, reinterpret_cast<const char16_t*>(entry.szExeFile)));
      row.Set("createdAt", Napi::Number::New(env, created));
      out.Set(i++, row);
    } while (Process32NextW(snap, &entry));
  }
  CloseHandle(snap);
  return out;
}

Napi::Value Start(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  if (g_running) return Napi::Boolean::New(env, false);
  if (info.Length() < 2 || !info[0].IsNumber() || !info[1].IsFunction())
    return Napi::Boolean::New(env, false);
  if (!IsSupported()) return Napi::Boolean::New(env, false);

  const DWORD pid = static_cast<DWORD>(info[0].As<Napi::Number>().Uint32Value());
  g_tsfn = Napi::ThreadSafeFunction::New(env, info[1].As<Napi::Function>(), "shareAudio", 0, 1);
  g_running = true;
  g_thread = std::thread(CaptureLoop, pid);
  return Napi::Boolean::New(env, true);
}

Napi::Value Stop(const Napi::CallbackInfo& info) {
  if (g_running.exchange(false) || g_thread.joinable()) {
    if (g_thread.joinable()) g_thread.join();
    g_tsfn.Release();
  }
  return info.Env().Undefined();
}

}  // namespace

Napi::Object Init(Napi::Env env, Napi::Object exports) {
  exports.Set("supported",    Napi::Function::New(env, Supported));
  exports.Set("pidForWindow", Napi::Function::New(env, PidForWindow));
  exports.Set("processTable", Napi::Function::New(env, ProcessTable));
  exports.Set("start",        Napi::Function::New(env, Start));
  exports.Set("stop",         Napi::Function::New(env, Stop));
  return exports;
}
NODE_API_MODULE(skycord_audio_capture, Init)

#else   // not Windows

namespace {
Napi::Value Unsupported(const Napi::CallbackInfo& info) {
  return Napi::Boolean::New(info.Env(), false);
}
}  // namespace

Napi::Object Init(Napi::Env env, Napi::Object exports) {
  exports.Set("supported", Napi::Function::New(env, Unsupported));
  return exports;
}
NODE_API_MODULE(skycord_audio_capture, Init)

#endif
