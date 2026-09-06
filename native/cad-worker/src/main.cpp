#include <BRepBndLib.hxx>
#include <BRepLib_ToolTriangulatedShape.hxx>
#include <BRepMesh_IncrementalMesh.hxx>
#include <BRep_Tool.hxx>
#include <Bnd_Box.hxx>
#include <Message_ProgressIndicator.hxx>
#include <Message_ProgressScope.hxx>
#include <Poly_Triangulation.hxx>
#include <Quantity_Color.hxx>
#include <STEPCAFControl_Reader.hxx>
#include <TDF_LabelSequence.hxx>
#include <TDataStd_Name.hxx>
#include <TDocStd_Document.hxx>
#include <TopAbs_Orientation.hxx>
#include <TopAbs_ShapeEnum.hxx>
#include <TopExp_Explorer.hxx>
#include <TopLoc_Location.hxx>
#include <TopoDS.hxx>
#include <TopoDS_Face.hxx>
#include <TopoDS_Shape.hxx>
#include <XCAFApp_Application.hxx>
#include <XCAFDoc_ColorTool.hxx>
#include <XCAFDoc_DocumentTool.hxx>
#include <XCAFDoc_ShapeTool.hxx>

#include "thumbnail_renderer.h"

#include <algorithm>
#include <array>
#include <atomic>
#include <bit>
#include <cctype>
#include <cmath>
#include <cstdint>
#include <cstdlib>
#include <filesystem>
#include <iomanip>
#include <fstream>
#include <iostream>
#include <limits>
#include <optional>
#include <sstream>
#include <string>
#include <string_view>
#include <thread>
#include <vector>

#include <fcntl.h>
#include <io.h>

