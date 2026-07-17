#include "status-animation.h"

#include <glaze/json.hpp>

#include <algorithm>
#include <cstdlib>
#include <fstream>
#include <iterator>
#include <utility>

namespace voxspell {

namespace {

constexpr std::size_t maximumFrameCount = 256;
constexpr std::uint64_t minimumIntervalMs = 80;
constexpr std::uint64_t maximumIntervalMs = 2000;

bool validStage(const StatusAnimationStage &stage) {
	return !stage.id.empty() && !stage.text.empty() && !stage.frames.empty() &&
		stage.frames.size() <= maximumFrameCount &&
		std::ranges::all_of(
			stage.frames,
			[](const std::string &frame) { return !frame.empty(); }) &&
		stage.interval >= minimumIntervalMs &&
		stage.interval <= maximumIntervalMs;
}

} // namespace

StatusAnimationConfig defaultStatusAnimationConfig() {
	std::vector<StatusAnimationStage> stages{
		{
			.id = "connecting",
			.name = "连接服务",
			.frames = {"📡", "🌐", "🔗", "🌐"},
			.text = "连接语音服务",
			.hint = "请稍候",
			.interval = 520,
		},
		{
			.id = "preparing",
			.name = "准备中",
			.frames = {"⏳", "⌛", "⏳", "⌛"},
			.text = "准备中",
			.hint = "请稍候",
			.interval = 420,
		},
		{
			.id = "recording",
			.name = "录音",
			.frames = {"🔈", "🔉", "🔊", "🔉"},
			.text = "请开始讲话",
			.hint = "松开热键完成，Esc 取消",
			.interval = 240,
		},
		{
			.id = "recognizing",
			.name = "识别中",
			.frames = {"💭", "💬", "💭", "💬"},
			.text = "正在识别",
			.hint = "请稍候",
			.interval = 520,
		},
		{
			.id = "processing",
			.name = "处理中",
			.frames = {"🧠", "💭"},
			.text = "正在处理",
			.hint = "请稍候",
			.interval = 420,
		},
		{
			.id = "polishing",
			.name = "润色中",
			.frames = {"✨", "🌟", "💫", "🌟", "✨"},
			.text = "正在润色",
			.hint = "请稍候",
			.interval = 420,
		},
		{
			.id = "choosing",
			.name = "选择结果",
			.frames = {"👇"},
			.text = "请选择结果",
			.hint = "1 润色结果 · 2 识别结果 · Enter 确认",
			.interval = 500,
		},
		{
			.id = "submitting",
			.name = "提交中",
			.frames = {"📤", "⏳", "⌛", "⏳", "📤"},
			.text = "正在提交",
			.hint = "请稍候",
			.interval = 320,
		},
	};

	StatusAnimationConfig config;
	for (auto &stage : stages) {
		config.emplace(stage.id, std::move(stage));
	}
	return config;
}

std::optional<StatusAnimationConfig>
parseStatusAnimationConfig(std::string_view source) {
	std::vector<StatusAnimationStage> overrides;
	if (glz::read_json(overrides, source)) {
		return std::nullopt;
	}

	auto config = defaultStatusAnimationConfig();
	StatusAnimationConfig seen;
	for (auto &stage : overrides) {
		if (!config.contains(stage.id) || !validStage(stage) ||
			seen.contains(stage.id)) {
			return std::nullopt;
		}
		seen.emplace(stage.id, stage);
		config.insert_or_assign(stage.id, std::move(stage));
	}
	return config;
}

StatusAnimationConfig
loadStatusAnimationConfig(const std::filesystem::path &path) {
	std::ifstream stream(path);
	if (!stream) {
		return defaultStatusAnimationConfig();
	}
	const std::string source{
		std::istreambuf_iterator<char>(stream),
		std::istreambuf_iterator<char>()};
	auto config = parseStatusAnimationConfig(source);
	return config ? std::move(*config) : defaultStatusAnimationConfig();
}

std::filesystem::path statusAnimationConfigPath() {
	if (const auto *configHome = std::getenv("XDG_CONFIG_HOME");
		configHome && *configHome) {
		return std::filesystem::path(configHome) / "voxspell" /
			"status-animation.json";
	}
	if (const auto *home = std::getenv("HOME"); home && *home) {
		return std::filesystem::path(home) / ".config" / "voxspell" /
			"status-animation.json";
	}
	return {};
}

} // namespace voxspell
