export type ChannelInputs = {
  rf_snr_db: number;
  fso_snr_db: number;
  atmospheric_loss_db: number;
  cloud_attenuation_db: number;
};

export type PredictionResponse = {
  prediction: string;
  confidence_percent: Record<string, number>;
  inputs: ChannelInputs;
  model_features: string[];
  note: string;
};

export type ApiStatus = "checking" | "loading" | "connected" | "offline";

export type DecisionState = {
  status: "loading" | "ready" | "error";
  rfProb: number | null;
  fsoProb: number | null;
  selected: "RF" | "FSO" | null;
  updatedAt: number | null;
};
