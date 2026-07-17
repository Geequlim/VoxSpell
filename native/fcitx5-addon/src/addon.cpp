#include "config.h"
#include "daemon-client.h"
#include "tap-hold-state.h"

#include <fcitx/addonfactory.h>
#include <fcitx/addoninstance.h>
#include <fcitx/addonmanager.h>
#include <fcitx/candidatelist.h>
#include <fcitx/event.h>
#include <fcitx/inputcontext.h>
#include <fcitx/inputcontextmanager.h>
#include <fcitx/inputcontextproperty.h>
#include <fcitx/inputpanel.h>
#include <fcitx/instance.h>
#include <fcitx/text.h>
#include <fcitx/userinterface.h>
#include <fcitx-config/iniparser.h>
#include <fcitx-utils/event.h>
#include <fcitx-utils/eventloopinterface.h>
#include <fcitx-utils/key.h>
#include <fcitx-utils/trackableobject.h>

#include <cstdint>
#include <cstdlib>
#include <memory>
#include <string>
#include <vector>

namespace voxspell {

namespace {

constexpr char configFile[] = "conf/voxspell.conf";
constexpr char connectingMessage[] = "VoxSpell · 正在连接语音服务…";
constexpr char waitingMessage[] = "VoxSpell · 正在听，等待识别结果…";
constexpr char streamingMessage[] = "VoxSpell · 正在听";
constexpr char finishingMessage[] = "VoxSpell · 正在识别…";
constexpr char finalMessage[] = "VoxSpell · 识别完成";
constexpr char errorMessage[] = "VoxSpell · 测试 daemon 不可用";
constexpr char activeHint[] = "松开空格完成，Esc 取消";
constexpr char finishingHint[] = "请稍候";
constexpr char errorHint[] = "请先运行 yarn tiny dev/mock-daemon";
constexpr std::uint64_t errorMessageDurationUs = 1600000;

class InputContextState final : public fcitx::InputContextProperty {
public:
	TapHoldPhase phase = TapHoldPhase::Idle;
	bool replaying = false;
	bool passingInjectedSpace = false;
	bool ownsPanel = false;
	fcitx::Key triggerKey;
	fcitx::Key triggerRawKey;
	int triggerPressTime = 0;
	std::unique_ptr<fcitx::EventSourceTime> holdTimer;
	std::unique_ptr<fcitx::EventSourceTime> feedbackTimer;
};

} // namespace

class VoxSpellAddon final : public fcitx::AddonInstance {
public:
	explicit VoxSpellAddon(fcitx::Instance *instance) : instance_(instance) {
		instance_->inputContextManager().registerProperty("voxspellState", &stateFactory_);
		reloadConfig();

		eventHandlers_.emplace_back(instance_->watchEvent(
			fcitx::EventType::InputContextKeyEvent,
			fcitx::EventWatcherPhase::PreInputMethod,
			[this](fcitx::Event &event) {
				handleKeyEvent(static_cast<fcitx::KeyEvent &>(event));
			}));

		auto reset = [this](fcitx::Event &event) {
			auto &inputContextEvent = static_cast<fcitx::InputContextEvent &>(event);
			resetInputContext(inputContextEvent.inputContext(), true);
		};
		eventHandlers_.emplace_back(instance_->watchEvent(
			fcitx::EventType::InputContextFocusOut,
			fcitx::EventWatcherPhase::Default,
			reset));
		eventHandlers_.emplace_back(instance_->watchEvent(
			fcitx::EventType::InputContextReset,
			fcitx::EventWatcherPhase::Default,
			reset));
		eventHandlers_.emplace_back(instance_->watchEvent(
			fcitx::EventType::InputContextSwitchInputMethod,
			fcitx::EventWatcherPhase::Default,
			reset));

		daemonClient_ = std::make_unique<DaemonClient>(
			instance_->eventLoop(),
			DaemonClient::Callbacks{
				.ready = [this]() { handleDaemonReady(); },
				.started = [this](const std::string &sessionId) {
					handleSessionStarted(sessionId);
				},
				.partial = [this](const protocol::TranscriptPartialParams &params) {
					handlePartial(params);
				},
				.finalTranscript =
					[this](const protocol::TranscriptFinalParams &params) {
						handleFinal(params);
					},
				.completed = [this](const protocol::SessionCompletedParams &params) {
					handleCompleted(params);
				},
				.error = [this](const std::string &sessionId, const std::string &) {
					handleDaemonError(sessionId);
				},
				.disconnected = [this]() { handleDaemonError({}); },
			});
	}

