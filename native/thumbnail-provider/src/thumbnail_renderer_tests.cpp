#include "thumbnail_renderer.h"

#include <windows.h>
#include <objbase.h>

#include <algorithm>
#include <array>
#include <cstdint>
#include <cstring>
#include <string>
#include <vector>

namespace {

void append_u32(std::vector<std::uint8_t>& bytes, std::uint32_t value) {
  bytes.push_back(static_cast<std::uint8_t>(value));
  bytes.push_back(static_cast<std::uint8_t>(value >> 8));
  bytes.push_back(static_cast<std::uint8_t>(value >> 16));
  bytes.push_back(static_cast<std::uint8_t>(value >> 24));
}

void append_f32(std::vector<std::uint8_t>& bytes, float value) {
  std::uint32_t bits = 0;
  std::memcpy(&bits, &value, sizeof(bits));
  append_u32(bytes, bits);
}

std::vector<std::uint8_t> triangle_glb() {
  std::string json = R"({"asset":{"version":"2.0"},"buffers":[{"byteLength":36}],"bufferViews":[{"buffer":0,"byteOffset":0,"byteLength":36,"target":34962}],"accessors":[{"bufferView":0,"componentType":5126,"count":3,"type":"VEC3","min":[0,0,0],"max":[1,1,0]}],"meshes":[{"primitives":[{"attributes":{"POSITION":0}},{"attributes":{"POSITION":0}}]}],"nodes":[{"mesh":0}],"scenes":[{"nodes":[0]}],"scene":0})";
  while (json.size() % 4) json.push_back(' ');
  const std::array<float, 9> positions = {0, 0, 0, 1, 0, 0, 0, 1, 0};
  const std::uint32_t total = 12 + 8 + static_cast<std::uint32_t>(json.size()) + 8 + sizeof(positions);
  std::vector<std::uint8_t> bytes;
  bytes.reserve(total);
  append_u32(bytes, 0x46546C67);
  append_u32(bytes, 2);
  append_u32(bytes, total);
  append_u32(bytes, static_cast<std::uint32_t>(json.size()));
  append_u32(bytes, 0x4E4F534A);
  bytes.insert(bytes.end(), json.begin(), json.end());
  append_u32(bytes, sizeof(positions));
  append_u32(bytes, 0x004E4942);
  const auto* position_bytes = reinterpret_cast<const std::uint8_t*>(positions.data());
  bytes.insert(bytes.end(), position_bytes, position_bytes + sizeof(positions));
  return bytes;
}

std::vector<std::uint8_t> textured_triangle_glb() {
  constexpr std::array<std::uint8_t, 126> png = {
    0x89,0x50,0x4E,0x47,0x0D,0x0A,0x1A,0x0A,0x00,0x00,0x00,0x0D,0x49,0x48,0x44,0x52,
    0x00,0x00,0x00,0x02,0x00,0x00,0x00,0x02,0x08,0x06,0x00,0x00,0x00,0x72,0xB6,0x0D,0x24,
    0x00,0x00,0x00,0x01,0x73,0x52,0x47,0x42,0x00,0xAE,0xCE,0x1C,0xE9,0x00,0x00,0x00,0x04,
    0x67,0x41,0x4D,0x41,0x00,0x00,0xB1,0x8F,0x0B,0xFC,0x61,0x05,0x00,0x00,0x00,0x09,0x70,
    0x48,0x59,0x73,0x00,0x00,0x1D,0x87,0x00,0x00,0x1D,0x87,0x01,0x8F,0xE5,0xF1,0x65,0x00,
    0x00,0x00,0x13,0x49,0x44,0x41,0x54,0x18,0x57,0x63,0xF8,0xCF,0xC0,0xF0,0x1F,0x0C,0x19,
    0x18,0xFE,0x83,0x01,0x00,0x49,0xC8,0x09,0xF7,0x96,0xDE,0x4D,0x2E,0x00,0x00,0x00,0x00,
    0x49,0x45,0x4E,0x44,0xAE,0x42,0x60,0x82
  };
  std::string json = R"({"asset":{"version":"2.0"},"buffers":[{"byteLength":188}],"bufferViews":[{"buffer":0,"byteOffset":0,"byteLength":36,"target":34962},{"buffer":0,"byteOffset":36,"byteLength":24,"target":34962},{"buffer":0,"byteOffset":60,"byteLength":126}],"accessors":[{"bufferView":0,"componentType":5126,"count":3,"type":"VEC3","min":[0,0,0],"max":[1,1,0]},{"bufferView":1,"componentType":5126,"count":3,"type":"VEC2"}],"images":[{"bufferView":2,"mimeType":"image/png"}],"textures":[{"source":0}],"materials":[{"pbrMetallicRoughness":{"baseColorTexture":{"index":0}}}],"meshes":[{"primitives":[{"attributes":{"POSITION":0,"TEXCOORD_0":1},"material":0}]}],"nodes":[{"mesh":0}],"scenes":[{"nodes":[0]}],"scene":0})";
  while (json.size() % 4) json.push_back(' ');
  std::vector<std::uint8_t> binary;
  const std::array<float, 9> positions = {0,0,0, 1,0,0, 0,1,0};
  const std::array<float, 6> uvs = {0,0, 1,0, 0,1};
  for (float value : positions) append_f32(binary, value);
  for (float value : uvs) append_f32(binary, value);
  binary.insert(binary.end(), png.begin(), png.end());
  while (binary.size() % 4) binary.push_back(0);
  const std::uint32_t total = 12 + 8 + static_cast<std::uint32_t>(json.size()) + 8 + static_cast<std::uint32_t>(binary.size());
  std::vector<std::uint8_t> bytes;
  append_u32(bytes, 0x46546C67); append_u32(bytes, 2); append_u32(bytes, total);
  append_u32(bytes, static_cast<std::uint32_t>(json.size())); append_u32(bytes, 0x4E4F534A);
  bytes.insert(bytes.end(), json.begin(), json.end());
  append_u32(bytes, static_cast<std::uint32_t>(binary.size())); append_u32(bytes, 0x004E4942);
  bytes.insert(bytes.end(), binary.begin(), binary.end());
  return bytes;
}

std::vector<std::uint8_t> colored_triangle_glb() {
  std::string json = R"({"asset":{"version":"2.0"},"buffers":[{"byteLength":72}],"bufferViews":[{"buffer":0,"byteOffset":0,"byteLength":36,"target":34962},{"buffer":0,"byteOffset":36,"byteLength":36,"target":34962}],"accessors":[{"bufferView":0,"componentType":5126,"count":3,"type":"VEC3","min":[0,0,0],"max":[1,1,0]},{"bufferView":1,"componentType":5126,"count":3,"type":"VEC3"}],"materials":[{"pbrMetallicRoughness":{"baseColorFactor":[1,1,1,1]}}],"meshes":[{"primitives":[{"attributes":{"POSITION":0,"COLOR_0":1},"material":0}]}],"nodes":[{"mesh":0}],"scenes":[{"nodes":[0]}],"scene":0})";
  while (json.size() % 4) json.push_back(' ');
  const std::array<float, 9> positions = {0,0,0, 1,0,0, 0,1,0};
  const std::array<float, 9> colors = {1,0,0, 1,0,0, 1,0,0};
  constexpr std::uint32_t binary_bytes = sizeof(positions) + sizeof(colors);
  const std::uint32_t total = 12 + 8 + static_cast<std::uint32_t>(json.size()) + 8 + binary_bytes;
  std::vector<std::uint8_t> bytes;
  append_u32(bytes, 0x46546C67); append_u32(bytes, 2); append_u32(bytes, total);
  append_u32(bytes, static_cast<std::uint32_t>(json.size())); append_u32(bytes, 0x4E4F534A);
  bytes.insert(bytes.end(), json.begin(), json.end());
  append_u32(bytes, binary_bytes); append_u32(bytes, 0x004E4942);
  for (float value : positions) append_f32(bytes, value);
  for (float value : colors) append_f32(bytes, value);
  return bytes;
}

std::vector<std::uint8_t> high_triangle_count_glb() {
  constexpr std::uint32_t triangle_count = 1'500'001;
  constexpr std::uint32_t index_count = triangle_count * 3;
  constexpr std::uint32_t index_bytes = index_count * sizeof(std::uint32_t);
  constexpr std::uint32_t binary_bytes = 36 + index_bytes;
  std::string json =
      "{\"asset\":{\"version\":\"2.0\"},\"buffers\":[{\"byteLength\":" + std::to_string(binary_bytes) +
      "}],\"bufferViews\":[{\"buffer\":0,\"byteOffset\":0,\"byteLength\":36,\"target\":34962},"
      "{\"buffer\":0,\"byteOffset\":36,\"byteLength\":" + std::to_string(index_bytes) +
      ",\"target\":34963}],\"accessors\":[{\"bufferView\":0,\"componentType\":5126,\"count\":3,"
      "\"type\":\"VEC3\",\"min\":[0,0,0],\"max\":[1,1,0]},{\"bufferView\":1,\"componentType\":5125,"
      "\"count\":" + std::to_string(index_count) + ",\"type\":\"SCALAR\"}],\"meshes\":[{\"primitives\":[{"
      "\"attributes\":{\"POSITION\":0},\"indices\":1}]}],\"nodes\":[{\"mesh\":0}],\"scenes\":[{\"nodes\":[0]}],\"scene\":0}";
  while (json.size() % 4) json.push_back(' ');
  const std::uint32_t total = 12 + 8 + static_cast<std::uint32_t>(json.size()) + 8 + binary_bytes;
  std::vector<std::uint8_t> bytes;
  bytes.reserve(total);
  append_u32(bytes, 0x46546C67); append_u32(bytes, 2); append_u32(bytes, total);
  append_u32(bytes, static_cast<std::uint32_t>(json.size())); append_u32(bytes, 0x4E4F534A);
  bytes.insert(bytes.end(), json.begin(), json.end());
  append_u32(bytes, binary_bytes); append_u32(bytes, 0x004E4942);
  const std::array<float, 9> positions = {0,0,0, 1,0,0, 0,1,0};
  for (float value : positions) append_f32(bytes, value);
  for (std::uint32_t triangle = 0; triangle < triangle_count; ++triangle) {
    append_u32(bytes, 0);
    append_u32(bytes, triangle == 1 ? 1 : 0);
    append_u32(bytes, triangle == 1 ? 2 : 0);
  }
  return bytes;
}

std::vector<std::uint8_t> triangle_binary_stl() {
  std::vector<std::uint8_t> bytes(80, 0);
  append_u32(bytes, 1);
  for (int component = 0; component < 3; ++component) append_f32(bytes, component == 2 ? 1.0F : 0.0F);
  const std::array<float, 9> positions = {0, 0, 0, 1, 0, 0, 0, 1, 0};
  for (float value : positions) append_f32(bytes, value);
  bytes.push_back(0);
  bytes.push_back(0);
  return bytes;
}

std::vector<std::uint8_t> triangle_binary_ply() {
  const std::string header =
      "ply\nformat binary_little_endian 1.0\nelement vertex 3\nproperty float x\nproperty float y\n"
      "property float z\nproperty uchar red\nproperty uchar green\nproperty uchar blue\nelement face 1\n"
      "property list uchar int vertex_indices\nend_header\n";
  std::vector<std::uint8_t> bytes(header.begin(), header.end());
  const std::array<float, 9> positions = {0, 0, 0, 1, 0, 0, 0, 1, 0};
  for (std::size_t vertex = 0; vertex < 3; ++vertex) {
    for (int component = 0; component < 3; ++component) append_f32(bytes, positions[vertex * 3 + component]);
    bytes.push_back(vertex == 0 ? 255 : 0);
    bytes.push_back(vertex == 1 ? 255 : 0);
    bytes.push_back(vertex == 2 ? 255 : 0);
  }
  bytes.push_back(3);
  append_u32(bytes, 0); append_u32(bytes, 1); append_u32(bytes, 2);
  return bytes;
}

}  // namespace

