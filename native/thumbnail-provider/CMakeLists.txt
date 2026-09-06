cmake_minimum_required(VERSION 3.24)
project(Kea3DThumbnailProvider LANGUAGES CXX)
enable_testing()

include(FetchContent)
FetchContent_Declare(
  cgltf
  GIT_REPOSITORY https://github.com/jkuhlmann/cgltf.git
  GIT_TAG bbeb5b0b070ddacddac6852fb72143eb68454937
  GIT_SHALLOW TRUE
)
FetchContent_MakeAvailable(cgltf)

add_library(Kea3DThumbnailProvider SHARED
  src/provider.def
  src/provider.cpp
  src/thumbnail_renderer.cpp
)
target_compile_features(Kea3DThumbnailProvider PRIVATE cxx_std_20)
target_compile_definitions(Kea3DThumbnailProvider PRIVATE UNICODE _UNICODE WIN32_LEAN_AND_MEAN NOMINMAX)
target_include_directories(Kea3DThumbnailProvider PRIVATE ${cgltf_SOURCE_DIR} src)
target_link_libraries(Kea3DThumbnailProvider PRIVATE ole32 windowscodecs)
set_target_properties(Kea3DThumbnailProvider PROPERTIES OUTPUT_NAME "Kea3DThumbnailProvider")

add_executable(Kea3DThumbnailTest
  src/thumbnail_test.cpp
  src/thumbnail_renderer.cpp
)
target_compile_features(Kea3DThumbnailTest PRIVATE cxx_std_20)
target_compile_definitions(Kea3DThumbnailTest PRIVATE UNICODE _UNICODE WIN32_LEAN_AND_MEAN NOMINMAX)
target_include_directories(Kea3DThumbnailTest PRIVATE ${cgltf_SOURCE_DIR} src)
target_link_libraries(Kea3DThumbnailTest PRIVATE ole32 windowscodecs)

add_executable(Kea3DThumbnailUnitTests
  src/thumbnail_renderer_tests.cpp
  src/thumbnail_renderer.cpp
)
target_compile_features(Kea3DThumbnailUnitTests PRIVATE cxx_std_20)
target_compile_definitions(Kea3DThumbnailUnitTests PRIVATE UNICODE _UNICODE WIN32_LEAN_AND_MEAN NOMINMAX)
target_include_directories(Kea3DThumbnailUnitTests PRIVATE ${cgltf_SOURCE_DIR} src)
target_link_libraries(Kea3DThumbnailUnitTests PRIVATE ole32 windowscodecs)
add_test(NAME thumbnail_renderer_safety COMMAND Kea3DThumbnailUnitTests)
set_tests_properties(thumbnail_renderer_safety PROPERTIES TIMEOUT 5)

add_executable(Kea3DShellThumbnailTest src/shell_thumbnail_test.cpp)
target_compile_features(Kea3DShellThumbnailTest PRIVATE cxx_std_20)
target_compile_definitions(Kea3DShellThumbnailTest PRIVATE UNICODE _UNICODE WIN32_LEAN_AND_MEAN NOMINMAX)
target_link_libraries(Kea3DShellThumbnailTest PRIVATE ole32 shell32 gdi32)
