#include "tap-hold-state.h"

namespace voxspell {

TapHoldTransition transitionTapHold(TapHoldPhase phase, TapHoldEvent event) {
	switch (phase) {
	case TapHoldPhase::Idle:
		if (event == TapHoldEvent::TriggerPressed) {
			return {TapHoldPhase::Pending, TapHoldAction::ArmTimer};
		}
		break;
	case TapHoldPhase::Pending:
		switch (event) {
		case TapHoldEvent::TriggerRepeated:
			return {phase, TapHoldAction::Swallow};
		case TapHoldEvent::TriggerReleased:
			return {TapHoldPhase::Idle, TapHoldAction::ReplayTrigger};
		case TapHoldEvent::ThresholdElapsed:
			return {TapHoldPhase::Active, TapHoldAction::ShowActive};
		case TapHoldEvent::OtherPressed:
			return {TapHoldPhase::AwaitingRelease, TapHoldAction::ReplayTrigger};
		case TapHoldEvent::Reset:
			return {TapHoldPhase::Idle, TapHoldAction::Clear};
		default:
			break;
		}
		break;
	case TapHoldPhase::Active:
		switch (event) {
		case TapHoldEvent::TriggerRepeated:
			return {phase, TapHoldAction::Swallow};
		case TapHoldEvent::TriggerReleased:
			return {
				TapHoldPhase::ActiveTriggerRelease,
				TapHoldAction::ArmReleaseTimer,
			};
		case TapHoldEvent::OtherPressed:
		case TapHoldEvent::Cancelled:
			return {TapHoldPhase::AwaitingRelease, TapHoldAction::Cancel};
		case TapHoldEvent::SessionFailed:
			return {TapHoldPhase::AwaitingRelease, TapHoldAction::None};
		case TapHoldEvent::Reset:
			return {TapHoldPhase::Idle, TapHoldAction::Clear};
		default:
			break;
		}
		break;
	case TapHoldPhase::ActiveTriggerRelease:
		switch (event) {
		case TapHoldEvent::TriggerRepeated:
			return {TapHoldPhase::Active, TapHoldAction::CancelReleaseTimer};
		case TapHoldEvent::TriggerReleaseElapsed:
			return {TapHoldPhase::Idle, TapHoldAction::ShowSuccess};
		case TapHoldEvent::SessionFailed:
			return {TapHoldPhase::FailedTriggerRelease, TapHoldAction::None};
		case TapHoldEvent::Reset:
			return {TapHoldPhase::Idle, TapHoldAction::Clear};
		default:
			break;
		}
		break;
	case TapHoldPhase::FailedTriggerRelease:
		switch (event) {
		case TapHoldEvent::TriggerRepeated:
			return {
				TapHoldPhase::AwaitingRelease,
				TapHoldAction::CancelReleaseTimer,
			};
		case TapHoldEvent::TriggerReleaseElapsed:
			return {TapHoldPhase::Idle, TapHoldAction::None};
		case TapHoldEvent::Reset:
			return {TapHoldPhase::Idle, TapHoldAction::Clear};
		default:
			break;
		}
		break;
	case TapHoldPhase::AwaitingRelease:
		if (event == TapHoldEvent::TriggerReleased) {
			return {TapHoldPhase::Idle, TapHoldAction::Swallow};
		}
		if (event == TapHoldEvent::TriggerRepeated) {
			return {phase, TapHoldAction::Swallow};
		}
		if (event == TapHoldEvent::Reset) {
			return {TapHoldPhase::Idle, TapHoldAction::Clear};
		}
		break;
	}

	return {phase, TapHoldAction::None};
}

} // namespace voxspell
