cmake_minimum_required(VERSION 3.24)
project(kea3d_cad_worker VERSION 0.1.0 LANGUAGES CXX)

if(NOT CMAKE_SIZEOF_VOID_P EQUAL 8)
  message(FATAL_ERROR "The Kea3D CAD worker requires a 64-bit target.")
endif()

if(WIN32)
  find_package(OpenCASCADE 7.8.1 EXACT REQUIRED COMPONENTS
    FoundationClasses
    ModelingData
    ModelingAlgorithms
    ApplicationFramework
    DataExchange
  )
else()
  find_path(OpenCASCADE_INCLUDE_DIR Standard_Version.hxx PATH_SUFFIXES opencascade REQUIRED)
  set(OpenCASCADE_LIBRARIES)
  find_library(OpenCASCADE_STEP_LIBRARY NAMES TKDESTEP TKXDESTEP REQUIRED)
  list(APPEND OpenCASCADE_LIBRARIES ${OpenCASCADE_STEP_LIBRARY})
  foreach(component TKXCAF TKVCAF TKCAF TKLCAF TKCDF TKMesh TKTopAlgo TKBRep TKV3d TKG3d TKMath TKernel)
    find_library(OpenCASCADE_${component}_LIBRARY NAMES ${component} REQUIRED)
    list(APPEND OpenCASCADE_LIBRARIES ${OpenCASCADE_${component}_LIBRARY})
  endforeach()
endif()

add_executable(kea3d-cad-worker
  src/main.cpp
)
target_compile_features(kea3d-cad-worker PRIVATE cxx_std_20)
target_include_directories(kea3d-cad-worker SYSTEM PRIVATE ${OpenCASCADE_INCLUDE_DIR})
target_link_directories(kea3d-cad-worker PRIVATE ${OpenCASCADE_LIBRARY_DIR})
target_link_libraries(kea3d-cad-worker PRIVATE ${OpenCASCADE_LIBRARIES})

if(WIN32)
  include(FetchContent)
  FetchContent_Declare(
    cgltf
    GIT_REPOSITORY https://github.com/jkuhlmann/cgltf.git
    GIT_TAG bbeb5b0b070ddacddac6852fb72143eb68454937
    GIT_SHALLOW TRUE
  )
  FetchContent_MakeAvailable(cgltf)
  target_sources(kea3d-cad-worker PRIVATE ../thumbnail-provider/src/thumbnail_renderer.cpp)
  target_compile_definitions(kea3d-cad-worker PRIVATE NOMINMAX WIN32_LEAN_AND_MEAN)
  target_include_directories(kea3d-cad-worker PRIVATE ${cgltf_SOURCE_DIR} ../thumbnail-provider/src)
  target_link_libraries(kea3d-cad-worker PRIVATE ole32 windowscodecs)
endif()

if(MSVC)
  target_compile_options(kea3d-cad-worker PRIVATE /W4 /permissive- /EHsc)
else()
  target_compile_options(kea3d-cad-worker PRIVATE -Wall -Wextra -Wpedantic -Werror)
endif()

install(TARGETS kea3d-cad-worker RUNTIME DESTINATION .)
