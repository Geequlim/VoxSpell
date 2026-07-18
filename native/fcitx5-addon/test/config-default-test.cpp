#include "config.h"

#include <cassert>

int main() {
	voxspell::VoxSpellConfig config;
	assert(config.pttKey.value().check(FcitxKey_space));
	assert(config.polishingToggleKey.value().check(FcitxKey_Shift_L));
}
