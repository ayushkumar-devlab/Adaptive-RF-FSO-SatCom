
import numpy as np
import matplotlib.pyplot as plt

rng = np.random.default_rng(2026)

N = 100_000
bits = rng.integers(0, 2, N)
tx = 2 * bits - 1

ebn0_db = np.arange(0, 15, 2)

# Illustrative FSO attenuation scenarios
fso_loss_db = [0, 5, 10]

rf_ber = []
fso_ber = []
hybrid_ber = []
selected_links = []

for db in ebn0_db:
    ebn0 = 10 ** (db / 10)

    # RF link: BPSK over AWGN
    rf_noise = rng.normal(0, np.sqrt(1 / (2 * ebn0)), N)
    rf_rx = tx + rf_noise
    rf_bits = (rf_rx > 0).astype(int)
    rf_error = np.mean(bits != rf_bits)
    rf_ber.append(rf_error)

    # FSO link: use a randomly selected illustrative attenuation
    loss_db = rng.choice(fso_loss_db)
    effective_ebn0 = 10 ** ((db - loss_db) / 10)

    fso_noise = rng.normal(
        0, np.sqrt(1 / (2 * effective_ebn0)), N
    )
    fso_rx = tx + fso_noise
    fso_bits = (fso_rx > 0).astype(int)
    fso_error = np.mean(bits != fso_bits)
    fso_ber.append(fso_error)

    # Basic switching: select the link with lower observed BER
    # This is an offline benchmark, not a deployable selector.
    if rf_error <= fso_error:
        hybrid_ber.append(rf_error)
        selected_links.append("RF")
    else:
        hybrid_ber.append(fso_error)
        selected_links.append("FSO")

print("Hybrid RF-FSO Link Results")
print("-" * 65)
print("Eb/N0 | RF BER    | FSO BER   | Hybrid BER | Selected")

for db, r, f, h, link in zip(
    ebn0_db, rf_ber, fso_ber, hybrid_ber, selected_links
):
    print(
        f"{db:>4} dB | {r:.6f} | {f:.6f} | "
        f"{h:.6f} | {link}"
    )

plt.figure(figsize=(8, 5))
plt.semilogy(ebn0_db, rf_ber, "o-", label="RF")
plt.semilogy(ebn0_db, fso_ber, "s-", label="FSO")
plt.semilogy(ebn0_db, hybrid_ber, "^-", label="Hybrid benchmark")

plt.xlabel("Nominal Eb/N0 (dB)")
plt.ylabel("Bit Error Rate (BER)")
plt.title("Hybrid RF-FSO Link: Illustrative Comparison")
plt.grid(True, which="both")
plt.legend()
plt.tight_layout()
plt.savefig("hybrid_link_ber.png", dpi=300)
plt.show()
