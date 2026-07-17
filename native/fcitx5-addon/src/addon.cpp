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
#include <functional>
#include <memory>
#include <optional>
#include <string>
#include <utility>
#include <vector>

namespace voxspell {

namespace {

constexpr char configFile[] = "conf/voxspell.conf";
constexpr char connectingMessage[] = "VoxSpell · 正在连接语音服务…";
constexpr char recordingMessage[] = "VoxSpell · 正在录音";
constexpr char recognizingMessage[] = "VoxSpell · 正在识别…";
constexpr char processingMessage[] = "VoxSpell · 正在处理…";
constexpr char polishingMessage[] = "VoxSpell · 正在润色…";
constexpr char choosingMessage[] = "VoxSpell · 请选择结果";
constexpr char submittingMessage[] = "VoxSpell · 正在提交…";
constexpr char errorMessage[] = "VoxSpell · 本次语音输入失败";
constexpr char activeHint[] = "松开热键完成，Esc 取消";
constexpr char finishingHint[] = "请稍候";
constexpr char choosingHint[] = "1 润色结果 · 2 识别结果 · Enter 确认";
constexpr char errorHint[] = "未提交任何文本";
constexpr std::uint64_t errorMessageDurationUs = 1600000;

class ResultCandidateWord final : public fcitx::CandidateWord {
public:
	ResultCandidateWord(
		std::string text,
		std::string choiceId,
		bool selectable,
		std::function<void(const std::string &)> select)
		: CandidateWord(fcitx::Text(std::move(text))),
		  choiceId_(std::move(choiceId)),
		  selectable_(selectable),
		  select_(std::move(select)) {}

