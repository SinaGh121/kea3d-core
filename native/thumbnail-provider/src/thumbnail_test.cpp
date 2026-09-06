#include <windows.h>
#include <objbase.h>

#include "thumbnail_renderer.h"

#include <cstdint>
#include <filesystem>
#include <fstream>
#include <iostream>
#include <vector>

#pragma pack(push, 1)
struct BmpFileHeader {
  std::uint16_t type = 0x4D42;
  std::uint32_t size;
  std::uint16_t reserved1 = 0;
  std::uint16_t reserved2 = 0;
  std::uint32_t offset = 14 + 40;
};
#pragma pack(pop)

int wmain(int argc, wchar_t** argv) {
  if (argc != 3) {
    std::wcerr << L"Usage: Kea3DThumbnailTest input.glb|input.stl|input.ply output.bmp\n";
    return 2;
  }
  const HRESULT initialized = CoInitializeEx(nullptr, COINIT_MULTITHREADED);
  if (FAILED(initialized) && initialized != RPC_E_CHANGED_MODE) return 6;
  std::ifstream input(std::filesystem::path(argv[1]), std::ios::binary | std::ios::ate);
  if (!input) return 3;
  const auto length = input.tellg();
  input.seekg(0);
  std::vector<std::uint8_t> bytes(static_cast<std::size_t>(length));
  input.read(reinterpret_cast<char*>(bytes.data()), length);
  kea3d::Thumbnail image;
  if (!kea3d::render_model_thumbnail(bytes.data(), bytes.size(), 256, image)) return 4;

  BITMAPINFOHEADER header{};
  header.biSize = sizeof(header);
  header.biWidth = static_cast<LONG>(image.width);
  header.biHeight = -static_cast<LONG>(image.height);
  header.biPlanes = 1;
  header.biBitCount = 32;
  header.biCompression = BI_RGB;
  header.biSizeImage = static_cast<DWORD>(image.bgra.size());
  BmpFileHeader file_header{};
  file_header.size = file_header.offset + header.biSizeImage;
  std::ofstream output(std::filesystem::path(argv[2]), std::ios::binary);
  output.write(reinterpret_cast<const char*>(&file_header), sizeof(file_header));
  output.write(reinterpret_cast<const char*>(&header), sizeof(header));
  output.write(reinterpret_cast<const char*>(image.bgra.data()), image.bgra.size());
  if (SUCCEEDED(initialized)) CoUninitialize();
  return output ? 0 : 5;
}
