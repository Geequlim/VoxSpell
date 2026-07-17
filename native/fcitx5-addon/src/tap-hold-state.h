#pragma once

namespace voxspell {

enum class TapHoldPhase {
	Idle,
	Pending,
	Active,
	AwaitingRelease,
};

enum class TapHoldEvent {
	TriggerPressed,
	TriggerRepeated,
	TriggerReleased,
	ThresholdElapsed,
	OtherPressed,
	Cancelled,
	Reset,
};

enum class TapHoldAction {
	None,
	ArmTimer,
	ReplayTrigger,
	ShowActive,
	ShowSuccess,
	Cancel,
	Clear,
	Swallow,
};

struct TapHoldTransition {
	TapHoldPhase phase;
	TapHoldAction action;
};

TapHoldTransition transitionTapHold(TapHoldPhase phase, TapHoldEvent event);

} // namespace voxspell
