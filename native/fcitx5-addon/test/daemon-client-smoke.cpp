#include "daemon-client.h"

#include <fcitx-utils/event.h>
#include <fcitx-utils/eventloopinterface.h>

#include <cstdint>
#include <iostream>
#include <memory>
#include <string>

int main(int argc, char **argv) {
	const bool streaming = argc > 1 && std::string(argv[1]) == "streaming";
	fcitx::EventLoop eventLoop;
	std::unique_ptr<voxspell::DaemonClient> client;
	std::string sessionId;
	bool sawFinal = false;
	bool sawPartial = false;
	bool completed = false;
	bool failed = false;
	bool finishSent = false;

	client = std::make_unique<voxspell::DaemonClient>(
		eventLoop,
		voxspell::DaemonClient::Callbacks{
			.started = [&](const std::string &startedSessionId) {
				sessionId = startedSessionId;
				if (!streaming) {
					finishSent = true;
					client->finish(sessionId);
				}
			},
			.partial = [&](const voxspell::protocol::TranscriptPartialParams &params) {
				sawPartial = params.sessionId == sessionId && !params.text.empty();
				if (streaming && sawPartial && params.revision >= 2 && !finishSent) {
					finishSent = true;
					client->finish(sessionId);
				}
			},
			.finalTranscript = [&](const voxspell::protocol::TranscriptFinalParams &params) {
				sawFinal = params.sessionId == sessionId && !params.text.empty();
			},
			.completed = [&](const voxspell::protocol::SessionCompletedParams &params) {
				completed = sawFinal && (!streaming || sawPartial) &&
					params.sessionId == sessionId && !params.text.empty();
				eventLoop.exit();
			},
			.error = [&](const std::string &, const std::string &message) {
				std::cerr << message << '\n';
				failed = true;
				eventLoop.exit();
			},
			.disconnected = [&]() {
				failed = true;
				eventLoop.exit();
			},
		});

	auto timeout = eventLoop.addTimeEvent(
		CLOCK_MONOTONIC,
		fcitx::now(CLOCK_MONOTONIC) + 5000000,
		0,
		[&](fcitx::EventSourceTime *, std::uint64_t) {
			std::cerr << "daemon client smoke test timed out\n";
			failed = true;
			eventLoop.exit();
			return false;
		});
	timeout->setOneShot();
	client->start("smoke-input-context");
	eventLoop.exec();
	return !failed && completed ? 0 : 1;
}
