#pragma once

#include "content-length-codec.h"
#include "rpc-protocol.h"

#include <fcitx-utils/event.h>

#include <cstdint>
#include <functional>
#include <memory>
#include <optional>
#include <string>

namespace voxspell {

class DaemonClient final {
public:
	struct Callbacks {
		std::function<void()> ready;
		std::function<void(const std::string &)> started;
		std::function<void(const protocol::SessionPhaseParams &)> phase;
		std::function<void(const protocol::SessionPreviewParams &)> preview;
		std::function<void(const protocol::SessionPolishingStateParams &)> polishingState;
		std::function<void(const protocol::SessionResultsParams &)> results;
		std::function<void(const protocol::SessionCompletedParams &)> completed;
		std::function<void(const protocol::SessionErrorParams &)> sessionError;
		std::function<void(
			const std::string &,
			const std::string &,
			const std::optional<protocol::ProtocolErrorData> &)> error;
		std::function<void()> disconnected;
	};

	DaemonClient(fcitx::EventLoop &eventLoop, Callbacks callbacks);
	~DaemonClient();

	DaemonClient(const DaemonClient &) = delete;
	DaemonClient &operator=(const DaemonClient &) = delete;

	bool ready() const;
	void start(std::string inputContextId);
	void cancelPendingStart();
	void finish(const std::string &sessionId);
	void cancel(const std::string &sessionId, std::string reason);
	void selectResult(const std::string &sessionId, std::string choiceId);
	void setPolishingEnabled(const std::string &sessionId, bool enabled);

private:
	enum class ConnectionState {
		Disconnected,
		Connecting,
		Connected,
	};

	void configureNotifications();
	void ensureConnected();
	void sendInitialize();
	void sendPendingStart();
	void queue(std::string message);
	void updateIoEvents();
	bool handleIo(fcitx::IOEventFlags flags);
	bool completeConnection();
	bool readAvailable();
	bool writeAvailable();
	void handleMessage(const std::string &message);
	void reportError(std::string context, const glz::rpc::error &error);
	void disconnect(bool notify);
	std::int64_t nextRequestId();

	fcitx::EventLoop &eventLoop_;
	Callbacks callbacks_;
	ConnectionState connectionState_ = ConnectionState::Disconnected;
	int socketFd_ = -1;
	std::unique_ptr<fcitx::EventSourceIO> ioEvent_;
	ContentLengthCodec codec_;
	std::string output_;
	std::size_t outputOffset_ = 0;
	std::int64_t requestId_ = 0;
	bool ready_ = false;
	std::optional<protocol::SessionStartParams> pendingStart_;
	protocol::RpcClient rpcClient_;
	protocol::NotificationServer notificationServer_;
};

} // namespace voxspell
