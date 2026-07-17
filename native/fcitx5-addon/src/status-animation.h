#pragma once

#include <cstdint>
#include <filesystem>
#include <optional>
#include <string>
#include <string_view>
#include <unordered_map>
#include <vector>

namespace voxspell {

struct StatusAnimationStage {
	std::string id;
	std::string name;
	std::vector<std::string> frames;
	std::string text;
	std::string hint;
	std::uint64_t interval = 0;
};

using StatusAnimationConfig =
	std::unordered_map<std::string, StatusAnimationStage>;

StatusAnimationConfig defaultStatusAnimationConfig();

std::optional<StatusAnimationConfig>
parseStatusAnimationConfig(std::string_view source);

StatusAnimationConfig
loadStatusAnimationConfig(const std::filesystem::path &path);

std::filesystem::path statusAnimationConfigPath();

} // namespace voxspell
