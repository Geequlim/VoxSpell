#pragma once

#include "rpc-protocol.h"

#include <string>
#include <string_view>

namespace voxspell {

struct ErrorPresentation {
	std::string summary;
	std::string diagnostic;
};

ErrorPresentation presentSessionError(const protocol::ProtocolErrorData &error);
ErrorPresentation presentClientError(std::string_view message);

} // namespace voxspell