	~VoxSpellAddon() override {
		resetAllInputContexts();
	}

	void reloadConfig() override {
		fcitx::readAsIni(config_, configFile);
		resetAllInputContexts();
	}

	const fcitx::Configuration *getConfig() const override {
		return &config_;
	}

	void setConfig(const fcitx::RawConfig &config) override {
		auto updatedConfig = config_;
		updatedConfig.load(config, true);
		config_ = std::move(updatedConfig);
		fcitx::safeSaveAsIni(config_, configFile);
		resetAllInputContexts();
	}

private:
	void handleKeyEvent(fcitx::KeyEvent &keyEvent) {
		auto *inputContext = keyEvent.inputContext();
		auto *state = inputContext->propertyFor(&stateFactory_);
		if (state->replaying) {
			return;
		}
		if (state->passingInjectedSpace &&
			keyEvent.key().sym() == FcitxKey_space) {
			if (keyEvent.isRelease()) {
				state->passingInjectedSpace = false;
			}
			return;
		}

		if (!keyEvent.isRelease() && state->feedbackTimer) {
			state->feedbackTimer.reset();
			clearOwnPanel(inputContext);
		}

		const bool triggerRelease =
			keyEvent.isRelease() && state->phase != TapHoldPhase::Idle &&
			keyEvent.key().sym() == state->triggerKey.sym();
		if (triggerRelease) {
			keyEvent.filterAndAccept();
			applyTransition(
				inputContext,
				*state,
				TapHoldEvent::TriggerReleased,
				keyEvent.time());
			return;
		}

		if (keyEvent.isRelease()) {
			return;
		}

		if (state->phase != TapHoldPhase::Idle &&
			keyEvent.key().sym() == state->triggerKey.sym()) {
			keyEvent.filterAndAccept();
			applyTransition(
				inputContext,
				*state,
				TapHoldEvent::TriggerRepeated,
				keyEvent.time());
			return;
		}

		if (state->phase == TapHoldPhase::Pending) {
			applyTransition(
				inputContext,
				*state,
				TapHoldEvent::OtherPressed,
				keyEvent.time());
			return;
		}

		if (state->phase == TapHoldPhase::Active) {
			const bool isEscape = keyEvent.key().check(FcitxKey_Escape);
			applyTransition(
				inputContext,
				*state,
				isEscape ? TapHoldEvent::Cancelled : TapHoldEvent::OtherPressed,
				keyEvent.time());
			if (isEscape) {
				keyEvent.filterAndAccept();
			}
			return;
		}

		const auto triggerKey = config_.pttKey.value().normalize();
		if (!triggerKey.isValid() || !keyEvent.key().check(triggerKey)) {
			return;
		}

		const auto &inputPanel = inputContext->inputPanel();
		if (!inputPanel.clientPreedit().empty() || !inputPanel.preedit().empty()) {
			return;
		}

		state->triggerKey = keyEvent.key();
		state->triggerRawKey = keyEvent.rawKey();
		state->triggerPressTime = keyEvent.time();
		keyEvent.filterAndAccept();
		applyTransition(
			inputContext,
			*state,
			TapHoldEvent::TriggerPressed,
			keyEvent.time());
	}