namespace {

constexpr std::uint16_t protocol_version = 1;
constexpr std::uint64_t max_manifest_bytes = 8ULL * 1024ULL * 1024ULL;
constexpr std::uint64_t max_mesh_batch_bytes = 64ULL * 1024ULL * 1024ULL;
constexpr std::size_t max_thumbnail_triangles = 1'000'000;
constexpr unsigned thumbnail_edge = 512;

std::atomic_bool cancel_requested{false};

struct Arguments {
  std::string session;
  std::filesystem::path input;
};

struct ColorGroup {
  std::uint32_t first_triangle = 0;
  std::uint32_t triangle_count = 0;
  std::array<float, 4> color{};
};

struct MeshBatch {
  std::vector<float> positions;
  std::vector<float> normals;
  std::vector<std::uint32_t> indices;
  std::vector<ColorGroup> groups;
  std::uint64_t face_count = 0;
  std::uint64_t colored_face_count = 0;
};

std::uint64_t thumbnail_hash(const std::filesystem::path& path) {
  std::ifstream input(path, std::ios::binary);
  if (!input) return 0;
  std::uint64_t hash = 1469598103934665603ULL;
  std::vector<char> bytes(1024 * 1024);
  while (input) {
    input.read(bytes.data(), static_cast<std::streamsize>(bytes.size()));
    const std::streamsize count = input.gcount();
    for (std::streamsize index = 0; index < count; ++index) {
      hash ^= static_cast<unsigned char>(bytes[static_cast<std::size_t>(index)]);
      hash *= 1099511628211ULL;
    }
  }
  return input.eof() ? hash : 0;
}

std::filesystem::path thumbnail_cache_path(const std::filesystem::path& input) {
  const wchar_t* local_app_data = _wgetenv(L"LOCALAPPDATA");
  const std::uint64_t hash = thumbnail_hash(input);
  if (!local_app_data || !*local_app_data || hash == 0) return {};
  std::error_code error;
  const std::uint64_t size = std::filesystem::file_size(input, error);
  if (error) return {};
  std::wostringstream name;
  name << std::hex << std::setw(16) << std::setfill(L'0') << hash << L'-' << std::dec << size << L".k3t";
  return std::filesystem::path(local_app_data) / L"Kea3D" / L"ThumbnailCache" / L"v2" / name.str();
}

void append_thumbnail_triangles(const MeshBatch& batch,
                                std::vector<kea3d::CadThumbnailTriangle>& output) {
  const std::size_t triangle_count = batch.indices.size() / 3;
  std::size_t group_index = 0;
  for (std::size_t triangle = 0;
       triangle < triangle_count && output.size() < max_thumbnail_triangles; ++triangle) {
    while (group_index + 1 < batch.groups.size() &&
           triangle >= static_cast<std::size_t>(batch.groups[group_index].first_triangle) +
                         batch.groups[group_index].triangle_count) {
      ++group_index;
    }
    kea3d::CadThumbnailTriangle value{};
    const auto color = batch.groups.empty()
      ? std::array<float, 4>{0.72F, 0.76F, 0.82F, 1.0F}
      : batch.groups[group_index].color;
    std::copy(color.begin(), color.end(), value.color);
    bool valid = true;
    for (std::size_t corner = 0; corner < 3; ++corner) {
      const std::uint32_t vertex = batch.indices[triangle * 3 + corner];
      if (static_cast<std::size_t>(vertex) * 3 + 2 >= batch.positions.size()) {
        valid = false;
        break;
      }
      const float* position = batch.positions.data() + static_cast<std::size_t>(vertex) * 3;
      value.vertices[corner * 3] = position[0];
      value.vertices[corner * 3 + 1] = position[2];
      value.vertices[corner * 3 + 2] = -position[1];
    }
    if (valid) output.push_back(value);
  }
}

void write_thumbnail_cache(const std::filesystem::path& input,
                           const std::vector<kea3d::CadThumbnailTriangle>& triangles) {
  if (triangles.empty()) return;
  kea3d::Thumbnail thumbnail;
  if (!kea3d::render_cad_thumbnail(triangles.data(), triangles.size(), thumbnail_edge, thumbnail)) return;
  const std::filesystem::path destination = thumbnail_cache_path(input);
  if (destination.empty()) return;
  std::error_code error;
  std::filesystem::create_directories(destination.parent_path(), error);
  if (error) return;
  const std::filesystem::path temporary = destination.wstring() + L".tmp";
  std::ofstream output(temporary, std::ios::binary | std::ios::trunc);
  if (!output) return;
  const std::array<char, 12> header{
    'K', '3', 'T', '1',
    static_cast<char>(thumbnail.width), static_cast<char>(thumbnail.width >> 8),
    static_cast<char>(thumbnail.width >> 16), static_cast<char>(thumbnail.width >> 24),
    static_cast<char>(thumbnail.height), static_cast<char>(thumbnail.height >> 8),
    static_cast<char>(thumbnail.height >> 16), static_cast<char>(thumbnail.height >> 24),
  };
  output.write(header.data(), static_cast<std::streamsize>(header.size()));
  output.write(reinterpret_cast<const char*>(thumbnail.bgra.data()),
               static_cast<std::streamsize>(thumbnail.bgra.size()));
  output.close();
  if (!output) {
    std::filesystem::remove(temporary, error);
    return;
  }
  std::filesystem::remove(destination, error);
  error.clear();
  std::filesystem::rename(temporary, destination, error);
  if (error) std::filesystem::remove(temporary, error);
}

class CancelIndicator final : public Message_ProgressIndicator {
protected:
  Standard_Boolean UserBreak() override {
    return cancel_requested.load(std::memory_order_relaxed) ? Standard_True : Standard_False;
  }

