export type StructuredOutputRequest<TSchema extends object = Record<string, unknown>> = {
  tenantId: string;
  taskName: string;
  transcript: string;
  schema: TSchema;
  correlationId?: string;
  context?: Record<string, unknown>;
};

export type StructuredOutputResponse<TOutput extends object = Record<string, unknown>> = {
  output: TOutput;
  confidence: number;
  provider: string;
  warnings: string[];
};

export type StructuredOutputAdapter = {
  generateStructuredOutput: <TOutput extends object>(
    request: StructuredOutputRequest,
  ) => Promise<StructuredOutputResponse<TOutput>>;
};
