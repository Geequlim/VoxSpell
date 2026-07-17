#include "content-length-codec.h"

#include <cassert>
#include <string>

int main() {
	voxspell::ContentLengthCodec codec;
	const auto first = voxspell::ContentLengthCodec::frame(R"({"id":1})");
	const auto second = voxspell::ContentLengthCodec::frame(R"({"id":2})");
	const auto combined = first + second;

	assert(codec.append(combined.substr(0, 12)));
	assert(!codec.next().has_value());
	assert(codec.append(combined.substr(12)));
	assert(codec.next() == R"({"id":1})");
	assert(codec.next() == R"({"id":2})");
	assert(!codec.next().has_value());
	assert(!codec.failed());

	voxspell::ContentLengthCodec invalid;
	assert(invalid.append("Content-Length: nope\r\n\r\n"));
	assert(!invalid.next().has_value());
	assert(invalid.failed());
}
