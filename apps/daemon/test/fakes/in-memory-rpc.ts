import { PassThrough, Transform } from 'node:stream';

import {
	StreamMessageReader,
	StreamMessageWriter,
	createMessageConnection,
} from 'vscode-jsonrpc/node';

import type { MessageConnection } from 'vscode-jsonrpc/node';
import type { Duplex, TransformCallback } from 'node:stream';

export interface InMemoryRpcPair {
	readonly client: MessageConnection;
	readonly server: MessageConnection;
	readonly clientToServer: Duplex;
	readonly serverToClient: Duplex;
	dispose(): void;
}

class FragmentingStream extends Transform {
	readonly #fragmentSize: number;

	constructor(fragmentSize: number) {
		super();
		this.#fragmentSize = fragmentSize;
	}

	_transform(chunk: Buffer, encoding: BufferEncoding, callback: TransformCallback): void {
		const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk, encoding);
		for (let offset = 0; offset < buffer.length; offset += this.#fragmentSize) {
			this.push(buffer.subarray(offset, offset + this.#fragmentSize));
		}
		callback();
	}
}

/** 创建使用 LSP Content-Length 分帧的双向内存 JSON-RPC 连接。 */
export function createInMemoryRpcPair(fragmentSize?: number): InMemoryRpcPair {
	const clientToServer = fragmentSize ? new FragmentingStream(fragmentSize) : new PassThrough();
	const serverToClient = fragmentSize ? new FragmentingStream(fragmentSize) : new PassThrough();
	const client = createMessageConnection(
		new StreamMessageReader(serverToClient),
		new StreamMessageWriter(clientToServer),
	);
	const server = createMessageConnection(
		new StreamMessageReader(clientToServer),
		new StreamMessageWriter(serverToClient),
	);

	return {
		client,
		server,
		clientToServer,
		serverToClient,
		dispose: () => {
			client.dispose();
			server.dispose();
			clientToServer.destroy();
			serverToClient.destroy();
		},
	};
}
