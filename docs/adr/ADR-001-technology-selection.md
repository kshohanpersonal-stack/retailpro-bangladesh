# ADR-001 — Technology Selection
**Status:** Accepted (2026-11-03)
**Context:** Windows desktop, fully offline, Bengali UI/PDF, thermal printing, lifetime licensing, buildable in a network-restricted sandbox and on GitHub Actions.
**Decision:** TypeScript monorepo; Electron 39 shell; React 19 + Vite 7 renderer; Vitest 3; electron-builder 26 (NSIS).
**Alternatives considered:** .NET/WPF (excellent Windows fit but weaker cross-platform CI story and heavier PDF/printing stack for Bengali); Tauri (smaller binaries but Rust toolchain + WebView2 Bengali printing variability); pure web app (fails the Windows EXE/installer requirement).
**Consequences:** One language across layers; Chromium guarantees Bengali rendering for UI and print; large binary size accepted (essential functionality over size per spec); Electron binary download is skipped in the sandbox (web preview used) and performed on CI.
