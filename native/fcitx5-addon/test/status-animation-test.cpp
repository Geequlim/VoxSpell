#include "status-animation.h"

#include <iostream>
#include <string_view>

namespace {

bool expect(bool condition, std::string_view message) {
	if (!condition) {
		std::cerr << message << '\n';
	}
	return condition;
}

} // namespace

int main() {
	bool passed = true;
	const auto defaults = voxspell::defaultStatusAnimationConfig();
	passed &= expect(defaults.size() == 8, "default stage count");
	passed &= expect(
		defaults.at("connecting").frames.front() == "📡",
		"connecting default frame");
	passed &= expect(
		defaults.at("recording").interval == 240,
		"recording default interval");
	passed &= expect(
		defaults.at("choosing").frames.front() == "👇",
		"choosing default frame");

	constexpr std::string_view validOverride = R"json([
		{
			"id": "recording",
			"name": "自定义录音",
			"frames": ["🎙️", "🔴", "🎙️"],
			"text": "现在讲话",
			"hint": "松开完成",
			"interval": 180
		}
	])json";
	const auto configured = voxspell::parseStatusAnimationConfig(validOverride);
	passed &= expect(configured.has_value(), "valid override parses");
	if (configured) {
		passed &= expect(
			configured->at("recording").frames.size() == 3,
			"override frames applied");
		passed &= expect(
			configured->at("preparing").frames == defaults.at("preparing").frames,
			"missing stage keeps default");
	}

	passed &= expect(
		!voxspell::parseStatusAnimationConfig(
			R"([{"id":"unknown","frames":["x"],"interval":100}])"),
		"unknown stage rejected");
	passed &= expect(
		!voxspell::parseStatusAnimationConfig(
			R"([{"id":"recording","frames":[],"interval":100}])"),
		"empty frames rejected");
	passed &= expect(
		!voxspell::parseStatusAnimationConfig(
			R"([{"id":"recording","frames":["x"],"text":"","interval":100}])"),
		"empty text rejected");
	passed &= expect(
		!voxspell::parseStatusAnimationConfig(
			R"([{"id":"recording","frames":["x"],"interval":79}])"),
		"short interval rejected");
	passed &= expect(
		!voxspell::parseStatusAnimationConfig(R"([
			{"id":"recording","frames":["x"],"interval":100},
			{"id":"recording","frames":["y"],"interval":100}
		])"),
		"duplicate stage rejected");

	return passed ? 0 : 1;
}
