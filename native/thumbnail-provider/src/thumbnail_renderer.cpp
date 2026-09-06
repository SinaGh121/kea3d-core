#define CGLTF_IMPLEMENTATION
#include <cgltf.h>

#include <windows.h>
#include <wincodec.h>

#include "thumbnail_renderer.h"

#include <algorithm>
#include <array>
#include <chrono>
#include <charconv>
#include <cctype>
#include <cmath>
#include <cstring>
#include <limits>
#include <optional>
#include <string>
#include <string_view>
#include <unordered_map>
#include <unordered_set>

namespace kea3d {
namespace {

constexpr std::size_t kMaximumInputBytes = 192ULL * 1024ULL * 1024ULL;
constexpr std::size_t kMaximumInspectedVertices = 5'000'000;
constexpr std::size_t kMaximumRenderedTriangles = 1'500'000;
constexpr std::size_t kMaximumGlbTriangles = 6'000'000;
constexpr std::size_t kMaximumEncodedTextureBytes = 32ULL * 1024ULL * 1024ULL;
constexpr std::size_t kMaximumDecodedTextureBytes = 64ULL * 1024ULL * 1024ULL;
constexpr auto kRenderBudget = std::chrono::milliseconds(1800);

struct Budget {
  std::chrono::steady_clock::time_point deadline = std::chrono::steady_clock::now() + kRenderBudget;
  bool expired() const { return std::chrono::steady_clock::now() >= deadline; }
};

struct Vec3 { float x, y, z; };
struct Vec2 { float x, y; };
struct ScreenVertex { float x, y, depth; };
struct Triangle { Vec3 vertices[3]; };
struct ColoredTriangle {
  Triangle geometry;
  std::array<float, 4> color = {0.34F, 0.68F, 0.72F, 1.0F};
};
struct Bounds {
  float min_x = std::numeric_limits<float>::max();
  float min_y = std::numeric_limits<float>::max();
  float max_x = std::numeric_limits<float>::lowest();
  float max_y = std::numeric_limits<float>::lowest();
  bool valid = false;
};

Vec3 transform_point(const cgltf_float matrix[16], const Vec3& point) {
  return {
    matrix[0] * point.x + matrix[4] * point.y + matrix[8] * point.z + matrix[12],
    matrix[1] * point.x + matrix[5] * point.y + matrix[9] * point.z + matrix[13],
    matrix[2] * point.x + matrix[6] * point.y + matrix[10] * point.z + matrix[14],
  };
}

Vec3 subtract(const Vec3& a, const Vec3& b) { return {a.x - b.x, a.y - b.y, a.z - b.z}; }
Vec3 cross(const Vec3& a, const Vec3& b) {
  return {a.y * b.z - a.z * b.y, a.z * b.x - a.x * b.z, a.x * b.y - a.y * b.x};
}
float dot(const Vec3& a, const Vec3& b) { return a.x * b.x + a.y * b.y + a.z * b.z; }
Vec3 normalize(const Vec3& value) {
  const float length = std::sqrt(std::max(dot(value, value), 1.0e-20F));
  return {value.x / length, value.y / length, value.z / length};
}

// Keep Explorer thumbnails aligned with the viewer's approved default isometric
// direction: normalize(-1, 0.72, 1). The basis uses the same world-up rule as
// Viewer.frameDirection(), so a file opens from the side shown in Explorer.
constexpr Vec3 kCameraRight = {0.70710678F, 0.0F, 0.70710678F};
constexpr Vec3 kCameraUp = {0.32081535F, 0.89115381F, -0.32081535F};
constexpr Vec3 kCameraForward = {-0.63014090F, 0.45370144F, 0.63014090F};

std::array<float, 3> project(const Vec3& point) {
  return {dot(point, kCameraRight), dot(point, kCameraUp), dot(point, kCameraForward)};
}

const cgltf_accessor* find_position(const cgltf_primitive& primitive) {
  for (cgltf_size i = 0; i < primitive.attributes_count; ++i) {
    if (primitive.attributes[i].type == cgltf_attribute_type_position) return primitive.attributes[i].data;
  }
  return nullptr;
}

const cgltf_accessor* find_texcoord(const cgltf_primitive& primitive, cgltf_int set) {
  for (cgltf_size i = 0; i < primitive.attributes_count; ++i) {
    if (primitive.attributes[i].type == cgltf_attribute_type_texcoord && primitive.attributes[i].index == set) {
      return primitive.attributes[i].data;
    }
  }
  return nullptr;
}

const cgltf_accessor* find_color(const cgltf_primitive& primitive) {
  for (cgltf_size i = 0; i < primitive.attributes_count; ++i) {
    if (primitive.attributes[i].type == cgltf_attribute_type_color && primitive.attributes[i].index == 0) {
      return primitive.attributes[i].data;
    }
  }
  return nullptr;
}

bool read_point(const cgltf_accessor* accessor, cgltf_size index, const cgltf_float matrix[16], Vec3& point) {
  float values[3]{};
  if (!cgltf_accessor_read_float(accessor, index, values, 3)) return false;
  point = transform_point(matrix, {values[0], values[1], values[2]});
  return std::isfinite(point.x) && std::isfinite(point.y) && std::isfinite(point.z);
}

bool read_uv(const cgltf_accessor* accessor, cgltf_size index, Vec2& uv) {
  float values[2]{};
  if (!accessor || !cgltf_accessor_read_float(accessor, index, values, 2) ||
      !std::isfinite(values[0]) || !std::isfinite(values[1])) return false;
  uv = {values[0], values[1]};
  return true;
}

bool read_color(const cgltf_accessor* accessor, cgltf_size index, std::array<float, 4>& color) {
  if (!accessor || (accessor->type != cgltf_type_vec3 && accessor->type != cgltf_type_vec4)) return false;
  float values[4] = {1, 1, 1, 1};
  if (!cgltf_accessor_read_float(accessor, index, values, 4)) return false;
  for (int channel = 0; channel < 4; ++channel) {
    if (!std::isfinite(values[channel])) return false;
    color[channel] = std::clamp(values[channel], 0.0F, 1.0F);
  }
  return true;
}

std::array<float, 4> material_color(const cgltf_primitive& primitive) {
  if (!primitive.material || !primitive.material->has_pbr_metallic_roughness) return {0.25F, 0.66F, 0.72F, 1.0F};
  const auto& factor = primitive.material->pbr_metallic_roughness.base_color_factor;
  return {factor[0], factor[1], factor[2],
          primitive.material->alpha_mode == cgltf_alpha_mode_opaque ? 1.0F : factor[3]};
}

float edge_function(const ScreenVertex& a, const ScreenVertex& b, float x, float y) {
  return (x - a.x) * (b.y - a.y) - (y - a.y) * (b.x - a.x);
}

void include_in_bounds(const Vec3& point, Bounds& bounds) {
  const auto projected = project(point);
  bounds.min_x = std::min(bounds.min_x, projected[0]);
  bounds.max_x = std::max(bounds.max_x, projected[0]);
  bounds.min_y = std::min(bounds.min_y, projected[1]);
  bounds.max_y = std::max(bounds.max_y, projected[1]);
  bounds.valid = true;
}

ScreenVertex to_screen(const Vec3& point, float center_x, float center_y, float scale, unsigned edge) {
  const auto value = project(point);
  return {
    (value[0] - center_x) * scale + static_cast<float>(edge) * 0.5F,
    static_cast<float>(edge) * 0.5F - (value[1] - center_y) * scale,
    value[2],
  };
}

bool prepare_output(const Bounds& bounds, unsigned edge, Thumbnail& output, std::vector<float>& depth_buffer,
                    float& center_x, float& center_y, float& scale) {
  if (!bounds.valid) return false;
  output = {edge, edge, std::vector<std::uint8_t>(static_cast<std::size_t>(edge) * edge * 4, 0)};
  depth_buffer.assign(static_cast<std::size_t>(edge) * edge, std::numeric_limits<float>::lowest());
  const float extent_x = std::max(bounds.max_x - bounds.min_x, 1.0e-6F);
  const float extent_y = std::max(bounds.max_y - bounds.min_y, 1.0e-6F);
  scale = 0.82F * static_cast<float>(edge) / std::max(extent_x, extent_y);
  center_x = (bounds.min_x + bounds.max_x) * 0.5F;
  center_y = (bounds.min_y + bounds.max_y) * 0.5F;
  return std::isfinite(scale) && scale > 0;
}

bool has_visible_pixels(const Thumbnail& output) {
  for (std::size_t index = 3; index < output.bgra.size(); index += 4) {
    if (output.bgra[index] != 0) return true;
  }
  return false;
}

std::uint32_t read_u32_le(const std::uint8_t* bytes) {
  return static_cast<std::uint32_t>(bytes[0]) |
         (static_cast<std::uint32_t>(bytes[1]) << 8) |
         (static_cast<std::uint32_t>(bytes[2]) << 16) |
         (static_cast<std::uint32_t>(bytes[3]) << 24);
}

bool read_f32_le(const std::uint8_t* bytes, float& value) {
  const std::uint32_t bits = read_u32_le(bytes);
  std::memcpy(&value, &bits, sizeof(value));
  return std::isfinite(value);
}

bool read_binary_stl_triangle(const std::uint8_t* bytes, std::size_t index, Triangle& triangle) {
  const std::uint8_t* record = bytes + 84 + index * 50 + 12;
  for (int vertex = 0; vertex < 3; ++vertex) {
    float values[3]{};
    for (int component = 0; component < 3; ++component) {
      if (!read_f32_le(record + vertex * 12 + component * 4, values[component])) return false;
    }
    triangle.vertices[vertex] = {values[0], values[2], -values[1]};
  }
  return true;
}

bool parse_ascii_stl(const std::uint8_t* bytes, std::size_t size, const Budget& budget,
                     std::vector<Triangle>& triangles, Bounds& bounds) {
  const char* cursor = reinterpret_cast<const char*>(bytes);
  const char* end = cursor + size;
  std::vector<Vec3> vertices;
  vertices.reserve(std::min<std::size_t>(size / 24, kMaximumInspectedVertices));
  while (cursor < end) {
    const char* token = std::search(cursor, end, "vertex", "vertex" + 6);
    if (token == end) break;
    cursor = token + 6;
    if (!vertices.empty() && (vertices.size() & 8191) == 0 && budget.expired()) return false;
    float values[3]{};
    for (float& value : values) {
      while (cursor < end && (*cursor == ' ' || *cursor == '\t' || *cursor == '\r' || *cursor == '\n')) ++cursor;
      const auto result = std::from_chars(cursor, end, value, std::chars_format::general);
      if (result.ec != std::errc{} || !std::isfinite(value)) return false;
      cursor = result.ptr;
    }
    vertices.push_back({values[0], values[2], -values[1]});
    if (vertices.size() > kMaximumInspectedVertices) return false;
  }
  if (vertices.empty() || vertices.size() % 3 != 0 || vertices.size() / 3 > kMaximumRenderedTriangles) return false;
  triangles.resize(vertices.size() / 3);
  for (std::size_t index = 0; index < vertices.size(); ++index) {
    triangles[index / 3].vertices[index % 3] = vertices[index];
    include_in_bounds(vertices[index], bounds);
  }
  return true;
}

enum class PlyScalar { invalid, i8, u8, i16, u16, i32, u32, f32, f64 };
struct PlyProperty {
  bool list = false;
  PlyScalar count_type = PlyScalar::invalid;
  PlyScalar value_type = PlyScalar::invalid;
  std::string name;
};
struct PlyHeader {
  bool binary = false;
  std::size_t data_offset = 0;
  std::size_t vertex_count = 0;
  std::size_t face_count = 0;
  std::vector<PlyProperty> vertex_properties;
  std::vector<PlyProperty> face_properties;
};
struct PlyVertex {
  Vec3 point{};
  std::array<float, 4> color = {0.34F, 0.68F, 0.72F, 1.0F};
};

struct TextureImage {
  unsigned width = 0;
  unsigned height = 0;
  cgltf_wrap_mode wrap_s = cgltf_wrap_mode_repeat;
  cgltf_wrap_mode wrap_t = cgltf_wrap_mode_repeat;
  std::vector<std::uint8_t> rgba;
};

bool embedded_image_bytes(const cgltf_image& image, const std::uint8_t*& bytes, std::size_t& size) {
  if (!image.buffer_view || !image.buffer_view->buffer || !image.buffer_view->buffer->data) return false;
  const auto& view = *image.buffer_view;
  if (view.offset > view.buffer->size || view.size > view.buffer->size - view.offset ||
      view.size == 0 || view.size > kMaximumEncodedTextureBytes) return false;
  const auto* buffer = static_cast<const std::uint8_t*>(view.buffer->data);
  bytes = buffer + view.offset;
  size = view.size;
  const bool png = size >= 8 && std::memcmp(bytes, "\x89PNG\r\n\x1a\n", 8) == 0;
  const bool jpeg = size >= 3 && bytes[0] == 0xFF && bytes[1] == 0xD8 && bytes[2] == 0xFF;
  if (image.mime_type && std::strcmp(image.mime_type, "image/png") != 0 &&
      std::strcmp(image.mime_type, "image/jpeg") != 0) return false;
  return png || jpeg;
}

bool decode_wic_texture(const cgltf_image& image, TextureImage& output, std::size_t& decoded_bytes,
                        const Budget& budget) {
  const std::uint8_t* encoded = nullptr;
  std::size_t encoded_size = 0;
  if (!embedded_image_bytes(image, encoded, encoded_size) || encoded_size > std::numeric_limits<DWORD>::max() ||
      budget.expired()) return false;
  IWICImagingFactory* factory = nullptr;
  IWICStream* stream = nullptr;
  IWICBitmapDecoder* decoder = nullptr;
  IWICBitmapFrameDecode* frame = nullptr;
  IWICFormatConverter* converter = nullptr;
  const auto release = [&]() {
    if (converter) converter->Release();
    if (frame) frame->Release();
    if (decoder) decoder->Release();
    if (stream) stream->Release();
    if (factory) factory->Release();
  };
  HRESULT result = CoCreateInstance(CLSID_WICImagingFactory, nullptr, CLSCTX_INPROC_SERVER,
                                    IID_PPV_ARGS(&factory));
  if (SUCCEEDED(result)) result = factory->CreateStream(&stream);
  if (SUCCEEDED(result)) {
    result = stream->InitializeFromMemory(const_cast<BYTE*>(encoded), static_cast<DWORD>(encoded_size));
  }
  if (SUCCEEDED(result)) {
    result = factory->CreateDecoderFromStream(stream, nullptr, WICDecodeMetadataCacheOnLoad, &decoder);
  }
  if (SUCCEEDED(result)) result = decoder->GetFrame(0, &frame);
  UINT width = 0, height = 0;
  if (SUCCEEDED(result)) result = frame->GetSize(&width, &height);
  constexpr std::uint64_t kMaximumTexturePixels = kMaximumDecodedTextureBytes / 4;
  const std::uint64_t pixels = static_cast<std::uint64_t>(width) * height;
  if (SUCCEEDED(result) && (width == 0 || height == 0 || width > 4096 || height > 4096 ||
                            pixels > kMaximumTexturePixels || pixels * 4 > kMaximumDecodedTextureBytes - decoded_bytes)) {
    result = E_OUTOFMEMORY;
  }
  if (SUCCEEDED(result)) result = factory->CreateFormatConverter(&converter);
  if (SUCCEEDED(result)) {
    result = converter->Initialize(frame, GUID_WICPixelFormat32bppRGBA, WICBitmapDitherTypeNone,
                                   nullptr, 0.0, WICBitmapPaletteTypeCustom);
  }
  if (SUCCEEDED(result) && !budget.expired()) {
    output.width = width;
    output.height = height;
    output.rgba.resize(static_cast<std::size_t>(pixels) * 4);
    result = converter->CopyPixels(nullptr, width * 4, static_cast<UINT>(output.rgba.size()), output.rgba.data());
  }
  release();
  if (FAILED(result) || output.rgba.empty() || budget.expired()) {
    output = {};
    return false;
  }
  decoded_bytes += output.rgba.size();
  return true;
}

float wrap_coordinate(float value, cgltf_wrap_mode mode) {
  if (mode == cgltf_wrap_mode_clamp_to_edge) return std::clamp(value, 0.0F, 1.0F);
  if (mode == cgltf_wrap_mode_mirrored_repeat) {
    float period = std::fmod(value, 2.0F);
    if (period < 0.0F) period += 2.0F;
    return period <= 1.0F ? period : 2.0F - period;
  }
  return value - std::floor(value);
}

std::array<float, 4> sample_texture(const TextureImage& texture, float u, float v) {
  u = wrap_coordinate(u, texture.wrap_s);
  v = wrap_coordinate(v, texture.wrap_t);
  const float x = u * static_cast<float>(texture.width - 1);
  const float y = v * static_cast<float>(texture.height - 1);
  const unsigned x0 = static_cast<unsigned>(std::floor(x));
  const unsigned y0 = static_cast<unsigned>(std::floor(y));
  const unsigned x1 = std::min(x0 + 1, texture.width - 1);
  const unsigned y1 = std::min(y0 + 1, texture.height - 1);
  const float tx = x - x0;
  const float ty = y - y0;
  std::array<float, 4> result{};
  for (int channel = 0; channel < 4; ++channel) {
    const auto value = [&](unsigned px, unsigned py) {
      return texture.rgba[(static_cast<std::size_t>(py) * texture.width + px) * 4 + channel] / 255.0F;
    };
    const float top = value(x0, y0) * (1.0F - tx) + value(x1, y0) * tx;
    const float bottom = value(x0, y1) * (1.0F - tx) + value(x1, y1) * tx;
    result[channel] = top * (1.0F - ty) + bottom * ty;
  }
  return result;
}

Vec2 transform_uv(Vec2 uv, const cgltf_texture_view& view) {
  if (!view.has_transform) return uv;
  const auto& transform = view.transform;
  const float x = uv.x * transform.scale[0];
  const float y = uv.y * transform.scale[1];
  const float cosine = std::cos(transform.rotation);
  const float sine = std::sin(transform.rotation);
  return {
    transform.offset[0] + cosine * x - sine * y,
    transform.offset[1] + sine * x + cosine * y,
  };
}

PlyScalar ply_scalar(std::string_view name) {
  if (name == "char" || name == "int8") return PlyScalar::i8;
  if (name == "uchar" || name == "uint8") return PlyScalar::u8;
  if (name == "short" || name == "int16") return PlyScalar::i16;
  if (name == "ushort" || name == "uint16") return PlyScalar::u16;
  if (name == "int" || name == "int32") return PlyScalar::i32;
  if (name == "uint" || name == "uint32") return PlyScalar::u32;
  if (name == "float" || name == "float32") return PlyScalar::f32;
  if (name == "double" || name == "float64") return PlyScalar::f64;
  return PlyScalar::invalid;
}

bool next_word(std::string_view line, std::size_t& offset, std::string_view& word) {
  while (offset < line.size() && (line[offset] == ' ' || line[offset] == '\t' || line[offset] == '\r')) ++offset;
  const std::size_t start = offset;
  while (offset < line.size() && line[offset] != ' ' && line[offset] != '\t' && line[offset] != '\r') ++offset;
  word = line.substr(start, offset - start);
  return !word.empty();
}

bool parse_size(std::string_view word, std::size_t& value) {
  const auto result = std::from_chars(word.data(), word.data() + word.size(), value);
  return result.ec == std::errc{} && result.ptr == word.data() + word.size();
}

bool parse_ply_header(const std::uint8_t* bytes, std::size_t size, PlyHeader& header) {
  constexpr std::size_t kMaximumHeaderBytes = 1024 * 1024;
  if (size < 16 || std::memcmp(bytes, "ply", 3) != 0 || (bytes[3] != '\n' && bytes[3] != '\r')) return false;
  const std::string_view text(reinterpret_cast<const char*>(bytes), std::min(size, kMaximumHeaderBytes));
  std::size_t cursor = 0;
  std::string current_element;
  bool format_seen = false;
  bool vertex_seen = false;
  bool face_seen = false;
  while (cursor < text.size()) {
    const std::size_t line_end = text.find('\n', cursor);
    if (line_end == std::string_view::npos) return false;
    std::string_view line = text.substr(cursor, line_end - cursor);
    cursor = line_end + 1;
    if (!line.empty() && line.back() == '\r') line.remove_suffix(1);
    std::size_t offset = 0;
    std::string_view command;
    if (!next_word(line, offset, command)) continue;
    if (command == "format") {
      std::string_view format, version;
      if (!next_word(line, offset, format) || !next_word(line, offset, version) || version != "1.0") return false;
      if (format == "ascii") header.binary = false;
      else if (format == "binary_little_endian") header.binary = true;
      else return false;
      format_seen = true;
    } else if (command == "element") {
      std::string_view name, count;
      std::size_t parsed_count = 0;
      if (!next_word(line, offset, name) || !next_word(line, offset, count) || !parse_size(count, parsed_count)) return false;
      current_element.assign(name);
      if (name == "vertex") {
        if (vertex_seen || face_seen) return false;
        vertex_seen = true;
        header.vertex_count = parsed_count;
      } else if (name == "face") {
        if (!vertex_seen || face_seen) return false;
        face_seen = true;
        header.face_count = parsed_count;
      } else if (parsed_count > 0 && !face_seen) {
        return false;
      }
    } else if (command == "property" && (current_element == "vertex" || current_element == "face")) {
      std::string_view first;
      if (!next_word(line, offset, first)) return false;
      PlyProperty property;
      if (first == "list") {
        std::string_view count_type, value_type, name;
        if (!next_word(line, offset, count_type) || !next_word(line, offset, value_type) || !next_word(line, offset, name)) return false;
        property.list = true;
        property.count_type = ply_scalar(count_type);
        property.value_type = ply_scalar(value_type);
        property.name.assign(name);
      } else {
        std::string_view name;
        property.value_type = ply_scalar(first);
        if (!next_word(line, offset, name)) return false;
        property.name.assign(name);
      }
      if (property.value_type == PlyScalar::invalid || (property.list && property.count_type == PlyScalar::invalid)) return false;
      (current_element == "vertex" ? header.vertex_properties : header.face_properties).push_back(std::move(property));
    } else if (command == "end_header") {
      header.data_offset = cursor;
      break;
    }
  }
  if (!format_seen || !header.data_offset || header.vertex_count == 0 || header.vertex_count > kMaximumInspectedVertices ||
      header.face_count == 0 || header.face_count > kMaximumRenderedTriangles || header.vertex_properties.empty() ||
      header.face_properties.empty()) return false;
  bool x = false, y = false, z = false, indices = false;
  for (const auto& property : header.vertex_properties) {
    if (property.list) return false;
    x = x || property.name == "x"; y = y || property.name == "y"; z = z || property.name == "z";
  }
  for (const auto& property : header.face_properties) {
    indices = indices || (property.list && (property.name == "vertex_indices" || property.name == "vertex_index"));
  }
  return x && y && z && indices;
}

bool ascii_number(const char*& cursor, const char* end, double& value) {
  while (cursor < end && std::isspace(static_cast<unsigned char>(*cursor))) ++cursor;
  if (cursor == end) return false;
  const auto result = std::from_chars(cursor, end, value, std::chars_format::general);
  if (result.ec != std::errc{} || result.ptr == cursor || !std::isfinite(value)) return false;
  cursor = result.ptr;
  return true;
}

std::size_t scalar_size(PlyScalar type) {
  switch (type) {
    case PlyScalar::i8: case PlyScalar::u8: return 1;
    case PlyScalar::i16: case PlyScalar::u16: return 2;
    case PlyScalar::i32: case PlyScalar::u32: case PlyScalar::f32: return 4;
    case PlyScalar::f64: return 8;
    default: return 0;
  }
}

template <typename T>
T read_pod(const std::uint8_t* bytes) { T value{}; std::memcpy(&value, bytes, sizeof(T)); return value; }

bool binary_number(const std::uint8_t*& cursor, const std::uint8_t* end, PlyScalar type, double& value) {
  const std::size_t width = scalar_size(type);
  if (!width || static_cast<std::size_t>(end - cursor) < width) return false;
  switch (type) {
    case PlyScalar::i8: value = read_pod<std::int8_t>(cursor); break;
    case PlyScalar::u8: value = read_pod<std::uint8_t>(cursor); break;
    case PlyScalar::i16: value = read_pod<std::int16_t>(cursor); break;
    case PlyScalar::u16: value = read_pod<std::uint16_t>(cursor); break;
    case PlyScalar::i32: value = read_pod<std::int32_t>(cursor); break;
    case PlyScalar::u32: value = read_pod<std::uint32_t>(cursor); break;
    case PlyScalar::f32: value = read_pod<float>(cursor); break;
    case PlyScalar::f64: value = read_pod<double>(cursor); break;
    default: return false;
  }
  cursor += width;
  return std::isfinite(value);
}

float ply_color(double value, PlyScalar type) {
  double divisor = 1.0;
  if (type == PlyScalar::u8 || type == PlyScalar::i8) divisor = 255.0;
  else if (type == PlyScalar::u16 || type == PlyScalar::i16) divisor = 65535.0;
  else if (value > 1.0) divisor = 255.0;
  return static_cast<float>(std::clamp(value / divisor, 0.0, 1.0));
}

bool render_ply_data(const std::uint8_t* bytes, std::size_t size, const PlyHeader& header, const Budget& budget,
                     std::vector<ColoredTriangle>& triangles, Bounds& bounds) {
  std::vector<PlyVertex> vertices(header.vertex_count);
  const char* ascii_cursor = reinterpret_cast<const char*>(bytes + header.data_offset);
  const char* ascii_end = reinterpret_cast<const char*>(bytes + size);
  const std::uint8_t* binary_cursor = bytes + header.data_offset;
  const std::uint8_t* binary_end = bytes + size;
  auto read = [&](PlyScalar type, double& value) {
    return header.binary ? binary_number(binary_cursor, binary_end, type, value) : ascii_number(ascii_cursor, ascii_end, value);
  };
  for (std::size_t vertex_index = 0; vertex_index < header.vertex_count; ++vertex_index) {
    if ((vertex_index & 8191) == 0 && budget.expired()) return false;
    auto& vertex = vertices[vertex_index];
    for (const auto& property : header.vertex_properties) {
      double value = 0;
      if (!read(property.value_type, value)) return false;
      if (property.name == "x") vertex.point.x = static_cast<float>(value);
      else if (property.name == "y") vertex.point.y = static_cast<float>(value);
      else if (property.name == "z") vertex.point.z = static_cast<float>(value);
      else if (property.name == "red" || property.name == "r") vertex.color[0] = ply_color(value, property.value_type);
      else if (property.name == "green" || property.name == "g") vertex.color[1] = ply_color(value, property.value_type);
      else if (property.name == "blue" || property.name == "b") vertex.color[2] = ply_color(value, property.value_type);
      else if (property.name == "alpha" || property.name == "a") vertex.color[3] = ply_color(value, property.value_type);
    }
    if (!std::isfinite(vertex.point.x) || !std::isfinite(vertex.point.y) || !std::isfinite(vertex.point.z)) return false;
    include_in_bounds(vertex.point, bounds);
  }
  std::vector<std::size_t> face_indices;
  for (std::size_t face_index = 0; face_index < header.face_count; ++face_index) {
    if ((face_index & 8191) == 0 && budget.expired()) return false;
    face_indices.clear();
    for (const auto& property : header.face_properties) {
      if (!property.list) { double ignored = 0; if (!read(property.value_type, ignored)) return false; continue; }
      double raw_count = 0;
      if (!read(property.count_type, raw_count) || raw_count < 0 || raw_count > 1'000'000 || std::floor(raw_count) != raw_count) return false;
      const std::size_t count = static_cast<std::size_t>(raw_count);
      const bool is_indices = property.name == "vertex_indices" || property.name == "vertex_index";
      if (is_indices) face_indices.reserve(count);
      for (std::size_t index = 0; index < count; ++index) {
        double raw_value = 0;
        if (!read(property.value_type, raw_value) || raw_value < 0 || std::floor(raw_value) != raw_value) return false;
        if (is_indices) {
          if (raw_value >= static_cast<double>(vertices.size())) return false;
          const auto vertex_index = static_cast<std::size_t>(raw_value);
          face_indices.push_back(vertex_index);
        }
      }
    }
    if (face_indices.size() < 3 || face_indices.size() - 2 > kMaximumRenderedTriangles - triangles.size()) return false;
    for (std::size_t corner = 1; corner + 1 < face_indices.size(); ++corner) {
      const std::array<std::size_t, 3> ids = {face_indices[0], face_indices[corner], face_indices[corner + 1]};
      ColoredTriangle triangle;
      triangle.color = {0, 0, 0, 0};
      for (int i = 0; i < 3; ++i) {
        triangle.geometry.vertices[i] = vertices[ids[i]].point;
        for (int channel = 0; channel < 4; ++channel) triangle.color[channel] += vertices[ids[i]].color[channel] / 3.0F;
      }
      triangles.push_back(triangle);
    }
  }
  return !triangles.empty();
}

bool rasterize(
    const ScreenVertex& a, const ScreenVertex& b, const ScreenVertex& c,
    const Vec3& world_a, const Vec3& world_b, const Vec3& world_c,
    const std::array<float, 4>& base, Thumbnail& output, std::vector<float>& depth_buffer,
    const Budget& budget, const TextureImage* texture = nullptr,
    const std::array<Vec2, 3>* texture_uvs = nullptr,
    const std::array<std::array<float, 4>, 3>* vertex_colors = nullptr,
    bool use_alpha = false) {
  const float area = edge_function(a, b, c.x, c.y);
  if (std::abs(area) < 0.0001F) return true;
  const int min_x = std::max(0, static_cast<int>(std::floor(std::min({a.x, b.x, c.x}))));
  const int max_x = std::min(static_cast<int>(output.width) - 1, static_cast<int>(std::ceil(std::max({a.x, b.x, c.x}))));
  const int min_y = std::max(0, static_cast<int>(std::floor(std::min({a.y, b.y, c.y}))));
  const int max_y = std::min(static_cast<int>(output.height) - 1, static_cast<int>(std::ceil(std::max({a.y, b.y, c.y}))));

  const Vec3 normal = normalize(cross(subtract(world_b, world_a), subtract(world_c, world_a)));
  const Vec3 light = normalize({0.35F, 0.8F, 0.55F});
  const float lighting = std::clamp(0.30F + 0.85F * std::abs(dot(normal, light)), 0.25F, 1.15F);
  for (int y = min_y; y <= max_y; ++y) {
    if ((y & 15) == 0 && budget.expired()) return false;
    for (int x = min_x; x <= max_x; ++x) {
      const float px = static_cast<float>(x) + 0.5F;
      const float py = static_cast<float>(y) + 0.5F;
      const float w0 = edge_function(b, c, px, py) / area;
      const float w1 = edge_function(c, a, px, py) / area;
      const float w2 = 1.0F - w0 - w1;
      if (w0 < 0.0F || w1 < 0.0F || w2 < 0.0F) continue;
      const float depth = w0 * a.depth + w1 * b.depth + w2 * c.depth;
      const std::size_t pixel = static_cast<std::size_t>(y) * output.width + static_cast<std::size_t>(x);
      if (depth <= depth_buffer[pixel]) continue;
      depth_buffer[pixel] = depth;
      std::array<float, 4> sampled = base;
      if (vertex_colors) {
        for (int channel = 0; channel < 3; ++channel) {
          sampled[channel] *= w0 * (*vertex_colors)[0][channel] + w1 * (*vertex_colors)[1][channel] +
                              w2 * (*vertex_colors)[2][channel];
        }
        if (use_alpha) {
          sampled[3] *= w0 * (*vertex_colors)[0][3] + w1 * (*vertex_colors)[1][3] +
                        w2 * (*vertex_colors)[2][3];
        }
      }
      if (texture && texture_uvs) {
        const float u = w0 * (*texture_uvs)[0].x + w1 * (*texture_uvs)[1].x + w2 * (*texture_uvs)[2].x;
        const float v = w0 * (*texture_uvs)[0].y + w1 * (*texture_uvs)[1].y + w2 * (*texture_uvs)[2].y;
        const auto texel = sample_texture(*texture, u, v);
        for (int index = 0; index < 3; ++index) sampled[index] *= texel[index];
        if (use_alpha) sampled[3] *= texel[3];
      }
      const auto channel = [&](int index) {
        return static_cast<std::uint8_t>(std::clamp(sampled[index] * lighting, 0.0F, 1.0F) * 255.0F);
      };
      output.bgra[pixel * 4 + 0] = channel(2);
      output.bgra[pixel * 4 + 1] = channel(1);
      output.bgra[pixel * 4 + 2] = channel(0);
      output.bgra[pixel * 4 + 3] = static_cast<std::uint8_t>(std::clamp(sampled[3], 0.0F, 1.0F) * 255.0F);
    }
  }
  return true;
}

}  // namespace

bool render_glb_thumbnail(const std::uint8_t* bytes, std::size_t size, unsigned edge, Thumbnail& output) {
  if (!bytes || size < 20 || size > kMaximumInputBytes || edge < 16 || edge > 2048) return false;
  const Budget budget;
  cgltf_options options{};
  cgltf_data* data = nullptr;
  if (cgltf_parse(&options, bytes, size, &data) != cgltf_result_success || !data) return false;
  const auto release = [&]() { cgltf_free(data); };
  if (data->file_type != cgltf_file_type_glb ||
      cgltf_load_buffers(&options, data, nullptr) != cgltf_result_success ||
      cgltf_validate(data) != cgltf_result_success) {
    release();
    return false;
  }
  if (budget.expired()) { release(); return false; }

  Bounds bounds;
  std::size_t total_triangles = 0;
  std::size_t inspected_vertices = 0;
  std::unordered_map<const cgltf_node*, std::unordered_set<const cgltf_accessor*>> inspected_position_accessors;
  for (cgltf_size node_index = 0; node_index < data->nodes_count; ++node_index) {
    if (budget.expired()) { release(); return false; }
    const auto& node = data->nodes[node_index];
    if (!node.mesh) continue;
    cgltf_float matrix[16];
    cgltf_node_transform_world(&node, matrix);
    for (cgltf_size primitive_index = 0; primitive_index < node.mesh->primitives_count; ++primitive_index) {
      const auto& primitive = node.mesh->primitives[primitive_index];
      const auto* positions = find_position(primitive);
      if (!positions || primitive.type != cgltf_primitive_type_triangles) continue;
      const cgltf_size count = primitive.indices ? primitive.indices->count : positions->count;
      if (count / 3 > std::numeric_limits<std::size_t>::max() - total_triangles) {
        release();
        return false;
      }
      total_triangles += count / 3;
      // CAD exports commonly split one geometry accessor into hundreds of
      // material primitives. Count and inspect each accessor once per node;
      // the node remains part of the key because one mesh may be instanced
      // with different world transforms.
      if (!inspected_position_accessors[&node].insert(positions).second) continue;
      if (positions->count > kMaximumInspectedVertices - inspected_vertices) {
        release();
        return false;
      }
      inspected_vertices += positions->count;
      for (cgltf_size index = 0; index < positions->count; ++index) {
        if ((index & 16383) == 0 && budget.expired()) { release(); return false; }
        Vec3 point{};
        if (!read_point(positions, index, matrix, point)) continue;
        include_in_bounds(point, bounds);
      }
    }
  }
  if (!bounds.valid || total_triangles == 0 || total_triangles > kMaximumGlbTriangles) { release(); return false; }

  std::vector<float> depth_buffer;
  float center_x = 0;
  float center_y = 0;
  float scale = 0;
  if (!prepare_output(bounds, edge, output, depth_buffer, center_x, center_y, scale)) { release(); return false; }
  std::size_t triangle_number = 0;
  std::size_t decoded_texture_bytes = 0;
  std::unordered_map<const cgltf_texture*, std::optional<TextureImage>> texture_cache;

  for (cgltf_size node_index = 0; node_index < data->nodes_count; ++node_index) {
    if (budget.expired()) { release(); return false; }
    const auto& node = data->nodes[node_index];
    if (!node.mesh) continue;
    cgltf_float matrix[16];
    cgltf_node_transform_world(&node, matrix);
    for (cgltf_size primitive_index = 0; primitive_index < node.mesh->primitives_count; ++primitive_index) {
      const auto& primitive = node.mesh->primitives[primitive_index];
      const auto* positions = find_position(primitive);
      if (!positions || primitive.type != cgltf_primitive_type_triangles) continue;
      const cgltf_size count = primitive.indices ? primitive.indices->count : positions->count;
      const auto color = material_color(primitive);
      const cgltf_accessor* colors = find_color(primitive);
      if (colors && colors->count < positions->count) colors = nullptr;
      const cgltf_texture_view* texture_view = nullptr;
      const cgltf_accessor* texcoords = nullptr;
      TextureImage* texture_image = nullptr;
      if (primitive.material && primitive.material->has_pbr_metallic_roughness) {
        auto& candidate = primitive.material->pbr_metallic_roughness.base_color_texture;
        cgltf_int texcoord_set = candidate.texcoord;
        if (candidate.has_transform && candidate.transform.has_texcoord) texcoord_set = candidate.transform.texcoord;
        texcoords = find_texcoord(primitive, texcoord_set);
        if (candidate.texture && candidate.texture->image && texcoords && texcoords->count >= positions->count) {
          texture_view = &candidate;
          auto [entry, inserted] = texture_cache.try_emplace(candidate.texture);
          if (inserted) {
            TextureImage decoded;
            if (decode_wic_texture(*candidate.texture->image, decoded, decoded_texture_bytes, budget)) {
              if (candidate.texture->sampler) {
                if (candidate.texture->sampler->wrap_s != static_cast<cgltf_wrap_mode>(0)) decoded.wrap_s = candidate.texture->sampler->wrap_s;
                if (candidate.texture->sampler->wrap_t != static_cast<cgltf_wrap_mode>(0)) decoded.wrap_t = candidate.texture->sampler->wrap_t;
              }
              entry->second = std::move(decoded);
            } else {
              entry->second = std::nullopt;
            }
          }
          if (entry->second) texture_image = &*entry->second;
        }
      }
      for (cgltf_size i = 0; i + 2 < count; i += 3, ++triangle_number) {
        if ((triangle_number & 8191) == 0 && budget.expired()) { release(); return false; }
        Vec3 world[3]{};
        std::array<Vec2, 3> uvs{};
        std::array<std::array<float, 4>, 3> vertex_colors{};
        bool valid = true;
        bool valid_uvs = texture_image && texture_view;
        bool valid_colors = colors != nullptr;
        for (int corner = 0; corner < 3; ++corner) {
          const cgltf_size vertex = primitive.indices ? cgltf_accessor_read_index(primitive.indices, i + corner) : i + corner;
          valid = valid && vertex < positions->count && read_point(positions, vertex, matrix, world[corner]);
          if (valid_uvs) {
            valid_uvs = vertex < texcoords->count && read_uv(texcoords, vertex, uvs[corner]);
            if (valid_uvs) uvs[corner] = transform_uv(uvs[corner], *texture_view);
          }
          if (valid_colors) valid_colors = vertex < colors->count && read_color(colors, vertex, vertex_colors[corner]);
        }
        if (!valid) continue;
        ScreenVertex screen[3]{};
        for (int corner = 0; corner < 3; ++corner) {
          screen[corner] = to_screen(world[corner], center_x, center_y, scale, edge);
        }
        const bool use_alpha = primitive.material && primitive.material->alpha_mode != cgltf_alpha_mode_opaque;
        if (!rasterize(screen[0], screen[1], screen[2], world[0], world[1], world[2], color, output,
                       depth_buffer, budget, valid_uvs ? texture_image : nullptr, valid_uvs ? &uvs : nullptr,
                       valid_colors ? &vertex_colors : nullptr, use_alpha)) {
          release();
          return false;
        }
      }
    }
  }
  release();
  return has_visible_pixels(output);
}

bool render_stl_thumbnail(const std::uint8_t* bytes, std::size_t size, unsigned edge, Thumbnail& output) {
  if (!bytes || size < 15 || size > kMaximumInputBytes || edge < 16 || edge > 2048) return false;
  const Budget budget;
  Bounds bounds;
  std::size_t triangle_count = 0;
  bool binary = false;
  if (size >= 84) {
    triangle_count = read_u32_le(bytes + 80);
    binary = triangle_count <= kMaximumRenderedTriangles &&
             triangle_count <= kMaximumInspectedVertices / 3 &&
             triangle_count <= (std::numeric_limits<std::size_t>::max() - 84) / 50 &&
             84 + triangle_count * 50 == size;
  }

  std::vector<Triangle> ascii_triangles;
  if (binary) {
    for (std::size_t index = 0; index < triangle_count; ++index) {
      if ((index & 8191) == 0 && budget.expired()) return false;
      Triangle triangle{};
      if (!read_binary_stl_triangle(bytes, index, triangle)) return false;
      for (const Vec3& vertex : triangle.vertices) include_in_bounds(vertex, bounds);
    }
  } else {
    const std::string_view text(reinterpret_cast<const char*>(bytes), size);
    const std::size_t first = text.find_first_not_of(" \t\r\n");
    if (first == std::string_view::npos || text.substr(first, 5) != "solid" ||
        !parse_ascii_stl(bytes, size, budget, ascii_triangles, bounds)) return false;
    triangle_count = ascii_triangles.size();
  }
  if (!bounds.valid || triangle_count == 0 || budget.expired()) return false;

  std::vector<float> depth_buffer;
  float center_x = 0;
  float center_y = 0;
  float scale = 0;
  if (!prepare_output(bounds, edge, output, depth_buffer, center_x, center_y, scale)) return false;
  constexpr std::array<float, 4> kStlColor = {0.34F, 0.68F, 0.72F, 1.0F};
  for (std::size_t index = 0; index < triangle_count; ++index) {
    if ((index & 8191) == 0 && budget.expired()) return false;
    Triangle triangle{};
    if (binary) {
      if (!read_binary_stl_triangle(bytes, index, triangle)) return false;
    } else {
      triangle = ascii_triangles[index];
    }
    ScreenVertex screen[3]{};
    for (int corner = 0; corner < 3; ++corner) {
      screen[corner] = to_screen(triangle.vertices[corner], center_x, center_y, scale, edge);
    }
    if (!rasterize(screen[0], screen[1], screen[2], triangle.vertices[0], triangle.vertices[1],
                   triangle.vertices[2], kStlColor, output, depth_buffer, budget)) return false;
  }
  return has_visible_pixels(output);
}

bool render_ply_thumbnail(const std::uint8_t* bytes, std::size_t size, unsigned edge, Thumbnail& output) {
  if (!bytes || size < 16 || size > kMaximumInputBytes || edge < 16 || edge > 2048) return false;
  const Budget budget;
  PlyHeader header;
  if (!parse_ply_header(bytes, size, header)) return false;
  Bounds bounds;
  std::vector<ColoredTriangle> triangles;
  triangles.reserve(std::min(header.face_count, kMaximumRenderedTriangles));
  if (!render_ply_data(bytes, size, header, budget, triangles, bounds) || budget.expired()) return false;
  std::vector<float> depth_buffer;
  float center_x = 0, center_y = 0, scale = 0;
  if (!prepare_output(bounds, edge, output, depth_buffer, center_x, center_y, scale)) return false;
  for (std::size_t index = 0; index < triangles.size(); ++index) {
    if ((index & 8191) == 0 && budget.expired()) return false;
    const auto& triangle = triangles[index];
    ScreenVertex screen[3]{};
    for (int corner = 0; corner < 3; ++corner) {
      screen[corner] = to_screen(triangle.geometry.vertices[corner], center_x, center_y, scale, edge);
    }
    if (!rasterize(screen[0], screen[1], screen[2], triangle.geometry.vertices[0], triangle.geometry.vertices[1],
                   triangle.geometry.vertices[2], triangle.color, output, depth_buffer, budget)) return false;
  }
  return has_visible_pixels(output);
}

bool render_cad_thumbnail(const CadThumbnailTriangle* source, std::size_t triangle_count,
                          unsigned edge, Thumbnail& output) {
  if (!source || triangle_count == 0 || triangle_count > kMaximumRenderedTriangles ||
      edge < 16 || edge > 2048) return false;
  const Budget budget;
  Bounds bounds;
  for (std::size_t index = 0; index < triangle_count; ++index) {
    if ((index & 8191) == 0 && budget.expired()) return false;
    for (int corner = 0; corner < 3; ++corner) {
      const Vec3 point{source[index].vertices[corner * 3], source[index].vertices[corner * 3 + 1],
                       source[index].vertices[corner * 3 + 2]};
      if (!std::isfinite(point.x) || !std::isfinite(point.y) || !std::isfinite(point.z)) return false;
      include_in_bounds(point, bounds);
    }
  }
  std::vector<float> depth_buffer;
  float center_x = 0, center_y = 0, scale = 0;
  if (!prepare_output(bounds, edge, output, depth_buffer, center_x, center_y, scale)) return false;
  for (std::size_t index = 0; index < triangle_count; ++index) {
    if ((index & 8191) == 0 && budget.expired()) return false;
    Vec3 world[3]{};
    ScreenVertex screen[3]{};
    for (int corner = 0; corner < 3; ++corner) {
      world[corner] = {source[index].vertices[corner * 3], source[index].vertices[corner * 3 + 1],
                       source[index].vertices[corner * 3 + 2]};
      screen[corner] = to_screen(world[corner], center_x, center_y, scale, edge);
    }
    std::array<float, 4> color{};
    for (int channel = 0; channel < 4; ++channel) {
      if (!std::isfinite(source[index].color[channel])) return false;
      color[channel] = std::clamp(source[index].color[channel], 0.0F, 1.0F);
    }
    if (!rasterize(screen[0], screen[1], screen[2], world[0], world[1], world[2], color,
                   output, depth_buffer, budget)) return false;
  }
  return has_visible_pixels(output);
}

bool render_model_thumbnail(const std::uint8_t* bytes, std::size_t size, unsigned edge, Thumbnail& output) {
  if (!bytes || size < 4) return false;
  if (read_u32_le(bytes) == 0x46546C67) return render_glb_thumbnail(bytes, size, edge, output);
  if (std::memcmp(bytes, "ply", 3) == 0 && (bytes[3] == '\n' || bytes[3] == '\r')) {
    return render_ply_thumbnail(bytes, size, edge, output);
  }
  return render_stl_thumbnail(bytes, size, edge, output);
}

}  // namespace kea3d
