#include <fcitx/addonfactory.h>
#include <fcitx/addoninstance.h>
#include <fcitx/addonmanager.h>
#include <fcitx/event.h>
#include <fcitx/inputcontext.h>
#include <fcitx/inputpanel.h>
#include <fcitx/instance.h>
#include <fcitx/text.h>
#include <fcitx/userinterface.h>
#include <fcitx-utils/event.h>
#include <fcitx-utils/eventloopinterface.h>
#include <fcitx-utils/key.h>

#include <cstdint>
#include <memory>
#include <vector>

namespace voxspell {

class VoxSpellAddon final : public fcitx::AddonInstance {
public:
	explicit VoxSpellAddon(fcitx::Instance *instance) : instance_(instance) {
		eventHandlers_.emplace_back(instance_->watchEvent(
			fcitx::EventType::InputContextKeyEvent,
			fcitx::EventWatcherPhase::PreInputMethod,
			[this](fcitx::Event &event) {
				auto &keyEvent = static_cast<fcitx::KeyEvent &>(event);
				if (keyEvent.isRelease() || !keyEvent.key().check(smokeTestKey_)) {
					return;
				}

				keyEvent.filterAndAccept();
				showHello(keyEvent.inputContext());
			}));
	}

private:
	void showHello(fcitx::InputContext *inputContext) {
		helloTimer_.reset();
		inputContext->inputPanel().setAuxUp(fcitx::Text("Hello from VoxSpell"));
		inputContext->updateUserInterface(fcitx::UserInterfaceComponent::InputPanel);

		auto inputContextReference = inputContext->watch();
		helloTimer_ = instance_->eventLoop().addTimeEvent(
			CLOCK_MONOTONIC,
			fcitx::now(CLOCK_MONOTONIC) + 1500000,
			0,
			[this, inputContextReference](fcitx::EventSourceTime *, std::uint64_t) {
				helloTimer_.reset();
				auto *currentInputContext = inputContextReference.get();
				if (!currentInputContext) {
					return false;
				}

				currentInputContext->inputPanel().setAuxUp(fcitx::Text());
				currentInputContext->updateUserInterface(
					fcitx::UserInterfaceComponent::InputPanel);
				return false;
			});
		helloTimer_->setOneShot();
	}

	fcitx::Instance *instance_;
	const fcitx::Key smokeTestKey_{"Control+Alt+Shift+V"};
	std::vector<std::unique_ptr<fcitx::HandlerTableEntry<fcitx::EventHandler>>>
		eventHandlers_;
	std::unique_ptr<fcitx::EventSourceTime> helloTimer_;
};

class VoxSpellAddonFactory final : public fcitx::AddonFactory {
public:
	fcitx::AddonInstance *create(fcitx::AddonManager *manager) override {
		return new VoxSpellAddon(manager->instance());
	}
};

} // namespace voxspell

FCITX_ADDON_FACTORY(voxspell::VoxSpellAddonFactory);
