#include "content-length-codec.h"

#include <charconv>
#include <string>

namespace voxspell {

namespace {

constexpr std::string_view headerSeparator = "\r\n\r\n";
constexpr std::string_view contentLengthHeader = "Content-Length:";

} // namespace

std::string ContentLengthCodec::frame(std::string_view content) {
	return "Content-Length: " + std::to_string(content.size()) + "\r\n\r\n" +
		std::string(content);
}

bool ContentLengthCodec::append(std::string_view chunk) {
	if (failed_ || buffer_.size() + chunk.size() > maxContentLength * 2) {
		failed_ = true;
		return false;
	}
	buffer_.append(chunk);
	return true;
}

std::optional<std::string> ContentLengthCodec::next() {
	if (failed_) {
		return std::nullopt;
	}

	if (!contentLength_) {
		const auto separator = buffer_.find(headerSeparator);
		if (separator == std::string::npos) {
			return std::nullopt;
		}

		const std::string_view headers(buffer_.data(), separator);
		const auto lineEnd = headers.find("\r\n");
		const auto firstLine = headers.substr(0, lineEnd);
		if (!firstLine.starts_with(contentLengthHeader)) {
			failed_ = true;
			return std::nullopt;
		}

		auto value = firstLine.substr(contentLengthHeader.size());
		while (!value.empty() && value.front() == ' ') {
			value.remove_prefix(1);
		}
		std::size_t parsedLength = 0;
		const auto [end, error] = std::from_chars(
			value.data(),
			value.data() + value.size(),
			parsedLength);
		if (error != std::errc() || end != value.data() + value.size() ||
			parsedLength > maxContentLength) {
			failed_ = true;
			return std::nullopt;
		}

		contentLength_ = parsedLength;
		buffer_.erase(0, separator + headerSeparator.size());
	}

	if (buffer_.size() < *contentLength_) {
		return std::nullopt;
	}

	std::string content = buffer_.substr(0, *contentLength_);
	buffer_.erase(0, *contentLength_);
	contentLength_.reset();
	return content;
}

bool ContentLengthCodec::failed() const {
	return failed_;
}

} // namespace voxspell
