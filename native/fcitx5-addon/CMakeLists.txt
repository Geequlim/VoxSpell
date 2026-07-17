cmake_minimum_required(VERSION 3.20)

project(voxspell-fcitx5-addon VERSION 0.1.0 LANGUAGES CXX)

include(GNUInstallDirs)

find_package(Fcitx5Core 5.1.0 REQUIRED)

add_library(voxspell MODULE
	src/addon.cpp
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
