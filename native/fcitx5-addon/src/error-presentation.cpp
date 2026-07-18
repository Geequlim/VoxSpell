#include "error-presentation.h"

#include <string>
#include <utility>

namespace voxspell {

namespace {

std::string summaryForCode(const std::string &code) {
	if (code == "SESSION_BUSY") return "已有一轮语音输入正在进行";
	if (code == "SESSION_NOT_FOUND" || code == "INVALID_SESSION_STATE") {
		return "语音会话状态异常";
	}
	if (code == "CAPTURE_FAILED") return "无法启动或读取麦克风";
	if (code == "ASR_FAILED") return "语音识别服务失败";
	if (code == "PROCESSING_FAILED") return "识别结果处理失败";
	if (code == "POLISH_FAILED") return "AI 润色服务失败";
	if (code == "NOT_CONFIGURED") return "尚未配置可用的语音识别服务";
	if (
		code == "CONFIG_NOT_FOUND" || code == "CONFIG_INVALID" ||
		code == "CONFIG_APPLY_FAILED") {
		return "语音输入配置不可用";
	}
	if (code == "CREDENTIAL_MISSING" || code == "CREDENTIAL_STORE_INVALID") {
		return "语音服务凭据缺失或不可用";
	}
	if (code == "PROTOCOL_VERSION_UNSUPPORTED") return "组件协议版本不兼容";
	if (code == "MESSAGE_TOO_LARGE") return "后台返回的数据超出限制";
	return "语音输入失败";
}

} // namespace

ErrorPresentation presentSessionError(const protocol::ProtocolErrorData &error) {
	std::string diagnostic = "错误码: " + error.code + " · 阶段: " + error.stage;
	if (error.providerCode) {
		diagnostic += " · 服务: " + *error.providerCode;
	}
	if (error.retryable) {
		diagnostic += " · 可重试";
	}
	return {summaryForCode(error.code), std::move(diagnostic)};
}

ErrorPresentation presentClientError(std::string_view message) {
	std::string summary = "无法连接或调用后台服务";
	if (
		message.find("Connection refused") != std::string_view::npos ||
		message.find("No such file or directory") != std::string_view::npos) {
		summary = "后台服务未运行或尚未就绪";
	}
	return {
		std::move(summary),
		message.empty() ? "错误码: DAEMON_UNAVAILABLE" : std::string(message),
	};
}

} // namespace voxspell