  void Show(const Message_ProgressScope&, const Standard_Boolean) override {}
};

std::string wide_to_utf8(const std::wstring_view value) {
  if (value.empty()) return {};
  const std::wstring terminated(value);
  const TCollection_ExtendedString extended(
    reinterpret_cast<const Standard_ExtCharacter*>(terminated.c_str()));
  std::vector<char> utf8(static_cast<std::size_t>(extended.LengthOfCString()) + 1, '\0');
  Standard_PCharacter buffer = utf8.data();
  extended.ToUTF8CString(buffer);
  return utf8.data();
}

bool valid_session_id(const std::string_view value) {
  return !value.empty() && value.size() <= 64 &&
         std::all_of(value.begin(), value.end(), [](const unsigned char character) {
           return std::isalnum(character) != 0 || character == '-';
         });
}

std::optional<Arguments> parse_arguments(const int argc, wchar_t** argv) {
  std::optional<std::wstring> protocol;
  std::optional<std::wstring> session;
  std::optional<std::filesystem::path> input;
  for (int index = 1; index + 1 < argc; index += 2) {
    const std::wstring_view option(argv[index]);
    if (option == L"--protocol") protocol = argv[index + 1];
    else if (option == L"--session") session = argv[index + 1];
    else if (option == L"--input") input = std::filesystem::path(argv[index + 1]);
    else return std::nullopt;
  }
  if (argc != 7 || protocol != L"1" || !session || !input) return std::nullopt;
  const std::string session_utf8 = wide_to_utf8(*session);
  std::error_code filesystem_error;
  if (!valid_session_id(session_utf8) ||
      !std::filesystem::is_regular_file(*input, filesystem_error) || filesystem_error) {
    return std::nullopt;
  }
  const std::wstring extension = input->extension().wstring();
  if (_wcsicmp(extension.c_str(), L".step") != 0 && _wcsicmp(extension.c_str(), L".stp") != 0) {
    return std::nullopt;
  }
  const std::filesystem::path canonical = std::filesystem::weakly_canonical(*input, filesystem_error);
  if (filesystem_error) return std::nullopt;
  return Arguments{session_utf8, canonical};
}

std::string json_escape(const std::string_view value) {
  std::ostringstream output;
  for (const unsigned char character : value) {
    switch (character) {
      case '"': output << "\\\""; break;
      case '\\': output << "\\\\"; break;
      case '\b': output << "\\b"; break;
      case '\f': output << "\\f"; break;
      case '\n': output << "\\n"; break;
      case '\r': output << "\\r"; break;
      case '\t': output << "\\t"; break;
      default:
        if (character < 0x20) {
          output << "\\u" << std::hex << std::setw(4) << std::setfill('0')
                 << static_cast<unsigned>(character) << std::dec;
        } else {
          output << character;
        }
    }
  }
  return output.str();
}

std::string label_name(const TDF_Label& label) {
  Handle(TDataStd_Name) attribute;
  if (!label.FindAttribute(TDataStd_Name::GetID(), attribute) || attribute.IsNull()) return {};
  const TCollection_ExtendedString& extended = attribute->Get();
  std::vector<char> utf8(static_cast<std::size_t>(extended.LengthOfCString()) + 1, '\0');
  Standard_PCharacter buffer = utf8.data();
  extended.ToUTF8CString(buffer);
  return utf8.data();
}

void append_u32(std::vector<std::uint8_t>& output, const std::uint32_t value) {
  output.push_back(static_cast<std::uint8_t>(value));
  output.push_back(static_cast<std::uint8_t>(value >> 8));
  output.push_back(static_cast<std::uint8_t>(value >> 16));
  output.push_back(static_cast<std::uint8_t>(value >> 24));
}

void append_f32(std::vector<std::uint8_t>& output, const float value) {
  append_u32(output, std::bit_cast<std::uint32_t>(value));
}

bool same_color(const std::array<float, 4>& left, const std::array<float, 4>& right) {
  return std::equal(left.begin(), left.end(), right.begin(), [](const float a, const float b) {
    return std::abs(a - b) < 0.000001F;
  });
}

bool face_color(const Handle(XCAFDoc_ColorTool)& colors, const TDF_Label& root,
                const Handle(XCAFDoc_ShapeTool)& shapes, const TopoDS_Face& face,
                std::array<float, 4>& value) {
  TDF_Label label;
  Quantity_Color color;
  if (!shapes->FindSubShape(root, face, label) ||
      !(colors->GetColor(label, XCAFDoc_ColorSurf, color) ||
        colors->GetColor(label, XCAFDoc_ColorGen, color) ||
        colors->GetColor(label, XCAFDoc_ColorCurv, color))) {
    value = {0.72F, 0.76F, 0.82F, 1.0F};
    return false;
  }
  value = {static_cast<float>(color.Red()), static_cast<float>(color.Green()),
           static_cast<float>(color.Blue()), 1.0F};
  return true;
}

bool checked_u32(const std::size_t value, std::uint32_t& result) {
  if (value > std::numeric_limits<std::uint32_t>::max()) return false;
  result = static_cast<std::uint32_t>(value);
  return true;
}

std::optional<MeshBatch> extract_shell_mesh(const TopoDS_Shape& shell, const TDF_Label& root,
                                            const Handle(XCAFDoc_ShapeTool)& shapes,
                                            const Handle(XCAFDoc_ColorTool)& colors) {
  MeshBatch batch;
  for (TopExp_Explorer explorer(shell, TopAbs_FACE); explorer.More(); explorer.Next()) {
    if (cancel_requested.load(std::memory_order_relaxed)) return std::nullopt;
    ++batch.face_count;
    const TopoDS_Face face = TopoDS::Face(explorer.Current());
    TopLoc_Location location;
    const Handle(Poly_Triangulation) triangulation = BRep_Tool::Triangulation(face, location);
    if (triangulation.IsNull() || triangulation->NbNodes() <= 0 || triangulation->NbTriangles() <= 0) {
      continue;
    }
    BRepLib_ToolTriangulatedShape::ComputeNormals(face, triangulation);

    const gp_Trsf transform = location.Transformation();
    const bool reversed = face.Orientation() == TopAbs_REVERSED;
    const std::uint32_t first_triangle = static_cast<std::uint32_t>(batch.indices.size() / 3);
    std::vector<std::uint32_t> node_map(
      static_cast<std::size_t>(triangulation->NbNodes()) + 1,
      std::numeric_limits<std::uint32_t>::max());
    const auto map_node = [&](const Standard_Integer node) -> std::optional<std::uint32_t> {
      if (node <= 0 || node > triangulation->NbNodes()) return std::nullopt;
      std::uint32_t& mapped = node_map[static_cast<std::size_t>(node)];
      if (mapped != std::numeric_limits<std::uint32_t>::max()) return mapped;
      const gp_Pnt point = triangulation->Node(node).Transformed(transform);
      gp_Dir normal = triangulation->Normal(node).Transformed(transform);
      if (reversed) normal.Reverse();
      const std::array<float, 6> values{
        static_cast<float>(point.X()), static_cast<float>(point.Y()),
        static_cast<float>(point.Z()), static_cast<float>(normal.X()),
        static_cast<float>(normal.Y()), static_cast<float>(normal.Z())};
      if (!std::all_of(values.begin(), values.end(), [](const double value) {
            return std::isfinite(value);
          })) {
        return std::nullopt;
      }
      if (!checked_u32(batch.positions.size() / 3, mapped)) return std::nullopt;
      batch.positions.insert(batch.positions.end(), values.begin(), values.begin() + 3);
      batch.normals.insert(batch.normals.end(), values.begin() + 3, values.end());
      return mapped;
    };
    for (Standard_Integer triangle = 1; triangle <= triangulation->NbTriangles(); ++triangle) {
      Standard_Integer first = 0;
      Standard_Integer second = 0;
      Standard_Integer third = 0;
      triangulation->Triangle(triangle).Get(first, second, third);
      if (reversed) std::swap(second, third);
      const std::optional<std::uint32_t> mapped_first = map_node(first);
      const std::optional<std::uint32_t> mapped_second = map_node(second);
      const std::optional<std::uint32_t> mapped_third = map_node(third);
      if (!mapped_first || !mapped_second || !mapped_third) continue;
      batch.indices.insert(batch.indices.end(), {*mapped_first, *mapped_second, *mapped_third});
    }

    std::array<float, 4> color{};
    if (face_color(colors, root, shapes, face, color)) ++batch.colored_face_count;
    const std::uint32_t triangle_count =
      static_cast<std::uint32_t>(batch.indices.size() / 3) - first_triangle;
    if (triangle_count == 0) continue;
    if (!batch.groups.empty() && same_color(batch.groups.back().color, color) &&
        batch.groups.back().first_triangle + batch.groups.back().triangle_count == first_triangle) {
      batch.groups.back().triangle_count += triangle_count;
    } else {
      batch.groups.push_back(ColorGroup{first_triangle, triangle_count, color});
    }
  }
  if (batch.positions.empty() || batch.indices.empty()) return std::nullopt;
  return batch;
}

std::optional<MeshBatch> tessellate_shell(const TopoDS_Shape& shell, const TDF_Label& root,
                                          const Handle(XCAFDoc_ShapeTool)& shapes,
                                          const Handle(XCAFDoc_ColorTool)& colors) {
  BRepMesh_IncrementalMesh mesher(shell, 0.1, Standard_False, 0.5, Standard_True);
  mesher.Perform();
  if (!mesher.IsDone()) return std::nullopt;
  return extract_shell_mesh(shell, root, shapes, colors);
}

std::vector<std::uint8_t> encode_mesh(const MeshBatch& batch) {
  std::vector<std::uint8_t> output;
  output.reserve(16 + (batch.positions.size() + batch.normals.size()) * sizeof(float) +
                 batch.indices.size() * sizeof(std::uint32_t) + batch.groups.size() * 24);
  output.insert(output.end(), {'K', '3', 'M', '1'});
  append_u32(output, static_cast<std::uint32_t>(batch.positions.size() / 3));
  append_u32(output, static_cast<std::uint32_t>(batch.indices.size() / 3));
  append_u32(output, static_cast<std::uint32_t>(batch.groups.size()));
  for (const float value : batch.positions) append_f32(output, value);
  for (const float value : batch.normals) append_f32(output, value);
  for (const std::uint32_t value : batch.indices) append_u32(output, value);
  for (const ColorGroup& group : batch.groups) {
    append_u32(output, group.first_triangle);
    append_u32(output, group.triangle_count);
    for (const float value : group.color) append_f32(output, value);
  }
  return output;
}

bool valid_mesh_values(const MeshBatch& batch) {
  return std::all_of(batch.positions.begin(), batch.positions.end(), [](const float value) {
           return std::isfinite(value);
         }) &&
         std::all_of(batch.normals.begin(), batch.normals.end(), [](const float value) {
           return std::isfinite(value);
         });
}

void write_frame(const std::string& header, const std::vector<std::uint8_t>& payload = {}) {
  const std::uint32_t header_size = static_cast<std::uint32_t>(header.size());
  const std::array<char, 4> prefix{
    static_cast<char>(header_size), static_cast<char>(header_size >> 8),
    static_cast<char>(header_size >> 16), static_cast<char>(header_size >> 24)};
  std::cout.write(prefix.data(), static_cast<std::streamsize>(prefix.size()));
  std::cout.write(header.data(), static_cast<std::streamsize>(header.size()));
  if (!payload.empty()) {
    std::cout.write(reinterpret_cast<const char*>(payload.data()),
                    static_cast<std::streamsize>(payload.size()));
  }
  std::cout.flush();
}

std::string base_header(const Arguments& arguments, const std::uint64_t sequence,
                        const std::uint64_t payload_size) {
  return "{\"protocolVersion\":1,\"sessionId\":\"" + json_escape(arguments.session) +
         "\",\"sequence\":" + std::to_string(sequence) +
         ",\"payloadLength\":" + std::to_string(payload_size);
}

void write_progress(const Arguments& arguments, std::uint64_t& sequence,
                    const std::string_view stage, const std::size_t completed,
                    const std::size_t total) {
  write_frame(base_header(arguments, sequence++, 0) +
              ",\"type\":\"progress\",\"stage\":\"" + std::string(stage) +
              "\",\"completed\":" + std::to_string(completed) +
              ",\"total\":" + std::to_string(total) + '}');
}

[[noreturn]] void terminal(const Arguments& arguments, const std::uint64_t sequence,
                           const std::string_view status, const std::string_view message,
                           const int exit_code) {
  std::string header = base_header(arguments, sequence, 0) +
                       ",\"type\":\"terminal\",\"status\":\"" + std::string(status) + "\"";
  if (!message.empty()) header += ",\"message\":\"" + json_escape(message) + "\"";
  header += '}';
  write_frame(header);
  std::cout.flush();
  std::cerr.flush();
  std::_Exit(exit_code);
}

void hash_value(std::uint64_t& hash, const std::uint64_t value) {
  for (unsigned shift = 0; shift < 64; shift += 8) {
    hash ^= (value >> shift) & 0xff;
    hash *= 1099511628211ULL;
  }
}

std::uint64_t quantize(const double value) {
  return static_cast<std::uint64_t>(
    static_cast<std::int64_t>(std::llround(value * 1000000.0)));
}

std::string shell_id(const std::size_t ordinal, const TopoDS_Shape& shell,
                     const MeshBatch& batch) {
  Bnd_Box bounds;
  BRepBndLib::Add(shell, bounds);
  Standard_Real x_min = 0;
  Standard_Real y_min = 0;
  Standard_Real z_min = 0;
  Standard_Real x_max = 0;
  Standard_Real y_max = 0;
  Standard_Real z_max = 0;
  bounds.Get(x_min, y_min, z_min, x_max, y_max, z_max);

  std::uint64_t hash = 1469598103934665603ULL;
  hash_value(hash, ordinal);
  hash_value(hash, batch.face_count);
  hash_value(hash, batch.indices.size() / 3);
  hash_value(hash, quantize(x_min));
  hash_value(hash, quantize(y_min));
  hash_value(hash, quantize(z_min));
  hash_value(hash, quantize(x_max));
  hash_value(hash, quantize(y_max));
  hash_value(hash, quantize(z_max));

  std::ostringstream value;
  value << "shell-" << std::setw(4) << std::setfill('0') << ordinal << '-'
        << std::hex << std::setw(16) << hash;
  return value.str();
}

std::vector<TopoDS_Shape> collect_shells(const TopoDS_Shape& shape) {
  std::vector<TopoDS_Shape> shells;
  for (TopExp_Explorer explorer(shape, TopAbs_SHELL); explorer.More(); explorer.Next()) {
    shells.push_back(explorer.Current());
  }
  return shells;
}

void monitor_commands(const Arguments& arguments) {
  const std::string expected = "{\"protocolVersion\":1,\"sessionId\":\"" +
                               arguments.session + "\",\"command\":\"cancel\"}";
  std::string line;
  while (std::getline(std::cin, line)) {
    if (line == expected) {
      cancel_requested.store(true, std::memory_order_relaxed);
      return;
    }
  }
}

}  // namespace

