#include <fcitx-utils/event.h>

#include <sys/timerfd.h>
#include <unistd.h>

#include <cstdint>
#include <iostream>

int main() {
	fcitx::EventLoop eventLoop;
	const int timerFd =
		timerfd_create(CLOCK_MONOTONIC, TFD_NONBLOCK | TFD_CLOEXEC);
	if (timerFd < 0) {
		std::cerr << "unable to create timerfd\n";
		return 1;
	}

	itimerspec specification{};
	specification.it_value.tv_nsec = 10000000;
	specification.it_interval = specification.it_value;
	if (timerfd_settime(timerFd, 0, &specification, nullptr) < 0) {
		close(timerFd);
		std::cerr << "unable to configure timerfd\n";
		return 1;
	}

	std::uint64_t tickCount = 0;
	auto timer = eventLoop.addIOEvent(
		timerFd,
		fcitx::IOEventFlag::In,
		[&](fcitx::EventSourceIO *, int fileDescriptor, fcitx::IOEventFlags) {
			std::uint64_t expirations = 0;
			if (read(
					fileDescriptor,
					&expirations,
					sizeof(expirations)) != sizeof(expirations)) {
				return false;
			}
			tickCount += expirations;
			if (tickCount >= 3) {
				eventLoop.exit();
			}
			return true;
		});
	auto timeout = eventLoop.addTimeEvent(
		CLOCK_MONOTONIC,
		fcitx::now(CLOCK_MONOTONIC) + 500000,
		0,
		[&](fcitx::EventSourceTime *, std::uint64_t) {
			std::cerr << "recurring timer timed out after " << tickCount
					  << " ticks\n";
			eventLoop.exit();
			return false;
		});
	timeout->setOneShot();

	eventLoop.exec();
	timer.reset();
	close(timerFd);
	return tickCount >= 3 ? 0 : 1;
}
