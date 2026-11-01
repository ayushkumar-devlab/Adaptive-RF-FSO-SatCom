
clear;
clc;
close all;
rng(1);

% Output directory
projectDir = 'D:\SATCom_Project';
resultsDir = fullfile(projectDir, 'results');

if ~exist(resultsDir, 'dir')
    mkdir(resultsDir);
end

% Generate data and modulate using BPSK
N = 100000;
bits = randi([0 1], N, 1);
tx = 2*bits - 1;

EbN0_dB = 0:2:14;
BER_simulated = zeros(size(EbN0_dB));
BER_theoretical = zeros(size(EbN0_dB));

for k = 1:length(EbN0_dB)
    gamma = 10^(EbN0_dB(k)/10);
    noise = sqrt(1/(2*gamma)) * randn(N,1);
    rx = tx + noise;
    received_bits = rx > 0;

    BER_simulated(k) = mean(bits ~= received_bits);
    BER_theoretical(k) = 0.5 * erfc(sqrt(gamma));
end

% Display results
T = table(EbN0_dB(:), BER_simulated(:), BER_theoretical(:), ...
    'VariableNames', ...
    {'EbN0_dB', 'BER_Simulated', 'BER_Theoretical'});
disp(T);

% Create and save the figure
fig = figure('Color', 'w', 'Visible', 'on');

semilogy(EbN0_dB, max(BER_simulated, 0.5/N), ...
    'bo-', 'LineWidth', 1.5, 'MarkerSize', 6);
hold on;
semilogy(EbN0_dB, BER_theoretical, 'r--', 'LineWidth', 1.8);

grid on;
set(gca, 'Color', 'w', 'XColor', 'k', 'YColor', 'k');
xlabel('E_b/N_0 (dB)', 'Color', 'k');
ylabel('Bit Error Rate (BER)', 'Color', 'k');
title('BPSK over AWGN: Simulated vs Theoretical BER', 'Color', 'k');
legend('Simulated BER', 'Theoretical BER', 'Location', 'southwest');

drawnow;

% Save the figure and data
exportgraphics(fig, fullfile(resultsDir, ...
    'bpsk_baseline_validation.png'), 'Resolution', 300);

writetable(T, fullfile(resultsDir, ...
    'bpsk_baseline_validation.csv'));

fprintf('\nBaseline validation completed.\n');
fprintf('Results folder: %s\n', resultsDir);
