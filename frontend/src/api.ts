import type { ChannelInputs, PredictionResponse } from "./types";

export const API_BASE_URL =
  import.meta.env.VITE_API_URL ?? "http://127.0.0.1:8000";

export type HealthResponse = {
  status: string;
  app: string;
  model_loaded: boolean;
  features: string[];
};

export async function health(signal?: AbortSignal): Promise<HealthResponse> {
  const response = await fetch(`${API_BASE_URL}/api/health`, { signal });
  if (!response.ok) {
    throw new Error(`Health request failed (${response.status})`);
  }
  return (await response.json()) as HealthResponse;
}

export async function predict(
  inputs: ChannelInputs,
  signal?: AbortSignal,
): Promise<PredictionResponse> {
  const response = await fetch(`${API_BASE_URL}/api/predict`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(inputs),
    signal,
  });

  if (!response.ok) {
    throw new Error(`Prediction request failed (${response.status})`);
  }

  return (await response.json()) as PredictionResponse;
}
