#include "daemon-client.h"

#include <fcitx-utils/event.h>
#include <fcitx-utils/eventloopinterface.h>

#include <cstdint>
#include <iostream>
#include <memory>
#include <string>

int main(int argc, char **argv) {
	const std::string scenario = argc > 1 ? argv[1] : "realtime";
	fcitx::EventLoop eventLoop;
	std::unique_ptr<voxspell::DaemonClient> client;
	std::string sessionId;
	std::string preview;
	std::string expectedChoice = "transcript";
	std::string preparingSessionId;
	bool sawPreparing = false;
	bool sawRecording = false;
	bool sawRecognizing = false;
	bool sawProcessing = false;
	bool sawResults = false;
	bool selectionSent = false;
	bool completed = false;
	bool failed = false;

	client = std::make_unique<voxspell::DaemonClient>(
		eventLoop,
		voxspell::DaemonClient::Callbacks{
			.started = [&](const std::string &startedSessionId) {
				if (!sawPreparing || preparingSessionId != startedSessionId) {
					failed = true;
					eventLoop.exit();
					return;
				}
				sessionId = startedSessionId;
				if (scenario != "realtime") {
					client->finish(sessionId);
				}
			},
			.phase = [&](const voxspell::protocol::SessionPhaseParams &params) {
				if (params.phase == "preparing" && sessionId.empty()) {
					sawPreparing = true;
					preparingSessionId = params.sessionId;
					return;
				}
				if (params.sessionId != sessionId) return;
				sawRecording = sawRecording || params.phase == "recording";
				sawRecognizing = sawRecognizing || params.phase == "recognizing";
				sawProcessing = sawProcessing || params.phase == "processing";
			},
			.preview = [&](const voxspell::protocol::SessionPreviewParams &params) {
				if (params.sessionId != sessionId) return;
				preview = params.text;
				if (scenario == "realtime" &&
					preview == "今天下午三点我们开会") {
					client->finish(sessionId);
				}
			},
			.results = [&](const voxspell::protocol::SessionResultsParams &params) {
				if (params.sessionId != sessionId) return;
				sawResults = params.transcript.status == "final";
				if (scenario == "polish-transcript" && params.polished &&
					params.polished->status == "streaming" && !selectionSent) {
					selectionSent = true;
					expectedChoice = "transcript";
					client->selectResult(sessionId, expectedChoice);
				} else if (scenario == "polish" && params.polished &&
					params.polished->status == "final" && !selectionSent) {
					selectionSent = true;
					expectedChoice = "polished";
					client->selectResult(sessionId, expectedChoice);
				}
			},
			.completed = [&](const voxspell::protocol::SessionCompletedParams &params) {
				completed = params.sessionId == sessionId && sawRecording &&
					sawRecognizing && sawProcessing &&
					sawResults && params.selectedChoiceId == expectedChoice &&
					!params.text.empty();
				eventLoop.exit();
			},
			.sessionError = [&](const voxspell::protocol::SessionErrorParams &) {
				failed = true;
				eventLoop.exit();
			},
			.error = [&](
				const std::string &,
				const std::string &message,
				const std::optional<voxspell::protocol::ProtocolErrorData> &) {
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
		fcitx::now(CLOCK_MONOTONIC) + 7000000,
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
	if (scenario == "batch" && !preview.empty()) {
		failed = true;
	}
	return !failed && completed ? 0 : 1;
}
