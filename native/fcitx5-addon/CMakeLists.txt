cmake_minimum_required(VERSION 3.20)

project(voxspell-fcitx5-addon VERSION 0.1.0 LANGUAGES CXX)

include(GNUInstallDirs)
include(CTest)

find_package(Fcitx5Core 5.1.0 REQUIRED)

add_library(voxspell MODULE
	src/addon.cpp
	src/content-length-codec.cpp
	src/daemon-client.cpp
	src/error-presentation.cpp
	src/status-animation.cpp
	src/tap-hold-state.cpp
)

target_compile_features(voxspell PRIVATE cxx_std_23)
target_include_directories(voxspell PRIVATE third_party/glaze/include)
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

	add_executable(content-length-codec-test
		test/content-length-codec-test.cpp
		src/content-length-codec.cpp
	)
	target_compile_features(content-length-codec-test PRIVATE cxx_std_23)
	target_include_directories(content-length-codec-test PRIVATE src)
	set_target_properties(content-length-codec-test PROPERTIES CXX_EXTENSIONS OFF)
	add_test(NAME content-length-codec COMMAND content-length-codec-test)

	add_executable(error-presentation-test
		test/error-presentation-test.cpp
		src/error-presentation.cpp
	)
	target_compile_features(error-presentation-test PRIVATE cxx_std_23)
	target_include_directories(error-presentation-test PRIVATE
		src
		third_party/glaze/include
	)
	set_target_properties(error-presentation-test PROPERTIES CXX_EXTENSIONS OFF)
	add_test(NAME error-presentation COMMAND error-presentation-test)

	add_executable(config-default-test
		test/config-default-test.cpp
	)
	target_compile_features(config-default-test PRIVATE cxx_std_23)
	target_include_directories(config-default-test PRIVATE src)
	target_link_libraries(config-default-test PRIVATE Fcitx5::Core)
	set_target_properties(config-default-test PROPERTIES CXX_EXTENSIONS OFF)
	add_test(NAME config-default COMMAND config-default-test)

	add_executable(status-animation-test
		test/status-animation-test.cpp
		src/status-animation.cpp
	)
	target_compile_features(status-animation-test PRIVATE cxx_std_23)
	target_include_directories(status-animation-test PRIVATE
		src
		third_party/glaze/include
	)
	set_target_properties(status-animation-test PROPERTIES CXX_EXTENSIONS OFF)
	add_test(NAME status-animation COMMAND status-animation-test)

	add_executable(recurring-timer-test
		test/recurring-timer-test.cpp
	)
	target_compile_features(recurring-timer-test PRIVATE cxx_std_23)
	target_link_libraries(recurring-timer-test PRIVATE Fcitx5::Core)
	set_target_properties(recurring-timer-test PROPERTIES CXX_EXTENSIONS OFF)
	add_test(NAME recurring-timer COMMAND recurring-timer-test)

	add_executable(daemon-client-smoke
		test/daemon-client-smoke.cpp
		src/content-length-codec.cpp
		src/daemon-client.cpp
	)
	target_compile_features(daemon-client-smoke PRIVATE cxx_std_23)
	target_include_directories(daemon-client-smoke PRIVATE
		src
		third_party/glaze/include
	)
	target_link_libraries(daemon-client-smoke PRIVATE Fcitx5::Core)
	set_target_properties(daemon-client-smoke PROPERTIES CXX_EXTENSIONS OFF)
	add_test(
		NAME daemon-client-smoke
		COMMAND "${CMAKE_COMMAND}" -E env node
			"${CMAKE_CURRENT_SOURCE_DIR}/test/run-daemon-client-smoke.mjs"
			"$<TARGET_FILE:daemon-client-smoke>"
	)
endif()
