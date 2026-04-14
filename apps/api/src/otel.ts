/**
 * OpenTelemetry instrumentation — must be imported BEFORE all other modules.
 * Reads OTEL_EXPORTER_OTLP_ENDPOINT from env (default: http://localhost:4318).
 */
import { NodeSDK } from "@opentelemetry/sdk-node";
import { getNodeAutoInstrumentations } from "@opentelemetry/auto-instrumentations-node";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";

const sdk = new NodeSDK({
  serviceName: process.env["OTEL_SERVICE_NAME"] ?? "treasury-api",
  traceExporter: new OTLPTraceExporter({
    url: `${process.env["OTEL_EXPORTER_OTLP_ENDPOINT"] ?? "http://localhost:4318"}/v1/traces`,
  }),
  instrumentations: [getNodeAutoInstrumentations()],
});

sdk.start();

process.on("SIGTERM", () => {
  sdk.shutdown().finally(() => process.exit(0));
});
