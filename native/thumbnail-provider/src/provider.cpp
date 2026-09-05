#include <windows.h>
#include <thumbcache.h>
#include <shobjidl_core.h>

#include "thumbnail_renderer.h"

#include <atomic>
#include <algorithm>
#include <cstring>
#include <cstdint>
#include <filesystem>
#include <fstream>
#include <iomanip>
#include <new>
#include <sstream>
#include <vector>

namespace {

// {E50D62FC-E508-4A2D-82AF-A3290688D78C}
constexpr CLSID kProviderClsid = {0xe50d62fc, 0xe508, 0x4a2d, {0x82, 0xaf, 0xa3, 0x29, 0x06, 0x88, 0xd7, 0x8c}};
std::atomic<long> g_objects = 0;

std::uint32_t read_u32(const std::uint8_t* bytes) {
  return static_cast<std::uint32_t>(bytes[0]) |
         (static_cast<std::uint32_t>(bytes[1]) << 8) |
         (static_cast<std::uint32_t>(bytes[2]) << 16) |
         (static_cast<std::uint32_t>(bytes[3]) << 24);
}

bool is_step_file(const std::vector<std::uint8_t>& bytes) {
  constexpr char signature[] = "ISO-10303-21";
  const std::size_t inspected = std::min<std::size_t>(bytes.size(), 512);
  return std::search(bytes.begin(), bytes.begin() + inspected,
                     signature, signature + sizeof(signature) - 1) != bytes.begin() + inspected;
}

std::uint64_t thumbnail_hash(const std::vector<std::uint8_t>& bytes) {
  std::uint64_t hash = 1469598103934665603ULL;
  for (const std::uint8_t value : bytes) {
    hash ^= value;
    hash *= 1099511628211ULL;
  }
  return hash;
}

std::filesystem::path thumbnail_cache_path(const std::vector<std::uint8_t>& bytes) {
  const wchar_t* local_app_data = _wgetenv(L"LOCALAPPDATA");
  if (!local_app_data || !*local_app_data) return {};
  std::wostringstream name;
  name << std::hex << std::setw(16) << std::setfill(L'0') << thumbnail_hash(bytes)
       << L'-' << std::dec << bytes.size() << L".k3t";
  return std::filesystem::path(local_app_data) / L"Kea3D" / L"ThumbnailCache" / L"v2" / name.str();
}

bool load_cad_thumbnail(const std::vector<std::uint8_t>& source, unsigned requested_edge,
                        kea3d::Thumbnail& output) {
  const std::filesystem::path path = thumbnail_cache_path(source);
  std::ifstream input(path, std::ios::binary | std::ios::ate);
  if (!input) return false;
  const std::streamoff length = input.tellg();
  if (length < 12 || length > 12 + 512 * 512 * 4) return false;
  input.seekg(0);
  std::vector<std::uint8_t> bytes(static_cast<std::size_t>(length));
  input.read(reinterpret_cast<char*>(bytes.data()), static_cast<std::streamsize>(bytes.size()));
  if (!input || std::memcmp(bytes.data(), "K3T1", 4) != 0) return false;
  const unsigned width = read_u32(bytes.data() + 4);
  const unsigned height = read_u32(bytes.data() + 8);
  if (width == 0 || height == 0 || width > 512 || height > 512 || width != height ||
      bytes.size() != 12 + static_cast<std::size_t>(width) * height * 4) return false;
  const unsigned edge = std::clamp(requested_edge, 16U, width);
  output = {edge, edge, std::vector<std::uint8_t>(static_cast<std::size_t>(edge) * edge * 4)};
  for (unsigned y = 0; y < edge; ++y) {
    const unsigned source_y = std::min(height - 1, y * height / edge);
    for (unsigned x = 0; x < edge; ++x) {
      const unsigned source_x = std::min(width - 1, x * width / edge);
      const std::size_t from = 12 + (static_cast<std::size_t>(source_y) * width + source_x) * 4;
      const std::size_t to = (static_cast<std::size_t>(y) * edge + x) * 4;
      std::copy_n(bytes.data() + from, 4, output.bgra.data() + to);
    }
  }
  return true;
}

class ThumbnailProvider final : public IInitializeWithStream, public IThumbnailProvider {
 public:
  ThumbnailProvider() { ++g_objects; }
  ~ThumbnailProvider() { if (stream_) stream_->Release(); --g_objects; }