int wmain(const int argc, wchar_t** argv) {
  if (_setmode(_fileno(stdout), _O_BINARY) == -1) {
    std::cerr << "Could not configure the CAD protocol output stream.\n";
    return 1;
  }
  std::ios::sync_with_stdio(false);
  std::cout.exceptions(std::ios::badbit | std::ios::failbit);

  const std::optional<Arguments> parsed = parse_arguments(argc, argv);
  if (!parsed) {
    std::cerr << "usage: kea3d-cad-worker --protocol 1 --session <id> --input <file.step>\n";
    return 2;
  }
  const Arguments arguments = *parsed;
  std::thread(monitor_commands, std::cref(arguments)).detach();
  std::uint64_t sequence = 1;

  try {
    const std::string input_utf8 = wide_to_utf8(arguments.input.wstring());
    if (input_utf8.empty()) terminal(arguments, sequence, "failure", "The STEP path is not valid UTF-8.", 1);

    const Handle(XCAFApp_Application) application = XCAFApp_Application::GetApplication();
    Handle(TDocStd_Document) document;
    application->NewDocument("BinXCAF", document);

    STEPCAFControl_Reader reader;
    reader.SetNameMode(Standard_True);
    reader.SetColorMode(Standard_True);
    write_progress(arguments, sequence, "reading", 0, 1);
    if (reader.ReadFile(input_utf8.c_str()) != IFSelect_RetDone) {
      terminal(arguments, sequence, "failure", "OpenCascade could not read the STEP file.", 1);
    }
    write_progress(arguments, sequence, "reading", 1, 1);
    if (cancel_requested.load(std::memory_order_relaxed)) {
      terminal(arguments, sequence, "cancelled", "", 0);
    }

    const Handle(CancelIndicator) indicator = new CancelIndicator();
    write_progress(arguments, sequence, "transferring", 0, 1);
    if (!reader.Transfer(document, indicator->Start())) {
      terminal(arguments, sequence, cancel_requested.load() ? "cancelled" : "failure",
               cancel_requested.load() ? "" : "OpenCascade could not transfer the STEP model.",
               cancel_requested.load() ? 0 : 1);
    }
    write_progress(arguments, sequence, "transferring", 1, 1);

    const Handle(XCAFDoc_ShapeTool) shapes = XCAFDoc_DocumentTool::ShapeTool(document->Main());
    const Handle(XCAFDoc_ColorTool) colors = XCAFDoc_DocumentTool::ColorTool(document->Main());
    TDF_LabelSequence roots;
    shapes->GetFreeShapes(roots);
    if (roots.Length() != 1) {
      terminal(arguments, sequence, "failure", "The initial worker requires exactly one STEP root.", 1);
    }
    const TDF_Label root = roots.Value(1);
    const std::vector<TopoDS_Shape> shells = collect_shells(shapes->GetShape(root));
    if (shells.empty()) {
      terminal(arguments, sequence, "failure", "The STEP model does not contain tessellatable shells.", 1);
    }
    const std::string source_name = label_name(root);
    const std::string display_name = source_name.empty()
      ? wide_to_utf8(arguments.input.stem().wstring()) : source_name;
    const std::string manifest =
      "{\"schema\":\"kea3d-cad-manifest-v1\",\"rootId\":\"root\",\"nodes\":[{\"id\":\"root\","
      "\"parentId\":null,\"sourceName\":" +
      (source_name.empty() ? std::string("null") : "\"" + json_escape(source_name) + "\"") +
      ",\"displayName\":\"" + json_escape(display_name) +
      "\",\"transform\":[1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1]}]}";
    if (manifest.size() > max_manifest_bytes) {
      terminal(arguments, sequence, "failure", "The CAD manifest exceeds the protocol limit.", 1);
    }
    const std::vector<std::uint8_t> manifest_payload(manifest.begin(), manifest.end());
    write_frame(base_header(arguments, sequence++, manifest_payload.size()) +
                ",\"type\":\"manifest\",\"rootCount\":1,\"shellCount\":" +
                std::to_string(shells.size()) + '}', manifest_payload);

    std::vector<kea3d::CadThumbnailTriangle> thumbnail_triangles;
    thumbnail_triangles.reserve(std::min<std::size_t>(max_thumbnail_triangles, 250'000));
    std::size_t emitted_shells = 0;
    std::size_t skipped_shells = 0;
    for (std::size_t index = 0; index < shells.size(); ++index) {
      if (cancel_requested.load(std::memory_order_relaxed)) {
        terminal(arguments, sequence, "cancelled", "", 0);
      }
      std::optional<MeshBatch> batch;
      try {
        batch = extract_shell_mesh(shells[index], root, shapes, colors);
        if (!batch) batch = tessellate_shell(shells[index], root, shapes, colors);
      } catch (const Standard_Failure&) {
        if (cancel_requested.load(std::memory_order_relaxed)) {
          terminal(arguments, sequence, "cancelled", "", 0);
        }
      }
      if (!batch) {
        ++skipped_shells;
        write_progress(arguments, sequence, "tessellating", index + 1, shells.size());
        continue;
      }
      if (!valid_mesh_values(*batch)) {
        ++skipped_shells;
        write_progress(arguments, sequence, "tessellating", index + 1, shells.size());
        continue;
      }
      append_thumbnail_triangles(*batch, thumbnail_triangles);
      const std::vector<std::uint8_t> payload = encode_mesh(*batch);
      if (payload.size() > max_mesh_batch_bytes) {
        ++skipped_shells;
        write_progress(arguments, sequence, "tessellating", index + 1, shells.size());
        continue;
      }
      const std::string id = shell_id(index + 1, shells[index], *batch);
      write_frame(base_header(arguments, sequence++, payload.size()) +
                  ",\"type\":\"meshBatch\",\"batchId\":\"" + id +
                  "\",\"nodeId\":\"root\",\"faceCount\":" +
                  std::to_string(batch->face_count) + ",\"coloredFaceCount\":" +
                  std::to_string(batch->colored_face_count) + ",\"vertexCount\":" +
                  std::to_string(batch->positions.size() / 3) + ",\"triangleCount\":" +
                  std::to_string(batch->indices.size() / 3) +
                  ",\"encoding\":\"kea3d-mesh-v1\"}", payload);
      ++emitted_shells;
      write_progress(arguments, sequence, "tessellating", index + 1, shells.size());
    }

    if (emitted_shells == 0) {
      terminal(arguments, sequence, "failure", "OpenCascade could not tessellate any STEP shells.", 1);
    }
    write_thumbnail_cache(arguments.input, thumbnail_triangles);
    const std::string warning = skipped_shells == 0
      ? std::string()
      : "Opened with " + std::to_string(skipped_shells) + " of " +
        std::to_string(shells.size()) + " STEP shells skipped because they could not be tessellated.";
    terminal(arguments, sequence, "success", warning, 0);
  } catch (const Standard_Failure& error) {
    terminal(arguments, sequence, "failure", error.GetMessageString(), 1);
  } catch (const std::exception& error) {
    terminal(arguments, sequence, "failure", error.what(), 1);
  } catch (...) {
    terminal(arguments, sequence, "failure", "The native CAD worker failed unexpectedly.", 1);
  }
}
