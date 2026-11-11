import type { ChannelInputs, PredictionResponse } from "./types";

export const API_BASE_URL =
  (import.meta.env.VITE_API_URL || "https://satcom-api-e64x.onrender.com").replace(/\/+$/, "");

export type HealthResponse = {
  status: string;
};

export class ApiHttpError extends Error {
  readonly status: number;
  readonly url: string;

  constructor(
    status: number,
    url: string,
  ) {
    super(`HTTP ${status} from ${url}`);
    this.name = "ApiHttpError";
    this.status = status;
    this.url = url;
  }
}

export class ApiTimeoutError extends Error {
  readonly timeoutMs: number;
  readonly url: string;

  constructor(
    timeoutMs: number,
    url: string,
  ) {
    super(`Request to ${url} timed out after ${timeoutMs / 1000} seconds.`);
    this.name = "ApiTimeoutError";
    this.timeoutMs = timeoutMs;
    this.url = url;
  }
}

async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<Response> {
  const controller = new AbortController();
  let timedOut = false;
  const abortFromCaller = () => controller.abort();
  if (signal?.aborted) controller.abort();
  signal?.addEventListener("abort", abortFromCaller, { once: true });
  const timeout = window.setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);

  try {
    const response = await fetch(url, { ...init, signal: controller.signal });
    if (!response.ok) {
      throw new ApiHttpError(response.status, url);
    }
    return response;
  } catch (error) {
    if (timedOut) {
      throw new ApiTimeoutError(timeoutMs, url);
    }
    throw error;
  } finally {
    window.clearTimeout(timeout);
    signal?.removeEventListener("abort", abortFromCaller);
  }
}

export async function health(signal?: AbortSignal): Promise<HealthResponse> {
  const url = `${API_BASE_URL}/api/health`;
  const response = await fetchWithTimeout(url, {}, 60_000, signal);
  const result = (await response.json()) as HealthResponse;
  if (result.status !== "ok") {
    throw new Error(`Health check returned an unexpected status from ${url}.`);
  }
  return result;
}

export async function predict(
  inputs: ChannelInputs,
  signal?: AbortSignal,
  timeoutMs = 30_000,
): Promise<PredictionResponse> {
  const url = `${API_BASE_URL}/api/predict`;
  const response = await fetchWithTimeout(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(inputs),
  }, timeoutMs, signal);
  return (await response.json()) as PredictionResponse;
}
