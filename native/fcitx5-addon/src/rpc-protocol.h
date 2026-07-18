#pragma once

#include <glaze/ext/jsonrpc.hpp>

#include <cstdint>
#include <optional>
#include <string>

namespace voxspell::protocol {

inline constexpr std::int64_t version = 1;

struct EmptyObject {};

struct ServiceInfo {
	std::string name;
	std::string version;
};

struct ServerCapabilities {
	bool partialTranscript = false;
	bool polishPreview = false;
};

struct InitializeParams {
	std::int64_t protocolVersion = version;
	ServiceInfo clientInfo;
};

struct InitializeResult {
	std::int64_t protocolVersion = 0;
	ServiceInfo serverInfo;
	ServerCapabilities capabilities;
};

struct SessionStartParams {
	std::string inputContextId;
};

struct SessionStartResult {
	std::string sessionId;
};

struct SessionParams {
	std::string sessionId;
};

struct SessionCancelParams {
	std::string sessionId;
	std::string reason;
};

struct SessionSelectResultParams {
	std::string sessionId;
	std::string choiceId;
};

struct SessionSetPolishingEnabledParams {
	std::string sessionId;
	bool enabled = false;
};

struct DaemonReadyParams {
	ServiceInfo serverInfo;
	ServerCapabilities capabilities;
};

struct SessionPhaseParams {
	std::string sessionId;
	std::string phase;
};

struct SessionPreviewParams {
	std::string sessionId;
	std::string text;
};

struct SessionPolishingStateParams {
	std::string sessionId;
	bool enabled = false;
};

struct TranscriptResult {
	std::string text;
	std::string status;
};

struct PolishedResult {
	std::string text;
	std::string status;
};

struct SessionResultsParams {
	std::string sessionId;
	TranscriptResult transcript;
	std::optional<PolishedResult> polished;
	std::optional<std::string> recommendedChoiceId;
};

struct SessionCompletedParams {
	std::string sessionId;
	std::string selectedChoiceId;
	std::string text;
};

struct ProtocolErrorData {
	std::string code;
	std::string stage;
	bool retryable = false;
	std::optional<std::string> providerCode;
};

struct SessionErrorParams {
	std::string sessionId;
	ProtocolErrorData error;
};

using InitializeMethod =
	glz::rpc::method<"initialize", InitializeParams, InitializeResult>;
using SessionStartMethod =
	glz::rpc::method<"session.start", SessionStartParams, SessionStartResult>;
using SessionFinishMethod =
	glz::rpc::method<"session.finish", SessionParams, EmptyObject>;
using SessionCancelMethod =
	glz::rpc::method<"session.cancel", SessionCancelParams, EmptyObject>;
using SessionSelectResultMethod = glz::rpc::method<
	"session.selectResult",
	SessionSelectResultParams,
	EmptyObject>;
using SessionSetPolishingEnabledMethod = glz::rpc::method<
	"session.setPolishingEnabled",
	SessionSetPolishingEnabledParams,
	EmptyObject>;

using DaemonReadyMethod =
	glz::rpc::method<"daemon.ready", DaemonReadyParams, EmptyObject>;
using SessionPhaseMethod =
	glz::rpc::method<"session.phase", SessionPhaseParams, EmptyObject>;
using SessionPreviewMethod =
	glz::rpc::method<"session.preview", SessionPreviewParams, EmptyObject>;
using SessionPolishingStateMethod = glz::rpc::method<
	"session.polishingState",
	SessionPolishingStateParams,
	EmptyObject>;
using SessionResultsMethod =
	glz::rpc::method<"session.results", SessionResultsParams, EmptyObject>;
using SessionCompletedMethod =
	glz::rpc::method<"session.completed", SessionCompletedParams, EmptyObject>;
using SessionErrorMethod =
	glz::rpc::method<"session.error", SessionErrorParams, EmptyObject>;

using RpcClient = glz::rpc::client<
	InitializeMethod,
	SessionStartMethod,
	SessionFinishMethod,
	SessionCancelMethod,
	SessionSelectResultMethod,
	SessionSetPolishingEnabledMethod>;
using NotificationServer = glz::rpc::server<
	DaemonReadyMethod,
	SessionPhaseMethod,
	SessionPreviewMethod,
	SessionPolishingStateMethod,
	SessionResultsMethod,
	SessionCompletedMethod,
	SessionErrorMethod>;

} // namespace voxspell::protocol
