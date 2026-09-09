import {randomBytes} from 'node:crypto';
import {createServer, type IncomingMessage, type Server} from 'node:http';
import {appendFile, readFile} from 'node:fs/promises';
import type {Socket} from 'node:net';
import {join} from 'node:path';

export interface WorkerHeapCdpBrokerSample {
	sampledAtEpochMs: number;
	targetId: string;
	targetUrl: string;
	totalSize: number;
	usedSize: number;
	harloweParserWorker: {
		currentSample?: WorkerHeapCdpBrokerTargetSample;
		/**
		 * Largest `usedSize` observed in a CDP sample during this broker's
		 * lifetime. This is sampled data, not the helper's allocation peak.
		 */
		observedPeakSample?: WorkerHeapCdpBrokerTargetSample;
	};
}

export interface WorkerHeapCdpBrokerTargetSample {
	sampledAtEpochMs: number;
	targetId: string;
	targetUrl: string;
	totalSize: number;
	usedSize: number;
}

export interface WorkerHeapCdpBrokerHttpRequest {
	authorization?: string;
	method?: string;
	path?: string;
}

export interface WorkerHeapCdpBrokerHttpResponse {
	end(body?: string): void;
	setHeader(name: string, value: string): void;
	writeHead(status: number): void;
}

interface BrowserTarget {
	targetId: string;
	type: string;
	url: string;
}

interface BrokerSocket {
	addEventListener(
		event: 'close' | 'error' | 'message' | 'open',
		listener: (event: any) => void
	): void;
	close(): void;
	send(message: string): void;
}

export interface WorkerHeapCdpBrokerOptions {
	commandTimeoutMs?: number;
	readDevToolsActivePort?: () => Promise<string>;
	tracePath?: string;
	userDataPath: string;
	webSocket?: (url: string) => BrokerSocket;
}

