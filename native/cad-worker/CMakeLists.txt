cmake_minimum_required(VERSION 3.24)
project(kea3d_cad_worker VERSION 0.1.0 LANGUAGES CXX)

if(NOT WIN32 OR NOT CMAKE_SIZEOF_VOID_P EQUAL 8)
  message(FATAL_ERROR "The initial Kea3D CAD worker supports Windows x64 only.")
endif()

find_package(OpenCASCADE 7.8.1 EXACT REQUIRED COMPONENTS
  FoundationClasses
  ModelingData
  ModelingAlgorithms
  ApplicationFramework
  DataExchange
)

include(FetchContent)
FetchContent_Declare(
  cgltf
  GIT_REPOSITORY https://github.com/jkuhlmann/cgltf.git
  GIT_TAG bbeb5b0b070ddacddac6852fb72143eb68454937
  GIT_SHALLOW TRUE
)
FetchContent_MakeAvailable(cgltf)

add_executable(kea3d-cad-worker
  src/main.cpp
  ../thumbnail-provider/src/thumbnail_renderer.cpp
)
target_compile_features(kea3d-cad-worker PRIVATE cxx_std_20)
target_compile_definitions(kea3d-cad-worker PRIVATE NOMINMAX WIN32_LEAN_AND_MEAN)
target_include_directories(kea3d-cad-worker PRIVATE ${cgltf_SOURCE_DIR} ../thumbnail-provider/src)
target_link_directories(kea3d-cad-worker PRIVATE ${OpenCASCADE_LIBRARY_DIR})
target_link_libraries(kea3d-cad-worker PRIVATE ${OpenCASCADE_LIBRARIES} ole32 windowscodecs)

if(MSVC)
  target_compile_options(kea3d-cad-worker PRIVATE /W4 /permissive- /EHsc)
endif()

install(TARGETS kea3d-cad-worker RUNTIME DESTINATION .)
