import React, { useState, useEffect } from 'react';
import { Box, Text } from 'ink';
import { APP_VERSION } from '../cli/constants.js';

interface WelcomeProps {
  model: string;
  cwd: string;
  onAnimationDone?: () => void;
  yolo?: boolean;
}

// Block letter "ORTHOS" — same weight as the old CODE letters (exported for static banner)
export const LOGO = [
  ' ██████  ██████  ████████ ██   ██  ██████  ███████',
  '██    ██ ██   ██    ██    ██   ██ ██    ██ ██     ',
  '██    ██ ██████     ██    ███████ ██    ██ ███████',
  '██    ██ ██   ██    ██    ██   ██ ██    ██      ██',
  ' ██████  ██   ██    ██    ██   ██  ██████  ███████',
];

export const LOGO_WIDTH = 50; // character width of the logo
export const STRIPE_CHAR = '\u2571'; // ╱ diagonal

// Static banner (no animation) — used as first item in Static for permanent header
export function WelcomeBanner({ model, cwd, yolo }: { model: string; cwd: string; yolo?: boolean }) {
  const home = process.env.HOME || process.env.USERPROFILE || '';
  const displayCwd = home && cwd.startsWith(home)
    ? '~' + cwd.slice(home.length).replace(/\\/g, '/')
    : cwd.replace(/\\/g, '/');
  const versionStr = `v${APP_VERSION}`;

  return (
    <Box flexDirection="column" paddingX={1}>
      <Text color="blue" dimColor>{STRIPE_CHAR.repeat(LOGO_WIDTH)}</Text>
      {LOGO.map((line, i) => (
        <Box key={i}>
          <Text color="cyan" bold>{line}</Text>
          {i === 0 && <Text color="blue"> {versionStr}</Text>}
        </Box>
      ))}
      <Text color="blue" dimColor>{STRIPE_CHAR.repeat(LOGO_WIDTH)}</Text>
      <Text dimColor>{displayCwd}</Text>
      <Text> </Text>
      {model ? (
        <Text>
          <Text dimColor>Model: </Text>
          <Text bold color="cyan">{model}</Text>
        </Text>
      ) : (
        <Text color="yellow">No model selected — type /model to choose</Text>
      )}
      {yolo && <Text color="yellow" bold> YOLO</Text>}
      <Text> </Text>
    </Box>
  );
}

export function Welcome({ model, cwd, onAnimationDone, yolo }: WelcomeProps) {
  const [phase, setPhase] = useState(0);
  const stripeWidth = LOGO_WIDTH;

  useEffect(() => {
    const timers = [
      setTimeout(() => setPhase(1), 300),
      setTimeout(() => setPhase(2), 800),
      setTimeout(() => {
        setPhase(3);
        onAnimationDone?.();
      }, 1400),
    ];
    return () => timers.forEach(clearTimeout);
  }, [onAnimationDone]);

  // Shorten cwd for display
  const home = process.env.HOME || process.env.USERPROFILE || '';
  const displayCwd = home && cwd.startsWith(home)
    ? '~' + cwd.slice(home.length).replace(/\\/g, '/')
    : cwd.replace(/\\/g, '/');

  const versionStr = `v${APP_VERSION}`;

  return (
    <Box flexDirection="column" paddingX={0} paddingTop={0}>
      {/* Phase 0: blank */}
      {phase === 0 && <Text> </Text>}

      {/* Phase 1+: Banner */}
      {phase >= 1 && (
        <Box flexDirection="column" paddingX={1}>
          {/* Top stripe */}
          <Text color="blue" dimColor>{STRIPE_CHAR.repeat(stripeWidth)}</Text>

          {/* Logo lines — version aligned right on first line */}
          {LOGO.map((line, i) => (
            <Box key={i}>
              <Text color="cyan" bold>{line}</Text>
              {i === 0 && (
                <Text color="blue"> {versionStr}</Text>
              )}
            </Box>
          ))}

          {/* Bottom stripe */}
          <Text color="blue" dimColor>{STRIPE_CHAR.repeat(stripeWidth)}</Text>
        </Box>
      )}

      {/* Phase 2+: Working dir + Model info */}
      {phase >= 2 && (
        <Box flexDirection="column" paddingX={1} marginTop={0}>
          <Text dimColor>{displayCwd}</Text>
          <Text> </Text>
          {model ? (
            <Text>
              <Text dimColor>Model: </Text>
              <Text bold color="cyan">{model}</Text>
            </Text>
          ) : (
            <Text color="yellow">No model selected — type /model to choose</Text>
          )}

          {yolo && (
            <Text color="yellow" bold> YOLO</Text>
          )}
        </Box>
      )}

      {/* Phase 3: Ready state */}
      {phase >= 3 && (
        <Box flexDirection="column" paddingX={1} marginTop={0}>
          <Text> </Text>
        </Box>
      )}
    </Box>
  );
}
