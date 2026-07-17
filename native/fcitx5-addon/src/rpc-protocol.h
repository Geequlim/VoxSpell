#pragma once

#include <glaze/ext/jsonrpc.hpp>

#include <cstdint>
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

struct DaemonReadyParams {
	ServiceInfo serverInfo;
	ServerCapabilities capabilities;
};

struct TranscriptPartialParams {
	std::string sessionId;
	std::string segmentId;
	std::int64_t revision = 0;
	std::string text;
};

struct AsrReadyParams {
	std::string sessionId;
	std::string providerId;
};

struct TranscriptSegmentFinalParams {
	std::string sessionId;
	std::string segmentId;
	std::string text;
};

struct TranscriptFinalParams {
	std::string sessionId;
	std::string text;
};

struct SessionCompletedParams {
	std::string sessionId;
	std::string text;
};

struct ProtocolErrorData {
	std::string code;
	std::string message;
};

struct SessionErrorParams {
	std::string sessionId;
	ProtocolErrorData error;
};

struct MessageHeader {
	std::string method;
};

using InitializeMethod =
	glz::rpc::method<"initialize", InitializeParams, InitializeResult>;
using SessionStartMethod =
	glz::rpc::method<"session.start", SessionStartParams, SessionStartResult>;
using SessionFinishMethod =
	glz::rpc::method<"session.finish", SessionParams, EmptyObject>;
using SessionCancelMethod =
	glz::rpc::method<"session.cancel", SessionCancelParams, EmptyObject>;

using DaemonReadyMethod =
	glz::rpc::method<"daemon.ready", DaemonReadyParams, EmptyObject>;
using SessionRecordingMethod =
	glz::rpc::method<"session.recording", SessionParams, EmptyObject>;
using AsrReadyMethod =
	glz::rpc::method<"asr.ready", AsrReadyParams, EmptyObject>;
using TranscriptPartialMethod =
	glz::rpc::method<"transcript.partial", TranscriptPartialParams, EmptyObject>;
using TranscriptSegmentFinalMethod = glz::rpc::method<
	"transcript.segmentFinal",
	TranscriptSegmentFinalParams,
	EmptyObject>;
using TranscriptFinalMethod =
	glz::rpc::method<"transcript.final", TranscriptFinalParams, EmptyObject>;
using SessionCompletedMethod =
	glz::rpc::method<"session.completed", SessionCompletedParams, EmptyObject>;
using SessionErrorMethod =
	glz::rpc::method<"session.error", SessionErrorParams, EmptyObject>;

using RpcClient = glz::rpc::client<
	InitializeMethod,
	SessionStartMethod,
	SessionFinishMethod,
	SessionCancelMethod>;
using NotificationServer = glz::rpc::server<
	DaemonReadyMethod,
	SessionRecordingMethod,
	AsrReadyMethod,
	TranscriptPartialMethod,
	TranscriptSegmentFinalMethod,
	TranscriptFinalMethod,
	SessionCompletedMethod,
	SessionErrorMethod>;

} // namespace voxspell::protocol
