#include "tap-hold-state.h"

#include <cstdlib>

using voxspell::TapHoldAction;
using voxspell::TapHoldEvent;
using voxspell::TapHoldPhase;

namespace {

TapHoldPhase expectTransition(
	TapHoldPhase phase,
	TapHoldEvent event,
	TapHoldPhase expectedPhase,
	TapHoldAction expectedAction) {
	const auto transition = voxspell::transitionTapHold(phase, event);
	if (transition.phase != expectedPhase || transition.action != expectedAction) {
		std::abort();
	}
	return transition.phase;
}

void testShortTap() {
	auto phase = expectTransition(
		TapHoldPhase::Idle,
		TapHoldEvent::TriggerPressed,
		TapHoldPhase::Pending,
		TapHoldAction::ArmTimer);
	expectTransition(
		phase,
		TapHoldEvent::TriggerReleased,
		TapHoldPhase::Idle,
		TapHoldAction::ReplayTrigger);
}

void testLongHold() {
	auto phase = expectTransition(
		TapHoldPhase::Idle,
		TapHoldEvent::TriggerPressed,
		TapHoldPhase::Pending,
		TapHoldAction::ArmTimer);
	phase = expectTransition(
		phase,
		TapHoldEvent::ThresholdElapsed,
		TapHoldPhase::Active,
		TapHoldAction::ShowActive);
	expectTransition(
		phase,
		TapHoldEvent::TriggerReleased,
		TapHoldPhase::Idle,
		TapHoldAction::ShowSuccess);
}

void testRollover() {
	auto phase = expectTransition(
		TapHoldPhase::Idle,
		TapHoldEvent::TriggerPressed,
		TapHoldPhase::Pending,
		TapHoldAction::ArmTimer);
	phase = expectTransition(
		phase,
		TapHoldEvent::OtherPressed,
		TapHoldPhase::AwaitingRelease,
		TapHoldAction::ReplayTrigger);
	expectTransition(
		phase,
		TapHoldEvent::TriggerReleased,
		TapHoldPhase::Idle,
		TapHoldAction::Swallow);
}

void testCancelAndReset() {
	auto phase = expectTransition(
		TapHoldPhase::Active,
		TapHoldEvent::Cancelled,
		TapHoldPhase::AwaitingRelease,
		TapHoldAction::Cancel);
	expectTransition(
		phase,
		TapHoldEvent::Reset,
		TapHoldPhase::Idle,
		TapHoldAction::Clear);
}

void testRepeatedTrigger() {
	expectTransition(
		TapHoldPhase::Pending,
		TapHoldEvent::TriggerRepeated,
		TapHoldPhase::Pending,
		TapHoldAction::Swallow);
	expectTransition(
		TapHoldPhase::Active,
		TapHoldEvent::TriggerRepeated,
		TapHoldPhase::Active,
		TapHoldAction::Swallow);
}

} // namespace

int main() {
	testShortTap();
	testLongHold();
	testRollover();
	testCancelAndReset();
	testRepeatedTrigger();
	return 0;
}