int main() {
  const HRESULT initialized = CoInitializeEx(nullptr, COINIT_MULTITHREADED);
  if (FAILED(initialized) && initialized != RPC_E_CHANGED_MODE) return 15;
  kea3d::Thumbnail output;
  std::array<std::uint8_t, 20> invalid{};
  if (kea3d::render_glb_thumbnail(nullptr, 20, 256, output)) return 1;
  if (kea3d::render_glb_thumbnail(invalid.data(), invalid.size(), 256, output)) return 2;
  if (kea3d::render_glb_thumbnail(invalid.data(), 193ULL * 1024ULL * 1024ULL, 256, output)) return 3;
  if (kea3d::render_glb_thumbnail(invalid.data(), invalid.size(), 4096, output)) return 4;
  auto valid = triangle_glb();
  if (!kea3d::render_glb_thumbnail(valid.data(), valid.size(), 128, output)) return 5;
  if (output.width != 128 || output.height != 128 || output.bgra.size() != 128 * 128 * 4) return 6;
  auto binary_stl = triangle_binary_stl();
  if (!kea3d::render_stl_thumbnail(binary_stl.data(), binary_stl.size(), 128, output)) return 7;
  const std::string ascii_stl =
      "solid triangle\nfacet normal 0 0 1\nouter loop\nvertex 0 0 0\nvertex 1 0 0\nvertex 0 1 0\n"
      "endloop\nendfacet\nendsolid triangle\n";
  if (!kea3d::render_stl_thumbnail(reinterpret_cast<const std::uint8_t*>(ascii_stl.data()),
                                   ascii_stl.size(), 128, output)) return 8;
  binary_stl.pop_back();
  if (kea3d::render_stl_thumbnail(binary_stl.data(), binary_stl.size(), 128, output)) return 9;
  if (!kea3d::render_model_thumbnail(valid.data(), valid.size(), 128, output)) return 10;
  const std::string ascii_ply =
      "ply\nformat ascii 1.0\nelement vertex 4\nproperty float x\nproperty float y\nproperty float z\n"
      "property uchar red\nproperty uchar green\nproperty uchar blue\nelement face 1\n"
      "property list uchar int vertex_indices\nend_header\n"
      "0 0 0 255 0 0\n1 0 0 0 255 0\n1 1 0 0 0 255\n0 1 0 255 255 0\n4 0 1 2 3\n";
  if (!kea3d::render_ply_thumbnail(reinterpret_cast<const std::uint8_t*>(ascii_ply.data()), ascii_ply.size(), 128, output)) return 11;
  auto binary_ply = triangle_binary_ply();
  if (!kea3d::render_model_thumbnail(binary_ply.data(), binary_ply.size(), 128, output)) return 12;
  binary_ply.pop_back();
  if (kea3d::render_ply_thumbnail(binary_ply.data(), binary_ply.size(), 128, output)) return 13;
  const std::string big_endian = "ply\nformat binary_big_endian 1.0\nelement vertex 3\nelement face 1\nend_header\n";
  if (kea3d::render_ply_thumbnail(reinterpret_cast<const std::uint8_t*>(big_endian.data()), big_endian.size(), 128, output)) return 14;
  auto textured = textured_triangle_glb();
  if (!kea3d::render_glb_thumbnail(textured.data(), textured.size(), 128, output)) return 16;
  bool found_color = false;
  for (std::size_t index = 0; index + 3 < output.bgra.size(); index += 4) {
    if (output.bgra[index + 3] == 0) continue;
    const auto minimum = std::min({output.bgra[index], output.bgra[index + 1], output.bgra[index + 2]});
    const auto maximum = std::max({output.bgra[index], output.bgra[index + 1], output.bgra[index + 2]});
    if (maximum - minimum > 40) { found_color = true; break; }
  }
  if (!found_color) return 17;
  auto dense = high_triangle_count_glb();
  if (!kea3d::render_glb_thumbnail(dense.data(), dense.size(), 64, output)) return 18;
  auto colored = colored_triangle_glb();
  if (!kea3d::render_glb_thumbnail(colored.data(), colored.size(), 64, output)) return 19;
  bool found_red = false;
  for (std::size_t index = 0; index + 3 < output.bgra.size(); index += 4) {
    if (output.bgra[index + 3] != 0 && output.bgra[index + 2] > output.bgra[index + 1] + 40 &&
        output.bgra[index + 2] > output.bgra[index] + 40) {
      found_red = true;
      break;
    }
  }
  if (!found_red) return 20;
  const kea3d::CadThumbnailTriangle cad_triangle{
    {0, 0, 0, 1, 0, 0, 0, 1, 0}, {0.1F, 0.7F, 0.2F, 1.0F}
  };
  if (!kea3d::render_cad_thumbnail(&cad_triangle, 1, 96, output) ||
      output.width != 96 || output.height != 96) return 21;
  return 0;
}
