#include <windows.h>
#include <shobjidl_core.h>

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
    std::wcerr << L"Usage: Kea3DShellThumbnailTest input output.bmp\n";
    return 2;
  }
  const HRESULT initialized = CoInitializeEx(nullptr, COINIT_APARTMENTTHREADED);
  if (FAILED(initialized)) return 3;
  IShellItemImageFactory* factory = nullptr;
  HRESULT result = SHCreateItemFromParsingName(argv[1], nullptr, IID_PPV_ARGS(&factory));
  const wchar_t* stage = L"SHCreateItemFromParsingName";
  HBITMAP bitmap = nullptr;
  if (SUCCEEDED(result)) {
    SIZE size{256, 256};
    stage = L"IShellItemImageFactory::GetImage";
    result = factory->GetImage(size, static_cast<SIIGBF>(SIIGBF_RESIZETOFIT | SIIGBF_THUMBNAILONLY), &bitmap);
  }
  if (factory) factory->Release();
  if (FAILED(result) || !bitmap) {
    std::wcerr << stage << L" failed (HRESULT 0x" << std::hex
               << static_cast<unsigned long>(result) << L")\n";
    CoUninitialize();
    return 4;
  }

  BITMAP source{};
  if (!GetObjectW(bitmap, sizeof(source), &source) || source.bmWidth <= 0 || source.bmHeight <= 0) {
    DeleteObject(bitmap); CoUninitialize(); return 5;
  }
  BITMAPINFOHEADER header{};
  header.biSize = sizeof(header);
  header.biWidth = source.bmWidth;
  header.biHeight = -source.bmHeight;
  header.biPlanes = 1;
  header.biBitCount = 32;
  header.biCompression = BI_RGB;
  header.biSizeImage = static_cast<DWORD>(source.bmWidth * source.bmHeight * 4);
  std::vector<std::uint8_t> pixels(header.biSizeImage);
  BITMAPINFO info{};
  info.bmiHeader = header;
  HDC dc = GetDC(nullptr);
  const int rows = GetDIBits(dc, bitmap, 0, source.bmHeight, pixels.data(), &info, DIB_RGB_COLORS);
  ReleaseDC(nullptr, dc);
  DeleteObject(bitmap);
  CoUninitialize();
  if (rows != source.bmHeight) return 6;

  BmpFileHeader file_header{};
  file_header.size = file_header.offset + header.biSizeImage;
  std::ofstream output(std::filesystem::path(argv[2]), std::ios::binary);
  output.write(reinterpret_cast<const char*>(&file_header), sizeof(file_header));
  output.write(reinterpret_cast<const char*>(&header), sizeof(header));
  output.write(reinterpret_cast<const char*>(pixels.data()), pixels.size());
  return output ? 0 : 7;
}
