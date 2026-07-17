export interface AudioCaptureBackend {
	/** 创建一次独立的音频采集会话。 */
	createSession(): AudioCaptureSession;
}

export interface AudioCaptureSession {
	/** 启动音频采集。 */
	start(signal: AbortSignal): Promise<void>;

	/** 按采集顺序返回音频字节块。 */
	frames(): AsyncIterable<Uint8Array>;

	/** 正常停止采集，并让音频流在剩余数据耗尽后结束。 */
	stop(): Promise<void>;

	/** 立即取消采集。 */
	cancel(reason?: string): Promise<void>;
}
