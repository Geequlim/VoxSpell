/** 在多个 RPC 连接之间保证同一时间只有一个语音会话。 */
export class DaemonSessionGate {
	#owner?: object;

	/** 尝试为指定协调器占用 daemon 会话。 */
	acquire(owner: object): boolean {
		if (this.#owner) return this.#owner === owner;
		this.#owner = owner;
		return true;
	}

	/** 仅由当前持有者释放 daemon 会话。 */
	release(owner: object): void {
		if (this.#owner === owner) this.#owner = undefined;
	}
}