  HRESULT STDMETHODCALLTYPE QueryInterface(REFIID id, void** result) override {
    if (!result) return E_POINTER;
    *result = nullptr;
    if (id == IID_IUnknown || id == IID_IInitializeWithStream) *result = static_cast<IInitializeWithStream*>(this);
    else if (id == IID_IThumbnailProvider) *result = static_cast<IThumbnailProvider*>(this);
    else return E_NOINTERFACE;
    AddRef();
    return S_OK;
  }
  ULONG STDMETHODCALLTYPE AddRef() override { return ++references_; }
  ULONG STDMETHODCALLTYPE Release() override {
    const ULONG remaining = --references_;
    if (!remaining) delete this;
    return remaining;
  }
  HRESULT STDMETHODCALLTYPE Initialize(IStream* stream, DWORD) override {
    if (!stream) return E_INVALIDARG;
    if (stream_) return HRESULT_FROM_WIN32(ERROR_ALREADY_INITIALIZED);
    stream_ = stream;
    stream_->AddRef();
    return S_OK;
  }
  HRESULT STDMETHODCALLTYPE GetThumbnail(UINT edge, HBITMAP* bitmap, WTS_ALPHATYPE* alpha) override {
    if (!bitmap || !alpha || !stream_) return E_POINTER;
    *bitmap = nullptr;
    *alpha = WTSAT_UNKNOWN;
    STATSTG stats{};
    if (FAILED(stream_->Stat(&stats, STATFLAG_NONAME)) || stats.cbSize.QuadPart <= 0 ||
        stats.cbSize.QuadPart > 192LL * 1024LL * 1024LL) return E_FAIL;
    LARGE_INTEGER start{};
    if (FAILED(stream_->Seek(start, STREAM_SEEK_SET, nullptr))) return E_FAIL;
    std::vector<std::uint8_t> bytes(static_cast<std::size_t>(stats.cbSize.QuadPart));
    ULONG read = 0;
    if (FAILED(stream_->Read(bytes.data(), static_cast<ULONG>(bytes.size()), &read)) || read != bytes.size()) return E_FAIL;
    kea3d::Thumbnail image;
    const bool rendered = is_step_file(bytes)
      ? load_cad_thumbnail(bytes, edge, image)
      : kea3d::render_model_thumbnail(bytes.data(), bytes.size(), edge, image);
    if (!rendered) return E_FAIL;

    BITMAPINFO info{};
    info.bmiHeader.biSize = sizeof(BITMAPINFOHEADER);
    info.bmiHeader.biWidth = static_cast<LONG>(image.width);
    info.bmiHeader.biHeight = -static_cast<LONG>(image.height);
    info.bmiHeader.biPlanes = 1;
    info.bmiHeader.biBitCount = 32;
    info.bmiHeader.biCompression = BI_RGB;
    void* pixels = nullptr;
    HBITMAP dib = CreateDIBSection(nullptr, &info, DIB_RGB_COLORS, &pixels, nullptr, 0);
    if (!dib || !pixels) return E_OUTOFMEMORY;
    std::memcpy(pixels, image.bgra.data(), image.bgra.size());
    *bitmap = dib;
    *alpha = WTSAT_ARGB;
    return S_OK;
  }

 private:
  std::atomic<ULONG> references_ = 1;
  IStream* stream_ = nullptr;
};

class ClassFactory final : public IClassFactory {
 public:
  HRESULT STDMETHODCALLTYPE QueryInterface(REFIID id, void** result) override {
    if (!result) return E_POINTER;
    *result = nullptr;
    if (id != IID_IUnknown && id != IID_IClassFactory) return E_NOINTERFACE;
    *result = static_cast<IClassFactory*>(this);
    AddRef();
    return S_OK;
  }
  ULONG STDMETHODCALLTYPE AddRef() override { return ++references_; }
  ULONG STDMETHODCALLTYPE Release() override {
    const ULONG remaining = --references_;
    if (!remaining) delete this;
    return remaining;
  }
  HRESULT STDMETHODCALLTYPE CreateInstance(IUnknown* outer, REFIID id, void** result) override {
    if (outer) return CLASS_E_NOAGGREGATION;
    auto* provider = new (std::nothrow) ThumbnailProvider();
    if (!provider) return E_OUTOFMEMORY;
    const HRESULT status = provider->QueryInterface(id, result);
    provider->Release();
    return status;
  }
  HRESULT STDMETHODCALLTYPE LockServer(BOOL lock) override { g_objects += lock ? 1 : -1; return S_OK; }
 private:
  std::atomic<ULONG> references_ = 1;
};

}  // namespace

HRESULT __stdcall DllGetClassObject(REFCLSID class_id, REFIID interface_id, void** result) {
  if (class_id != kProviderClsid) return CLASS_E_CLASSNOTAVAILABLE;
  auto* factory = new (std::nothrow) ClassFactory();
  if (!factory) return E_OUTOFMEMORY;
  const HRESULT status = factory->QueryInterface(interface_id, result);
  factory->Release();
  return status;
}

HRESULT __stdcall DllCanUnloadNow() { return g_objects == 0 ? S_OK : S_FALSE; }
