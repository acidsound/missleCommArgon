# AEGIS DOME // 3D Missile Command

## Overview
A self-contained 3D Missile Command tactical arcade web game built with Three.js (`r180`) and procedural Web Audio API sound synthesis.

## Project Structure
- `index.html`: Main game entry point, tactical HUD overlay, radar minimap, and game state modals.
- `css/style.css`: NORAD/cyber-vector tactical UI styling, HUD panels, and responsive layout.
- `js/main.js`: Core `MissileCommand3D` controller, 3D predictive targeting & threat-lock system, camera presets, wave manager, and WebXR-compatible animation loop.
- `js/xr.js`: `WebXRSubsystem` supporting `immersive-vr` and `immersive-ar` (MR passthrough), dual 6DoF controller laser pointers, haptic feedback, 3 XR scale modes (`TABLETOP`, `COMMANDER`, `CITADEL`), and an interactive 3D Holographic Command Console.
- `js/world.js`: `DefenseWorld`, procedural valley terrain, radar sweep, starfield, 6 `City` bio-domes, and 3 articulated `Battery` missile turrets (`ALPHA`, `BRAVO`, `CHARLIE`).
- `js/entities.js`: `CounterMissile`, `EnemyMissile` (`ICBM`, `MIRV`, `SMART`), `OrbitalBomber`, 3D `PlasmaExplosion` spheres, and `ParticleSystem`.
- `js/audio.js`: Procedural Web Audio API synthesizer (`SoundManager`).
- `vendor/three/`: Local bundled Three.js (`0.180.0`) core and post-processing/control addons.
