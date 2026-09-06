#pragma once

#include <cstddef>
#include <cstdint>
#include <vector>

namespace kea3d {

struct Thumbnail {
  unsigned width = 0;
  unsigned height = 0;
  std::vector<std::uint8_t> bgra;
};

struct CadThumbnailTriangle {
  float vertices[9]{};
  float color[4]{};
};

bool render_glb_thumbnail(const std::uint8_t* bytes, std::size_t size, unsigned edge, Thumbnail& output);
bool render_stl_thumbnail(const std::uint8_t* bytes, std::size_t size, unsigned edge, Thumbnail& output);
bool render_ply_thumbnail(const std::uint8_t* bytes, std::size_t size, unsigned edge, Thumbnail& output);
bool render_model_thumbnail(const std::uint8_t* bytes, std::size_t size, unsigned edge, Thumbnail& output);
bool render_cad_thumbnail(const CadThumbnailTriangle* triangles, std::size_t triangle_count,
                          unsigned edge, Thumbnail& output);

}  // namespace kea3d
