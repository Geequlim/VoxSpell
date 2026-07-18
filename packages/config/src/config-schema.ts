import { Type } from '@sinclair/typebox';

import type { Static } from '@sinclair/typebox';

export const DEFAULT_MAXIMUM_RECORDING_SECONDS = 300;
export const MINIMUM_RECORDING_SECONDS = 1;
export const MAXIMUM_RECORDING_SECONDS = 3_600;

export const OpenAiCompatibleTranscriptionProviderConfigSchema = Type.Object(
	{
		id: Type.String({ minLength: 1 }),
		type: Type.Literal('openai-compatible-transcription'),
		baseUrl: Type.String({ pattern: '^https?://', minLength: 1 }),
		apiKeyEnvironment: Type.String({ pattern: '^[A-Z][A-Z0-9_]*$' }),
		model: Type.String({ minLength: 1 }),
	},
	{ additionalProperties: false },
);

export type OpenAiCompatibleTranscriptionProviderConfig = Static<
	typeof OpenAiCompatibleTranscriptionProviderConfigSchema
>;

export const TencentRealtimeProviderConfigSchema = Type.Object(
	{
		id: Type.String({ minLength: 1 }),
		type: Type.Literal('tencent-realtime'),
		engineModelType: Type.String({ minLength: 1 }),
	},
	{ additionalProperties: false },
);
export type TencentRealtimeProviderConfig = Static<typeof TencentRealtimeProviderConfigSchema>;

export const AsrProviderConfigSchema = Type.Union([
	OpenAiCompatibleTranscriptionProviderConfigSchema,
	TencentRealtimeProviderConfigSchema,
]);
export type AsrProviderConfig = Static<typeof AsrProviderConfigSchema>;

export const OpenAiCompatibleTextPolisherConfigSchema = Type.Object(
	{
		id: Type.String({ minLength: 1 }),
		type: Type.Literal('openai-compatible-chat'),
		baseUrl: Type.String({ pattern: '^https?://', minLength: 1 }),
		apiKeyEnvironment: Type.String({ pattern: '^[A-Z][A-Z0-9_]*$' }),
		model: Type.String({ minLength: 1 }),
		timeoutMilliseconds: Type.Optional(Type.Integer({ minimum: 1_000 })),
	},
	{ additionalProperties: false },
);
export type OpenAiCompatibleTextPolisherConfig = Static<
	typeof OpenAiCompatibleTextPolisherConfigSchema
>;

export const TextPolishingConfigSchema = Type.Object(
	{
		enabled: Type.Boolean(),
		minimumEffectiveCharacters: Type.Optional(Type.Integer({ minimum: 0, maximum: 200 })),
		activeProvider: Type.Optional(Type.String({ minLength: 1 })),
		systemPrompt: Type.String({ minLength: 1 }),
		providers: Type.Array(OpenAiCompatibleTextPolisherConfigSchema),
	},
	{ additionalProperties: false },
);
export type TextPolishingConfig = Static<typeof TextPolishingConfigSchema>;

export const TextProcessingConfigSchema = Type.Object(
	{
		trimTrailingPeriod: Type.Boolean(),
	},
	{ additionalProperties: false },
);
export type TextProcessingConfig = Static<typeof TextProcessingConfigSchema>;

export const SessionConfigSchema = Type.Object(
	{
		maximumRecordingSeconds: Type.Integer({
			minimum: MINIMUM_RECORDING_SECONDS,
			maximum: MAXIMUM_RECORDING_SECONDS,
		}),
	},
	{ additionalProperties: false },
);
export type SessionConfig = Static<typeof SessionConfigSchema>;

export const VoxSpellConfigSchema = Type.Object(
	{
		version: Type.Literal(1),
		asr: Type.Object(
			{
				activeProvider: Type.String({ minLength: 1 }),
				providers: Type.Array(AsrProviderConfigSchema, {
					minItems: 1,
				}),
			},
			{ additionalProperties: false },
		),
		session: Type.Optional(SessionConfigSchema),
		textProcessing: Type.Optional(TextProcessingConfigSchema),
		polishing: Type.Optional(TextPolishingConfigSchema),
	},
	{ additionalProperties: false },
);

export type VoxSpellConfig = Static<typeof VoxSpellConfigSchema>;