const bundledWorkerUrl = /(?:^|\/)twine-wasm-worker-[^/?#]+\.js(?:[?#]|$)/;
const harloweParserWorkerUrl =
	/(?:^|\/)harlowe-parser-worker-[^/?#]+\.js(?:[?#]|$)/;
const defaultCommandTimeoutMs = 4_000;

function errorMessage(error: unknown) {
	return error instanceof Error ? error.message : String(error);
}

function epochNow() {
	return performance.timeOrigin + performance.now();
}

function parseDevToolsActivePort(value: string) {
	const [port, browserPath] = value.split(/\r?\n/);
	if (!/^[1-9]\d*$/.test(port ?? '') || !browserPath?.startsWith('/')) {
		throw new Error(
			'DevToolsActivePort must contain a local port and browser path.'
		);
	}
	return `ws://127.0.0.1:${port}${browserPath}`;
}

/** Runner-owned browser-root CDP broker for the one benchmark worker isolate. */
export class WorkerHeapCdpBroker {
	readonly token = randomBytes(32).toString('hex');
	private readonly commandTimeoutMs: number;
	private readonly connections = new Set<Socket>();
	private server: Server | undefined;
	private socket: BrokerSocket | undefined;
	private nextId = 1;
	private pending = new Map<
		number,
		{
			method: string;
			reject: (error: Error) => void;
			resolve: (result: unknown) => void;
			timeout: ReturnType<typeof setTimeout>;
		}
	>();
	private closed = false;
	private sampleQueue: Promise<void> = Promise.resolve();
	private sessionId: string | undefined;
	private target: BrowserTarget | undefined;
	private traceWrites: Promise<void> = Promise.resolve();
	private harloweParserObservedPeakSample:
		WorkerHeapCdpBrokerTargetSample | undefined;

	constructor(private readonly options: WorkerHeapCdpBrokerOptions) {
		this.commandTimeoutMs = options.commandTimeoutMs ?? defaultCommandTimeoutMs;
	}

	async start() {
		if (this.server) return this.endpoint();
		this.server = createServer((request, response) => {
			void this.handleNodeRequest(request, response);
		});
		this.server.on('connection', socket => {
			this.connections.add(socket);
			socket.once('close', () => this.connections.delete(socket));
			if (this.closed) socket.destroy();
		});
		await new Promise<void>((resolve, reject) => {
			this.server!.once('error', reject);
			this.server!.listen(0, '127.0.0.1', () => {
				this.server!.removeListener('error', reject);
				resolve();
			});
		});
		this.recordLifecycle('broker-listening');
		return this.endpoint();
	}

	endpoint() {
		const address = this.server?.address();
		if (!address || typeof address === 'string') {
			throw new Error('Worker heap broker is not listening.');
		}
		return `http://127.0.0.1:${address.port}/worker-heap`;
	}

	async close() {
		if (this.closed) return;
		this.closed = true;
		this.recordLifecycle('broker-close');
		this.resetConnection(new Error('Worker heap broker closed.'));
		const server = this.server;
		this.server = undefined;
		if (server) {
			const closed = new Promise<void>((resolve, reject) =>
				server.close(error => {
					if (
						error &&
						(error as NodeJS.ErrnoException).code !== 'ERR_SERVER_NOT_RUNNING'
					) {
						reject(error);
					} else {
						resolve();
					}
				})
			);
			// close() does not reliably terminate idle keep-alive sockets on every
			// supported Node runtime. Destroy them after close initiation so test
			// teardown cannot wait for their timeout.
			for (const connection of this.connections) connection.destroy();
			await closed;
		}
		await this.traceWrites;
	}

	/** Test-only lifecycle trace. It intentionally never records bearer tokens. */
	recordLifecycle(stage: string, detail: Record<string, unknown> = {}) {
		const event = {
			detail,
			stage,
			timeEpochMs: epochNow()
		};
		if (!this.options.tracePath) return;
		this.traceWrites = this.traceWrites
			.catch(() => undefined)
			.then(() =>
				appendFile(this.options.tracePath!, `${JSON.stringify(event)}\n`)
			);
	}

	/**
	 * Routes one broker request. Tests exercise this in memory; only `start()`
	 * owns a real loopback listener for the benchmark runner.
	 */
	async handleHttpRequest(
		request: WorkerHeapCdpBrokerHttpRequest,
		response: WorkerHeapCdpBrokerHttpResponse
	) {
		if (
			request.method !== 'POST' ||
			request.path !== '/worker-heap' ||
			request.authorization !== `Bearer ${this.token}`
		) {
			this.recordLifecycle('broker-http-response', {
				status: request.authorization ? 404 : 401
			});
			response.writeHead(request.authorization ? 404 : 401);
			response.end();
			return;
		}
		this.recordLifecycle('broker-http-request');
		try {
			const sample = await this.sample();
			response.setHeader('content-type', 'application/json');
			response.end(JSON.stringify(sample));
			this.recordLifecycle('broker-http-response', {status: 200});
		} catch (error) {
			this.recordLifecycle('broker-http-response', {
				error: errorMessage(error),
				status: 503
			});
			response.writeHead(503);
			response.end(JSON.stringify({error: errorMessage(error)}));
		}
	}

	private async handleNodeRequest(
		request: IncomingMessage,
		response: import('node:http').ServerResponse
	) {
		await this.handleHttpRequest(
			{
				authorization:
					typeof request.headers.authorization === 'string'
						? request.headers.authorization
						: undefined,
				method: request.method,
				path: request.url
			},
			response
		);
	}

	private sample(): Promise<WorkerHeapCdpBrokerSample> {
		const queued = this.sampleQueue.then(() => this.sampleOnce());
		this.sampleQueue = queued.then(
			() => undefined,
			() => undefined
		);
		return queued;
	}

	private async sampleOnce(): Promise<WorkerHeapCdpBrokerSample> {
		if (this.closed) throw new Error('Worker heap broker is closed.');
		const deadline = performance.now() + this.commandTimeoutMs;
		const targets = await this.ensureAttached(deadline);
		if (!this.target || !this.sessionId) {
			throw new Error('Worker heap target is unavailable after attachment.');
		}
		const core = await this.getHeapUsage(this.target, this.sessionId, deadline);
		const currentSample = await this.sampleHarloweParser(
			targets.harloweParserWorker,
			deadline
		);
		if (
			currentSample &&
			(!this.harloweParserObservedPeakSample ||
				currentSample.usedSize > this.harloweParserObservedPeakSample.usedSize)
		) {
			this.harloweParserObservedPeakSample = currentSample;
		}
		return {
			...core,
			harloweParserWorker: {
				...(currentSample ? {currentSample} : {}),
				...(this.harloweParserObservedPeakSample
					? {observedPeakSample: this.harloweParserObservedPeakSample}
					: {})
			}
		};
	}

	private async ensureAttached(deadline: number) {
		await this.connect(deadline);
		let awaitingAnonymousWorker = false;
		for (;;) {
			if (awaitingAnonymousWorker && this.remainingTimeoutMs(deadline) <= 0) {
				throw new Error(
					`Anonymous dedicated worker target did not resolve within ${this.commandTimeoutMs}ms.`
				);
			}
			const targets = await this.inspectTargets(deadline);
			if (targets.coreWorker && !targets.anonymousWorker) {
				if (
					this.target?.targetId === targets.coreWorker.targetId &&
					this.sessionId
				) {
					return targets;
				}
				this.recordLifecycle('target-selection', {
					targetId: targets.coreWorker.targetId,
					targetUrl: targets.coreWorker.url
				});
				const attached = (await this.command(
					'Target.attachToTarget',
					{
						flatten: true,
						targetId: targets.coreWorker.targetId
					},
					undefined,
					deadline
				)) as {sessionId?: unknown};
				if (typeof attached.sessionId !== 'string') {
					throw new Error('Target.attachToTarget did not return a session ID.');
				}
				this.recordLifecycle('target-attach-response', {
					sessionId: attached.sessionId
				});
				this.target = targets.coreWorker;
				this.sessionId = attached.sessionId;
				return targets;
			}
			awaitingAnonymousWorker = Boolean(targets.anonymousWorker);
			const remainingMs = this.remainingTimeoutMs(deadline);
			if (remainingMs <= 0) {
				this.recordLifecycle('target-selection-timeout', {
					timeoutMs: this.commandTimeoutMs
				});
				if (targets.anonymousWorker) {
					throw new Error(
						`Anonymous dedicated worker target did not resolve within ${this.commandTimeoutMs}ms.`
					);
				}
				throw new Error(
					`Expected exactly one bundled WASM worker target within ${this.commandTimeoutMs}ms; found 0.`
				);
			}
			await new Promise(resolve =>
				setTimeout(resolve, Math.min(50, remainingMs))
			);
		}
	}

	private async inspectTargets(deadline: number) {
		const response = (await this.command(
			'Target.getTargets',
			undefined,
			undefined,
			deadline
		)) as {targetInfos?: unknown};
		const dedicatedWorkers = Array.isArray(response.targetInfos)
			? response.targetInfos.filter(
					(candidate): candidate is BrowserTarget =>
						typeof candidate?.targetId === 'string' &&
						candidate.type === 'worker' &&
						typeof candidate.url === 'string'
				)
			: [];
		const coreWorkers = dedicatedWorkers.filter(target =>
			bundledWorkerUrl.test(target.url)
		);
		const harloweParserWorkers = dedicatedWorkers.filter(target =>
			harloweParserWorkerUrl.test(target.url)
		);
		const anonymousWorkers = dedicatedWorkers.filter(
			target => target.url === ''
		);
		const unexpectedWorkers = dedicatedWorkers.filter(
			target =>
				target.url !== '' &&
				!bundledWorkerUrl.test(target.url) &&
				!harloweParserWorkerUrl.test(target.url)
		);
		this.recordLifecycle('target-selection', {
			anonymousDedicatedWorkerCount: anonymousWorkers.length,
			harloweParserWorkerCount: harloweParserWorkers.length,
			matchingTargetCount: coreWorkers.length,
			unexpectedDedicatedWorkerCount: unexpectedWorkers.length
		});
		if (coreWorkers.length > 1) {
			throw new Error(
				`Expected exactly one bundled WASM worker target; found ${coreWorkers.length}.`
			);
		}
		if (harloweParserWorkers.length > 1) {
			throw new Error(
				`Expected at most one Harlowe parser worker target; found ${harloweParserWorkers.length}.`
			);
		}
		if (anonymousWorkers.length > 1) {
			throw new Error(
				`Expected at most one anonymous dedicated worker target; found ${anonymousWorkers.length}.`
			);
		}
		if (
			anonymousWorkers.length &&
			(!coreWorkers.length || harloweParserWorkers.length)
		) {
			throw new Error(
				'Anonymous dedicated worker target is only permitted beside one core worker and no resolved Harlowe parser worker.'
			);
		}
		if (unexpectedWorkers.length) {
			throw new Error(
				`Unexpected dedicated worker target(s): ${unexpectedWorkers.map(target => target.url).join(', ')}.`
			);
		}
		return {
			anonymousWorker: anonymousWorkers[0],
			coreWorker: coreWorkers[0],
			harloweParserWorker: harloweParserWorkers[0]
		};
	}

	private async getHeapUsage(
		target: BrowserTarget,
		sessionId: string,
		deadline: number
	): Promise<WorkerHeapCdpBrokerTargetSample> {
		const result = (await this.command(
			'Runtime.getHeapUsage',
			undefined,
			sessionId,
			deadline
		)) as {totalSize?: unknown; usedSize?: unknown};
		if (
			typeof result.usedSize !== 'number' ||
			typeof result.totalSize !== 'number'
		) {
			throw new Error('Runtime.getHeapUsage returned invalid sizes.');
		}
		return {
			sampledAtEpochMs: epochNow(),
			targetId: target.targetId,
			targetUrl: target.url,
			totalSize: result.totalSize,
			usedSize: result.usedSize
		};
	}

	private async sampleHarloweParser(
		target: BrowserTarget | undefined,
		deadline: number
	) {
		if (!target) return undefined;
		let sessionId: string | undefined;
		try {
			const attached = (await this.command(
				'Target.attachToTarget',
				{flatten: true, targetId: target.targetId},
				undefined,
				deadline
			)) as {sessionId?: unknown};
			if (typeof attached.sessionId !== 'string') {
				throw new Error('Target.attachToTarget did not return a session ID.');
			}
			sessionId = attached.sessionId;
			return await this.getHeapUsage(target, sessionId, deadline);
		} catch (error) {
			// The parser is short-lived. If it vanished after discovery, confirm its
			// absence within this sample's deadline and report no current sample.
			const refreshed = await this.ensureAttached(deadline);
			if (!refreshed.harloweParserWorker) return undefined;
			throw error;
		} finally {
			if (sessionId) {
				try {
					await this.command(
						'Target.detachFromTarget',
						{sessionId},
						undefined,
						deadline
					);
				} catch {
					/* A terminated helper implicitly closes its CDP session. */
				}
			}
		}
	}

	private async connect(deadline: number) {
		if (this.socket) return;
		this.recordLifecycle('devtools-active-port-read-start');
		let activePort: string;
		try {
			const readDevToolsActivePort =
				this.options.readDevToolsActivePort ??
				(() =>
					readFile(
						join(this.options.userDataPath, 'session', 'DevToolsActivePort'),
						'utf8'
					));
			activePort = await this.withDeadline(
				readDevToolsActivePort(),
				deadline,
				'DevToolsActivePort read'
			);
			this.recordLifecycle('devtools-active-port-read-success');
		} catch (error) {
			this.recordLifecycle('devtools-active-port-read-failed', {
				error: errorMessage(error)
			});
			throw error;
		}
		this.recordLifecycle('browser-websocket-open-start');
		const socket = (
			this.options.webSocket ??
			(url => new WebSocket(url) as unknown as BrokerSocket)
		)(parseDevToolsActivePort(activePort));
		this.socket = socket;
		socket.addEventListener('message', event => this.onMessage(event));
		socket.addEventListener('close', () =>
			this.resetConnection(new Error('Browser-root CDP socket closed.'))
		);
		socket.addEventListener('error', () =>
			this.resetConnection(new Error('Browser-root CDP socket failed.'))
		);
		await new Promise<void>((resolve, reject) => {
			const timeout = setTimeout(() => {
				this.recordLifecycle('browser-websocket-open-timeout', {
					timeoutMs: this.commandTimeoutMs
				});
				reject(new Error('Browser-root CDP connection timed out.'));
			}, this.remainingTimeoutMs(deadline));
			socket.addEventListener('open', () => {
				clearTimeout(timeout);
				this.recordLifecycle('browser-websocket-open-success');
				resolve();
			});
			socket.addEventListener('error', () => {
				clearTimeout(timeout);
				this.recordLifecycle('browser-websocket-open-failed');
				reject(new Error('Browser-root CDP connection failed.'));
			});
		});
	}

	private command(
		method:
			| 'Runtime.getHeapUsage'
			| 'Target.attachToTarget'
			| 'Target.detachFromTarget'
			| 'Target.getTargets',
		params?: Record<string, unknown>,
		sessionId?: string,
		deadline = performance.now() + this.commandTimeoutMs
	) {
		const socket = this.socket;
		if (!socket)
			return Promise.reject(
				new Error('Browser-root CDP socket is unavailable.')
			);
		const id = this.nextId++;
		return new Promise<unknown>((resolve, reject) => {
			const remainingMs = this.remainingTimeoutMs(deadline);
			if (remainingMs <= 0) {
				this.recordLifecycle('cdp-command-timeout', {
					method,
					timeoutMs: this.commandTimeoutMs
				});
				reject(
					new Error(
						`Browser-root CDP ${method} timed out after ${this.commandTimeoutMs}ms.`
					)
				);
				return;
			}
			const timeout = setTimeout(() => {
				this.pending.delete(id);
				this.recordLifecycle('cdp-command-timeout', {
					method,
					timeoutMs: this.commandTimeoutMs
				});
				reject(
					new Error(
						`Browser-root CDP ${method} timed out after ${this.commandTimeoutMs}ms.`
					)
				);
			}, remainingMs);
			this.pending.set(id, {method, reject, resolve, timeout});
			try {
				this.recordLifecycle(
					method === 'Runtime.getHeapUsage'
						? 'runtime-get-heap-usage-send'
						: 'cdp-command-send',
					{method, ...(sessionId ? {sessionId} : {})}
				);
				socket.send(
					JSON.stringify({
						id,
						...(params ? {params} : {}),
						...(sessionId ? {sessionId} : {}),
						method
					})
				);
			} catch (error) {
				clearTimeout(timeout);
				this.pending.delete(id);
				reject(error as Error);
			}
		});
	}

	private remainingTimeoutMs(deadline: number) {
		return Math.max(0, Math.ceil(deadline - performance.now()));
	}

	private async withDeadline<T>(
		operation: Promise<T>,
		deadline: number,
		label: string
	) {
		const remainingMs = this.remainingTimeoutMs(deadline);
		if (remainingMs <= 0)
			throw new Error(`${label} timed out after ${this.commandTimeoutMs}ms.`);
		return await new Promise<T>((resolve, reject) => {
			const timeout = setTimeout(
				() =>
					reject(
						new Error(`${label} timed out after ${this.commandTimeoutMs}ms.`)
					),
				remainingMs
			);
			operation.then(
				value => {
					clearTimeout(timeout);
					resolve(value);
				},
				error => {
					clearTimeout(timeout);
					reject(error);
				}
			);
		});
	}

	private onMessage(event: {data?: unknown}) {
		if (typeof event.data !== 'string') return;
		let message: {id?: unknown; error?: {message?: unknown}; result?: unknown};
		try {
			message = JSON.parse(event.data);
		} catch {
			return;
		}
		if (typeof message.id !== 'number') return;
		const pending = this.pending.get(message.id);
		if (!pending) return;
		this.pending.delete(message.id);
		clearTimeout(pending.timeout);
		this.recordLifecycle(
			pending.method === 'Runtime.getHeapUsage'
				? 'runtime-get-heap-usage-response'
				: pending.method === 'Target.getTargets'
					? 'target-get-targets-response'
					: 'cdp-command-response',
			pending.method === 'Target.getTargets'
				? {
						targetCount: Array.isArray(
							(message.result as {targetInfos?: unknown})?.targetInfos
						)
							? (message.result as {targetInfos: unknown[]}).targetInfos.length
							: undefined
					}
				: {method: pending.method}
		);
		if (message.error) {
			pending.reject(
				new Error(
					typeof message.error.message === 'string'
						? message.error.message
						: 'Browser-root CDP command failed.'
				)
			);
		} else {
			pending.resolve(message.result);
		}
	}

	private resetConnection(error: Error) {
		const socket = this.socket;
		this.socket = undefined;
		this.sessionId = undefined;
		this.target = undefined;
		for (const pending of this.pending.values()) {
			clearTimeout(pending.timeout);
			pending.reject(error);
		}
		this.pending.clear();
		try {
			socket?.close();
		} catch {
			/* teardown is best effort */
		}
	}
}
