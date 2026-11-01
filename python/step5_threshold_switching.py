
import numpy as np
import matplotlib.pyplot as plt

rng = np.random.default_rng(2026)

N = 100_000
bits = rng.integers(0, 2, N)
tx = 2 * bits - 1

ebn0_db = np.arange(0, 15, 2)

rf_ber = []
fso_ber = []
hybrid_ber = []
selected_link = []

# Illustrative FSO attenuation conditions
# These are assumed conditions, not real weather measurements.
fso_loss_db = [0, 5, 10]

# Threshold: choose FSO only when its estimated channel
# quality is at least as good as the RF link.
for db in ebn0_db:
    rf_quality_db = db
    fso_loss = rng.choice(fso_loss_db)
    fso_quality_db = db - fso_loss

    # Estimate quality before transmitting data
    if fso_quality_db >= rf_quality_db:
        choice = "FSO"
        selected_link.append(choice)
        chosen_quality_db = fso_quality_db
    else:
        choice = "RF"
        selected_link.append(choice)
        chosen_quality_db = rf_quality_db

    # Simulate RF transmission
    rf_snr = 10 ** (rf_quality_db / 10)
    rf_noise = rng.normal(0, np.sqrt(1 / (2 * rf_snr)), N)
    rf_rx = tx + rf_noise
    rf_bits = (rf_rx > 0).astype(int)
    rf_error = np.mean(bits != rf_bits)
    rf_ber.append(rf_error)

    # Simulate FSO transmission
    fso_snr = 10 ** (fso_quality_db / 10)
    fso_noise = rng.normal(0, np.sqrt(1 / (2 * fso_snr)), N)
    fso_rx = tx + fso_noise
    fso_bits = (fso_rx > 0).astype(int)
    fso_error = np.mean(bits != fso_bits)
    fso_ber.append(fso_error)

    # BER of the selected link
    if choice == "FSO":
        hybrid_ber.append(fso_error)
    else:
        hybrid_ber.append(rf_error)

print("Threshold-Based RF-FSO Switching")
print("-" * 65)
print("Eb/N0 | RF BER    | FSO BER   | Hybrid BER | Selected")

for db, r, f, h, link in zip(
    ebn0_db, rf_ber, fso_ber, hybrid_ber, selected_link
):
    print(f"{db:>4} dB | {r:.6f} | {f:.6f} | {h:.6f} | {link}")

plt.figure(figsize=(8, 5))
plt.semilogy(ebn0_db, rf_ber, "o-", label="RF")
plt.semilogy(ebn0_db, fso_ber, "s-", label="FSO")
plt.semilogy(ebn0_db, hybrid_ber, "^-", label="Threshold hybrid")

plt.xlabel("Nominal Eb/N0 (dB)")
plt.ylabel("Bit Error Rate (BER)")
plt.title("Threshold-Based RF-FSO Switching")
plt.grid(True, which="both")
plt.legend()
plt.tight_layout()
plt.savefig("results/threshold_switching.png", dpi=300)
plt.show()
