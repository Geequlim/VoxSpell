cmake_minimum_required(VERSION 3.20)

project(voxspell-fcitx5-addon VERSION 0.1.0 LANGUAGES CXX)

include(GNUInstallDirs)
include(CTest)

find_package(Fcitx5Core 5.1.0 REQUIRED)

add_library(voxspell MODULE
	src/addon.cpp
	src/tap-hold-state.cpp
)

target_compile_features(voxspell PRIVATE cxx_std_20)
target_link_libraries(voxspell PRIVATE Fcitx5::Core)

set_target_properties(voxspell PROPERTIES
	CXX_EXTENSIONS OFF
	OUTPUT_NAME voxspell
	PREFIX ""
)

configure_file(data/voxspell.conf.in voxspell.conf @ONLY)

install(TARGETS voxspell
	LIBRARY DESTINATION "${CMAKE_INSTALL_LIBDIR}/fcitx5"
)
install(FILES "${CMAKE_CURRENT_BINARY_DIR}/voxspell.conf"
	DESTINATION "${CMAKE_INSTALL_DATADIR}/fcitx5/addon"
)

if(BUILD_TESTING)
	add_executable(tap-hold-state-test
		test/tap-hold-state-test.cpp
		src/tap-hold-state.cpp
	)
	target_compile_features(tap-hold-state-test PRIVATE cxx_std_20)
	target_include_directories(tap-hold-state-test PRIVATE src)
	set_target_properties(tap-hold-state-test PROPERTIES CXX_EXTENSIONS OFF)
	add_test(NAME tap-hold-state COMMAND tap-hold-state-test)
endif()
