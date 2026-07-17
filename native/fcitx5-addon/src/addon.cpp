#include "config.h"
#include "tap-hold-state.h"

#include <fcitx/addonfactory.h>
#include <fcitx/addoninstance.h>
#include <fcitx/addonmanager.h>
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

#include <cstdint>
#include <cstdlib>
#include <memory>
#include <string>
#include <vector>

namespace voxspell {

namespace {

constexpr char configFile[] = "conf/voxspell.conf";
constexpr char activeMessage[] = "🎙 VoxSpell · 本地测试模式";
constexpr char activeHint[] = "松开按键结束，Esc 取消";
constexpr char successMessage[] = "✓ VoxSpell 长按交互测试通过";
constexpr char successHint[] = "语音服务尚未连接";
constexpr std::uint64_t successMessageDurationUs = 1000000;

class InputContextState final : public fcitx::InputContextProperty {
public:
	TapHoldPhase phase = TapHoldPhase::Idle;
	bool replaying = false;
	bool passingInjectedSpace = false;
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
			showActive(inputContext);
			break;
		case TapHoldAction::ShowSuccess:
			showSuccess(inputContext, state);
			break;
		case TapHoldAction::Cancel:
			clearOwnPanel(inputContext);
			break;
		case TapHoldAction::Clear:
			state.holdTimer.reset();
			state.feedbackTimer.reset();
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

	void showActive(fcitx::InputContext *inputContext) {
		auto &inputPanel = inputContext->inputPanel();
		inputPanel.setAuxUp(fcitx::Text(activeMessage));
		inputPanel.setAuxDown(fcitx::Text(activeHint));
		inputContext->updateUserInterface(fcitx::UserInterfaceComponent::InputPanel);
	}

	void showSuccess(fcitx::InputContext *inputContext, InputContextState &state) {
		state.holdTimer.reset();
		state.feedbackTimer.reset();
		auto &inputPanel = inputContext->inputPanel();
		inputPanel.setAuxUp(fcitx::Text(successMessage));
		inputPanel.setAuxDown(fcitx::Text(successHint));
		inputContext->updateUserInterface(fcitx::UserInterfaceComponent::InputPanel);

		auto inputContextReference = inputContext->watch();
		state.feedbackTimer = instance_->eventLoop().addTimeEvent(
			CLOCK_MONOTONIC,
			fcitx::now(CLOCK_MONOTONIC) + successMessageDurationUs,
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

	void clearOwnPanel(fcitx::InputContext *inputContext) {
		auto &inputPanel = inputContext->inputPanel();
		const auto auxUp = inputPanel.auxUp().toString();
		if (auxUp != activeMessage && auxUp != successMessage) {
			return;
		}

		inputPanel.setAuxUp(fcitx::Text());
		inputPanel.setAuxDown(fcitx::Text());
		inputContext->updateUserInterface(fcitx::UserInterfaceComponent::InputPanel);
	}

	void resetInputContext(fcitx::InputContext *inputContext, bool updateUi) {
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
