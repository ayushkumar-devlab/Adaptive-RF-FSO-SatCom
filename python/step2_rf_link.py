import numpy as np
import matplotlib.pyplot as plt

# Reproducible RF link simulation
rng = np.random.default_rng(42)

N = 100_000
bits = rng.integers(0, 2, N)
tx = 2 * bits - 1  # BPSK modulation

ebn0_db = np.arange(0, 15, 2)
ber = []

# Simplified RF channel: additive white Gaussian noise
for db in ebn0_db:
    ebn0 = 10 ** (db / 10)
    noise = rng.normal(0, np.sqrt(1 / (2 * ebn0)), N)

    rx = tx + noise
    received_bits = (rx > 0).astype(int)
    errors = np.sum(bits != received_bits)
    ber.append(errors / N)

# Display results
print("RF Satellite Link - BPSK over AWGN")
print("-" * 42)

for db, error in zip(ebn0_db, ber):
    print(f"Eb/N0 = {db:2d} dB | BER = {error:.6f}")

# Plot BER
plt.figure(figsize=(8, 5))
plt.semilogy(ebn0_db, ber, "o-", label="RF link")
plt.xlabel("Eb/N0 (dB)")
plt.ylabel("Bit Error Rate (BER)")
plt.title("Simulated RF Link Performance")
plt.grid(True, which="both")
plt.legend()
plt.tight_layout()
plt.savefig("rf_link_ber.png", dpi=300)
plt.show()