	void applyTransition(
		fcitx::InputContext *inputContext,
		InputContextState &state,
		TapHoldEvent event,
		int eventTime) {
		const auto transition = transitionTapHold(state.phase, event);
		state.phase = transition.phase;

		switch (transition.action) {
		case TapHoldAction::ArmTimer:
			armHoldTimer(inputContext, state);
			break;
		case TapHoldAction::ReplayTrigger:
			state.holdTimer.reset();
			replayTrigger(inputContext, state, eventTime);
			break;
		case TapHoldAction::ShowActive:
			startVoiceSession(inputContext);
			break;
		case TapHoldAction::ShowSuccess:
			finishVoiceSession(inputContext, state);
			break;
		case TapHoldAction::Cancel:
			cancelVoiceSession(inputContext, "user");
			clearOwnPanel(inputContext);
			break;
		case TapHoldAction::Clear:
			state.holdTimer.reset();
			state.feedbackTimer.reset();
			cancelVoiceSession(inputContext, "focus-lost");
			clearOwnPanel(inputContext);
			break;
		case TapHoldAction::None:
		case TapHoldAction::Swallow:
			break;
		}
	}

	void armHoldTimer(fcitx::InputContext *inputContext, InputContextState &state) {
		state.holdTimer.reset();
		auto inputContextReference = inputContext->watch();
		const auto thresholdUs =
			static_cast<std::uint64_t>(config_.holdThresholdMs.value()) * 1000;
		state.holdTimer = instance_->eventLoop().addTimeEvent(
			CLOCK_MONOTONIC,
			fcitx::now(CLOCK_MONOTONIC) + thresholdUs,
			0,
			[this, inputContextReference](fcitx::EventSourceTime *, std::uint64_t) {
				auto *currentInputContext = inputContextReference.get();
				if (!currentInputContext) {
					return false;
				}

				auto *currentState = currentInputContext->propertyFor(&stateFactory_);
				currentState->holdTimer.reset();
				applyTransition(
					currentInputContext,
					*currentState,
					TapHoldEvent::ThresholdElapsed,
					0);
				return false;
			});
		state.holdTimer->setOneShot();
	}

	void replayTrigger(
		fcitx::InputContext *inputContext,
		InputContextState &state,
		int releaseTime) {
		state.replaying = true;
		const bool unmodifiedSpace =
			state.triggerKey.sym() == FcitxKey_space &&
			!state.triggerKey.hasModifier();
		if (unmodifiedSpace && injectSpaceForGhostty(inputContext, state)) {
			state.replaying = false;
			return;
		}

		fcitx::KeyEvent pressEvent(
			inputContext,
			state.triggerRawKey,
			false,
			state.triggerPressTime);
		const bool pressHandled = instance_->postEvent(pressEvent);
		const bool commitSpace =
			!pressHandled && unmodifiedSpace;
		if (commitSpace) {
			inputContext->commitString(" ");
		} else if (!pressHandled) {
			inputContext->forwardKey(
				state.triggerRawKey,
				false,
				state.triggerPressTime);
		}

		fcitx::KeyEvent releaseEvent(
			inputContext,
			state.triggerRawKey,
			true,
			releaseTime);
		if (!instance_->postEvent(releaseEvent) && !commitSpace) {
			inputContext->forwardKey(state.triggerRawKey, true, releaseTime);
		}
		state.replaying = false;
	}

	bool injectSpaceForGhostty(
		fcitx::InputContext *inputContext,
		InputContextState &state) {
		if (inputContext->program().find("ghostty") == std::string::npos ||
			!std::getenv("DISPLAY")) {
			return false;
		}

		state.passingInjectedSpace = true;
		if (std::system("xdotool key --clearmodifiers space") == 0) {
			return true;
		}

		state.passingInjectedSpace = false;
		return false;
	}

