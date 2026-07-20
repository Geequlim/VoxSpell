#pragma once

namespace voxspell {

enum class TapHoldPhase {
	Idle,
	Pending,
	Active,
	ActiveTriggerRelease,
	FailedTriggerRelease,
	AwaitingRelease,
};

enum class TapHoldEvent {
	TriggerPressed,
	TriggerRepeated,
	TriggerReleased,
	TriggerReleaseElapsed,
	ThresholdElapsed,
	OtherPressed,
	Cancelled,
	SessionFailed,
	Reset,
};

enum class TapHoldAction {
	None,
	ArmTimer,
	ArmReleaseTimer,
	CancelReleaseTimer,
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