	void select(fcitx::InputContext *) const override {
		if (selectable_) {
			select_(choiceId_);
		}
	}

private:
	std::string choiceId_;
	bool selectable_;
	std::function<void(const std::string &)> select_;
};

class InputContextState final : public fcitx::InputContextProperty {
public:
	TapHoldPhase phase = TapHoldPhase::Idle;
	bool replaying = false;
	bool passingInjectedSpace = false;
	bool ownsPanel = false;
	fcitx::KeySym swallowedSelectionKey = FcitxKey_None;
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
				.phase = [this](const protocol::SessionPhaseParams &params) {
					handlePhase(params);
				},
				.preview = [this](const protocol::SessionPreviewParams &params) {
					handlePreview(params);
				},
				.results = [this](const protocol::SessionResultsParams &params) {
					handleResults(params);
				},
				.completed = [this](const protocol::SessionCompletedParams &params) {
					handleCompleted(params);
				},
				.sessionError = [this](const protocol::SessionErrorParams &params) {
					handleSessionError(params);
				},
				.error = [this](const std::string &sessionId, const std::string &) {
					handleDaemonError(sessionId);
				},
				.disconnected = [this]() { handleDaemonError({}); },
			});
	}

	~VoxSpellAddon() override {
		cancelVoiceSession(nullptr, "client-disconnected");
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
		if (keyEvent.isRelease() &&
			state->swallowedSelectionKey == keyEvent.key().sym()) {
			state->swallowedSelectionKey = FcitxKey_None;
			keyEvent.filterAndAccept();
			return;
		}
		if (handleVoiceSelectionKey(keyEvent, *state)) {
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

	bool handleVoiceSelectionKey(
		fcitx::KeyEvent &keyEvent,
		InputContextState &state) {
		auto *inputContext = keyEvent.inputContext();
		if (keyEvent.isRelease() || state.phase != TapHoldPhase::Idle ||
			voiceInputContext_.get() != inputContext) {
			return false;
		}
		if (keyEvent.key().check(FcitxKey_Escape)) {
			state.swallowedSelectionKey = keyEvent.key().sym();
			keyEvent.filterAndAccept();
			cancelVoiceSession(inputContext, "user");
			clearOwnPanel(inputContext);
			return true;
		}
		if (config_.autoSelectResult.value() || !transcriptResult_ ||
			!hasManualChoice()) {
			if (!keyEvent.key().isModifier()) {
				cancelVoiceSession(inputContext, "user");
				clearOwnPanel(inputContext);
			}
			return false;
		}

		const auto swallow = [&]() {
			state.swallowedSelectionKey = keyEvent.key().sym();
			keyEvent.filterAndAccept();
		};
		if (keyEvent.key().check(FcitxKey_Up) ||
			keyEvent.key().check(FcitxKey_Down)) {
			selectedChoiceId_ =
				selectedChoiceId_ == "polished" ? "transcript" : "polished";
			renderResults(inputContext);
			swallow();
			return true;
		}
		if (keyEvent.key().check(FcitxKey_1)) {
			selectResult("polished");
			swallow();
			return true;
		}
		if (keyEvent.key().check(FcitxKey_2)) {
			selectResult("transcript");
			swallow();
			return true;
		}
		if (keyEvent.key().check(FcitxKey_Return) ||
			keyEvent.key().check(FcitxKey_KP_Enter) ||
			keyEvent.key().check(FcitxKey_space)) {
			selectResult(selectedChoiceId_);
			swallow();
			return true;
		}

		cancelVoiceSession(inputContext, "user");
		clearOwnPanel(inputContext);
		return false;
	}

	void startVoiceSession(fcitx::InputContext *inputContext) {
		cancelVoiceSession(nullptr, "replaced");
		voiceInputContext_ = inputContext->watch();
		voiceSessionId_.clear();
		sessionPhase_.clear();
		previewText_.clear();
		transcriptResult_.reset();
		polishedResult_.reset();
		recommendedChoiceId_.reset();
		selectedChoiceId_ = "polished";
		finishRequested_ = false;
		selectionRequested_ = false;
		sawPolishing_ = false;
		committed_ = false;
		setVoicePanel(
			inputContext,
			daemonClient_->ready() ? recordingMessage : connectingMessage,
			activeHint,
			{},
			nullptr);

		constexpr char hex[] = "0123456789abcdef";
		std::string inputContextId;
		inputContextId.reserve(inputContext->uuid().size() * 2);
		for (const auto byte : inputContext->uuid()) {
			inputContextId.push_back(hex[byte >> 4]);
			inputContextId.push_back(hex[byte & 0x0f]);
		}
		daemonClient_->start(std::move(inputContextId));
	}

	void finishVoiceSession(
		fcitx::InputContext *inputContext,
		InputContextState &state) {
		state.holdTimer.reset();
		state.feedbackTimer.reset();
		if (voiceInputContext_.get() != inputContext) {
			return;
		}
		finishRequested_ = true;
		setVoicePanel(
			inputContext,
			recognizingMessage,
			finishingHint,
			previewText_,
			nullptr);
		if (!voiceSessionId_.empty()) {
			daemonClient_->finish(voiceSessionId_);
		}
	}

	void showTimedError(
		fcitx::InputContext *inputContext,
		InputContextState &state) {
		setVoicePanel(inputContext, errorMessage, errorHint, {}, nullptr);

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

	void setVoicePanel(
		fcitx::InputContext *inputContext,
		const std::string &status,
		const std::string &hint,
		const std::string &preedit,
		std::unique_ptr<fcitx::CandidateList> candidates) {
		auto *state = inputContext->propertyFor(&stateFactory_);
		state->ownsPanel = true;
		auto &inputPanel = inputContext->inputPanel();
		inputPanel.setAuxUp(fcitx::Text(status));
		inputPanel.setAuxDown(fcitx::Text(hint));
		inputPanel.setPreedit(fcitx::Text(preedit));
		inputPanel.setCandidateList(std::move(candidates));
		inputContext->updateUserInterface(fcitx::UserInterfaceComponent::InputPanel);
	}

	void renderCurrentVoiceState() {
		auto *inputContext = voiceInputContext_.get();
		if (!inputContext) {
			return;
		}
		if (transcriptResult_) {
			renderResults(inputContext);
			return;
		}

		const char *status = recordingMessage;
		if (sessionPhase_ == "recognizing") {
			status = recognizingMessage;
		} else if (sessionPhase_ == "processing") {
			status = processingMessage;
		} else if (sessionPhase_ == "polishing") {
			status = polishingMessage;
		} else if (sessionPhase_ == "choosing") {
			status = choosingMessage;
		}
		const auto *hint = finishRequested_ ? finishingHint : activeHint;
		setVoicePanel(inputContext, status, hint, previewText_, nullptr);
	}

	void renderResults(fcitx::InputContext *inputContext) {
		if (config_.autoSelectResult.value()) {
			const protocol::PolishedResult *visibleResult = nullptr;
			if (polishedResult_) {
				visibleResult = &*polishedResult_;
			}

			if (visibleResult && !visibleResult->text.empty()) {
				auto candidates = std::make_unique<fcitx::DisplayOnlyCandidateList>();
				candidates->setContent(
					std::vector<std::string>{visibleResult->text});
				candidates->setCursorIndex(0);
				candidates->setLayoutHint(fcitx::CandidateLayoutHint::Vertical);
				const auto *status = selectionRequested_
					? submittingMessage
					: polishingMessage;
				setVoicePanel(
					inputContext,
					status,
					finishingHint,
					{},
					std::move(candidates));
				return;
			}
			if (!sawPolishing_ && transcriptResult_) {
				auto candidates = std::make_unique<fcitx::DisplayOnlyCandidateList>();
				candidates->setContent(
					std::vector<std::string>{transcriptResult_->text});
				candidates->setCursorIndex(0);
				setVoicePanel(
					inputContext,
					processingMessage,
					finishingHint,
					{},
					std::move(candidates));
				return;
			}
			setVoicePanel(
				inputContext,
				polishingMessage,
				finishingHint,
				{},
				nullptr);
			return;
		}
		if (!hasManualChoice()) {
			auto candidates = std::make_unique<fcitx::DisplayOnlyCandidateList>();
			candidates->setContent(
				std::vector<std::string>{transcriptResult_->text});
			candidates->setCursorIndex(0);
			setVoicePanel(
				inputContext,
				processingMessage,
				finishingHint,
				{},
				std::move(candidates));
			return;
		}

		auto candidates = std::make_unique<fcitx::CommonCandidateList>();
		candidates->setPageSize(2);
		candidates->setLabels({"1", "2"});
		candidates->setLayoutHint(fcitx::CandidateLayoutHint::Vertical);
		const bool polishedSelectable =
			polishedResult_ && polishedResult_->status == "final";
		std::string polishedText = "润色结果：正在润色…";
		if (polishedResult_ && !polishedResult_->text.empty()) {
			polishedText = "润色结果：" + polishedResult_->text;
		}
		candidates->append<ResultCandidateWord>(
			polishedText,
			"polished",
			polishedSelectable,
			[this](const std::string &choiceId) { selectResult(choiceId); });
		candidates->append<ResultCandidateWord>(
			"识别结果：" + transcriptResult_->text,
			"transcript",
			true,
			[this](const std::string &choiceId) { selectResult(choiceId); });
		candidates->setCursorIndex(selectedChoiceId_ == "transcript" ? 1 : 0);
		setVoicePanel(
			inputContext,
			selectionRequested_ ? submittingMessage : choosingMessage,
			selectionRequested_ ? finishingHint : choosingHint,
			{},
			std::move(candidates));
	}

	bool hasManualChoice() const {
		return !recommendedChoiceId_ || sawPolishing_ || polishedResult_.has_value();
	}

	void handleDaemonReady() {
		auto *inputContext = voiceInputContext_.get();
		if (!inputContext || !voiceSessionId_.empty()) {
			return;
		}
		setVoicePanel(
			inputContext,
			recordingMessage,
			activeHint,
			{},
			nullptr);
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

	void handlePhase(const protocol::SessionPhaseParams &params) {
		auto *inputContext = voiceInputContext_.get();
		if (!inputContext || params.sessionId != voiceSessionId_) {
			return;
		}
		sessionPhase_ = params.phase;
		if (sessionPhase_ == "polishing") {
			sawPolishing_ = true;
		}
		renderCurrentVoiceState();
	}

	void handlePreview(const protocol::SessionPreviewParams &params) {
		auto *inputContext = voiceInputContext_.get();
		if (!inputContext || params.sessionId != voiceSessionId_) {
			return;
		}
		previewText_ = params.text;
		renderCurrentVoiceState();
	}

	void handleResults(const protocol::SessionResultsParams &params) {
		auto *inputContext = voiceInputContext_.get();
		if (!inputContext || params.sessionId != voiceSessionId_) {
			return;
		}
		transcriptResult_ = params.transcript;
		polishedResult_ = params.polished;
		recommendedChoiceId_ = params.recommendedChoiceId;
		renderResults(inputContext);

		if (!config_.autoSelectResult.value() || selectionRequested_ ||
			!recommendedChoiceId_) {
			return;
		}
		if (*recommendedChoiceId_ == "polished" && polishedResult_ &&
			polishedResult_->status == "final") {
			selectResult("polished");
		} else if (*recommendedChoiceId_ == "transcript" && sawPolishing_) {
			selectResult("transcript");
		}
	}

	void selectResult(const std::string &choiceId) {
		if (selectionRequested_ || voiceSessionId_.empty() || !transcriptResult_) {
			return;
		}
		if (choiceId == "polished" &&
			(!polishedResult_ || polishedResult_->status != "final")) {
			return;
		}
		selectionRequested_ = true;
		selectedChoiceId_ = choiceId;
		renderCurrentVoiceState();
		daemonClient_->selectResult(voiceSessionId_, choiceId);
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
		clearVoiceSessionState();
	}

	void handleSessionError(const protocol::SessionErrorParams &params) {
		if (params.sessionId != voiceSessionId_) {
			return;
		}
		handleDaemonError(params.sessionId);
	}

	void handleDaemonError(const std::string &sessionId) {
		auto *inputContext = voiceInputContext_.get();
		if (!inputContext ||
			(!sessionId.empty() && sessionId != voiceSessionId_)) {
			return;
		}
		auto *state = inputContext->propertyFor(&stateFactory_);
		clearOwnPanel(inputContext);
		voiceInputContext_.unwatch();
		clearVoiceSessionState();
		showTimedError(inputContext, *state);
	}

	void cancelVoiceSession(
		fcitx::InputContext *inputContext,
		std::string reason) {
		auto *activeInputContext = voiceInputContext_.get();
		if (inputContext && inputContext != activeInputContext) {
			return;
		}
		if (!activeInputContext) {
			if (inputContext) {
				return;
			}
			if (voiceSessionId_.empty()) {
				daemonClient_->cancelPendingStart();
			} else {
				daemonClient_->cancel(voiceSessionId_, std::move(reason));
			}
			voiceInputContext_.unwatch();
			clearVoiceSessionState();
			return;
		}
		if (voiceSessionId_.empty()) {
			daemonClient_->cancelPendingStart();
		} else {
			daemonClient_->cancel(voiceSessionId_, std::move(reason));
		}
		voiceInputContext_.unwatch();
		clearVoiceSessionState();
	}

	void clearVoiceSessionState() {
		voiceSessionId_.clear();
		sessionPhase_.clear();
		previewText_.clear();
		transcriptResult_.reset();
		polishedResult_.reset();
		recommendedChoiceId_.reset();
		selectedChoiceId_ = "polished";
		finishRequested_ = false;
		selectionRequested_ = false;
		sawPolishing_ = false;
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
		inputPanel.setPreedit(fcitx::Text());
		inputPanel.setCandidateList(nullptr);
		inputContext->updateUserInterface(fcitx::UserInterfaceComponent::InputPanel);
	}

	void resetInputContext(fcitx::InputContext *inputContext, bool updateUi) {
		cancelVoiceSession(inputContext, "focus-lost");
		auto *state = inputContext->propertyFor(&stateFactory_);
		state->phase = TapHoldPhase::Idle;
		state->passingInjectedSpace = false;
		state->swallowedSelectionKey = FcitxKey_None;
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
	std::string sessionPhase_;
	std::string previewText_;
	std::optional<protocol::TranscriptResult> transcriptResult_;
	std::optional<protocol::PolishedResult> polishedResult_;
	std::optional<std::string> recommendedChoiceId_;
	std::string selectedChoiceId_ = "polished";
	bool finishRequested_ = false;
	bool selectionRequested_ = false;
	bool sawPolishing_ = false;
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