	void startVoiceSession(fcitx::InputContext *inputContext) {
		cancelVoiceSession(nullptr, "replaced");
		voiceInputContext_ = inputContext->watch();
		voiceSessionId_.clear();
		voiceTranscript_.clear();
		finishRequested_ = false;
		voiceFailed_ = false;
		committed_ = false;
		renderVoicePanel(
			inputContext,
			daemonClient_->ready() ? waitingMessage : connectingMessage,
			activeHint,
			{});
		daemonClient_->start(
			std::to_string(reinterpret_cast<std::uintptr_t>(inputContext)));
	}

	void finishVoiceSession(
		fcitx::InputContext *inputContext,
		InputContextState &state) {
		state.holdTimer.reset();
		state.feedbackTimer.reset();
		finishRequested_ = true;
		if (voiceFailed_) {
			cancelVoiceSession(inputContext, "user");
			showTimedError(inputContext, state);
			return;
		}
		renderVoicePanel(
			inputContext,
			finishingMessage,
			finishingHint,
			voiceTranscript_);
		if (!voiceSessionId_.empty()) {
			daemonClient_->finish(voiceSessionId_);
		}
	}

	void showTimedError(
		fcitx::InputContext *inputContext,
		InputContextState &state) {
		renderVoicePanel(inputContext, errorMessage, errorHint, {});

		auto inputContextReference = inputContext->watch();
		state.feedbackTimer = instance_->eventLoop().addTimeEvent(
			CLOCK_MONOTONIC,
			fcitx::now(CLOCK_MONOTONIC) + errorMessageDurationUs,
			0,
			[this, inputContextReference](fcitx::EventSourceTime *, std::uint64_t) {
				auto *currentInputContext = inputContextReference.get();
				if (!currentInputContext) {
					return false;
				}

				auto *currentState = currentInputContext->propertyFor(&stateFactory_);
				currentState->feedbackTimer.reset();
				clearOwnPanel(currentInputContext);
				return false;
			});
		state.feedbackTimer->setOneShot();
	}

	void renderVoicePanel(
		fcitx::InputContext *inputContext,
		const std::string &status,
		const std::string &hint,
		const std::string &transcript) {
		auto *state = inputContext->propertyFor(&stateFactory_);
		state->ownsPanel = true;
		auto &inputPanel = inputContext->inputPanel();
		inputPanel.setAuxUp(fcitx::Text(status));
		inputPanel.setAuxDown(fcitx::Text(hint));
		if (transcript.empty()) {
			inputPanel.setCandidateList(nullptr);
		} else {
			auto candidates = std::make_unique<fcitx::DisplayOnlyCandidateList>();
			candidates->setContent(std::vector<std::string>{transcript});
			candidates->setCursorIndex(0);
			candidates->setLayoutHint(fcitx::CandidateLayoutHint::Vertical);
			inputPanel.setCandidateList(std::move(candidates));
		}
		inputContext->updateUserInterface(fcitx::UserInterfaceComponent::InputPanel);
	}

	void handleDaemonReady() {
		auto *inputContext = voiceInputContext_.get();
		if (!inputContext || !voiceSessionId_.empty() || voiceFailed_) {
			return;
		}
		renderVoicePanel(
			inputContext,
			waitingMessage,
			activeHint,
			voiceTranscript_);
	}

	void handleSessionStarted(const std::string &sessionId) {
		auto *inputContext = voiceInputContext_.get();
		if (!inputContext) {
			daemonClient_->cancel(sessionId, "focus-lost");
			return;
		}
		voiceSessionId_ = sessionId;
		if (finishRequested_) {
			daemonClient_->finish(voiceSessionId_);
		}
	}

	void handlePartial(const protocol::TranscriptPartialParams &params) {
		auto *inputContext = voiceInputContext_.get();
		if (!inputContext || params.sessionId != voiceSessionId_ || finishRequested_) {
			return;
		}
		voiceTranscript_ = params.text;
		renderVoicePanel(
			inputContext,
			streamingMessage,
			activeHint,
			voiceTranscript_);
	}

