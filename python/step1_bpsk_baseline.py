
import numpy as np
import matplotlib.pyplot as plt

# Reproducible simulation
rng = np.random.default_rng(1)

N = 100_000
bits = rng.integers(0, 2, N)
tx = 2 * bits - 1

ebn0_db = np.arange(0, 15, 2)
ber = []

for db in ebn0_db:
    ebn0 = 10 ** (db / 10)
    noise = rng.normal(0, np.sqrt(1 / (2 * ebn0)), N)
    rx = tx + noise
    received_bits = (rx > 0).astype(int)
    ber.append(np.mean(bits != received_bits))

for db, error in zip(ebn0_db, ber):
    print(f"Eb/N0 = {db:2d} dB, BER = {error:.6f}")

plt.semilogy(ebn0_db, ber, "o-")
plt.xlabel("Eb/N0 (dB)")
plt.ylabel("Bit Error Rate (BER)")
plt.title("BPSK Communication over AWGN Channel")
plt.grid(True, which="both")
plt.tight_layout()
plt.savefig("bpsk_baseline.png", dpi=300)
plt.show()
