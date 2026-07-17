#pragma once

#include <cstddef>
#include <optional>
#include <string>
#include <string_view>

namespace voxspell {

class ContentLengthCodec final {
public:
	static constexpr std::size_t maxContentLength = 1024 * 1024;

	static std::string frame(std::string_view content);

	bool append(std::string_view chunk);
	std::optional<std::string> next();
	bool failed() const;

private:
	std::string buffer_;
	std::optional<std::size_t> contentLength_;
	bool failed_ = false;
};

} // namespace voxspell
