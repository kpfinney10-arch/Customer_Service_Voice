import type {
  StructuredOutputAdapter,
  StructuredOutputRequest,
  StructuredOutputResponse,
} from "./structured-output-adapter.js";

export type FakeStructuredOutputAdapterOptions = {
  outputByTranscript?: Record<string, object>;
  defaultOutput?: object;
  onRequest?: (request: StructuredOutputRequest) => void;
};

export function createFakeStructuredOutputAdapter(
  options: FakeStructuredOutputAdapterOptions = {},
): StructuredOutputAdapter {
  return {
    async generateStructuredOutput<TOutput extends object>(
      request: StructuredOutputRequest,
    ): Promise<StructuredOutputResponse<TOutput>> {
      options.onRequest?.(request);
      const output = options.outputByTranscript?.[request.transcript] ?? options.defaultOutput ?? {};
      return {
        output: output as TOutput,
        confidence: Object.keys(output).length > 0 ? 0.78 : 0,
        provider: "fake-structured-output",
        warnings: Object.keys(output).length > 0 ? [] : ["no_fake_output_configured"],
      };
    },
  };
}