	void handleFinal(const protocol::TranscriptFinalParams &params) {
		auto *inputContext = voiceInputContext_.get();
		if (!inputContext || params.sessionId != voiceSessionId_) {
			return;
		}
		voiceTranscript_ = params.text;
		renderVoicePanel(
			inputContext,
			finalMessage,
			finishingHint,
			voiceTranscript_);
	}

	void handleCompleted(const protocol::SessionCompletedParams &params) {
		auto *inputContext = voiceInputContext_.get();
		if (!inputContext || params.sessionId != voiceSessionId_ || committed_) {
			return;
		}
		committed_ = true;
		if (!params.text.empty()) {
			inputContext->commitString(params.text);
		}
		clearOwnPanel(inputContext);
		voiceInputContext_.unwatch();
		voiceSessionId_.clear();
		voiceTranscript_.clear();
		finishRequested_ = false;
	}

	void handleDaemonError(const std::string &sessionId) {
		auto *inputContext = voiceInputContext_.get();
		if (!inputContext ||
			(!sessionId.empty() && sessionId != voiceSessionId_)) {
			return;
		}
		voiceFailed_ = true;
		renderVoicePanel(inputContext, errorMessage, errorHint, {});
	}

	void cancelVoiceSession(
		fcitx::InputContext *inputContext,
		std::string reason) {
		auto *activeInputContext = voiceInputContext_.get();
		if (inputContext && inputContext != activeInputContext) {
			return;
		}
		if (!activeInputContext) {
			return;
		}
		if (voiceSessionId_.empty()) {
			daemonClient_->cancelPendingStart();
		} else {
			daemonClient_->cancel(voiceSessionId_, std::move(reason));
		}
		voiceInputContext_.unwatch();
		voiceSessionId_.clear();
		voiceTranscript_.clear();
		finishRequested_ = false;
		voiceFailed_ = false;
		committed_ = false;
	}

	void clearOwnPanel(fcitx::InputContext *inputContext) {
		auto *state = inputContext->propertyFor(&stateFactory_);
		if (!state->ownsPanel) {
			return;
		}
		state->ownsPanel = false;
		auto &inputPanel = inputContext->inputPanel();
		inputPanel.setAuxUp(fcitx::Text());
		inputPanel.setAuxDown(fcitx::Text());
		inputPanel.setCandidateList(nullptr);
		inputContext->updateUserInterface(fcitx::UserInterfaceComponent::InputPanel);
	}

	void resetInputContext(fcitx::InputContext *inputContext, bool updateUi) {
		cancelVoiceSession(inputContext, "focus-lost");
		auto *state = inputContext->propertyFor(&stateFactory_);
		state->phase = TapHoldPhase::Idle;
		state->passingInjectedSpace = false;
		state->holdTimer.reset();
		state->feedbackTimer.reset();
		if (updateUi) {
			clearOwnPanel(inputContext);
		}
	}

	void resetAllInputContexts() {
		instance_->inputContextManager().foreach([this](fcitx::InputContext *inputContext) {
			resetInputContext(inputContext, true);
			return true;
		});
	}

	fcitx::Instance *instance_;
	std::unique_ptr<DaemonClient> daemonClient_;
	fcitx::TrackableObjectReference<fcitx::InputContext> voiceInputContext_;
	std::string voiceSessionId_;
	std::string voiceTranscript_;
	bool finishRequested_ = false;
	bool voiceFailed_ = false;
	bool committed_ = false;
	VoxSpellConfig config_;
	fcitx::SimpleInputContextPropertyFactory<InputContextState> stateFactory_;
	std::vector<std::unique_ptr<fcitx::HandlerTableEntry<fcitx::EventHandler>>>
		eventHandlers_;
};

class VoxSpellAddonFactory final : public fcitx::AddonFactory {
public:
	fcitx::AddonInstance *create(fcitx::AddonManager *manager) override {
		return new VoxSpellAddon(manager->instance());
	}
};

} // namespace voxspell

FCITX_ADDON_FACTORY(voxspell::VoxSpellAddonFactory);
