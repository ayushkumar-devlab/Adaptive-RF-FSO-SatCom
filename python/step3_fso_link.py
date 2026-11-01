
import numpy as np
import matplotlib.pyplot as plt

rng = np.random.default_rng(123)

N = 100_000
bits = rng.integers(0, 2, N)
tx = 2 * bits - 1

ebn0_db = np.arange(0, 15, 2)

# Illustrative atmospheric attenuation scenarios.
# These are assumed model parameters, not measured weather data.
attenuation_db = {
    "Clear atmosphere (0 dB)": 0,
    "Moderate attenuation (5 dB)": 5,
    "High attenuation (10 dB)": 10,
}

plt.figure(figsize=(8, 5))

for label, loss_db in attenuation_db.items():
    ber = []

    for db in ebn0_db:
        # Effective SNR after optical path attenuation
        effective_ebn0_db = db - loss_db
        effective_ebn0 = 10 ** (effective_ebn0_db / 10)

        noise = rng.normal(
            0, np.sqrt(1 / (2 * effective_ebn0)), N
        )

        rx = tx + noise
        received_bits = (rx > 0).astype(int)
        ber.append(np.mean(bits != received_bits))

    plt.semilogy(ebn0_db, ber, "o-", label=label)

    print(f"\n{label}")
    for db, error in zip(ebn0_db, ber):
        print(f"Eb/N0 = {db:2d} dB | BER = {error:.6f}")

plt.xlabel("Nominal Eb/N0 (dB)")
plt.ylabel("Bit Error Rate (BER)")
plt.title("Illustrative FSO Link Under Atmospheric Attenuation")
plt.grid(True, which="both")
plt.legend()
plt.tight_layout()
plt.savefig("fso_link_ber.png", dpi=300)
plt.show()
