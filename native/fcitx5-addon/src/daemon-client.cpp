#include "daemon-client.h"

#include <glaze/glaze.hpp>

#include <sys/socket.h>
#include <sys/un.h>
#include <unistd.h>

#include <cerrno>
#include <cstdlib>
#include <cstring>
#include <string>
#include <utility>

namespace voxspell {

namespace {

std::string daemonSocketPath() {
	if (const auto *runtimeDirectory = std::getenv("XDG_RUNTIME_DIR")) {
		return std::string(runtimeDirectory) + "/voxspell/daemon.sock";
	}
	return "/run/user/" + std::to_string(getuid()) + "/voxspell/daemon.sock";
}

std::string rpcErrorMessage(const glz::rpc::error &error) {
	std::string message = error.message.empty()
		? std::string(glz::rpc::code_as_sv(error.code))
		: error.message;
	if (error.data && !error.data->empty()) {
		message += ": " + *error.data;
	}
	return message;
}

} // namespace

DaemonClient::DaemonClient(
	fcitx::EventLoop &eventLoop,
	Callbacks callbacks)
	: eventLoop_(eventLoop), callbacks_(std::move(callbacks)) {
	configureNotifications();
}

DaemonClient::~DaemonClient() {
	disconnect(false);
}

bool DaemonClient::ready() const {
	return ready_;
}

void DaemonClient::start(std::string inputContextId) {
	pendingInputContextId_ = std::move(inputContextId);
	if (ready_) {
		sendPendingStart();
		return;
	}
	ensureConnected();
}

void DaemonClient::cancelPendingStart() {
	pendingInputContextId_.reset();
}

void DaemonClient::finish(const std::string &sessionId) {
	if (!ready_ || sessionId.empty()) {
		return;
	}

	auto [message, inserted] = rpcClient_.request<"session.finish">(
		nextRequestId(),
		protocol::SessionParams{sessionId},
		[this, sessionId](const auto &result, const auto &) {
			if (!result) {
				reportError(sessionId, result.error());
			}
		});
	if (inserted) {
		queue(std::move(message));
	}
}

void DaemonClient::cancel(const std::string &sessionId, std::string reason) {
	if (!ready_ || sessionId.empty()) {
		return;
	}

	auto [message, inserted] = rpcClient_.request<"session.cancel">(
		nextRequestId(),
		protocol::SessionCancelParams{sessionId, std::move(reason)},
		[this, sessionId](const auto &result, const auto &) {
			if (!result) {
				reportError(sessionId, result.error());
			}
		});
	if (inserted) {
		queue(std::move(message));
	}
}

void DaemonClient::selectResult(
	const std::string &sessionId,
	std::string choiceId) {
	if (!ready_ || sessionId.empty()) {
		return;
	}

	auto [message, inserted] = rpcClient_.request<"session.selectResult">(
		nextRequestId(),
		protocol::SessionSelectResultParams{sessionId, std::move(choiceId)},
		[this, sessionId](const auto &result, const auto &) {
			if (!result) {
				reportError(sessionId, result.error());
			}
		});
	if (inserted) {
		queue(std::move(message));
	}
}

void DaemonClient::configureNotifications() {
	notificationServer_.on<"daemon.ready">(
		[](const protocol::DaemonReadyParams &) {
			return protocol::EmptyObject{};
		});
	notificationServer_.on<"session.phase">(
		[this](const protocol::SessionPhaseParams &params) {
			if (callbacks_.phase) {
				callbacks_.phase(params);
			}
			return protocol::EmptyObject{};
		});
	notificationServer_.on<"session.preview">(
		[this](const protocol::SessionPreviewParams &params) {
			if (callbacks_.preview) {
				callbacks_.preview(params);
			}
			return protocol::EmptyObject{};
		});
	notificationServer_.on<"session.results">(
		[this](const protocol::SessionResultsParams &params) {
			if (callbacks_.results) {
				callbacks_.results(params);
			}
			return protocol::EmptyObject{};
		});
	notificationServer_.on<"session.completed">(
		[this](const protocol::SessionCompletedParams &params) {
			if (callbacks_.completed) {
				callbacks_.completed(params);
			}
			return protocol::EmptyObject{};
		});
	notificationServer_.on<"session.error">(
		[this](const protocol::SessionErrorParams &params) {
			if (callbacks_.sessionError) {
				callbacks_.sessionError(params);
			}
			return protocol::EmptyObject{};
		});
}

void DaemonClient::ensureConnected() {
	if (connectionState_ != ConnectionState::Disconnected) {
		return;
	}

	const auto path = daemonSocketPath();
	if (path.size() >= sizeof(sockaddr_un::sun_path)) {
		if (callbacks_.error) {
			callbacks_.error({}, "daemon socket path is too long");
		}
		return;
	}

	socketFd_ = socket(AF_UNIX, SOCK_STREAM | SOCK_NONBLOCK | SOCK_CLOEXEC, 0);
	if (socketFd_ < 0) {
		if (callbacks_.error) {
			callbacks_.error({}, std::strerror(errno));
		}
		return;
	}

	sockaddr_un address{};
	address.sun_family = AF_UNIX;
	std::memcpy(address.sun_path, path.c_str(), path.size() + 1);
	const auto result = connect(
		socketFd_,
		reinterpret_cast<const sockaddr *>(&address),
		sizeof(address));
	if (result == 0) {
		connectionState_ = ConnectionState::Connected;
	} else if (errno == EINPROGRESS) {
		connectionState_ = ConnectionState::Connecting;
	} else {
		const std::string message = std::strerror(errno);
		disconnect(false);
		if (callbacks_.error) {
			callbacks_.error({}, message);
		}
		return;
	}

	ioEvent_ = eventLoop_.addIOEvent(
		socketFd_,
		{fcitx::IOEventFlag::In, fcitx::IOEventFlag::Out},
		[this](fcitx::EventSourceIO *, int, fcitx::IOEventFlags flags) {
			return handleIo(flags);
		});
	if (connectionState_ == ConnectionState::Connected) {
		sendInitialize();
	}
}

void DaemonClient::sendInitialize() {
	auto [message, inserted] = rpcClient_.request<"initialize">(
		nextRequestId(),
		protocol::InitializeParams{
			.protocolVersion = protocol::version,
			.clientInfo = {.name = "voxspell-fcitx5", .version = "0.1.0"}},
		[this](const auto &result, const auto &) {
			if (!result) {
				reportError({}, result.error());
				return;
			}
			if (result->protocolVersion != protocol::version) {
				if (callbacks_.error) {
					callbacks_.error({}, "unsupported daemon protocol version");
				}
				return;
			}
			ready_ = true;
			if (callbacks_.ready) {
				callbacks_.ready();
			}
			sendPendingStart();
		});
	if (inserted) {
		queue(std::move(message));
	}
}

void DaemonClient::sendPendingStart() {
	if (!ready_ || !pendingInputContextId_) {
		return;
	}

	auto inputContextId = std::move(*pendingInputContextId_);
	pendingInputContextId_.reset();
	auto [message, inserted] = rpcClient_.request<"session.start">(
		nextRequestId(),
		protocol::SessionStartParams{std::move(inputContextId)},
		[this](const auto &result, const auto &) {
			if (!result) {
				reportError({}, result.error());
				return;
			}
			if (callbacks_.started) {
				callbacks_.started(result->sessionId);
			}
		});
	if (inserted) {
		queue(std::move(message));
	}
}

void DaemonClient::queue(std::string message) {
	output_ += ContentLengthCodec::frame(message);
	updateIoEvents();
}

void DaemonClient::updateIoEvents() {
	if (!ioEvent_) {
		return;
	}
	fcitx::IOEventFlags flags{fcitx::IOEventFlag::In};
	if (connectionState_ == ConnectionState::Connecting ||
		outputOffset_ < output_.size()) {
		flags |= fcitx::IOEventFlag::Out;
	}
	ioEvent_->setEvents(flags);
}

bool DaemonClient::handleIo(fcitx::IOEventFlags flags) {
	if (flags.testAny(fcitx::IOEventFlags{
			fcitx::IOEventFlag::Err,
			fcitx::IOEventFlag::Hup})) {
		disconnect(true);
		return false;
	}
	if (connectionState_ == ConnectionState::Connecting &&
		flags.test(fcitx::IOEventFlag::Out) && !completeConnection()) {
		return false;
	}
	if (flags.test(fcitx::IOEventFlag::In) && !readAvailable()) {
		return false;
	}
	if (flags.test(fcitx::IOEventFlag::Out) && !writeAvailable()) {
		return false;
	}
	updateIoEvents();
	return true;
}

bool DaemonClient::completeConnection() {
	int socketError = 0;
	socklen_t length = sizeof(socketError);
	if (getsockopt(socketFd_, SOL_SOCKET, SO_ERROR, &socketError, &length) < 0 ||
		socketError != 0) {
		disconnect(true);
		return false;
	}
	connectionState_ = ConnectionState::Connected;
	sendInitialize();
	return true;
}

bool DaemonClient::readAvailable() {
	char buffer[8192];
	while (true) {
		const auto size = recv(socketFd_, buffer, sizeof(buffer), 0);
		if (size > 0) {
			if (!codec_.append(std::string_view(buffer, size))) {
				disconnect(true);
				return false;
			}
			while (auto message = codec_.next()) {
				handleMessage(*message);
			}
			if (codec_.failed()) {
				disconnect(true);
				return false;
			}
			continue;
		}
		if (size == 0) {
			disconnect(true);
			return false;
		}
		if (errno == EAGAIN || errno == EWOULDBLOCK) {
			return true;
		}
		if (errno == EINTR) {
			continue;
		}
		disconnect(true);
		return false;
	}
}

bool DaemonClient::writeAvailable() {
	while (outputOffset_ < output_.size()) {
		const auto size = send(
			socketFd_,
			output_.data() + outputOffset_,
			output_.size() - outputOffset_,
			MSG_NOSIGNAL);
		if (size > 0) {
			outputOffset_ += size;
			continue;
		}
		if (size < 0 && (errno == EAGAIN || errno == EWOULDBLOCK)) {
			return true;
		}
		if (size < 0 && errno == EINTR) {
			continue;
		}
		disconnect(true);
		return false;
	}
	output_.clear();
	outputOffset_ = 0;
	return true;
}

void DaemonClient::handleMessage(const std::string &message) {
	const auto method = glz::get_as_json<std::string, "/method">(message);
	if (method) {
		const auto error = notificationServer_.call(message);
		if (!error.empty() && callbacks_.error) {
			callbacks_.error({}, "invalid daemon notification");
		}
		return;
	}
	const auto nullResult = glz::get_as_json<glz::raw_json, "/result">(message);
	const auto responseId = glz::get_as_json<std::int64_t, "/id">(message);
	if (nullResult && nullResult->str == "null" && responseId) {
		const glz::rpc::id_t id{*responseId};
		rpcClient_.get_request_map<"session.finish">().erase(id);
		rpcClient_.get_request_map<"session.cancel">().erase(id);
		rpcClient_.get_request_map<"session.selectResult">().erase(id);
		return;
	}

	const auto error = rpcClient_.call(message);
	if (error && callbacks_.error) {
		callbacks_.error({}, rpcErrorMessage(error));
	}
}

void DaemonClient::reportError(
	std::string context,
	const glz::rpc::error &error) {
	if (callbacks_.error) {
		callbacks_.error(context, rpcErrorMessage(error));
	}
}

void DaemonClient::disconnect(bool notify) {
	ready_ = false;
	connectionState_ = ConnectionState::Disconnected;
	ioEvent_.reset();
	if (socketFd_ >= 0) {
		close(socketFd_);
		socketFd_ = -1;
	}
	codec_ = ContentLengthCodec{};
	output_.clear();
	outputOffset_ = 0;
	if (notify && callbacks_.disconnected) {
		callbacks_.disconnected();
	}
}

std::int64_t DaemonClient::nextRequestId() {
	return ++requestId_;
}

} // namespace voxspell
