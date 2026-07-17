#pragma once

#include <fcitx-config/configuration.h>
#include <fcitx-config/option.h>
#include <fcitx-utils/key.h>

namespace voxspell {

FCITX_CONFIGURATION(
	VoxSpellConfig,
	fcitx::Option<fcitx::Key, fcitx::KeyConstrain> pttKey{
		this,
		"PTTKey",
		"按住说话热键",
		fcitx::Key(FcitxKey_space),
		fcitx::KeyConstrain(fcitx::KeyConstrainFlags(
			fcitx::KeyConstrainFlag::AllowModifierLess))};
	fcitx::Option<int, fcitx::IntConstrain> holdThresholdMs{
		this,
		"HoldThresholdMs",
		"开始说话模式所需长按时间（毫秒）",
		200,
		fcitx::IntConstrain(100, 2000)};
	fcitx::Option<bool> autoSelectResult{
		this,
		"AutoSelectResult",
		"自动选择推荐结果",
		true};);

} // namespace voxspell
