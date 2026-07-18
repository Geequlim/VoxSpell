#include "error-presentation.h"

#include <cassert>

int main() {
	using voxspell::presentClientError;
	using voxspell::presentSessionError;

	const auto sessionError = presentSessionError({
		.code = "ASR_FAILED",
		.stage = "asr",
		.retryable = true,
		.providerCode = "UNAUTHORIZED",
	});
	assert(sessionError.summary == "语音识别服务失败");
	assert(
		sessionError.diagnostic ==
		"错误码: ASR_FAILED · 阶段: asr · 服务: UNAUTHORIZED · 可重试");
	const auto timeoutError = presentSessionError({
		.code = "SESSION_TIMEOUT",
		.stage = "session",
		.retryable = false,
	});
	assert(timeoutError.summary == "语音输入已达到最长时限");

	const auto connectionError = presentClientError("Connection refused");
	assert(connectionError.summary == "后台服务未运行或尚未就绪");
	assert(connectionError.diagnostic == "Connection refused");

	const auto unknownError = presentSessionError({
		.code = "UNKNOWN",
		.stage = "session",
		.retryable = false,
	});
	assert(unknownError.summary == "语音输入失败");
	assert(unknownError.diagnostic == "错误码: UNKNOWN · 阶段: session");
}
